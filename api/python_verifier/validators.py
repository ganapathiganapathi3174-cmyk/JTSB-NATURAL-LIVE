import re
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional

class ValidatorSet:
    def run_all(self, extracted: dict, expected_amount: int,
                expected_receiver_upi: str, expected_receiver_name: str,
                created_at: str, fraud_score: int, fraud_flags: List[str],
                ocr_confidence: float, app_name: str) -> Dict[str, Dict]:

        return {
            "amount": self._validate_amount(extracted.get("amount"), expected_amount),
            "receiver": self._validate_receiver(extracted, expected_receiver_upi, expected_receiver_name),
            "status": self._validate_status(extracted.get("status")),
            "date": self._validate_date(extracted.get("date")),
            "time": self._validate_time(extracted.get("time"), created_at),
            "utr": self._validate_utr(extracted.get("utr")),
            "fraud": self._validate_fraud(fraud_score, fraud_flags),
            "app_detected": self._validate_app(app_name, ocr_confidence),
            "ocr_quality": self._validate_ocr(ocr_confidence),
        }

    def _validate_amount(self, extracted: Optional[int], expected: int) -> Dict:
        if extracted is None:
            return {"passed": False, "found": "missing", "expected": str(expected)}
        passed = extracted == expected
        return {"passed": passed, "found": str(extracted), "expected": str(expected)}

    def _validate_receiver(self, extracted: dict, expected_upi: str, expected_name: str) -> Dict:
        extracted_upi = (extracted.get("upi") or "").lower().strip()
        extracted_name = (extracted.get("receiver") or "").lower().strip()
        expected_upi = expected_upi.lower().strip()

        found = extracted_upi or extracted_name or "missing"

        if extracted_upi and extracted_upi == expected_upi:
            return {"passed": True, "found": extracted_upi, "expected": expected_upi}

        extracted_name_clean = re.sub(r"[^a-z]", "", extracted_name)
        expected_name_clean = re.sub(r"[^a-z]", "", expected_name.lower())
        if extracted_name_clean and expected_name_clean:
            from rapidfuzz import fuzz
            ratio = fuzz.ratio(extracted_name_clean, expected_name_clean)
            if ratio >= 80:
                return {"passed": True, "found": extracted_name, "expected": expected_name}

        return {"passed": False, "found": found, "expected": expected_upi}

    def _validate_status(self, status: Optional[str]) -> Dict:
        if status is None:
            return {"passed": False, "found": "missing"}
        accepted = {"SUCCESS", "PAID", "COMPLETED", "CREDITED", "DONE", "SENT"}
        rejected = {"FAILED", "REJECTED", "DECLINED", "CANCELLED", "UNSUCCESSFUL", "PENDING", "PROCESSING"}
        upper = status.upper().strip()
        if upper in accepted:
            return {"passed": True, "found": upper}
        if upper in rejected:
            return {"passed": False, "found": upper}
        return {"passed": False, "found": upper}

    def _validate_date(self, date_str: Optional[str]) -> Dict:
        if date_str is None:
            return {"passed": False, "found": "missing"}
        try:
            parsed = datetime.strptime(date_str, "%Y-%m-%d")
            now = datetime.now()
            is_today = (
                parsed.year == now.year and
                parsed.month == now.month and
                parsed.day == now.day
            )
            return {"passed": is_today, "found": date_str}
        except:
            return {"passed": False, "found": date_str}

    def _validate_time(self, time_str: Optional[str], created_at: str) -> Dict:
        if time_str is None:
            return {"passed": False, "found": "missing"}
        if not created_at:
            return {"passed": True, "found": time_str}

        try:
            parts = time_str.split(":")
            if len(parts) < 2:
                return {"passed": False, "found": time_str}
            h, m = int(parts[0]), int(parts[1])
            now = datetime.now()
            screenshot_time = now.replace(hour=h, minute=m, second=0, microsecond=0)

            created = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
            if created.tzinfo:
                screenshot_time = screenshot_time.replace(tzinfo=timezone.utc)
                created = created.astimezone(timezone.utc)

            diff_minutes = (screenshot_time - created).total_seconds() / 60
            if diff_minutes < 0:
                return {"passed": False, "found": time_str, "reason": "Screenshot time is before order creation"}
            within_window = diff_minutes <= 60
            return {"passed": within_window, "found": time_str, "diff_minutes": int(diff_minutes)}
        except:
            return {"passed": True, "found": time_str}

    def _validate_utr(self, utr: Optional[str]) -> Dict:
        if utr is None:
            return {"passed": False, "found": "missing"}
        clean = utr.strip().upper().replace(" ", "")
        if not re.match(r"^[A-Z0-9]{10,30}$", clean):
            return {"passed": False, "found": utr}
        return {"passed": True, "found": utr}

    def _validate_fraud(self, fraud_score: int, fraud_flags: List[str]) -> Dict:
        passed = fraud_score < 50 and len(fraud_flags) == 0
        return {"passed": passed, "score": fraud_score, "flags": fraud_flags}

    def _validate_app(self, app_name: str, ocr_confidence: float) -> Dict:
        passed = app_name != "Unknown"
        score = ocr_confidence if passed else 0
        return {"passed": passed, "found": app_name}

    def _validate_ocr(self, ocr_confidence: float) -> Dict:
        return {"passed": ocr_confidence >= 30, "found": f"{ocr_confidence:.1f}%"}
