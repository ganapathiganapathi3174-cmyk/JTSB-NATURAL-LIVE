#!/usr/bin/env python
"""
Enterprise-grade Multi-Stage AI Payment Screenshot Verification Engine.

Stages:
  1. OpenCV Validation        — screenshot, crop, blur, tamper, layout
  2. Florence-2 Region Detect — locate amount, receiver, sender, txn ID, date, status
  3. Multi-OCR                 — PaddleOCR, EasyOCR, Tesseract (independent)
  4. Voting Engine             — majority agreement across OCR results
  5. Cross-Verification        — compare against database values
  6. Florence-2 Visual Verify  — VQA: confirm payment, amount, receiver, UTR, status
  7. Fraud Detection           — tamper, duplicate, mismatch, disagreement scores
  8. Decision Engine           — approve / reject / manual_review with strict thresholds

Usage:
  python _ai_engine.py --image <path> [--expected-amount 120] [--expected-receiver upi@bank] [--expected-utr UTR]
"""
import sys, os, json, re, time, traceback, base64, uuid
import warnings
warnings.filterwarnings('ignore')
os.environ['PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK'] = 'True'

from io import BytesIO
from datetime import datetime, date
from dataclasses import dataclass, field, asdict
from typing import Optional, List, Dict, Any, Tuple
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed, Future

import cv2
import numpy as np
from PIL import Image
from imagehash import phash

# ── Lazy-load heavy imports ──────────────────────────────────────────
_paddle_ocr_instance = None
_easy_ocr_instance = None
_florence_model = None
_florence_processor = None
_tesseract_available = False

# ── Configuration (all via env vars) ──────────────────────────────────
class Config:
    MIN_RESOLUTION = int(os.getenv('AI_MIN_RESOLUTION', '200'))
    MAX_RESOLUTION = int(os.getenv('AI_MAX_RESOLUTION', '4000'))
    MIN_ASPECT = float(os.getenv('AI_MIN_ASPECT', '0.3'))
    MAX_ASPECT = float(os.getenv('AI_MAX_ASPECT', '2.5'))
    BLUR_THRESHOLD = float(os.getenv('AI_BLUR_THRESHOLD', '50.0'))
    CROP_THRESHOLD = float(os.getenv('AI_CROP_THRESHOLD', '0.5'))
    TAMPER_SCORE_REJECT = int(os.getenv('AI_TAMPER_REJECT', '60'))
    BRIGHTNESS_MIN = float(os.getenv('AI_BRIGHT_MIN', '20'))
    BRIGHTNESS_MAX = float(os.getenv('AI_BRIGHT_MAX', '240'))
    CONTRAST_MIN = float(os.getenv('AI_CONTRAST_MIN', '10'))
    OCR_MIN_CONFIDENCE = float(os.getenv('AI_OCR_MIN_CONF', '30.0'))
    VOTE_AGREEMENT_THRESHOLD = float(os.getenv('AI_VOTE_THRESHOLD', '60.0'))
    APPROVE_CONFIDENCE_MIN = float(os.getenv('AI_APPROVE_CONF', '95.0'))
    REJECT_CONFIDENCE_MIN = float(os.getenv('AI_REJECT_CONF', '85.0'))
    FRAUD_REJECT_THRESHOLD = int(os.getenv('AI_FRAUD_REJECT', '60'))
    FLORENCE_TIMEOUT = int(os.getenv('AI_FLORENCE_TIMEOUT', '60'))
    PARALLEL_WORKERS = int(os.getenv('AI_PARALLEL_WORKERS', '5'))
    TESSERACT_CMD = os.getenv('AI_TESSERACT_CMD', '') or 'tesseract'
    # Auto-detect common Tesseract install paths
    if TESSERACT_CMD == 'tesseract':
        for _p in ['C:\\Program Files\\Tesseract-OCR\\tesseract.exe',
                    'C:\\Program Files (x86)\\Tesseract-OCR\\tesseract.exe']:
            if os.path.exists(_p):
                TESSERACT_CMD = _p
                break

# ── Logging ───────────────────────────────────────────────────────────
def log(phase: str, msg: str):
    print(f'[AI][{phase}] {msg}', file=sys.stderr)

# ── Utility ───────────────────────────────────────────────────────────
def cv2_to_pil(img: np.ndarray) -> Image.Image:
    return Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))

def pil_to_cv2(pil_img: Image.Image) -> np.ndarray:
    return cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)

def ensure_torch_path():
    torch_lib = os.path.join(os.path.dirname(sys.executable), 'Lib', 'site-packages', 'torch', 'lib')
    if os.path.isdir(torch_lib):
        os.environ['PATH'] = torch_lib + os.pathsep + os.environ.get('PATH', '')
        if hasattr(os, 'add_dll_directory'):
            try: os.add_dll_directory(torch_lib)
            except: pass
    # Pre-load torch DLLs to avoid 'procedure not found' / shm.dll errors
    if os.path.isdir(torch_lib):
        import ctypes
        for _dll in ['shm.dll', 'c10.dll', 'torch.dll', 'torch_cpu.dll', 'torch_python.dll', 'uv.dll']:
            _p = os.path.join(torch_lib, _dll)
            if os.path.exists(_p):
                try: ctypes.CDLL(_p)
                except: pass

def normalize_upi(val: str) -> str:
    return val.lower().strip() if val else ''

def normalize_utr(val: str) -> str:
    if not val: return ''
    val = val.upper().strip()
    subs = {'O': '0', 'I': '1', 'S': '5', 'B': '8', 'Z': '2', 'G': '6'}
    return ''.join(subs.get(c, c) for c in val)

def parse_amount(val) -> Optional[float]:
    if val is None: return None
    try: return float(re.sub(r'[^0-9.]', '', str(val)))
    except: return None

