#!/usr/bin/env python
"""
⚠️ DEPRECATED — Superseded by _ai_engine.py (Stage 3 runs PaddleOCR + EasyOCR + Tesseract in parallel).

PaddleOCR-based UPI screenshot text extraction.
Runs OCR, extracts fields, outputs JSON.
Usage: python _paddle_ocr.py <image_path>
"""

import sys
import os
import json
import traceback
import base64
from io import BytesIO

try:
    import cv2
    import numpy as np
    from paddleocr import PaddleOCR
    from imagehash import phash
    from PIL import Image
except ImportError as e:
    result = {"error": f"Missing dependency: {e}", "ocr": {"fields": {}}, "visualValidation": {}}
    print(json.dumps(result))
    sys.exit(0)

_ocr = None

def get_ocr():
    global _ocr
    if _ocr is None:
        _ocr = PaddleOCR(use_angle_cls=True, lang='en', show_log=False, use_gpu=False)
    return _ocr

def load_image(path):
    if path.startswith('data:image'):
        raw = base64.b64decode(path.split(',')[1] if ',' in path else path)
        buf = np.frombuffer(raw, np.uint8)
        return cv2.imdecode(buf, cv2.IMREAD_COLOR)
    return cv2.imread(path)


def check_blur(gray):
    fm = cv2.Laplacian(gray, cv2.CV_64F).var()
    if fm < 20:
        return True, round(fm, 2), "Very blurry"
    if fm < 50:
        return True, round(fm, 2), "Moderately blurry"
    return False, round(fm, 2), "Sharp"


def check_cropped(img, gray):
    h, w = img.shape[:2]
    thresh = cv2.threshold(gray, 240, 255, cv2.THRESH_BINARY)[1]
    coords = cv2.findNonZero(cv2.bitwise_not(thresh))
    if coords is None:
        return True, 1.0, "Fully blank"
    x, y, cw, ch = cv2.boundingRect(coords)
    margin_ratio = 0.03
    expected_w = w * (1 - 2 * margin_ratio)
    expected_h = h * (1 - 2 * margin_ratio)
    ratio = min(cw / expected_w, ch / expected_h) if expected_w > 0 and expected_h > 0 else 1
    if ratio < 0.5:
        return True, round(ratio, 3), f"Heavily cropped ({ratio})"
    if ratio < 0.75:
        return True, round(ratio, 3), f"Partially cropped ({ratio})"
    return False, round(ratio, 3), "Not cropped"


def check_tampering(img, gray):
    h, w = img.shape[:2]
    edges = cv2.Canny(gray, 50, 150)
    if np.sum(edges) == 0:
        return True, 80.0, "No edges detected"
    edge_density = np.sum(edges) / (h * w) * 100

    laplacian = cv2.Laplacian(gray, cv2.CV_64F)
    edge_std = np.std(laplacian)

    tamper_score = 0
    reasons = []

    if edge_density < 0.5:
        tamper_score += 25
        reasons.append("Unnatural edge density")

    sobelx = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
    sobely = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
    mag = np.sqrt(sobelx**2 + sobely**2)
    mag_norm = (mag / mag.max() * 255).astype(np.uint8) if mag.max() > 0 else mag

    hist = cv2.calcHist([mag_norm], [0], None, [256], [0, 256])
    hist_norm = hist / hist.sum()
    high_freq_ratio = hist_norm[200:].sum()

    if high_freq_ratio < 0.001:
        tamper_score += 15
        reasons.append("Unnatural smoothness")

    x_gradients = np.abs(np.diff(gray.astype(np.float32), axis=1))
    y_gradients = np.abs(np.diff(gray.astype(np.float32), axis=0))
    grid_size = 64
    block_x_vars = []
    for i in range(0, w - grid_size, grid_size):
        for j in range(0, h - grid_size, grid_size):
            block = x_gradients[j:j + grid_size, i:i + grid_size]
            if block.size > 0:
                block_x_vars.append(np.var(block))
    if block_x_vars:
        block_var_cv = np.std(block_x_vars) / (np.mean(block_x_vars) + 1e-6)
        if block_var_cv > 1.5:
            tamper_score += 20
            reasons.append("Inconsistent compression across regions")

    if tamper_score >= 40:
        return True, min(tamper_score, 100), "; ".join(reasons)
    return False, min(tamper_score, 100), "No tampering detected"


