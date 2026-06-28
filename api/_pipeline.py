#!/usr/bin/env python
"""
⚠️ DEPRECATED — Superseded by _ai_engine.py (enterprise 8-stage AI engine).

Production-grade UPI Screenshot Verification Pipeline.
8 Phases: Image Validation → Layout Detection → Multi-Engine OCR → Field Extraction → Normalization → [Node.js: Business Logic → Fraud → Decision]

Usage: python _pipeline.py <image_path>
Outputs structured JSON to stdout.
"""

import sys, os, json, re, traceback, base64
import warnings
warnings.filterwarnings('ignore')
os.environ['PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK'] = 'True'

# Ensure torch shared libraries are findable (fixes shm.dll loading on Windows)
_torch_lib_path = os.path.join(os.path.dirname(sys.executable), 'Lib', 'site-packages', 'torch', 'lib')
if os.path.isdir(_torch_lib_path):
    os.environ['PATH'] = _torch_lib_path + os.pathsep + os.environ.get('PATH', '')
    if hasattr(os, 'add_dll_directory'):
        try:
            os.add_dll_directory(_torch_lib_path)
        except Exception:
            pass
    # Pre-load torch eagerly so PaddleOCR/EasyOCR find shm.dll
    try:
        import torch as _pre_torch
        _pre_torch.__version__
    except Exception:
        pass

from io import BytesIO
from datetime import datetime
from dataclasses import dataclass, field, asdict
from typing import Optional, List, Dict, Any, Tuple
from collections import defaultdict

import cv2
import numpy as np
from PIL import Image, ImageEnhance
from imagehash import phash

# ─────────────────────────────────────────────
# CONFIGURATION (override via env vars)
# ─────────────────────────────────────────────
class Config:
    MIN_RESOLUTION = int(os.getenv('CV_MIN_RESOLUTION', '200'))
    MAX_RESOLUTION = int(os.getenv('CV_MAX_RESOLUTION', '4000'))
    MIN_ASPECT_RATIO = float(os.getenv('CV_MIN_ASPECT', '0.3'))
    MAX_ASPECT_RATIO = float(os.getenv('CV_MAX_ASPECT', '2.5'))
    BLUR_THRESHOLD = float(os.getenv('CV_BLUR_THRESHOLD', '50.0'))
    CROP_THRESHOLD = float(os.getenv('CV_CROP_THRESHOLD', '0.5'))
    TAMPER_EDGE_THRESHOLD = float(os.getenv('CV_TAMPER_EDGE', '0.005'))
    TAMPER_SCORE_REJECT = int(os.getenv('CV_TAMPER_REJECT', '60'))
    BRIGHTNESS_MIN = float(os.getenv('CV_BRIGHT_MIN', '20'))
    BRIGHTNESS_MAX = float(os.getenv('CV_BRIGHT_MAX', '240'))
    CONTRAST_MIN = float(os.getenv('CV_CONTRAST_MIN', '10'))
    MIN_TEXT_BLOCK_CONFIDENCE = float(os.getenv('OCR_MIN_CONFIDENCE', '30.0'))
    EASYOCR_FALLBACK_THRESHOLD = float(os.getenv('OCR_EASY_FALLBACK', '60.0'))
    OCR_TIMEOUT = int(os.getenv('OCR_TIMEOUT', '60'))

# ─────────────────────────────────────────────
# LOGGING
# ─────────────────────────────────────────────
def log(phase: str, msg: str):
    print(f'[PIPELINE][{phase}] {msg}', file=sys.stderr)