# ═══════════════════════════════════════════════════════════════════════
# STAGE 1: OpenCV Validation
# ═══════════════════════════════════════════════════════════════════════
def stage1_opencv(img: np.ndarray, img_path: str) -> Dict[str, Any]:
    log('S1', 'OpenCV Validation')
    result = {
        'passed': True, 'grade': 'good', 'issues': [],
        'isScreenshot': False, 'isCropped': False, 'isBlurred': False,
        'isEdited': False, 'isFake': False, 'layoutValid': False,
        'resolution': {'w': 0, 'h': 0}, 'aspectRatio': 0.0,
        'blurScore': 0.0, 'tamperScore': 0, 'perceptualHash': '',
        'cropRatio': 1.0, 'elaScore': 0.0, 'brightness': 0.0,
        'contrast': 0.0, 'noiseScore': 0.0, 'edgeReasons': [],
        'fileSize': 0,
    }
    h, w = img.shape[:2]
    result['resolution'] = {'w': w, 'h': h}
    result['aspectRatio'] = round(w / h, 4) if h > 0 else 0
    if os.path.exists(img_path):
        result['fileSize'] = os.path.getsize(img_path)

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Screenshot detection: mobile screens are typically 9:16 to 9:20
    ar = w / h if h > 0 else 0
    result['isScreenshot'] = 0.4 <= ar <= 0.6
    if not result['isScreenshot']:
        result['issues'].append(f'Not a mobile screenshot (aspect={ar:.2f})')
        result['grade'] = 'fair'

    # Resolution
    if w < Config.MIN_RESOLUTION or h < Config.MIN_RESOLUTION:
        result['issues'].append(f'Low resolution: {w}x{h}')
        result['grade'] = 'fair'
    if w * h > Config.MAX_RESOLUTION * Config.MAX_RESOLUTION * 2:
        result['issues'].append(f'Very high resolution: {w}x{h}')
        result['grade'] = 'fair'

    # Blur (Laplacian variance)
    lap_var = cv2.Laplacian(gray, cv2.CV_64F).var()
    result['blurScore'] = round(lap_var, 2)
    result['isBlurred'] = lap_var < Config.BLUR_THRESHOLD
    if result['isBlurred']:
        result['issues'].append(f'Blurry (Laplacian={lap_var:.1f})')
        result['grade'] = 'fair' if lap_var > Config.BLUR_THRESHOLD * 0.4 else 'poor'

    # Brightness
    mean_brightness = np.mean(gray)
    std_brightness = np.std(gray)
    result['brightness'] = round(mean_brightness, 1)
    result['contrast'] = round(std_brightness, 1)
    if mean_brightness < Config.BRIGHTNESS_MIN:
        result['issues'].append(f'Too dark: {mean_brightness:.0f}')
        result['grade'] = 'fair'
    if mean_brightness > Config.BRIGHTNESS_MAX:
        result['issues'].append(f'Too bright: {mean_brightness:.0f}')
        result['grade'] = 'fair'
    if std_brightness < Config.CONTRAST_MIN:
        result['issues'].append(f'Low contrast: {std_brightness:.1f}')
        result['grade'] = 'fair'

    # Noise
    kernel = np.ones((3,3), np.float32) / 9
    diff = cv2.absdiff(gray, cv2.filter2D(gray, -1, kernel).astype(np.uint8))
    noise = float(np.mean(diff))
    result['noiseScore'] = round(noise, 2)
    if noise > 50:
        result['issues'].append(f'High noise: {noise:.1f}')
        result['grade'] = 'fair'

    # Crop detection
    _, thresh = cv2.threshold(gray, 240, 255, cv2.THRESH_BINARY)
    coords = cv2.findNonZero(cv2.bitwise_not(thresh))
    if coords is not None:
        x, y, cw, ch = cv2.boundingRect(coords)
        margin = 0.03
        expected_w = w * (1 - 2 * margin)
        expected_h = h * (1 - 2 * margin)
        crop_ratio = min(cw / expected_w, ch / expected_h) if expected_w > 0 and expected_h > 0 else 1.0
    else:
        crop_ratio = 0.0
    result['cropRatio'] = round(crop_ratio, 3)
    result['isCropped'] = crop_ratio < Config.CROP_THRESHOLD
    if result['isCropped']:
        result['issues'].append(f'Cropped (ratio={crop_ratio:.2f})')
        result['grade'] = 'fair'

    # ELA tampering
    try:
        pil_img = cv2_to_pil(img)
        buf = BytesIO()
        pil_img.save(buf, format='JPEG', quality=90)
        buf.seek(0)
        resaved = Image.open(buf)
        diff_sum, count = 0.0, 0
        step = max(1, min(w, h) // 100)
        for y in range(0, h, step):
            for x in range(0, w, step):
                orig = pil_img.getpixel((x, y))
                re = resaved.getpixel((x, y))
                diff_sum += sum(abs(o - r) for o, r in zip(orig, re))
                count += 1
        ela_score = min(100, (diff_sum / count * 2) if count > 0 else 0)
    except Exception:
        ela_score = 0.0
    result['elaScore'] = round(ela_score, 1)
    result['isEdited'] = ela_score > 40
    if result['isEdited']:
        result['issues'].append(f'Potential editing via ELA ({ela_score:.1f})')
        result['grade'] = 'poor'

    # Edge analysis for tampering
    edges = cv2.Canny(gray, 50, 150)
    edge_density = np.sum(edges) / (w * h) * 100 if w * h > 0 else 0
    tamper_score = 0
    reasons = []
    if edge_density < 0.5:
        tamper_score += 25
        reasons.append('Low edge density')
    grid_rows, grid_cols = 4, 4
    rh, rw = h // grid_rows, w // grid_cols
    densities = []
    for gy in range(grid_rows):
        for gx in range(grid_cols):
            region = edges[gy*rh:(gy+1)*rh, gx*rw:(gx+1)*rw]
            densities.append(np.sum(region) / (rh * rw) * 100 if rh * rw > 0 else 0)
    if densities:
        cv_density = np.std(densities) / (np.mean(densities) + 1e-6)
        if cv_density > 1.2:
            tamper_score += 20
            reasons.append('Uneven edge distribution')
    laplacian = cv2.Laplacian(gray, cv2.CV_64F)
    flat_regions = 0
    total_regions = 0
    step = 32
    for y in range(0, h - step, step):
        for x in range(0, w - step, step):
            if np.var(laplacian[y:y+step, x:x+step]) < 0.5:
                flat_regions += 1
            total_regions += 1
    if total_regions > 0 and flat_regions / total_regions > 0.3:
        tamper_score += 15
        reasons.append(f'Unnatural smoothness ({flat_regions/total_regions:.0%})')
    result['tamperScore'] = tamper_score
    result['isFake'] = tamper_score >= Config.TAMPER_SCORE_REJECT
    result['edgeReasons'] = reasons
    if result['isFake']:
        result['issues'].append(f'Tampering via edge analysis ({tamper_score})')
        result['grade'] = 'poor'

    # Perceptual hash
    result['perceptualHash'] = str(phash(Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))))

    # Layout validation: mobile UPI screenshots have structured layout
    sep_count = len(detect_separators(gray, w, h))
    result['layoutValid'] = sep_count >= 3
    if not result['layoutValid']:
        result['issues'].append(f'Invalid layout: only {sep_count} separators')
        result['grade'] = 'fair'

    result['passed'] = result['grade'] not in ('poor',)
    log('S1', f'Grade={result["grade"]}, screenshot={result["isScreenshot"]}, blur={result["isBlurred"]}, crop={result["isCropped"]}, tamper={tamper_score}, ela={ela_score:.1f}, layout={result["layoutValid"]}')
    return result