def check_screenshot(gray):
    h, w = gray.shape
    edges = cv2.Canny(gray, 30, 100)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=int(min(w, h) * 0.1), minLineLength=int(min(w, h) * 0.2), maxLineGap=10)
    if lines is not None and len(lines) >= 4:
        return True, "Real screenshot (UI layout detected)"
    text_region = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    text_pixels = np.sum(text_region == 0)
    text_ratio = text_pixels / (h * w)
    if 0.01 < text_ratio < 0.4:
        return True, "Real screenshot (text density matches UPI screenshot)"
    return False, "Not a standard screenshot"


def check_missing_ui_elements(img, gray, ocr_result):
    h, w = img.shape[:2]
    issues = []
    upi_keywords = ['upi', 'vpa', 'pay', 'paid', 'amount', '₹', 'rs', 'success', 'completed', 'transaction', 'ref', 'utr']
    found_keywords = set()
    upi_pattern_detected = any('@' in line for line in ocr_result.get('all_text', []))
    rupee_detected = any('₹' in line for line in ocr_result.get('all_text', []))

    for block in ocr_result.get('blocks', []):
        text = block.get('text', '').lower()
        for kw in upi_keywords:
            if kw in text:
                found_keywords.add(kw)

    if not rupee_detected and not any('rs' in line.lower() or 'inr' in line.lower() for line in ocr_result.get('all_text', [])):
        issues.append("No currency indicator found")
    if not upi_pattern_detected and not any(kw in found_keywords for kw in ['upi', 'vpa', 'pay', 'paid', 'transaction']):
        issues.append("No UPI-related keywords found")
    if len(found_keywords) < 3:
        issues.append(f"Few UI keywords ({len(found_keywords)}/7)")

    return issues if issues else ["All UI elements present"]


def get_perceptual_hash(img):
    try:
        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        pil_img = Image.fromarray(rgb)
        h = str(phash(pil_img))
        return h
    except Exception:
        return ""


def classify_layout(blocks, img_width, img_height):
    layout = {
        'header': [], 'amount_section': [], 'receiver_section': [],
        'sender_section': [], 'transaction_details': [], 'footer': [],
        'unclassified': []
    }
    for b in blocks:
        text = b.get('text', '').strip()
        bbox = b.get('bbox', [[0,0],[0,0],[0,0],[0,0]])
        cy = (bbox[0][1] + bbox[2][1]) / 2
        cx = (bbox[0][0] + bbox[2][0]) / 2
        rel_y = cy / img_height if img_height > 0 else 0
        rel_x = cx / img_width if img_width > 0 else 0
        lower = text.lower()

        if rel_y < 0.15:
            layout['header'].append(b)
        elif any(kw in lower for kw in ['amount', '₹', 'rs.', 'total', 'paid']):
            layout['amount_section'].append(b)
        elif any(kw in lower for kw in ['receiver', 'payee', 'beneficiary', 'to:', 'paid to', 'transfer to', 'sent to']) or ('@' in text and rel_y < 0.5):
            layout['receiver_section'].append(b)
        elif any(kw in lower for kw in ['from:', 'sender', 'payer', 'sent by', 'paid by', 'debit from']):
            layout['sender_section'].append(b)
        elif any(kw in lower for kw in ['utr', 'transaction', 'ref no', 'txn', 'rrn', 'bank ref', 'date', 'time']) and rel_y > 0.3:
            layout['transaction_details'].append(b)
        elif rel_y > 0.8:
            layout['footer'].append(b)
        else:
            layout['unclassified'].append(b)

    return layout