# ─────────────────────────────────────────────
# PHASE 1: IMAGE VALIDATION
# ─────────────────────────────────────────────
def phase1_image_validation(img: np.ndarray, img_path: str) -> Dict[str, Any]:
    log('P1', 'Starting Image Validation')
    result = {
        'passed': True, 'grade': 'good', 'issues': [],
        'resolution': {'width': 0, 'height': 0},
        'aspectRatio': 0.0, 'blurScore': 0.0,
        'brightness': 0.0, 'contrast': 0.0,
        'noiseScore': 0.0, 'isCropped': False,
        'isTampered': False, 'tamperScore': 0,
        'perceptualHash': '', 'compressionScore': 0,
        'elaScore': 0, 'elaTampered': False,
        'fileSize': 0,
    }

    h, w = img.shape[:2]
    result['resolution'] = {'width': w, 'height': h}
    result['aspectRatio'] = round(w / h, 4) if h > 0 else 0
    if os.path.exists(img_path):
        result['fileSize'] = os.path.getsize(img_path)

    # Resolution check
    if w < Config.MIN_RESOLUTION or h < Config.MIN_RESOLUTION:
        result['issues'].append(f'Low resolution: {w}x{h}')
        result['grade'] = 'poor'
    if w > Config.MAX_RESOLUTION or h > Config.MAX_RESOLUTION:
        result['issues'].append(f'Very high resolution: {w}x{h}')
        result['grade'] = 'fair'

    # Aspect ratio
    ar = result['aspectRatio']
    if ar < Config.MIN_ASPECT_RATIO or ar > Config.MAX_ASPECT_RATIO:
        result['issues'].append(f'Unusual aspect ratio: {ar}')
        result['grade'] = 'poor'

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Blur detection (Laplacian variance)
    lap_var = cv2.Laplacian(gray, cv2.CV_64F).var()
    result['blurScore'] = round(lap_var, 2)
    if lap_var < Config.BLUR_THRESHOLD:
        result['issues'].append(f'Blurry screenshot (Laplacian={lap_var:.1f})')
        result['grade'] = 'fair'
    if lap_var < Config.BLUR_THRESHOLD * 0.4:
        result['grade'] = 'poor'

    # Brightness & contrast
    mean_brightness = np.mean(gray)
    std_brightness = np.std(gray)
    result['brightness'] = round(mean_brightness, 1)
    result['contrast'] = round(std_brightness, 1)
    if mean_brightness < Config.BRIGHTNESS_MIN:
        result['issues'].append(f'Too dark: brightness={mean_brightness:.0f}')
        result['grade'] = 'fair'
    if mean_brightness > Config.BRIGHTNESS_MAX:
        result['issues'].append(f'Too bright: brightness={mean_brightness:.0f}')
        result['grade'] = 'fair'
    if std_brightness < Config.CONTRAST_MIN:
        result['issues'].append(f'Low contrast: std={std_brightness:.1f}')
        result['grade'] = 'fair'

    # Noise estimation
    noise = estimate_noise(gray)
    result['noiseScore'] = round(noise, 2)
    if noise > 50:
        result['issues'].append(f'High noise: {noise:.1f}')
        result['grade'] = 'fair'

    # Crop detection
    crop_ratio, content_bounds = detect_crop(gray, w, h)
    is_cropped = crop_ratio < Config.CROP_THRESHOLD
    result['isCropped'] = is_cropped
    result['cropRatio'] = round(crop_ratio, 3)
    if is_cropped:
        result['issues'].append(f'Cropped screenshot (ratio={crop_ratio:.2f})')
        result['grade'] = 'fair'

    # Compression artifacts
    comp_score = detect_compression(img, gray, w, h)
    result['compressionScore'] = comp_score
    if comp_score > 70:
        result['issues'].append(f'Heavy compression artifacts: {comp_score}')
        result['grade'] = 'fair'

    # Tampering via Error Level Analysis
    ela_score, ela_tampered = detect_tampering_ela(img, gray, w, h)
    result['elaScore'] = round(ela_score, 1)
    result['elaTampered'] = ela_tampered
    if ela_tampered:
        result['issues'].append(f'Potential tampering via ELA (score={ela_score:.1f})')
        result['grade'] = 'poor'

    # Edge analysis for tampering
    tamper_score, edge_reasons = detect_tampering_edges(gray, w, h)
    result['tamperScore'] = tamper_score
    result['edgeReasons'] = edge_reasons
    if tamper_score >= Config.TAMPER_SCORE_REJECT:
        result['isTampered'] = True
        result['issues'].append(f'Tampering detected via edge analysis (score={tamper_score})')
        result['grade'] = 'poor'

    # Perceptual hash for duplicate detection
    result['perceptualHash'] = str(phash(Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))))

    # Final grade
    if result['grade'] == 'poor':
        result['passed'] = False

    log('P1', f'Grade={result["grade"]}, Blur={lap_var:.1f}, Brightness={mean_brightness:.0f}, Contrast={std_brightness:.1f}, Crop ratio={crop_ratio:.2f}, Tamper={tamper_score}, ELA={ela_score:.1f}')
    if result['issues']:
        log('P1', f'Issues: {"; ".join(result["issues"])}')

    return result

def estimate_noise(gray: np.ndarray) -> float:
    kernel = np.ones((3,3), np.float32) / 9
    smoothed = cv2.filter2D(gray, -1, kernel)
    diff = cv2.absdiff(gray, smoothed.astype(np.uint8))
    return float(np.mean(diff))

def detect_crop(gray: np.ndarray, w: int, h: int) -> Tuple[float, Dict]:
    _, thresh = cv2.threshold(gray, 240, 255, cv2.THRESH_BINARY)
    coords = cv2.findNonZero(cv2.bitwise_not(thresh))
    if coords is None:
        return 0.0, {'x': 0, 'y': 0, 'w': 0, 'h': 0}
    x, y, cw, ch = cv2.boundingRect(coords)
    margin = 0.03
    expected_w = w * (1 - 2 * margin)
    expected_h = h * (1 - 2 * margin)
    ratio = min(cw / expected_w, ch / expected_h) if expected_w > 0 and expected_h > 0 else 1.0
    return ratio, {'x': int(x), 'y': int(y), 'w': int(cw), 'h': int(ch)}

def detect_compression(img: np.ndarray, gray: np.ndarray, w: int, h: int) -> int:
    if w * h == 0:
        return 0
    bytes_per_pixel = img.nbytes / (w * h) if img.nbytes > 0 else 0
    score = 0
    if bytes_per_pixel > 0 and bytes_per_pixel < 0.5:
        score = 60
    elif bytes_per_pixel < 1.0:
        score = 30
    # Blockiness detection
    block_edges = 0
    total_blocks = 0
    for y in range(0, h - 8, 8):
        for x in range(0, w - 8, 8):
            diff = int(np.abs(int(gray[y, x+7]) - int(gray[y, x+8]))) if x+8 < w else 0
            if diff > 40:
                block_edges += 1
            total_blocks += 1
    block_ratio = block_edges / total_blocks if total_blocks > 0 else 0
    if block_ratio > 0.25:
        score = max(score, 70)
    return score