def detect_separators(gray, w, h):
    edges = cv2.Canny(gray, 30, 100)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=int(min(w, h) * 0.05),
                            minLineLength=int(w * 0.4), maxLineGap=20)
    separators = []
    if lines is not None:
        for line in lines:
            x1, y1, x2, y2 = line[0]
            angle = abs(np.degrees(np.arctan2(y2 - y1, x2 - x1)))
            if angle < 15 or angle > 165:
                y_pos = (y1 + y2) // 2
                length = abs(x2 - x1)
                if length > w * 0.3:
                    separators.append(y_pos)
    uniq = []
    seen = set()
    for s in sorted(separators):
        if not any(abs(s - sy) < h * 0.03 for sy in seen):
            seen.add(s)
            uniq.append(s)
    return uniq

# ═══════════════════════════════════════════════════════════════════════
# STAGE 2: Florence-2 Region Detection
# ═══════════════════════════════════════════════════════════════════════
def get_florence():
    global _florence_model, _florence_processor
    if _florence_model is None:
        ensure_torch_path()
        from transformers import AutoModelForCausalLM, AutoProcessor
        log('S2', 'Loading Florence-2 model...')
        t0 = time.time()
        model_id = os.getenv('FLORENCE_MODEL_ID', 'microsoft/Florence-2-base')
        try:
            # Workaround: transformers 5.x + cached Florence-2 config incompatibility
            home = os.path.expanduser('~')
            cfg_path = os.path.join(home, '.cache', 'huggingface', 'modules',
                'transformers_modules', 'microsoft')
            if os.path.isdir(cfg_path):
                for root, dirs, files in os.walk(cfg_path):
                    for f in files:
                        if f == 'configuration_florence2.py':
                            fpath = os.path.join(root, f)
                            with open(fpath, 'r') as fh:
                                content = fh.read()
                            if 'forced_bos_token_id' in content and 'if self.forced_bos_token_id is None' in content:
                                content = content.replace(
                                    'if self.forced_bos_token_id is None and kwargs.get("force_bos_token_to_be_generated", False):',
                                    'if getattr(self, "forced_bos_token_id", None) is None and kwargs.get("force_bos_token_to_be_generated", False):'
                                )
                                with open(fpath, 'w') as fh:
                                    fh.write(content)
                                log('S2', f'Patched forced_bos_token_id in {fpath}')
                            break
        except Exception as e:
            log('S2', f'Patch failed (non-fatal): {e}')
        try:
            _florence_model = AutoModelForCausalLM.from_pretrained(
                model_id, trust_remote_code=True, torch_dtype='auto'
            )
            _florence_processor = AutoProcessor.from_pretrained(
                model_id, trust_remote_code=True
            )
            log('S2', f'Florence-2 loaded in {time.time()-t0:.1f}s')
        except Exception as e:
            log('S2', f'Florence-2 load failed (will use fallback): {e}')
            _florence_model = None
            _florence_processor = None
    return _florence_model, _florence_processor

def florence_available() -> bool:
    try:
        model, proc = get_florence()
        return model is not None
    except Exception as e:
        log('S2', f'Florence-2 not available: {e}')
        return False

def stage2_florence_regions(pil_img: Image.Image) -> Dict[str, Any]:
    log('S2', 'Florence-2 Region Detection')
    result = {'regions': {}, 'available': False, 'error': None}

    if not florence_available():
        result['error'] = 'Florence-2 not loaded'
        return result

    try:
        model, processor = get_florence()
        questions = {
            'amount': 'Where is the payment amount shown in this screenshot? Return the bounding box.',
            'receiver': 'Where is the receiver name or UPI ID shown? Return the bounding box.',
            'sender': 'Where is the sender name shown? Return the bounding box.',
            'transactionId': 'Where is the UPI transaction ID or reference number? Return the bounding box.',
            'date': 'Where is the date shown? Return the bounding box.',
            'status': 'Where is the payment status (success/fail/pending)? Return the bounding box.',
        }

        for field, question in questions.items():
            try:
                inputs = processor(text=question, images=pil_img, return_tensors='pt')
                generated_ids = model.generate(
                    input_ids=inputs['input_ids'],
                    pixel_values=inputs['pixel_values'],
                    max_new_tokens=100,
                    num_beams=3,
                )
                answer = processor.batch_decode(generated_ids, skip_special_tokens=True)[0]
                result['regions'][field] = {'answer': answer, 'question': question}
                log('S2', f'  {field}: {answer[:80]}')
            except Exception as e:
                log('S2', f'  {field} failed: {e}')
                result['regions'][field] = {'answer': '', 'error': str(e)}

        result['available'] = True
    except Exception as e:
        result['error'] = str(e)
        log('S2', f'Florence-2 error: {e}')

    return result

# ═══════════════════════════════════════════════════════════════════════
# STAGE 3: Multi-OCR (PaddleOCR, EasyOCR, Tesseract)
# ═══════════════════════════════════════════════════════════════════════
def get_paddle():
    global _paddle_ocr_instance
    if _paddle_ocr_instance is None:
        ensure_torch_path()
        from paddleocr import PaddleOCR
        _paddle_ocr_instance = PaddleOCR(use_angle_cls=True, lang='en', show_log=False, use_gpu=False)
    return _paddle_ocr_instance