def extract_fields(ocr_result):
    fields = {
        'amount': {'value': None, 'confidence': 0, 'bbox': None},
        'receiverUpi': {'value': None, 'confidence': 0, 'bbox': None},
        'senderUpi': {'value': None, 'confidence': 0, 'bbox': None},
        'utr': {'value': None, 'confidence': 0, 'bbox': None},
        'date': {'value': None, 'confidence': 0, 'bbox': None},
        'time': {'value': None, 'confidence': 0, 'bbox': None},
        'status': {'value': None, 'confidence': 0, 'bbox': None},
        'bank': {'value': None, 'confidence': 0, 'bbox': None},
        'appName': {'value': None, 'confidence': 0, 'bbox': None},
    }

    all_text = ' '.join(b.get('text', '') for b in ocr_result.get('blocks', []))

    for b in ocr_result.get('blocks', []):
        text = b.get('text', '').strip()
        if not text:
            continue
        conf = b.get('confidence', 0)
        bbox = b.get('bbox', [])
        lower = text.lower()

        if fields['amount']['value'] is None:
            import re
            m = re.search(r'(?:₹|rs\.?\s*|inr\s*)\s*([\d,]+\.?\d{0,2})', text, re.IGNORECASE)
            if m:
                val = m.group(1).replace(',', '')
                fields['amount'] = {'value': val, 'confidence': conf, 'bbox': bbox}
                continue
            m = re.search(r'(?:amount|amt|total|paid)\s*:?\s*₹?\s*([\d,]+\.?\d{0,2})', text, re.IGNORECASE)
            if m:
                val = m.group(1).replace(',', '')
                try:
                    num = float(val)
                    if 1 < num < 10000000:
                        fields['amount'] = {'value': val, 'confidence': conf, 'bbox': bbox}
                        continue
                except:
                    pass
            m = re.match(r'^₹?\s*([\d,]+\.?\d{0,2})\s*$', text)
            if m and bbox:
                cy = (bbox[0][1] + bbox[2][1]) / 2
                if cy > 50:
                    val = m.group(1).replace(',', '')
                    fields['amount'] = {'value': val, 'confidence': conf * 0.8, 'bbox': bbox}
                    continue
            m = re.match(r'^([\d,]+\.?\d{0,2})\s*$', text)
            if m and bbox:
                cy = (bbox[0][1] + bbox[2][1]) / 2
                if cy > 50 and cy < 0.8 * (ocr_result.get('image_height', 2000) or 2000):
                    val = m.group(1).replace(',', '')
                    try:
                        num = float(val)
                        if 1 < num < 10000000:
                            fields['amount'] = {'value': val, 'confidence': conf * 0.7, 'bbox': bbox}
                            continue
                    except:
                        pass

        if fields['receiverUpi']['value'] is None and '@' in text:
            import re
            upis = re.findall(r'([\w.\-]+@[\w.]+)', text, re.IGNORECASE)
            if upis:
                for upi in upis:
                    parts = upi.split('@')
                    if len(parts) == 2 and len(parts[1]) >= 2:
                        lower_upi = upi.lower()
                        parent_text = all_text.lower()
                        receiver_idx = parent_text.find(lower_upi)
                        context_start = max(0, receiver_idx - 60)
                        context = all_text[context_start:receiver_idx + len(upi) + 20].lower()
                        if any(kw in context for kw in ['to:', 'paid to', 'receiver', 'payee', 'beneficiary', '@']):
                            fields['receiverUpi'] = {'value': lower_upi, 'confidence': conf, 'bbox': bbox}
                            break

        if fields['utr']['value'] is None:
            import re
            for pat in [r'(?:utr|neft\s*utr|upi\s*ref|transaction\s*(?:id|no|number|ref)|txn\s*(?:id|no)?)\s*:?\s*([a-z0-9]{10,})',
                        r'(?:bank\s*ref|rrn|reference\s*(?:no|number)?)\s*:?\s*([a-z0-9]{10,})',
                        r'\b([a-z0-9]{12,22})\b']:
                m = re.search(pat, text, re.IGNORECASE)
                if m:
                    val = m.group(1).upper()
                    if len(val) >= 10 and len(val) <= 30:
                        fields['utr'] = {'value': val, 'confidence': conf, 'bbox': bbox}
                        break

        if fields['senderUpi']['value'] is None and '@' in text:
            if fields['receiverUpi']['value'] and text.lower() != fields['receiverUpi']['value'].lower():
                import re
                upis = re.findall(r'([\w.\-]+@[\w.]+)', text, re.IGNORECASE)
                for upi in upis:
                    lower_upi = upi.lower()
                    if lower_upi != (fields['receiverUpi']['value'] or '').lower():
                        fields['senderUpi'] = {'value': lower_upi, 'confidence': conf, 'bbox': bbox}
                        break

        if fields['status']['value'] is None:
            upper = text.upper()
            if any(kw in upper for kw in ['SUCCESS', 'SUCCESSFUL', 'COMPLETED', 'PAID', 'DONE', 'CREDITED']):
                fields['status'] = {'value': 'SUCCESS', 'confidence': conf, 'bbox': bbox}
            elif any(kw in upper for kw in ['FAILED', 'REJECTED', 'DECLINED', 'CANCELLED', 'FAIL', 'UNSUCCESSFUL', 'REFUNDED', 'EXPIRED']):
                fields['status'] = {'value': 'FAILED', 'confidence': conf, 'bbox': bbox}
            elif any(kw in upper for kw in ['PENDING', 'PROCESSING', 'INITIATED', 'IN PROGRESS']):
                fields['status'] = {'value': 'PENDING', 'confidence': conf, 'bbox': bbox}

    # Fallback: search through full text for status keywords
    if fields['status']['value'] is None and all_text:
        upper_all = all_text.upper()
        if any(kw in upper_all for kw in ['SUCCESS', 'SUCCESSFUL', 'COMPLETED', 'PAID', 'DONE', 'CREDITED']):
            fields['status'] = {'value': 'SUCCESS', 'confidence': 85, 'bbox': None}
        elif any(kw in upper_all for kw in ['FAILED', 'REJECTED', 'DECLINED', 'CANCELLED', 'FAIL', 'UNSUCCESSFUL', 'REFUNDED', 'EXPIRED']):
            fields['status'] = {'value': 'FAILED', 'confidence': 85, 'bbox': None}
        elif any(kw in upper_all for kw in ['PENDING', 'PROCESSING', 'INITIATED', 'IN PROGRESS']):
            fields['status'] = {'value': 'PENDING', 'confidence': 85, 'bbox': None}

    for b in ocr_result.get('blocks', []):
        text = b.get('text', '').strip()
        conf = b.get('confidence', 0)
        bbox = b.get('bbox', [])

        if fields['date']['value'] is None:
            import re
            months = r'(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*'
            for pat in [
                rf'(\d{{1,2}})\s+{months}\s+(\d{{2,4}})',
                r'(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})',
                r'(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})',
            ]:
                m = re.search(pat, text, re.IGNORECASE)
                if m:
                    from datetime import datetime
                    try:
                        date_str = m.group(0)
                        for fmt in ['%d %b %Y', '%d %B %Y', '%d/%m/%Y', '%d-%m-%Y', '%m/%d/%Y', '%Y-%m-%d', '%Y/%m/%d']:
                            try:
                                dt = datetime.strptime(date_str[:20], fmt)
                                fields['date'] = {'value': dt.strftime('%Y-%m-%d'), 'confidence': conf, 'bbox': bbox}
                                break
                            except: pass
                        if fields['date']['value']: break
                    except: pass

        if fields['time']['value'] is None:
            import re
            m = re.search(r'(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:AM|PM|am|pm)?', text)
            if m:
                fields['time'] = {'value': m.group(0).strip(), 'confidence': conf, 'bbox': bbox}

        if fields['bank']['value'] is None:
            banks = ['hdfc bank', 'icici bank', 'state bank of india', 'sbi', 'axis bank', 'kotak mahindra',
                     'yes bank', 'pnb', 'canara bank', 'bank of baroda', 'union bank', 'idbi bank', 'indusind bank',
                     'federal bank', 'rbl bank', 'bandhan bank', 'hsbc', 'citi bank']
            for bank in banks:
                if bank in text.lower():
                    fields['bank'] = {'value': bank.title(), 'confidence': conf, 'bbox': bbox}
                    break

        if fields['appName']['value'] is None:
            apps = ['google pay', 'gpay', 'phonepe', 'paytm', 'bhim', 'amazon pay', 'cred', 'whatsapp',
                    'mobikwik', 'freecharge', 'airtel thanks', 'jiopay', 'axis pay', 'icici pockets',
                    'sbi yono', 'hdfc payzapp']
            for app in apps:
                if app in text.lower():
                    fields['appName'] = {'value': app.title(), 'confidence': conf, 'bbox': bbox}
                    break

    if fields['receiverUpi']['value'] is None:
        import re
        for b in ocr_result.get('blocks', []):
            text = b.get('text', '').strip()
            if '@' in text:
                upis = re.findall(r'([\w.\-]+@[\w.]+)', text, re.IGNORECASE)
                for upi in upis:
                    parts = upi.split('@')
                    if len(parts) == 2 and len(parts[1]) >= 2:
                        fields['receiverUpi'] = {'value': upi.lower(), 'confidence': b.get('confidence', 0) * 0.7, 'bbox': b.get('bbox', [])}
                        break
            if fields['receiverUpi']['value']: break

    if not fields['senderUpi']['value'] and fields['receiverUpi']['value']:
        import re
        for b in ocr_result.get('blocks', []):
            text = (b.get('text', '') or '').strip()
            if '@' in text and text.lower() != fields['receiverUpi']['value'].lower():
                upis = re.findall(r'([\w.\-]+@[\w.]+)', text, re.IGNORECASE)
                for upi in upis:
                    if upi.lower() != fields['receiverUpi']['value'].lower():
                        fields['senderUpi'] = {'value': upi.lower(), 'confidence': b.get('confidence', 0) * 0.6, 'bbox': b.get('bbox', [])}
                        break
        # Fallback: look in full text for "from" context
        if not fields['senderUpi']['value'] and all_text:
            lines = all_text.split('\n')
            for i, line in enumerate(lines):
                lower = line.lower()
                if 'from' in lower or 'sender' in lower:
                    m = re.search(r'([\w.\-]+@[\w.]+)', line, re.IGNORECASE)
                    if m:
                        upi = m.group(1).lower()
                        if upi != fields['receiverUpi']['value'].lower():
                            fields['senderUpi'] = {'value': upi, 'confidence': 80, 'bbox': None}
                            break
                    # Check next line for UPI ID
                    if i + 1 < len(lines):
                        nm = re.search(r'([\w.\-]+@[\w.]+)', lines[i + 1], re.IGNORECASE)
                        if nm:
                            upi = nm.group(1).lower()
                            if upi != fields['receiverUpi']['value'].lower():
                                fields['senderUpi'] = {'value': upi, 'confidence': 75, 'bbox': None}
                                break

    return fields


