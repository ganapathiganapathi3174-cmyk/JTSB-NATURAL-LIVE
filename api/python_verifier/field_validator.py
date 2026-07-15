import re
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional, Tuple

class FieldValidator:
    ACCEPTED_STATUSES = {'SUCCESS', 'SUCCESSFUL', 'COMPLETED', 'PAID', 'CREDITED', 'DONE', 'SENT', 'DEBIT_SUCCESS'}
    REJECTED_STATUSES = {'FAILED', 'REJECTED', 'DECLINED', 'CANCELLED', 'UNSUCCESSFUL', 'REVERSED', 'EXPIRED', 'PENDING', 'PROCESSING', 'INITIATED', 'AWAITING', 'TIMEOUT'}
    EXPECTED_RECEIVER_UPI = 'jayarajj126-3@okicici'
    EXPECTED_RECEIVER_NAME = 'JEYARAJ ALAG'
    ALLOWED_AMOUNTS = {120, 500, 1000}
    MAX_SESSION_AGE_MINUTES = 60

    def validate_all(self, extracted: Dict[str, Any], expected_amount: int,
                     expected_receiver_upi: str, expected_receiver_name: str,
                     created_at: str, fraud_score: int, fraud_flags: List[str],
                     ocr_confidence: float, app_name: str,
                     image_quality: Dict[str, Any], authenticity: Dict[str, Any]) -> Dict[str, Dict]:

        checks = {
            'amount': self._validate_amount(extracted.get('amount'), expected_amount),
            'receiver': self._validate_receiver(extracted, expected_receiver_upi, expected_receiver_name),
            'status': self._validate_status(extracted.get('status')),
            'date': self._validate_date(extracted.get('date')),
            'time': self._validate_time_window(extracted.get('time'), created_at),
            'utr': self._validate_utr(extracted.get('utr')),
            'app_identified': self._validate_app(app_name),
            'ocr_quality': self._validate_ocr_quality(ocr_confidence),
            'image_quality': self._validate_image_quality(image_quality),
            'authenticity': self._validate_authenticity(authenticity),
            'fraud': self._validate_fraud(fraud_score, fraud_flags),
        }

        for key, check in checks.items():
            check['check_name'] = key

        return checks

    def _validate_amount(self, extracted: Optional[int], expected: int) -> Dict:
        if extracted is None:
            return {'passed': False, 'found': 'missing', 'expected': expected, 'reason': 'Amount not found in screenshot'}
        passed = extracted == expected
        return {
            'passed': passed,
            'found': extracted,
            'expected': expected,
            'reason': '' if passed else f'Amount mismatch: found ₹{extracted}, expected ₹{expected}'
        }

    def _validate_receiver(self, extracted: dict, expected_upi: str, expected_name: str) -> Dict:
        ext_upi = (extracted.get('upi') or '').lower().strip()
        ext_name = (extracted.get('receiver') or '').lower().strip()
        exp_upi = expected_upi.lower().strip()
        exp_name = expected_name.lower().strip()

        found = ext_upi or ext_name or 'missing'

        if ext_upi and ext_upi == exp_upi:
            return {'passed': True, 'found': ext_upi, 'expected': exp_upi, 'reason': ''}

        if ext_upi and ext_upi == self.EXPECTED_RECEIVER_UPI:
            return {'passed': True, 'found': ext_upi, 'expected': self.EXPECTED_RECEIVER_UPI, 'reason': ''}

        ext_name_clean = re.sub(r'[^a-z]', '', ext_name)
        exp_name_clean = re.sub(r'[^a-z]', '', exp_name)
        if ext_name_clean and exp_name_clean:
            matches = ext_name_clean == exp_name_clean
            if not matches and len(exp_name_clean) >= 3:
                matches = ext_name_clean in exp_name_clean or exp_name_clean in ext_name_clean
            if matches:
                return {'passed': True, 'found': ext_name, 'expected': exp_name, 'reason': ''}

        return {'passed': False, 'found': found, 'expected': exp_upi,
                'reason': f'Receiver UPI does not match expected {exp_upi}'}

    def _validate_status(self, status: Optional[str]) -> Dict:
        if status is None:
            return {'passed': False, 'found': 'missing', 'reason': 'Payment status not found in screenshot'}
        upper = status.upper().strip()
        if upper in self.ACCEPTED_STATUSES:
            return {'passed': True, 'found': upper, 'reason': ''}
        if upper in self.REJECTED_STATUSES:
            return {'passed': False, 'found': upper, 'reason': f'Payment status is {upper}, must be SUCCESS/PAID/COMPLETED'}
        return {'passed': False, 'found': upper, 'reason': f'Unknown payment status: {upper}'}

    def _validate_date(self, date_str: Optional[str]) -> Dict:
        if date_str is None:
            return {'passed': False, 'found': 'missing', 'reason': 'Payment date not found in screenshot'}
        try:
            parsed = datetime.strptime(date_str, '%Y-%m-%d')
            now = datetime.now()
            is_today = (
                parsed.year == now.year and
                parsed.month == now.month and
                parsed.day == now.day
            )
            if is_today:
                return {'passed': True, 'found': date_str, 'reason': ''}
            else:
                return {'passed': False, 'found': date_str,
                        'reason': f'Payment date {date_str} is not today ({now.strftime("%Y-%m-%d")})'}
        except:
            return {'passed': False, 'found': date_str, 'reason': f'Could not parse date: {date_str}'}

    def _validate_time_window(self, time_str: Optional[str], created_at: str) -> Dict:
        if time_str is None:
            return {'passed': False, 'found': 'missing', 'reason': 'Payment time not found in screenshot'}
        if not created_at:
            return {'passed': True, 'found': time_str, 'reason': ''}

        try:
            parts = time_str.split(':')
            if len(parts) < 2:
                return {'passed': True, 'found': time_str, 'reason': ''}
            h, m = int(parts[0]), int(parts[1])
            now = datetime.now()
            screenshot_time = now.replace(hour=h, minute=m, second=0, microsecond=0)

            created = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
            if created.tzinfo:
                screenshot_time = screenshot_time.replace(tzinfo=timezone.utc)
                created = created.astimezone(timezone.utc)

            diff_minutes = (screenshot_time - created).total_seconds() / 60
            if diff_minutes < 0:
                return {'passed': False, 'found': time_str,
                        'reason': 'Screenshot time is before order creation'}
            within_window = diff_minutes <= self.MAX_SESSION_AGE_MINUTES
            if within_window:
                return {'passed': True, 'found': time_str, 'diff_minutes': int(diff_minutes), 'reason': ''}
            else:
                return {'passed': False, 'found': time_str, 'diff_minutes': int(diff_minutes),
                        'reason': f'Payment time ({time_str}) exceeds {self.MAX_SESSION_AGE_MINUTES}min window ({int(diff_minutes)}min since order)'}
        except:
            return {'passed': True, 'found': time_str, 'reason': ''}

    def _validate_utr(self, utr: Optional[str]) -> Dict:
        if utr is None:
            return {'passed': False, 'found': 'missing', 'reason': 'UTR not found in screenshot'}
        clean = utr.strip().upper().replace(' ', '')
        if not re.match(r'^[A-Z0-9]{10,30}$', clean):
            return {'passed': False, 'found': utr, 'reason': f'Invalid UTR format: {utr} (must be 10-30 alphanumeric)'}
        return {'passed': True, 'found': clean, 'reason': ''}

    def _validate_app(self, app_name: str) -> Dict:
        passed = app_name != 'Unknown'
        return {'passed': passed, 'found': app_name, 'reason': '' if passed else 'Could not identify payment application'}

    def _validate_ocr_quality(self, ocr_confidence: float) -> Dict:
        passed = ocr_confidence >= 30.0
        return {'passed': passed, 'found': f'{ocr_confidence:.1f}%',
                'reason': '' if passed else f'OCR confidence {ocr_confidence:.1f}% is below 30% threshold'}

    def _validate_image_quality(self, quality: Dict[str, Any]) -> Dict:
        issues = []
        if quality.get('is_blurred'):
            issues.append('Blurred screenshot')
        if quality.get('is_dark'):
            issues.append('Screenshot too dark')
        if quality.get('is_bright'):
            issues.append('Screenshot too bright')
        if quality.get('is_low_contrast'):
            issues.append('Low contrast screenshot')
        passed = len(issues) == 0
        return {'passed': passed, 'issues': issues, 'reason': ', '.join(issues) if issues else ''}

    def _validate_authenticity(self, authenticity: Dict[str, Any]) -> Dict:
        issues = []
        is_camera_photo = authenticity.get('is_camera_photo', False)
        is_edited = authenticity.get('is_edited', False)
        if is_camera_photo:
            issues.append('Camera photo of screen detected')
        if is_edited:
            issues.append('Screenshot appears edited or manipulated')
        if authenticity.get('is_cropped'):
            issues.append('Screenshot appears cropped')
        if authenticity.get('is_collage'):
            issues.append('Screenshot appears to be a collage')
        if authenticity.get('tamper_score', 0) > 60:
            issues.append(f'High tamper score: {authenticity["tamper_score"]}')
        passed = len(issues) == 0
        return {'passed': passed, 'issues': issues, 'tamper_score': authenticity.get('tamper_score', 0),
                'is_camera_photo': is_camera_photo, 'is_edited': is_edited,
                'reason': ', '.join(issues) if issues else ''}

    def _validate_fraud(self, fraud_score: int, fraud_flags: List[str]) -> Dict:
        passed = fraud_score < 50 and len(fraud_flags) == 0
        return {'passed': passed, 'score': fraud_score, 'flags': fraud_flags,
                'reason': '' if passed else f'Fraud detected: score={fraud_score}, flags={fraud_flags}'}