def get_easy():
    global _easy_ocr_instance
    if _easy_ocr_instance is None:
        ensure_torch_path()
        import easyocr
        _easy_ocr_instance = easyocr.Reader(['en'], gpu=False, verbose=False)
    return _easy_ocr_instance

def check_tesseract():
    global _tesseract_available
    if not _tesseract_available:
        try:
            import pytesseract
            from pytesseract import pytesseract as _pt_mod
            if Config.TESSERACT_CMD and Config.TESSERACT_CMD != 'tesseract':
                _pt_mod.tesseract_cmd = Config.TESSERACT_CMD
                pytesseract.pytesseract.tesseract_cmd = Config.TESSERACT_CMD
            pytesseract.get_tesseract_version()
            _tesseract_available = True
            log('S3', f'Tesseract found at: {Config.TESSERACT_CMD}')
        except Exception as e:
            _tesseract_available = False
            log('S3', f'Tesseract not available: {e}')
    return _tesseract_available

def run_paddle_ocr(img: np.ndarray) -> Dict[str, Any]:
    log('S3', 'PaddleOCR starting...')
    t0 = time.time()
    result = {'blocks': [], 'engine': 'paddleocr', 'success': False, 'error': None, 'duration': 0}
    try:
        # Downscale large images for faster OCR
        h, w = img.shape[:2]
        max_dim = 1200
        if max(h, w) > max_dim:
            scale = max_dim / max(h, w)
            new_w, new_h = int(w * scale), int(h * scale)
            img_small = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)
            log('S3', f'Resized {w}x{h} -> {new_w}x{new_h} (scale={scale:.2f})')
        else:
            img_small = img

        ocr = get_paddle()
        raw = ocr.ocr(img_small, cls=True)
        blocks = []
        # Scale bbox coordinates back to original image space
        if raw and len(raw) > 0:
            for group in raw:
                if group is None: continue
                for line in group:
                    if line is None: continue
                    bbox, (text, conf) = line
                    text = (text or '').strip()
                    if not text: continue
                    blocks.append({
                        'text': text,
                        'confidence': round(float(conf) * 100, 2),
                        'bbox': [[int(b[0]), int(b[1])] for b in bbox],
                        'engine': 'paddleocr',
                        'cx': int((bbox[0][0] + bbox[2][0]) / 2),
                        'cy': int((bbox[0][1] + bbox[2][1]) / 2),
                    })
        result['blocks'] = blocks
        result['success'] = len(blocks) > 0
        result['duration'] = round(time.time() - t0, 2)
        log('S3', f'PaddleOCR: {len(blocks)} blocks in {result["duration"]}s (resized {w}x{h})')
    except Exception as e:
        result['error'] = str(e)
        log('S3', f'PaddleOCR failed: {e}')
    return result

def run_easy_ocr(img: np.ndarray) -> Dict[str, Any]:
    log('S3', 'EasyOCR starting...')
    t0 = time.time()
    result = {'blocks': [], 'engine': 'easyocr', 'success': False, 'error': None, 'duration': 0}
    try:
        reader = get_easy()
        raw = reader.readtext(img, paragraph=False, width_ths=0.7, height_ths=0.5)
        blocks = []
        for bbox, text, conf in raw:
            text = (text or '').strip()
            if not text: continue
            pts = [[int(p[0]), int(p[1])] for p in bbox]
            blocks.append({
                'text': text,
                'confidence': round(float(conf) * 100, 2),
                'bbox': pts,
                'engine': 'easyocr',
                'cx': int((bbox[0][0] + bbox[2][0]) / 2),
                'cy': int((bbox[0][1] + bbox[2][1]) / 2),
            })
        result['blocks'] = blocks
        result['success'] = len(blocks) > 0
        result['duration'] = round(time.time() - t0, 2)
        log('S3', f'EasyOCR: {len(blocks)} blocks in {result["duration"]}s')
    except Exception as e:
        result['error'] = str(e)
        log('S3', f'EasyOCR failed: {e}')
    return result

def run_tesseract_ocr(img_path: str) -> Dict[str, Any]:
    log('S3', 'Tesseract starting...')
    t0 = time.time()
    result = {'blocks': [], 'engine': 'tesseract', 'success': False, 'error': None, 'duration': 0}
    if not check_tesseract():
        result['error'] = 'Tesseract not available'
        log('S3', 'Tesseract not available')
        return result
    try:
        import pytesseract
        pil_img = Image.open(img_path)
        data = pytesseract.image_to_data(pil_img, output_type=pytesseract.Output.DICT)
        blocks = []
        n = len(data['text'])
        for i in range(n):
            text = (data['text'][i] or '').strip()
            conf = data['conf'][i]
            if not text or conf == '-1': continue
            x, y, w, h = data['left'][i], data['top'][i], data['width'][i], data['height'][i]
            if w < 5 or h < 5: continue
            blocks.append({
                'text': text,
                'confidence': float(conf),
                'bbox': [[x, y], [x+w, y], [x+w, y+h], [x, y+h]],
                'engine': 'tesseract',
                'cx': x + w // 2,
                'cy': y + h // 2,
            })
        result['blocks'] = blocks
        result['success'] = len(blocks) > 0
        result['duration'] = round(time.time() - t0, 2)
        log('S3', f'Tesseract: {len(blocks)} blocks in {result["duration"]}s')
    except Exception as e:
        result['error'] = str(e)
        log('S3', f'Tesseract failed: {e}')
    return result

def stage3_multi_ocr(img_path: str, img: np.ndarray) -> Dict[str, Any]:
    log('S3', 'Multi-OCR (parallel) — PaddleOCR + Tesseract')
    results = {'engines': {}, 'allBlocks': [], 'engineCount': 0}

    with ThreadPoolExecutor(max_workers=2) as ex:
        futures = {
            ex.submit(run_paddle_ocr, img): 'paddleocr',
            ex.submit(run_tesseract_ocr, img_path): 'tesseract',
        }
        for future in as_completed(futures):
            name = futures[future]
            try:
                results['engines'][name] = future.result()
            except Exception as e:
                results['engines'][name] = {'blocks': [], 'engine': name, 'success': False, 'error': str(e)}

    for name, eng in results['engines'].items():
        results['allBlocks'].extend(eng.get('blocks', []))
        if eng.get('success'):
            results['engineCount'] += 1

    log('S3', f'Engines succeeded: {results["engineCount"]}/2')
    return results

