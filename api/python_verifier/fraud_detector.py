import re
import cv2
import numpy as np
import hashlib
import io
from PIL import Image
from typing import Dict, Any, List, Optional, Set, Tuple

class FraudDetector:
    def __init__(self):
        self._seen_hashes: Set[str] = set()

    def analyze(self, image_data: bytes, image_hash: str,
                extracted_fields: dict, raw_text: str,
                expected_utr: str = '', order_id: str = '',
                expected_amount: float = 0) -> Dict[str, Any]:
        result = {
            'score': 0,
            'flags': [],
            'details': {},
        }

        img = self._load_image(image_data)
        if img is None:
            return {'score': 100, 'flags': ['unreadable_image'], 'details': {}}

        ela_score, ela_details = self._ela_analysis(img)
        if ela_score > 50:
            result['flags'].append('possible_edit_detected')
            result['score'] += ela_score * 0.25
        result['details']['ela'] = {'score': round(ela_score, 1), 'details': ela_details}

        noise_score, noise_type = self._noise_analysis(img)
        if noise_score > 50:
            result['flags'].append(f'abnormal_noise_{noise_type}')
            result['score'] += noise_score * 0.5
        result['details']['noise'] = {'score': round(noise_score, 1), 'type': noise_type}

        dup_score, dup_type = self._duplicate_check(image_hash, extracted_fields, raw_text)
        if dup_score > 0:
            result['flags'].append(dup_type)
            result['score'] += dup_score
        result['details']['duplicate'] = {'score': dup_score, 'type': dup_type}

        screen_photo_score, photo_reasons = self._detect_screen_photo(img)
        if screen_photo_score > 40:
            result['flags'].append('camera_photo_of_screen')
            result['score'] += screen_photo_score * 0.4
        result['details']['screen_photo'] = {'score': round(screen_photo_score, 1), 'reasons': photo_reasons}

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        blur = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        if blur < 30:
            result['flags'].append('blurred_screenshot')
            result['score'] += max(0, (30 - blur) * 1.5)
        result['details']['blur'] = {'score': round(blur, 1)}

        if expected_utr and extracted_fields.get('utr'):
            utr_result = self._utr_fingerprint_check(extracted_fields['utr'], expected_utr, raw_text)
            if utr_result['suspicious']:
                result['flags'].append('utr_fingerprint_mismatch')
                result['score'] += utr_result['score']
            result['details']['utr_fingerprint'] = utr_result

        if extracted_fields.get('amount') and extracted_fields.get('utr'):
            cross_check = self._cross_field_consistency(extracted_fields)
            if not cross_check['consistent']:
                result['flags'].append('field_inconsistency')
                result['score'] += cross_check['score']
            result['details']['cross_field'] = cross_check

        text_anomaly = self._detect_text_anomalies(raw_text)
        if text_anomaly['score'] > 0:
            result['flags'].append('text_anomaly')
            result['score'] += text_anomaly['score']
        result['details']['text_anomaly'] = text_anomaly

        amount_anomaly = self._check_amount_anomaly(extracted_fields, expected_amount if expected_amount else 0)
        if amount_anomaly['score'] > 0:
            result['flags'].append('amount_anomaly')
            result['score'] += amount_anomaly['score']
        result['details']['amount_anomaly'] = amount_anomaly

        result['score'] = min(int(result['score']), 100)
        result['flags'] = list(set(result['flags']))
        return result

    def _load_image(self, data: bytes) -> Optional[np.ndarray]:
        try:
            arr = np.frombuffer(data, np.uint8)
            img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if img is None:
                pil = Image.open(io.BytesIO(data)).convert('RGB')
                img = np.array(pil)
                img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
            return img
        except:
            return None

    def _ela_analysis(self, img: np.ndarray, quality: int = 90) -> Tuple[float, dict]:
        try:
            pil_img = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
            buf = io.BytesIO()
            pil_img.save(buf, format='JPEG', quality=quality)
            buf.seek(0)
            resaved = Image.open(buf).convert('RGB')
            ela_arr = np.abs(
                np.array(pil_img, dtype=np.float32) - np.array(resaved, dtype=np.float32)
            ).astype(np.uint8)
            ela_gray = np.mean(ela_arr, axis=2)
            mean_ela = float(np.mean(ela_gray))
            std_ela = float(np.std(ela_gray))
            threshold = mean_ela + 2 * std_ela
            anomalous = float(np.sum(ela_gray > threshold) / ela_gray.size * 100)
            score = min(anomalous * 4, 100)
            return score, {'mean': round(mean_ela, 2), 'std': round(std_ela, 2), 'anomalous_pct': round(anomalous, 2)}
        except:
            return 0, {}

    def _noise_analysis(self, img: np.ndarray) -> Tuple[float, str]:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        noise = cv2.GaussianBlur(gray, (5, 5), 0) - gray
        noise_std = float(np.std(noise))
        if noise_std > 30:
            return min((noise_std - 30) * 3, 100), 'high'
        if noise_std < 2:
            return 40, 'low'
        return 0, 'normal'

    def _duplicate_check(self, image_hash: str, fields: dict, raw_text: str) -> Tuple[int, str]:
        if image_hash in self._seen_hashes:
            return 40, 'duplicate_image_in_session'
        self._seen_hashes.add(image_hash)
        return 0, ''

    def _detect_screen_photo(self, img: np.ndarray) -> Tuple[float, list]:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        reasons = []
        score = 0.0
        h, w = img.shape[:2]

        # Edge angle non-uniformity from perspective distortion
        edges = cv2.Canny(gray, 50, 150)
        lines = cv2.HoughLinesP(edges, 1, np.pi / 180, 100, minLineLength=100, maxLineGap=10)
        if lines is not None:
            angles = []
            for line in lines:
                x1, y1, x2, y2 = line[0]
                angle = np.degrees(np.arctan2(y2 - y1, x2 - x1))
                angles.append(abs(angle % 90))
            if angles:
                angle_std = float(np.std([min(a, 90 - a) for a in angles]))
                if angle_std > 10:
                    score += min(angle_std * 4, 40)
                    reasons.append(f'Non-uniform edge angles ({angle_std:.1f}deg)')
                if len(angles) < 30:
                    score += 10
                    reasons.append(f'Low edge count ({len(angles)})')

        # Color noise: camera photos have pixel-level chroma noise
        ycrcb = cv2.cvtColor(img, cv2.COLOR_BGR2YCrCb)
        cr_std = float(np.std(ycrcb[:, :, 1]))
        cb_std = float(np.std(ycrcb[:, :, 2]))
        if cr_std < 3 or cb_std < 3:
            score += 10
            reasons.append(f'Low chroma variance (Cr={cr_std:.1f}, Cb={cb_std:.1f})')

        return min(score, 100), reasons

    def _utr_fingerprint_check(self, extracted_utr: str, expected_utr: str, raw_text: str) -> Dict:
        result = {'suspicious': False, 'score': 0, 'reasons': []}

        ext_clean = extracted_utr.upper().replace('O', '0').replace('I', '1')
        exp_clean = expected_utr.upper().replace('O', '0').replace('I', '1')

        if exp_clean and ext_clean != exp_clean:
            text_upper = raw_text.upper()
            if ext_clean in text_upper and exp_clean not in text_upper:
                result['suspicious'] = True
                result['score'] = 20
                result['reasons'].append('Extracted UTR not matching expected UTR')
                other_numbers = []
                import re
                for m in re.finditer(r'\b([A-Z0-9]{10,22})\b', text_upper):
                    num = m.group(1)
                    if num != ext_clean and num != exp_clean:
                        other_numbers.append(num)
                if other_numbers:
                    result['reasons'].append(f'Other UTR-like numbers found: {other_numbers[:3]}')
                    result['score'] = 35
        return result

    def _cross_field_consistency(self, fields: Dict) -> Dict:
        result = {'consistent': True, 'score': 0, 'reasons': []}
        if fields.get('status') and fields['status'] == 'FAILED' and fields.get('amount') is not None:
            result['consistent'] = False
            result['score'] = 30
            result['reasons'].append('Failed payment but amount extracted')
        return result

    def _check_amount_anomaly(self, extracted_fields: Dict, expected_amount: float) -> Dict:
        result = {'score': 0, 'reasons': []}
        ext_amount = extracted_fields.get('amount', 0)
        if not ext_amount or ext_amount <= 0:
            return result

        ext_str = str(int(ext_amount))

        # Only flag amount anomaly when it doesn't match expected amount
        if ext_amount != expected_amount:
            # Check for uniform fake numbers (most legit amounts have 3+ unique digits)
            if len(ext_str) >= 4 and len(set(ext_str)) <= 2 and ext_amount >= 100:
                result['score'] = 35
                result['reasons'].append(f'Suspicious uniform amount ({ext_amount})')

            # Check for amounts way out of expected range (10x+)
            if expected_amount > 0 and (ext_amount > expected_amount * 10 or ext_amount < expected_amount * 0.1):
                result['score'] = max(result['score'], 30)
                result['reasons'].append(f'Amount ({ext_amount}) way out of expected range ({expected_amount})')

        # Detect rounded fake amounts like 99999, 88888, etc.
        if ext_amount > 1000 and ext_amount % 1000 == 999:
            result['score'] = max(result['score'], 25)
            result['reasons'].append(f'Suspicious rounded fake amount ({ext_amount})')

        return result

    def _detect_text_anomalies(self, raw_text: str) -> Dict:
        result = {'score': 0, 'reasons': []}
        if not raw_text:
            return result

        text_upper = raw_text.upper()

        suspicious_patterns = [
            (r'\b(FAKE|SCAM|FRAUD|TEST|DEMO|SAMPLE)\b', 50),
            (r'(?:Rs|INR|₹)\s*[0]+\s*\.?\s*[0]*', 20),
            (r'\bPAID\b.*\bPAID\b', 10),
            (r'\bSUCCESS\b.*\bFAILED\b', 15),
        ]

        for pattern, weight in suspicious_patterns:
            if re.search(pattern, text_upper):
                result['score'] += weight
                result['reasons'].append(f'Suspicious text pattern: {pattern}')

        repeated_chars = re.findall(r'(.)\1{10,}', raw_text)
        if repeated_chars:
            result['score'] += 15
            result['reasons'].append(f'Repeated characters: {repeated_chars[:3]}')

        return result

    def reset_session(self):
        self._seen_hashes.clear()