def normalize_text(text):
    if not text:
        return text
    subs = {'O': '0', 'o': '0', 'I': '1', 'l': '1', 'S': '5', 'B': '8', 'Z': '2', 'G': '6'}
    for old, new in subs.items():
        text = text.replace(old, new)
    return text.strip()


def process_image(image_path):
    result = {
        'visualValidation': {
            'isScreenshot': False,
            'isTampered': False,
            'isBlurred': False,
            'isCropped': False,
            'duplicate': False,
            'perceptualHash': '',
            'blurScore': 0,
            'tamperScore': 0,
            'issues': [],
        },
        'ocr': {
            'blocks': [],
            'all_text': [],
            'layout': {},
            'fields': {},
            'confidence': 0,
        },
        'error': None,
    }

    if not os.path.exists(image_path):
        result['error'] = f"Image not found: {image_path}"
        return result

    img = load_image(image_path)
    if img is None:
        result['error'] = "Failed to load image"
        return result

    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Perceptual hash
    result['visualValidation']['perceptualHash'] = get_perceptual_hash(img)

    # Blur check
    is_blurred, blur_score, blur_reason = check_blur(gray)
    result['visualValidation']['isBlurred'] = is_blurred
    result['visualValidation']['blurScore'] = blur_score
    if is_blurred:
        result['visualValidation']['issues'].append(blur_reason)

    # Cropped check
    is_cropped, crop_ratio, crop_reason = check_cropped(img, gray)
    result['visualValidation']['isCropped'] = is_cropped
    if is_cropped:
        result['visualValidation']['issues'].append(crop_reason)

    # Screenshot check
    is_screenshot, screenshot_reason = check_screenshot(gray)
    result['visualValidation']['isScreenshot'] = is_screenshot
    if not is_screenshot:
        result['visualValidation']['issues'].append(screenshot_reason)

    # Tampering check
    is_tampered, tamper_score, tamper_reason = check_tampering(img, gray)
    result['visualValidation']['isTampered'] = is_tampered
    result['visualValidation']['tamperScore'] = tamper_score
    if is_tampered:
        result['visualValidation']['issues'].append(tamper_reason)

    # Run PaddleOCR
    try:
        ocr_engine = get_ocr()
        ocr_results = ocr_engine.ocr(image_path, cls=True)

        blocks = []
        all_text = []
        total_conf = 0
        block_count = 0

        if ocr_results and len(ocr_results) > 0:
            for line_group in ocr_results:
                if line_group is None:
                    continue
                for line in line_group:
                    if line is None:
                        continue
                    bbox, (text, conf) = line
                    if not text or not text.strip():
                        continue
                    block = {
                        'text': text.strip(),
                        'confidence': round(float(conf) * 100, 2),
                        'bbox': [[int(b[0]), int(b[1])] for b in bbox],
                    }
                    blocks.append(block)
                    all_text.append(text.strip())
                    total_conf += float(conf)
                    block_count += 1

        result['ocr']['blocks'] = blocks
        result['ocr']['all_text'] = all_text
        result['ocr']['confidence'] = round((total_conf / block_count) * 100, 2) if block_count > 0 else 0
        result['ocr']['image_height'] = h
        result['ocr']['image_width'] = w

        # Layout analysis
        result['ocr']['layout'] = classify_layout(blocks, w, h)

        # UI element check
        ui_issues = check_missing_ui_elements(img, gray, result['ocr'])
        if ui_issues and ui_issues[0] != "All UI elements present":
            result['visualValidation']['issues'].extend(ui_issues)

        # Field extraction
        fields = extract_fields(result['ocr'])
        result['ocr']['fields'] = fields

    except Exception as e:
        result['error'] = f"OCR failed: {e}"
        traceback.print_exc()

    return result


if __name__ == '__main__':
    if len(sys.argv) > 1:
        img_path = sys.argv[1]
    else:
        img_path = sys.stdin.read().strip()

    if not img_path:
        result = {"error": "No image path provided"}
        print(json.dumps(result))
        sys.exit(0)

    result = process_image(img_path)
    print(json.dumps(result, default=str))