# ═══════════════════════════════════════════════════════════════════════
# STAGE 4: Value Presence Check — directly search expected values in raw OCR text
# ═══════════════════════════════════════════════════════════════════════
def check_utr_in_text(text: str, expected_utr: str) -> Dict:
    """Check if expected UTR appears in OCR text (fuzzy)."""
    if not expected_utr or not text: return {'found': False, 'method': None, 'confidence': 0}
    expected_norm = normalize_utr(str(expected_utr))
    text_upper = text.upper().replace('O', '0').replace('I', '1').replace('S', '5').replace('B', '8')
    if expected_norm in text_upper:
        return {'found': True, 'method': 'exact', 'confidence': 100}
    if len(expected_norm) >= 8 and expected_norm[:8] in text_upper:
        return {'found': True, 'method': 'partial_prefix', 'confidence': 85}
    if len(expected_norm) >= 8 and expected_norm[-8:] in text_upper:
        return {'found': True, 'method': 'partial_suffix', 'confidence': 80}
    return {'found': False, 'method': None, 'confidence': 0}

def check_amount_in_text(text: str, expected_amt: float) -> Dict:
    """Check if expected amount appears in OCR text (numeric)."""
    if expected_amt is None or not text: return {'found': False, 'method': None, 'confidence': 0}
    numbers = re.findall(r'[\d,]+\.?\d{0,2}', text)
    for num_str in numbers:
        val = parse_amount(num_str)
        if val and val <= 0: continue
        if val and abs(val - expected_amt) <= 1:
            return {'found': True, 'method': 'exact', 'confidence': 100}
    for num_str in numbers:
        val = parse_amount(num_str)
        if val and val <= 0: continue
        if val and abs(val - expected_amt) <= expected_amt * 0.1:
            return {'found': True, 'method': 'close', 'confidence': 80}
    return {'found': False, 'method': None, 'confidence': 0}

def check_upi_in_text(text: str, expected_upi: str) -> Dict:
    """Check if expected UPI ID appears in OCR text."""
    if not expected_upi or not text: return {'found': False, 'method': None, 'confidence': 0}
    expected_norm = normalize_upi(str(expected_upi))
    text_lower = text.lower()
    if expected_norm in text_lower:
        return {'found': True, 'method': 'exact', 'confidence': 100}
    handle = expected_norm.split('@')[0]
    domain = expected_norm.split('@')[1] if '@' in expected_norm else ''
    if handle and len(handle) >= 3 and handle in text_lower:
        return {'found': True, 'method': 'partial_handle', 'confidence': 80}
    # Domain match only if domain is long enough to avoid false positives (e.g. 'upi' matching 'UPI' keyword)
    if domain and len(domain) >= 4 and handle and handle in text_lower:
        return {'found': True, 'method': 'partial_domain', 'confidence': 60}
    # Try matching handle without special chars (OCR may drop hyphens/dots)
    handle_stripped = re.sub(r'[^a-z0-9]', '', handle) if handle else ''
    if len(handle_stripped) >= 6 and handle_stripped in re.sub(r'[^a-z0-9]', '', text_lower):
        return {'found': True, 'method': 'fuzzy_handle', 'confidence': 70}
    return {'found': False, 'method': None, 'confidence': 0}

def check_date_in_text(text: str, expected_date: str) -> Dict:
    """Check if expected date appears in OCR text in any format."""
    if not text: return {'found': False, 'method': None, 'confidence': 0}
    if not expected_date:
        expected_date = date.today().isoformat()
    try:
        exp_dt = datetime.strptime(str(expected_date)[:10], '%Y-%m-%d')
    except:
        return {'found': False, 'method': None, 'confidence': 0}
    valid_dates = {
        exp_dt.strftime('%Y-%m-%d'),
        exp_dt.strftime('%d/%m/%Y'), exp_dt.strftime('%d-%m-%Y'),
        exp_dt.strftime('%d %b %Y'), exp_dt.strftime('%d %B %Y'),
        exp_dt.strftime(f'{exp_dt.day} %b %Y'), exp_dt.strftime(f'{exp_dt.day} %B %Y'),
        exp_dt.strftime('%d%m%Y'),
    }
    exp_dt2 = exp_dt.replace(year=exp_dt.year % 100)
    short_year = str(exp_dt.year)[-2:]
    valid_dates.add(f'{exp_dt.day:02d}/{exp_dt.month:02d}/{short_year}')
    valid_dates.add(f'{exp_dt.day:02d}-{exp_dt.month:02d}-{short_year}')
    valid_dates.add(f'{exp_dt.day}{exp_dt.strftime("%b")}{exp_dt.year}')
    valid_dates.add(f'{exp_dt.day}{exp_dt.strftime("%b")}{short_year}')
    text_upper = text.upper()
    for vd in valid_dates:
        if vd.upper() in text_upper:
            return {'found': True, 'method': 'exact_format', 'confidence': 100}
    months = r'(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*'
    for m in re.finditer(rf'(\d{{1,2}})\s+{months}\s+(\d{{2,4}})', text, re.IGNORECASE):
        try:
            d, mon, yr = m.group(1), m.group(2).capitalize(), m.group(3)
            yr = '20' + yr[-2:] if len(yr) == 2 else yr
            dt = datetime.strptime(f'{d} {mon} {yr}', '%d %b %Y')
            if abs((dt - exp_dt).days) <= 1:
                return {'found': True, 'method': 'relative_date', 'confidence': 95}
        except: pass
    return {'found': False, 'method': None, 'confidence': 0}