def detect_tampering_ela(img: np.ndarray, gray: np.ndarray, w: int, h: int) -> Tuple[float, bool]:
    try:
        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        pil_img = Image.fromarray(rgb)
        buf = BytesIO()
        pil_img.save(buf, format='JPEG', quality=90)
        buf.seek(0)
        resaved = Image.open(buf)
        ela_img = Image.new('RGB', pil_img.size)
        diff_sum = 0.0
        count = 0
        step = max(1, min(w, h) // 100)
        for y in range(0, h, step):
            for x in range(0, w, step):
                orig = pil_img.getpixel((x, y))
                re = resaved.getpixel((x, y))
                diff = sum(abs(o - r) for o, r in zip(orig, re))
                diff_sum += diff
                count += 1
        avg_diff = diff_sum / count if count > 0 else 0
        score = min(100, avg_diff * 2)
        tampered = score > 40
        return score, tampered
    except Exception:
        return 0.0, False

def detect_tampering_edges(gray: np.ndarray, w: int, h: int) -> Tuple[int, List[str]]:
    edges = cv2.Canny(gray, 50, 150)
    edge_density = np.sum(edges) / (w * h) * 100 if w * h > 0 else 0
    reasons = []
    score = 0
    if edge_density < 0.5:
        score += 25
        reasons.append('Unnatural edge density')
    # Check for inconsistent edge patterns across grid regions
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
            score += 20
            reasons.append('Inconsistent edge distribution across image')
    # Check for unnatural smooth patches
    laplacian = cv2.Laplacian(gray, cv2.CV_64F)
    flat_regions = 0
    total_regions = 0
    step = 32
    for y in range(0, h - step, step):
        for x in range(0, w - step, step):
            region_var = np.var(laplacian[y:y+step, x:x+step])
            if region_var < 0.5:
                flat_regions += 1
            total_regions += 1
    flat_ratio = flat_regions / total_regions if total_regions > 0 else 0
    if flat_ratio > 0.3:
        score += 15
        reasons.append(f'Unnatural smooth regions ({flat_ratio:.0%})')
    return min(score, 100), reasons

# ─────────────────────────────────────────────
# PHASE 2: LAYOUT DETECTION (CV only, no OCR)
# ─────────────────────────────────────────────
def phase2_layout_detection(img: np.ndarray, gray: np.ndarray, image_validation: Dict) -> Dict[str, Any]:
    log('P2', 'Starting Layout Detection')
    result = {
        'regions': {},
        'horizontalSeparators': [],
        'detected': False,
    }
    h, w = img.shape[:2]

    # Edge detection for separators and region boundaries
    edges = cv2.Canny(gray, 30, 100)
    # Detect horizontal lines (separators)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=int(min(w, h) * 0.05),
                            minLineLength=int(w * 0.4), maxLineGap=20)
    separators = []
    if lines is not None:
        for line in lines:
            x1, y1, x2, y2 = line[0]
            angle = abs(np.degrees(np.arctan2(y2 - y1, x2 - x1)))
            if angle < 15 or angle > 165:  # horizontal lines
                y_pos = (y1 + y2) // 2
                length = abs(x2 - x1)
                if length > w * 0.3:
                    separators.append({'y': int(y_pos), 'length': int(length)})
    # Remove duplicates by y position
    uniq_seps = []
    seen_ys = set()
    for s in sorted(separators, key=lambda x: x['y']):
        if not any(abs(s['y'] - sy) < h * 0.03 for sy in seen_ys):
            seen_ys.add(s['y'])
            uniq_seps.append(s)
    result['horizontalSeparators'] = uniq_seps

    # Detect text regions using morphological operations
    thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    # Invert if needed
    if np.mean(thresh) > 127:
        thresh = cv2.bitwise_not(thresh)
    # Dilate to merge nearby text
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 5))
    dilated = cv2.dilate(thresh, kernel, iterations=2)
    contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    # Filter and classify regions
    regions = []
    min_area = w * h * 0.002
    max_area = w * h * 0.5

    for cnt in contours:
        x, y, cw, ch = cv2.boundingRect(cnt)
        area = cw * ch
        if area < min_area or area > max_area:
            continue
        aspect = cw / ch if ch > 0 else 0
        if aspect < 0.5 or aspect > 20:
            continue
        regions.append({
            'bbox': [int(x), int(y), int(x + cw), int(y + ch)],
            'cx': int(x + cw // 2), 'cy': int(y + ch // 2),
            'w': int(cw), 'h': int(ch),
            'area': int(area),
            'aspect': round(aspect, 2),
        })

    # Sort by y position
    regions.sort(key=lambda r: r['cy'])

    # Classify regions by position
    CLASSIFICATION_RULES = [
        ('header', lambda r: r['cy'] < h * 0.15 and r['w'] > w * 0.3),
        ('amountRegion', lambda r: h * 0.15 <= r['cy'] < h * 0.35 and r['w'] > w * 0.2),
        ('receiverCard', lambda r: h * 0.25 <= r['cy'] < h * 0.5 and 'upi' in str(r.get('label', '')) or h * 0.3 <= r['cy'] < h * 0.5),
        ('senderCard', lambda r: h * 0.35 <= r['cy'] < h * 0.55),
        ('transactionDetails', lambda r: h * 0.45 <= r['cy'] < h * 0.7),
        ('statusBadge', lambda r: h * 0.2 <= r['cy'] < h * 0.5 and r['h'] < h * 0.06),
        ('bankCard', lambda r: h * 0.55 <= r['cy'] < h * 0.75),
        ('footer', lambda r: r['cy'] > h * 0.8),
    ]

    classified = {}
    used = set()
    for label, rule in CLASSIFICATION_RULES:
        for i, r in enumerate(regions):
            if i in used:
                continue
            if rule(r):
                # Merge overlapping regions with same label
                if label in classified:
                    existing = classified[label]
                    # Keep the larger one
                    if r['area'] > existing['area']:
                        classified[label] = r
                else:
                    classified[label] = r
                used.add(i)
                break

    # Assign remaining unclassified regions
    unclassified = [r for i, r in enumerate(regions) if i not in used]
    if unclassified:
        classified['unclassified'] = unclassified

    result['regions'] = {k: v for k, v in classified.items()}
    result['detected'] = len(classified) >= 3

    log('P2', f'Regions: {list(classified.keys())}, Separators: {len(uniq_seps)}')
    return result

# ─────────────────────────────────────────────
# PHASE 3: MULTI-ENGINE OCR
# ─────────────────────────────────────────────
# Lazy-loaded engines
_paddle_ocr = None
_easy_ocr = None

def get_paddle_ocr():
    global _paddle_ocr
    if _paddle_ocr is None:
        from paddleocr import PaddleOCR
        _paddle_ocr = PaddleOCR(use_angle_cls=True, lang='en', show_log=False, use_gpu=False)
    return _paddle_ocr

def get_easy_ocr():
    global _easy_ocr
    if _easy_ocr is None:
        import easyocr
        _easy_ocr = easyocr.Reader(['en'], gpu=False, verbose=False)
    return _easy_ocr

def phase3_multi_engine_ocr(img: np.ndarray, img_path: str, layout: Dict) -> Dict[str, Any]:
    log('P3', 'Starting Multi-Engine OCR')
    result = {
        'blocks': [],
        'engineStats': {},
        'primaryEngine': 'paddleocr',
        'fallbackUsed': False,
    }

    # Count how many important fields we can extract from a block set
    def count_important_fields(blocks):
        text = ' '.join(b['text'] for b in blocks).lower()
        count = 0
        if re.search(r'[\d,]+\.?\d{0,2}', text): count += 1
        if re.search(r'[a-z0-9]{10,}', text): count += 1
        if re.search(r'[\w.\-]+@[\w.]+', text): count += 1
        if re.search(r'(success|fail|pending|completed|paid)', text): count += 1
        if re.search(r'\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}', text): count += 1
        return count

    paddle_failed = False
    paddle_blocks = []
    try:
        log('P3', 'PaddleOCR Started')
        paddle_blocks = run_paddle_ocr_inner(img_path)
        result['engineStats']['paddleocr'] = {
            'blocks': len(paddle_blocks),
            'avgConfidence': round(np.mean([b['confidence'] for b in paddle_blocks]), 2) if paddle_blocks else 0,
        }
        log('P3', f'PaddleOCR: {len(paddle_blocks)} blocks, avg conf={result["engineStats"]["paddleocr"]["avgConfidence"]}%')
        if paddle_blocks:
            max_conf = max(b['confidence'] for b in paddle_blocks)
            extracted_count = count_important_fields(paddle_blocks)
            log('P3', f'PaddleOCR: max_confidence={max_conf}%, important_fields={extracted_count}')
    except Exception as e:
        paddle_failed = True
        log('P3', f'PaddleOCR Failed: {e}')
        result['engineStats']['paddleocr'] = {'blocks': 0, 'avgConfidence': 0, 'error': str(e)}

    # Determine if EasyOCR fallback is needed
    needs_fallback = False
    if paddle_failed:
        needs_fallback = True
        log('P3', 'EasyOCR needed: PaddleOCR threw an exception')
    elif len(paddle_blocks) == 0:
        needs_fallback = True
        log('P3', 'EasyOCR needed: PaddleOCR returned zero text blocks')
    else:
        max_conf = max(b['confidence'] for b in paddle_blocks)
        if max_conf < Config.EASYOCR_FALLBACK_THRESHOLD:
            needs_fallback = True
            log('P3', f'EasyOCR needed: max confidence {max_conf}% < {Config.EASYOCR_FALLBACK_THRESHOLD}%')
        elif count_important_fields(paddle_blocks) < 3:
            needs_fallback = True
            log('P3', 'EasyOCR needed: fewer than 3 important fields extracted')

    easy_blocks = []
    if needs_fallback:
        log('P3', 'Switching to EasyOCR')
        try:
            easy_blocks = run_easy_ocr_inner(img)
            result['engineStats']['easyocr'] = {
                'blocks': len(easy_blocks),
                'avgConfidence': round(np.mean([b['confidence'] for b in easy_blocks]), 2) if easy_blocks else 0,
            }
            result['fallbackUsed'] = True
            if easy_blocks:
                log('P3', f'EasyOCR Success: {len(easy_blocks)} blocks, avg conf={result["engineStats"]["easyocr"]["avgConfidence"]}%')
            else:
                log('P3', 'EasyOCR returned zero blocks')
        except Exception as e:
            log('P3', f'EasyOCR Failed: {e}')
            result['engineStats']['easyocr'] = {'blocks': 0, 'avgConfidence': 0, 'error': str(e)}

    # Merge: per-field highest confidence
    merged_blocks = merge_ocr_results_per_field(paddle_blocks, easy_blocks)
    result['blocks'] = merged_blocks

    # Determine final engine name
    engines_used = set(b['engine'] for b in merged_blocks)
    if 'easyocr' in engines_used:
        result['primaryEngine'] = 'easyocr'
    elif 'paddleocr' in engines_used:
        result['primaryEngine'] = 'paddleocr'
    else:
        result['primaryEngine'] = 'none'

    log('P3', f'Final OCR Engine: {result["primaryEngine"]}')
    log('P3', f'Merged blocks: {len(merged_blocks)}')
    if merged_blocks:
        extracted = count_important_fields(merged_blocks)
        log('P3', f'Extracted Fields: {extracted}/5 important')
    return result

def run_paddle_ocr_inner(img_path: str) -> List[Dict]:
    """Run PaddleOCR. Raises on init/execution failure."""
    ocr = get_paddle_ocr()
    results = ocr.ocr(img_path, cls=True)
    blocks = []
    if results and len(results) > 0:
        for line_group in results:
            if line_group is None:
                continue
            for line in line_group:
                if line is None:
                    continue
                bbox, (text, conf) = line
                text = (text or '').strip()
                if not text:
                    continue
                block = {
                    'text': text,
                    'confidence': round(float(conf) * 100, 2),
                    'bbox': [[int(b[0]), int(b[1])] for b in bbox],
                    'engine': 'paddleocr',
                    'cx': int((bbox[0][0] + bbox[2][0]) / 2),
                    'cy': int((bbox[0][1] + bbox[2][1]) / 2),
                }
                blocks.append(block)
    return blocks

def run_easy_ocr_inner(img: np.ndarray) -> List[Dict]:
    """Run EasyOCR. Raises on init/execution failure."""
    reader = get_easy_ocr()
    results = reader.readtext(img, paragraph=False, width_ths=0.7, height_ths=0.5)
    blocks = []
    for bbox, text, conf in results:
        text = (text or '').strip()
        if not text:
            continue
        pts = [[int(p[0]), int(p[1])] for p in bbox]
        cx = int((bbox[0][0] + bbox[2][0]) / 2)
        cy = int((bbox[0][1] + bbox[2][1]) / 2)
        block = {
            'text': text,
            'confidence': round(float(conf) * 100, 2),
            'bbox': pts,
            'engine': 'easyocr',
            'cx': cx,
            'cy': cy,
        }
        blocks.append(block)
    return blocks

def merge_ocr_results_per_field(paddle_blocks: List[Dict], easy_blocks: List[Dict]) -> List[Dict]:
    """Merge OCR results choosing highest confidence per overlapping text region."""
    if not paddle_blocks and not easy_blocks:
        return []
    if not easy_blocks:
        return paddle_blocks
    if not paddle_blocks:
        return easy_blocks

    merged = []
    used_easy = set()
    for pb in paddle_blocks:
        best_block = pb
        best_conf = pb['confidence']
        for ei, eb in enumerate(easy_blocks):
            if ei in used_easy:
                continue
            y_dist = abs(pb['cy'] - eb['cy'])
            x_overlap = not (pb['bbox'][0][0] > eb['bbox'][2][0] or eb['bbox'][0][0] > pb['bbox'][2][0])
            if y_dist < 30 and x_overlap:
                if eb['confidence'] > best_conf and len(eb['text']) >= len(pb['text']) * 0.5:
                    best_block = eb
                    best_conf = eb['confidence']
                    used_easy.add(ei)
        merged.append(best_block)

    for ei, eb in enumerate(easy_blocks):
        if ei not in used_easy:
            merged.append(eb)

    merged.sort(key=lambda b: (b['cy'], b['cx']))
    return merged

def run_paddle_ocr(img_path: str) -> List[Dict]:
    try:
        ocr = get_paddle_ocr()
        results = ocr.ocr(img_path, cls=True)
        blocks = []
        if results and len(results) > 0:
            for line_group in results:
                if line_group is None:
                    continue
                for line in line_group:
                    if line is None:
                        continue
                    bbox, (text, conf) = line
                    text = (text or '').strip()
                    if not text:
                        continue
                    block = {
                        'text': text,
                        'confidence': round(float(conf) * 100, 2),
                        'bbox': [[int(b[0]), int(b[1])] for b in bbox],
                        'engine': 'paddleocr',
                        'cx': int((bbox[0][0] + bbox[2][0]) / 2),
                        'cy': int((bbox[0][1] + bbox[2][1]) / 2),
                    }
                    blocks.append(block)
        return blocks
    except Exception as e:
        log('P3', f'PaddleOCR error: {e}')
        return []

def run_easy_ocr(img: np.ndarray) -> List[Dict]:
    try:
        reader = get_easy_ocr()
        results = reader.readtext(img, paragraph=False, width_ths=0.7, height_ths=0.5)
        blocks = []
        for bbox, text, conf in results:
            text = (text or '').strip()
            if not text:
                continue
            pts = [[int(p[0]), int(p[1])] for p in bbox]
            cx = int((bbox[0][0] + bbox[2][0]) / 2)
            cy = int((bbox[0][1] + bbox[2][1]) / 2)
            block = {
                'text': text,
                'confidence': round(float(conf) * 100, 2),
                'bbox': pts,
                'engine': 'easyocr',
                'cx': cx,
                'cy': cy,
            }
            blocks.append(block)
        return blocks
    except Exception as e:
        log('P3', f'EasyOCR error: {e}')
        return []

def merge_ocr_results(paddle_blocks: List[Dict], easy_blocks: List[Dict],
                      layout: Dict, img_shape: Tuple) -> List[Dict]:
    """Merge PaddleOCR and EasyOCR results, selecting highest confidence per text region."""
    if not easy_blocks:
        return paddle_blocks
    if not paddle_blocks:
        return easy_blocks

    # Group blocks by y-axis proximity
    merged = []
    used_easy = set()
    for pb in paddle_blocks:
        best_block = pb
        best_conf = pb['confidence']
        for ei, eb in enumerate(easy_blocks):
            if ei in used_easy:
                continue
            # Check if blocks overlap or are close vertically
            y_dist = abs(pb['cy'] - eb['cy'])
            x_overlap = not (pb['bbox'][0][0] > eb['bbox'][2][0] or eb['bbox'][0][0] > pb['bbox'][2][0])
            if y_dist < 30 and x_overlap:
                if eb['confidence'] > best_conf and len(eb['text']) >= len(pb['text']) * 0.5:
                    best_block = eb
                    best_conf = eb['confidence']
                    used_easy.add(ei)
        merged.append(best_block)

    # Add any unused easy blocks
    for ei, eb in enumerate(easy_blocks):
        if ei not in used_easy:
            merged.append(eb)

    merged.sort(key=lambda b: (b['cy'], b['cx']))
    return merged

# ─────────────────────────────────────────────
# PHASE 4: FIELD EXTRACTION
# ─────────────────────────────────────────────
def phase4_field_extraction(ocr_result: Dict, layout: Dict, img_shape: Tuple) -> Dict[str, Any]:
    log('P4', 'Starting Field Extraction')
    blocks = ocr_result.get('blocks', [])
    all_text = [b['text'] for b in blocks]
    full_text = ' '.join(all_text)

    result = {
        'amount': extract_amount(blocks, full_text),
        'utr': extract_utr(blocks, full_text),
        'receiverUpi': extract_receiver_upi(blocks, full_text, layout),
        'senderUpi': extract_sender_upi(blocks, full_text, layout),
        'receiverName': extract_receiver_name(blocks, full_text),
        'senderName': extract_sender_name(blocks, full_text),
        'status': extract_status(blocks, full_text),
        'date': extract_date(blocks, full_text),
        'time': extract_time(blocks, full_text),
        'bank': extract_bank(blocks, full_text),
        'appName': extract_app_name(blocks, full_text),
        'googleTxnId': extract_google_txn_id(blocks, full_text),
    }

    field_count = sum(1 for v in result.values() if v and v.get('value'))
    log('P4', f'Fields extracted: {field_count}/12 — { {k: (v.get("value") if v else None) for k, v in result.items()} }')
    return result

def extract_amount(blocks: List[Dict], full_text: str) -> Optional[Dict]:
    patterns = [
        r'(?:₹|rs\.?\s*|inr\s*)\s*([\d,]+\.?\d{0,2})',
        r'(?:amount|amt|total|paid)\s*:?\s*₹?\s*([\d,]+\.?\d{0,2})',
        r'₹?\s*([\d,]+\.\d{2})\s*(?:₹|only)?',
    ]
    for b in blocks:
        text = b['text']
        for pat in patterns:
            m = re.search(pat, text, re.IGNORECASE)
            if m:
                val = m.group(1).replace(',', '')
                try:
                    num = float(val)
                    if 1 < num < 10000000:
                        return {'value': val, 'confidence': b['confidence'], 'bbox': b['bbox'], 'engine': b['engine']}
                except: pass
    # Fallback: isolated number in amount region
    for b in blocks:
        m = re.match(r'^([\d,]+\.?\d{0,2})\s*$', b['text'])
        if m:
            val = m.group(1).replace(',', '')
            try:
                num = float(val)
                if 1 < num < 10000000 and b['cy'] > 50:
                    return {'value': val, 'confidence': b['confidence'] * 0.7, 'bbox': b['bbox'], 'engine': b['engine']}
            except: pass
    return None

def extract_utr(blocks: List[Dict], full_text: str) -> Optional[Dict]:
    patterns = [
        r'(?:utr|neft\s*utr|upi\s*ref|transaction\s*(?:id|no|number|ref)|txn\s*(?:id|no)?)\s*:?\s*([a-z0-9]{10,})',
        r'(?:bank\s*ref|rrn|reference\s*(?:no|number)?)\s*:?\s*([a-z0-9]{10,})',
        r'\b(\d{12,22})\b',
    ]
    for b in blocks:
        for pat in patterns:
            m = re.search(pat, b['text'], re.IGNORECASE)
            if m:
                val = m.group(1).upper()
                if 10 <= len(val) <= 30:
                    return {'value': val, 'confidence': b['confidence'], 'bbox': b['bbox'], 'engine': b['engine']}
    return None

def extract_receiver_upi(blocks: List[Dict], full_text: str, layout: Dict) -> Optional[Dict]:
    receiver_candidates = []
    for b in blocks:
        upis = re.findall(r'([\w.\-]+@[\w.]+)', b['text'], re.IGNORECASE)
        for upi in upis:
            parts = upi.split('@')
            if len(parts) == 2 and len(parts[1]) >= 2:
                lower = upi.lower()
                # Check context for receiver keywords
                idx = full_text.lower().find(lower)
                context = full_text[max(0, idx-60):idx+len(upi)+20].lower()
                if any(kw in context for kw in ['to:', 'paid to', 'receiver', 'payee', 'beneficiary']):
                    receiver_candidates.append((lower, b['confidence'], b['bbox'], b['engine']))
                else:
                    receiver_candidates.append((lower, b['confidence'] * 0.8, b['bbox'], b['engine']))
    if receiver_candidates:
        receiver_candidates.sort(key=lambda x: -x[1])
        return {'value': receiver_candidates[0][0], 'confidence': receiver_candidates[0][1],
                'bbox': receiver_candidates[0][2], 'engine': receiver_candidates[0][3]}
    return None

def extract_sender_upi(blocks: List[Dict], full_text: str, layout: Dict) -> Optional[Dict]:
    receiver = extract_receiver_upi(blocks, full_text, layout)
    sender_candidates = []
    for b in blocks:
        upis = re.findall(r'([\w.\-]+@[\w.]+)', b['text'], re.IGNORECASE)
        for upi in upis:
            lower = upi.lower()
            if receiver and lower == receiver['value']:
                continue
            parts = upi.split('@')
            if len(parts) == 2 and len(parts[1]) >= 2:
                idx = full_text.lower().find(lower)
                context = full_text[max(0, idx-60):idx+len(upi)+20].lower()
                if any(kw in context for kw in ['from:', 'sender', 'paid by', 'debit']):
                    sender_candidates.append((lower, b['confidence'], b['bbox'], b['engine']))
                else:
                    sender_candidates.append((lower, b['confidence'] * 0.6, b['bbox'], b['engine']))
    if sender_candidates:
        sender_candidates.sort(key=lambda x: -x[1])
        return {'value': sender_candidates[0][0], 'confidence': sender_candidates[0][1],
                'bbox': sender_candidates[0][2], 'engine': sender_candidates[0][3]}
    return None

def extract_receiver_name(blocks: List[Dict], full_text: str) -> Optional[Dict]:
    for b in blocks:
        m = re.search(r'(?:paid\s+to|to|payee|beneficiary)\s*:?\s*([a-z][a-z\s.]+)', b['text'], re.IGNORECASE)
        if m:
            name = m.group(1).strip().rstrip(':')
            if len(name) > 1 and not re.match(r'^[\d@]+$', name):
                return {'value': name.strip(), 'confidence': b['confidence'], 'bbox': b['bbox'], 'engine': b['engine']}
    return None

def extract_sender_name(blocks: List[Dict], full_text: str) -> Optional[Dict]:
    for b in blocks:
        m = re.search(r'(?:from|sender|paid\s+by|debit)\s*:?\s*([a-z][a-z\s.]+)', b['text'], re.IGNORECASE)
        if m:
            name = m.group(1).strip().rstrip(':')
            if len(name) > 1 and not re.match(r'^[\d@]+$', name):
                return {'value': name.strip(), 'confidence': b['confidence'], 'bbox': b['bbox'], 'engine': b['engine']}
    return None

def extract_status(blocks: List[Dict], full_text: str) -> Optional[Dict]:
    status_keywords = {
        'SUCCESS': ['SUCCESS', 'SUCCESSFUL', 'SUCCESSFULLY', 'COMPLETED', 'PAID', 'DONE', 'CREDITED'],
        'FAILED': ['FAILED', 'REJECTED', 'DECLINED', 'CANCELLED', 'FAIL', 'UNSUCCESSFUL', 'REFUNDED', 'EXPIRED'],
        'PENDING': ['PENDING', 'PROCESSING', 'INITIATED', 'IN PROGRESS', 'AWAITING'],
    }
    for b in blocks:
        upper = b['text'].upper()
        for status, keywords in status_keywords.items():
            if any(kw in upper for kw in keywords):
                return {'value': status, 'confidence': b['confidence'], 'bbox': b['bbox'], 'engine': b['engine']}
    # Full text fallback
    upper_all = full_text.upper()
    for status, keywords in status_keywords.items():
        if any(kw in upper_all for kw in keywords):
            return {'value': status, 'confidence': 80.0, 'bbox': None, 'engine': 'text_fallback'}
    return None

def extract_date(blocks: List[Dict], full_text: str) -> Optional[Dict]:
    months = r'(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*'
    patterns = [
        rf'(\d{{1,2}})\s+{months}\s+(\d{{2,4}})',
        r'(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})',
        r'(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})',
    ]
    for b in blocks:
        for pat in patterns:
            m = re.search(pat, b['text'], re.IGNORECASE)
            if m:
                try:
                    date_str = m.group(0)[:20]
                    for fmt in ['%d %b %Y', '%d %B %Y', '%d/%m/%Y', '%d-%m-%Y', '%m/%d/%Y', '%Y-%m-%d']:
                        try:
                            dt = datetime.strptime(date_str, fmt)
                            return {'value': dt.strftime('%Y-%m-%d'), 'confidence': b['confidence'],
                                    'bbox': b['bbox'], 'engine': b['engine']}
                        except: pass
                except: pass
    return None

def extract_time(blocks: List[Dict], full_text: str) -> Optional[Dict]:
    for b in blocks:
        m = re.search(r'(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:AM|PM|am|pm)?', b['text'])
        if m:
            return {'value': m.group(0).strip(), 'confidence': b['confidence'],
                    'bbox': b['bbox'], 'engine': b['engine']}
    return None

def extract_bank(blocks: List[Dict], full_text: str) -> Optional[Dict]:
    banks = ['hdfc bank', 'icici bank', 'state bank of india', 'sbi', 'axis bank', 'kotak mahindra',
             'yes bank', 'pnb', 'canara bank', 'bank of baroda', 'union bank', 'idbi bank', 'indusind bank',
             'federal bank', 'rbl bank', 'bandhan bank', 'hsbc', 'citi bank', 'idfc first bank']
    for b in blocks:
        lower = b['text'].lower()
        for bank in banks:
            if bank in lower:
                return {'value': bank.title(), 'confidence': b['confidence'],
                        'bbox': b['bbox'], 'engine': b['engine']}
    return None

def extract_app_name(blocks: List[Dict], full_text: str) -> Optional[Dict]:
    apps = ['google pay', 'gpay', 'phonepe', 'paytm', 'bhim', 'amazon pay', 'cred', 'whatsapp',
             'mobikwik', 'freecharge', 'airtel thanks', 'jiopay', 'axis pay', 'icici pockets',
             'sbi yono', 'hdfc payzapp', 'google tez']
    for b in blocks:
        lower = b['text'].lower()
        for app in apps:
            if app in lower:
                val = 'Google Pay' if app in ('google pay', 'gpay', 'google tez') else app.title()
                return {'value': val, 'confidence': b['confidence'],
                        'bbox': b['bbox'], 'engine': b['engine']}
    return None

def extract_google_txn_id(blocks: List[Dict], full_text: str) -> Optional[Dict]:
    """Extract Google Pay-specific transaction ID (GPay transaction ID format)."""
    for b in blocks:
        # GPay TXN IDs: alphanumeric, 10-20 chars, often preceded by "TXN" or "Transaction"
        m = re.search(r'(?:txn\s*(?:id|no)?|transaction\s*(?:id|no)?)\s*:?\s*([a-z0-9]{10,20})',
                      b['text'], re.IGNORECASE)
        if m:
            val = m.group(1).upper()
            if 10 <= len(val) <= 20:
                return {'value': val, 'confidence': b['confidence'],
                        'bbox': b['bbox'], 'engine': b['engine']}
    return None

# ─────────────────────────────────────────────
# PHASE 5: NORMALIZATION
# ─────────────────────────────────────────────
def phase5_normalization(fields: Dict[str, Any]) -> Dict[str, Any]:
    log('P5', 'Starting Normalization')
    normalized = {}

    for field_name, field_value in fields.items():
        if field_value is None:
            normalized[field_name] = None
            continue

        val = field_value.get('value')
        if val is None:
            normalized[field_name] = field_value
            continue

        if field_name == 'amount':
            val = normalize_amount(val)
        elif field_name == 'receiverUpi' or field_name == 'senderUpi':
            val = normalize_upi(val)
        elif field_name in ('receiverName', 'senderName'):
            val = normalize_name(val)
        elif field_name == 'utr':
            val = normalize_utr(val)
        elif field_name == 'date':
            pass  # Already normalized to YYYY-MM-DD
        elif field_name == 'appName':
            val = normalize_app_name(val)

        normalized[field_name] = {**field_value, 'value': val, 'normalized': True}

    log('P5', 'Normalization complete')
    return normalized

def normalize_amount(val: str) -> str:
    """Clean and normalize amount string."""
    val = re.sub(r'[^0-9.,]', '', val)
    val = val.replace(',', '')
    return val

def normalize_upi(val: str) -> str:
    """Normalize UPI ID to lowercase."""
    return val.lower().strip()

def normalize_name(val: str) -> str:
    """Normalize person name."""
    val = re.sub(r'[^a-zA-Z\s.]', '', val).strip()
    return ' '.join(word.capitalize() for word in val.split())

def normalize_utr(val: str) -> str:
    """Normalize UTR: uppercase, apply OCR corrections."""
    val = val.upper().strip()
    # OCR common mistakes
    subs = {'O': '0', 'I': '1', 'S': '5', 'B': '8', 'Z': '2', 'G': '6'}
    corrected = ''
    for ch in val:
        if ch in subs:
            corrected += subs[ch]
        else:
            corrected += ch
    return corrected

def normalize_app_name(val: str) -> str:
    """Normalize UPI app name."""
    mapping = {
        'gpay': 'Google Pay', 'google pay': 'Google Pay', 'google tez': 'Google Pay',
        'phonepe': 'PhonePe', 'paytm': 'Paytm', 'bhim': 'BHIM',
        'amazon pay': 'Amazon Pay', 'cred': 'CRED',
        'whatsapp': 'WhatsApp Pay', 'mobikwik': 'Mobikwik',
        'freecharge': 'Freecharge', 'jiopay': 'JioPay',
        'airtel thanks': 'Airtel Payments', 'axis pay': 'Axis Pay',
        'icici pockets': 'ICICI Pockets', 'sbi yono': 'SBI YONO',
        'hdfc payzapp': 'HDFC PayZapp',
    }
    lower = val.lower().strip()
    for k, v in mapping.items():
        if k in lower:
            return v
    return val.title()

# ─────────────────────────────────────────────
# MAIN PIPELINE ORCHESTRATOR
# ─────────────────────────────────────────────

def run_pipeline(img_path: str) -> Dict[str, Any]:
    log('PIPELINE', f'Starting verification pipeline: {img_path}')

    pipeline_log = []

    # Load image
    if not os.path.exists(img_path):
        return {'error': f'Image not found: {img_path}', 'pipelineLog': []}

    img = load_image(img_path)
    if img is None:
        return {'error': 'Failed to load image', 'pipelineLog': []}

    # Phase 1: Image Validation
    image_validation = phase1_image_validation(img, img_path)
    pipeline_log.append({'phase': 'ImageValidation', 'result': image_validation})

    # If image is completely invalid (poor grade + critical issues), stop early
    if not image_validation['passed']:
        log('PIPELINE', 'Image validation failed — returning early')
        return {
            'error': None,
            'imageValidation': image_validation,
            'layout': {'regions': {}, 'horizontalSeparators': [], 'detected': False},
            'ocr': {'blocks': [], 'engineStats': {}, 'primaryEngine': 'none', 'fallbackUsed': False},
            'fields': {},
            'fieldsNormalized': {},
            'pipelineLog': pipeline_log,
            'earlyExit': True,
            'earlyExitReason': 'Image validation failed',
        }

    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Phase 2: Layout Detection
    layout = phase2_layout_detection(img, gray, image_validation)
    pipeline_log.append({'phase': 'LayoutDetection', 'result': layout})

    # Phase 3: Multi-Engine OCR
    ocr_result = phase3_multi_engine_ocr(img, img_path, layout)
    pipeline_log.append({'phase': 'MultiEngineOCR', 'result': {
        'blockCount': len(ocr_result['blocks']),
        'engineStats': ocr_result['engineStats'],
        'fallbackUsed': ocr_result['fallbackUsed'],
    }})

    # Phase 4: Field Extraction
    fields = phase4_field_extraction(ocr_result, layout, (h, w))
    pipeline_log.append({'phase': 'FieldExtraction', 'result': {
        k: {'value': v['value'] if v else None, 'confidence': v['confidence'] if v else 0}
        for k, v in fields.items()
    }})

    # Phase 5: Normalization
    normalized = phase5_normalization(fields)
    pipeline_log.append({'phase': 'Normalization', 'result': {
        k: {'value': v['value'] if v else None, 'normalized': v.get('normalized', False) if v else False}
        for k, v in normalized.items()
    }})

    log('PIPELINE', 'Pipeline complete')
    return {
        'error': None,
        'imageValidation': image_validation,
        'layout': layout,
        'ocr': ocr_result,
        'fields': {k: v for k, v in fields.items()},
        'fieldsNormalized': {k: v for k, v in normalized.items()},
        'pipelineLog': pipeline_log,
        'earlyExit': False,
    }

def load_image(path: str) -> Optional[np.ndarray]:
    if path.startswith('data:image'):
        raw = base64.b64decode(path.split(',')[1] if ',' in path else path)
        buf = np.frombuffer(raw, np.uint8)
        return cv2.imdecode(buf, cv2.IMREAD_COLOR)
    return cv2.imread(path)

# ─────────────────────────────────────────────
# CLI ENTRY POINT
# ─────────────────────────────────────────────
if __name__ == '__main__':
    if len(sys.argv) > 1:
        img_path = sys.argv[1]
    else:
        img_path = sys.stdin.read().strip()

    if not img_path:
        print(json.dumps({'error': 'No image path provided'}))
        sys.exit(0)

    result = run_pipeline(img_path)

    # Clean non-serializable items from logs
    class NumpyEncoder(json.JSONEncoder):
        def default(self, obj):
            if isinstance(obj, (np.integer,)):
                return int(obj)
            if isinstance(obj, (np.floating,)):
                return float(obj)
            if isinstance(obj, (np.ndarray,)):
                return obj.tolist()
            return super().default(obj)

    print(json.dumps(result, cls=NumpyEncoder, default=str))