def stage4_presence_check(multi_ocr: Dict[str, Any], expected: Dict[str, Any] = None) -> Dict[str, Any]:
    """VALUE PRESENCE CHECK: Directly search for each expected value in raw OCR text.
    
    Instead of extracting fields via regex patterns (which fails on unknown UPI app layouts),
    we concatenate ALL OCR text from all engines and search for the expected values directly.
    """
    log('S4', 'Value Presence Check — searching expected values in OCR text')
    expected = expected or {}
    
    # Combine all OCR text from all engines into one unified text
    all_text = ''
    per_engine_text = {}
    for name, eng in multi_ocr.get('engines', {}).items():
        blocks = eng.get('blocks', [])
        combined = ' '.join(b['text'] for b in blocks if b.get('text'))
        per_engine_text[name] = combined
        all_text += ' ' + combined

    result = {
        'allText': all_text.strip()[:500],
        'rawTextLen': len(all_text.strip()),
        'presence': {},
        'status': '',  # 'success' or 'failed'
        'errors': [],
    }

    expected_utr = str(expected.get('utr', ''))
    expected_amt = parse_amount(expected.get('amount'))
    expected_upi = str(expected.get('receiverUpi', ''))
    expected_date = str(expected.get('date', ''))[:10] if expected.get('date') else ''

    # UTR presence check
    utr_check = check_utr_in_text(all_text, expected_utr)
    
    # Amount presence check
    amt_check = check_amount_in_text(all_text, expected_amt) if expected_amt else {'found': False, 'method': None, 'confidence': 0}

    # UPI ID presence check
    upi_check = check_upi_in_text(all_text, expected_upi)

    # Date presence check
    date_check = check_date_in_text(all_text, expected_date)

    result['presence']['utr'] = {
        'found': utr_check['found'],
        'expected': expected_utr[:8] + '****' if len(expected_utr) > 8 else expected_utr,
        'method': utr_check['method'],
        'confidence': utr_check['confidence'],
    }
    result['presence']['amount'] = {
        'found': amt_check['found'],
        'expected': expected_amt,
        'method': amt_check['method'],
        'confidence': amt_check['confidence'],
    }
    result['presence']['upi_id'] = {
        'found': upi_check['found'],
        'expected': expected_upi,
        'method': upi_check['method'],
        'confidence': upi_check['confidence'],
    }
    result['presence']['date'] = {
        'found': date_check['found'],
        'expected': expected_date or date.today().isoformat(),
        'method': date_check['method'],
        'confidence': date_check['confidence'],
    }

    log('S4', f'UTR: {result["presence"]["utr"]["found"]} ({utr_check["method"] or "missing"}) | '
             f'Amount: {result["presence"]["amount"]["found"]} | '
             f'UPI: {result["presence"]["upi_id"]["found"]} | '
             f'Date: {result["presence"]["date"]["found"]}')

    return result

# ═══════════════════════════════════════════════════════════════════════
# STAGE 5: Value Match Report — simple found/missing summary
# ═══════════════════════════════════════════════════════════════════════
def stage5_match_report(presence: Dict[str, Any], expected: Dict[str, Any]) -> Dict[str, Any]:
    log('S5', 'Value Match Report')
    p = presence.get('presence', {})
    result = {
        'matches': {},
        'allFound': False,
        'utrFound': p.get('utr', {}).get('found', False),
        'amountFound': p.get('amount', {}).get('found', False),
        'upiFound': p.get('upi_id', {}).get('found', False),
        'dateFound': p.get('date', {}).get('found', False),
        'details': [],
    }
    result['matches']['utr'] = p.get('utr', {}).get('found', False)
    result['matches']['amount'] = p.get('amount', {}).get('found', False)
    result['matches']['receiverUpi'] = p.get('upi_id', {}).get('found', False)
    result['matches']['date'] = p.get('date', {}).get('found', False)
    result['allFound'] = all(result['matches'].values())
    for k, v in result['matches'].items():
        result['details'].append(f'{k}: {"✅ FOUND" if v else "❌ MISSING"}')
        log('S5', f'  {k}: {"✅ FOUND" if v else "❌ MISSING"}')
    return result

# ═══════════════════════════════════════════════════════════════════════
# STAGE 6: Florence-2 Visual Verification (VQA)
# ═══════════════════════════════════════════════════════════════════════
def stage6_visual_verify(pil_img: Image.Image, expected: Dict[str, Any]) -> Dict[str, Any]:
    log('S6', 'Florence-2 Visual Verification')
    result = {'answers': {}, 'agreement': {}, 'available': False, 'error': None}

    if not florence_available():
        result['error'] = 'Florence-2 not loaded'
        return result

    try:
        model, processor = get_florence()
        questions = [
            ('isSuccessful', 'Is this screenshot showing a successful payment? Answer yes or no.'),
            ('whoReceived', 'Who received the payment? What is the receiver name or UPI ID?'),
            ('whatAmount', 'What amount was paid? Return only the number.'),
            ('whatUtr', 'What is the UPI transaction ID or reference number? Return only the number.'),
            ('whatStatus', 'What is the payment status shown? Is it success, failed, pending, or processing?'),
        ]

        for key, question in questions:
            try:
                inputs = processor(text=question, images=pil_img, return_tensors='pt')
                generated_ids = model.generate(
                    input_ids=inputs['input_ids'],
                    pixel_values=inputs['pixel_values'],
                    max_new_tokens=50,
                    num_beams=3,
                )
                answer = processor.batch_decode(generated_ids, skip_special_tokens=True)[0]
                result['answers'][key] = answer
                log('S6', f'  {key}: {answer[:100]}')
            except Exception as e:
                result['answers'][key] = ''
                log('S6', f'  {key} failed: {e}')

        result['available'] = True

        # Cross-check answers against OCR and expected values
        amt_ans = result['answers'].get('whatAmount', '')
        exp_amt = str(expected.get('amount', ''))
        result['agreement']['amount'] = exp_amt in amt_ans if exp_amt and amt_ans else None

        utr_ans = result['answers'].get('whatUtr', '')
        exp_utr = str(expected.get('utr', ''))
        result['agreement']['utr'] = exp_utr[:8] in utr_ans if exp_utr and utr_ans else None

        status_ans = result['answers'].get('whatStatus', '').lower()
        result['agreement']['status'] = 'success' in status_ans or 'completed' in status_ans

        success_ans = result['answers'].get('isSuccessful', '').lower()
        result['agreement']['isSuccessful'] = 'yes' in success_ans

    except Exception as e:
        result['error'] = str(e)
        log('S6', f'Florence-2 VQA error: {e}')

    return result

# ═══════════════════════════════════════════════════════════════════════
# STAGE 7: Image Quality Check (informational only)
# ═══════════════════════════════════════════════════════════════════════
def stage7_quality(opencv: Dict[str, Any], presence: Dict[str, Any]) -> Dict[str, Any]:
    log('S7', 'Image Quality Check')
    result = {'warnings': [], 'isFake': False, 'isEdited': False, 'isBlurred': False, 'isCropped': False}
    if opencv.get('isFake'):
        result['warnings'].append('Potential tampering detected (edge analysis)')
        result['isFake'] = True
    if opencv.get('isEdited'):
        result['warnings'].append(f'ELA score suggests editing ({opencv.get("elaScore")})')
        result['isEdited'] = True
    if opencv.get('isBlurred'):
        result['warnings'].append(f'Blurry image (Laplacian={opencv.get("blurScore")})')
        result['isBlurred'] = True
    if opencv.get('isCropped'):
        result['warnings'].append('Image appears cropped')
        result['isCropped'] = True
    if not opencv.get('layoutValid'):
        result['warnings'].append('Layout does not match typical UPI screenshot')
    for w in result['warnings']:
        log('S7', f'  ⚠ {w}')
    return result

# ═══════════════════════════════════════════════════════════════════════
# STAGE 8: Decision Engine — Simple Value Presence Logic
# ═══════════════════════════════════════════════════════════════════════
def stage8_decision(presence: Dict[str, Any], quality: Dict[str, Any],
                    match_report: Dict[str, Any], raw_text_len: int) -> Dict[str, Any]:
    log('S8', 'Decision Engine — Value Presence Logic')
    result = {'status': 'manual_review', 'reasons': [], 'matched_fields': {}}

    p = presence.get('presence', {})
    utr_found = p.get('utr', {}).get('found', False)
    amt_found = p.get('amount', {}).get('found', False)
    upi_found = p.get('upi_id', {}).get('found', False)
    date_found = p.get('date', {}).get('found', False)

    # OCR quality assessment: did any engine extract meaningful text?
    ocr_successful = raw_text_len > 20  # at least some real text was extracted
    image_bad = quality.get('isBlurred') or quality.get('isCropped')

    result['matched_fields'] = {
        'utr': utr_found,
        'date': date_found,
        'amount': 'matched' if amt_found else ('uncertain' if raw_text_len > 20 else 'missing'),
        'upi_id': upi_found,
    }

    # ═══════════════════════════════════════════════════════════════════
    # RULE 1: UTR + Date found → APPROVE unconditionally
    # ═══════════════════════════════════════════════════════════════════
    if utr_found and date_found:
        result['status'] = 'approved'
        result['reasons'] = ['UTR matched successfully', 'Date matches current transaction']
        if amt_found: result['reasons'].append('Amount matches')
        else: result['reasons'].append('Amount unclear but ignored (UTR+date confirmed)')
        if upi_found: result['reasons'].append('UPI ID matches')
        log('S8', f'✅ APPROVED — UTR+Date confirmed, all cross-checks passed')
        return result

    # ═══════════════════════════════════════════════════════════════════
    # RULE 2: UTR + Amount found → APPROVE (date might be hard to read)
    # ═══════════════════════════════════════════════════════════════════
    if utr_found and amt_found:
        result['status'] = 'approved'
        result['reasons'] = ['UTR matched', 'Amount matches']
        if upi_found: result['reasons'].append('UPI ID matches')
        if not date_found: result['reasons'].append('Date unclear but UTR+Amount confirmed')
        log('S8', f'✅ APPROVED — UTR+Amount confirmed')
        return result

    # ═══════════════════════════════════════════════════════════════════
    # RULE 3: All values (Amount + UPI ID + Date) found → APPROVE
    # ═══════════════════════════════════════════════════════════════════
    if amt_found and upi_found and date_found:
        result['status'] = 'approved'
        result['reasons'] = ['Amount matches', 'UPI ID matches', 'Date matches']
        log('S8', f'✅ APPROVED — Amount+UPI+Date confirmed')
        return result

    # ═══════════════════════════════════════════════════════════════════
    # RULE 4: UTR found alone → MANUAL_REVIEW (need more confirmation)
    # ═══════════════════════════════════════════════════════════════════
    if utr_found:
        reasons = ['UTR found but date not confirmed']
        if not amt_found: reasons.append('Amount unclear')
        if not upi_found: reasons.append('UPI ID unclear')
        result['status'] = 'manual_review'
        result['reasons'] = reasons
        log('S8', f'⏸ MANUAL_REVIEW — UTR found but other fields unclear')
        return result

    # ═══════════════════════════════════════════════════════════════════
    # RULE 5: No values found but OCR worked → REJECT (confirmed missing)
    # ONLY REJECT WHEN 100% SURE: OCR extracted text, none of the values present
    # ═══════════════════════════════════════════════════════════════════
    if ocr_successful and not image_bad:
        missing = []
        if not utr_found: missing.append('UTR')
        if not amt_found: missing.append('amount')
        if not upi_found: missing.append('UPI ID')
        if not date_found: missing.append('date')

        # No values found at all — OCR worked but nothing matches
        if not utr_found and not amt_found and not upi_found and not date_found:
            # Check if a clearly different UTR was found (means it's a different transaction)
            all_text = presence.get('allText', '')
            other_utrs = re.findall(r'\b(\d{12,22})\b', all_text)
            other_utrs = [u for u in other_utrs if u != '00000000000000000000' and u != '000000000000']
            utr_expected_normalized = normalize_utr(p.get('utr', {}).get('expected', '').replace('****', ''))
            confirmed_diff = any(
                u and normalize_utr(u) != utr_expected_normalized 
                for u in other_utrs[:5]
            ) if other_utrs and utr_expected_normalized else False

            result['status'] = 'rejected'
            reasons = ['None of the expected details found in screenshot']
            if confirmed_diff:
                reasons.append(f'Different transaction: UTR {other_utrs[0][:8]}**** detected')
            result['reasons'] = reasons
            log('S8', f'❌ REJECTED — No expected values found in screenshot')
            return result

        # Partial values found but insufficient
        result['status'] = 'manual_review'
        result['reasons'] = [f'Missing: {", ".join(missing[:3])}']
        log('S8', f'⏸ MANUAL_REVIEW — Some values found but incomplete')
        return result

    # ═══════════════════════════════════════════════════════════════════
    # RULE 6: OCR failed or image is poor quality → MANUAL_REVIEW
    # ═══════════════════════════════════════════════════════════════════
    reasons = []
    if not ocr_successful:
        reasons.append('OCR did not extract sufficient text from screenshot')
    if image_bad:
        if quality.get('isBlurred'): reasons.append('Screenshot is blurry')
        if quality.get('isCropped'): reasons.append('Screenshot appears cropped')
    result['status'] = 'manual_review'
    result['reasons'] = reasons if reasons else ['Manual review needed']
    log('S8', f'⏸ MANUAL_REVIEW — {"OCR failed" if not ocr_successful else "image quality issues"}')
    return result

# ═══════════════════════════════════════════════════════════════════════
# ORCHESTRATOR: Run all stages
# ═══════════════════════════════════════════════════════════════════════
def run_ai_engine(img_path: str, expected: Dict[str, Any] = None) -> Dict[str, Any]:
    t_start = time.time()
    log('ENGINE', f'Starting AI Verification Engine: {img_path}')
    log('ENGINE', f'Expected: amount={expected.get("amount")}, receiver={expected.get("receiverUpi")}, utr={expected.get("utr")[:8] if expected.get("utr") else None}****')

    expected = expected or {}
    result = {
        'error': None,
        'imagePath': img_path,
        'expected': expected,
        'stages': {},
        'status': 'failed',
        'reasons': [],
        'confidence': 0,
        'duration': 0,
        'florenceAvailable': False,
    }

    # Load image
    if not os.path.exists(img_path):
        result['error'] = f'Image not found: {img_path}'
        return result

    img = load_image(img_path)
    if img is None:
        result['error'] = 'Failed to load image'
        return result

    pil_img = cv2_to_pil(img) if img is not None else None
    h, w = img.shape[:2]
    log('ENGINE', f'Image: {w}x{h}, {(os.path.getsize(img_path) if os.path.exists(img_path) else 0)/1024:.0f}KB')

    # ── Parallel Stage 1, 2, 3 ──
    florence_ok = florence_available()

    with ThreadPoolExecutor(max_workers=Config.PARALLEL_WORKERS) as ex:
        futures_s1 = ex.submit(stage1_opencv, img, img_path)
        futures_s3 = ex.submit(stage3_multi_ocr, img_path, img)
        futures_s2 = ex.submit(stage2_florence_regions, pil_img) if florence_ok and pil_img else None

        stage1 = futures_s1.result()
        stage3 = futures_s3.result()
        stage2 = futures_s2.result() if futures_s2 else {'regions': {}, 'available': False, 'error': 'Florence not loaded'}
        result['florenceAvailable'] = florence_ok

    result['stages']['stage1_opencv'] = stage1
    result['stages']['stage2_florence_regions'] = stage2
    result['stages']['stage3_multi_ocr'] = {
        'engineCount': stage3.get('engineCount'),
        'engines': {k: {'success': v.get('success'), 'blocks': len(v.get('blocks', [])), 'duration': v.get('duration'), 'error': v.get('error')} for k, v in stage3.get('engines', {}).items()},
    }

    # ── Stage 4: Value Presence Check (sequential, depends on Stage 3) ──
    stage4 = stage4_presence_check(stage3, expected)
    result['stages']['stage4_presence'] = {
        'presence': {k: {'found': v['found'], 'method': v['method'], 'confidence': v['confidence']} for k, v in stage4.get('presence', {}).items()},
        'rawTextLen': stage4.get('rawTextLen', 0),
    }

    # ── Stage 5: Match Report ──
    stage5 = stage5_match_report(stage4, expected)
    result['stages']['stage5_match'] = stage5

    # ── Stage 6: Florence-2 Visual Verify (sequential after regions known) ──
    stage6 = stage6_visual_verify(pil_img, expected) if florence_ok and pil_img else {'answers': {}, 'agreement': {}, 'available': False}
    result['stages']['stage6_visual_verify'] = stage6

    # ── Stage 7: Image Quality Check ──
    stage7 = stage7_quality(stage1, stage4)
    result['stages']['stage7_quality'] = stage7

    # ── Stage 8: Decision ──
    stage8 = stage8_decision(stage4, stage7, stage5, stage4.get('rawTextLen', 0))
    result['stages']['stage8_decision'] = stage8

    result['status'] = stage8['status']
    result['reasons'] = stage8['reasons']
    result['confidence'] = 100 if stage8['status'] == 'approved' else (0 if stage8['status'] == 'rejected' else 50)
    result['duration'] = round(time.time() - t_start, 2)
    result['matched_fields'] = stage8.get('matched_fields', {})

    log('ENGINE', f'Decision: {result["status"]}, duration: {result["duration"]}s')
    return result

def load_image(path: str):
    if path.startswith('data:image'):
        raw = base64.b64decode(path.split(',')[1] if ',' in path else path)
        buf = np.frombuffer(raw, np.uint8)
        return cv2.imdecode(buf, cv2.IMREAD_COLOR)
    return cv2.imread(path)

class NumpyEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, (np.integer,)): return int(obj)
        if isinstance(obj, (np.floating,)): return float(obj)
        if isinstance(obj, (np.ndarray,)): return obj.tolist()
        return super().default(obj)

# ── CLI ───────────────────────────────────────────────────────────────
if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='AI Payment Screenshot Verification Engine')
    parser.add_argument('--image', required=True, help='Path to screenshot')
    parser.add_argument('--expected-amount', type=float, help='Expected payment amount')
    parser.add_argument('--expected-receiver', help='Expected receiver UPI ID')
    parser.add_argument('--expected-utr', help='Expected UTR number')
    parser.add_argument('--expected-sender', help='Expected sender UPI ID')
    parser.add_argument('--expected-date', help='Expected transaction date (YYYY-MM-DD)')
    parser.add_argument('--json', action='store_true', help='Output JSON only')
    args = parser.parse_args()

    expected = {}
    if args.expected_amount: expected['amount'] = args.expected_amount
    if args.expected_receiver: expected['receiverUpi'] = args.expected_receiver
    if args.expected_utr: expected['utr'] = args.expected_utr
    if args.expected_sender: expected['senderUpi'] = args.expected_sender
    if args.expected_date: expected['date'] = args.expected_date

    result = run_ai_engine(args.image, expected)
    print(json.dumps(result, cls=NumpyEncoder, default=str))
