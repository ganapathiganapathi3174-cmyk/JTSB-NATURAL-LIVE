import re
from typing import Optional, Dict, Any

class FieldParser:
    AMOUNT_PATTERNS = [
        r"(?:Rs|INR|₹)\s*[:.]?\s*([\d,]+\.?\d{0,2})",
        r"(?:Amount|Amt|Total|Paid)\s*:?\s*(?:Rs|INR|₹)?\s*([\d,]+\.?\d{0,2})",
        r"([\d,]+\.\d{2})\s*(?:credited|debited|paid|sent)",
        r"(?:credited|debited|paid|sent)\s+(?:Rs|INR|₹)?\s*([\d,]+\.?\d{0,2})",
    ]
    UTR_PATTERNS = [
        r"(?:UPI\s*(?:Ref|Reference|Transaction\s*(?:Ref|ID)?|Trxn|TXN|Number)\s*(?:No|Number|ID|Ref)?\.?\s*:?\s*([A-Z0-9]{10,30}))",
        r"(?:Ref(?!erence)|Reference|Transaction\s*(?:ID|Ref)?|TXN?\s*(?:ID|No|Number)?|RRN|UTR)\s*(?:No(?!t)|Number|ID|Ref)?\.?\s*:?\s*([A-Z0-9]{10,30})",
        r"\b(\d{12,22})\b",
    ]
    UPI_PATTERNS = [
        r"([\w.\-]+@[\w.]+)",
    ]
    UPI_PATTERNS = [
        r"([\w.\-]+@[\w.]+)",
    ]
    DATE_PATTERNS = [
        r"(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})",
        r"(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{2,4})",
        r"(?:Date|Dt|On)\s*:?\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})",
    ]
    TIME_PATTERNS = [
        r"(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)?",
    ]
    STATUS_KEYWORDS = {
        "SUCCESS": ["success", "successful", "completed", "paid", "credited", "done", "sent"],
        "FAILED": ["failed", "rejected", "declined", "cancelled", "unsuccessful", "reversed", "expired"],
        "PENDING": ["pending", "processing", "initiated", "awaiting"],
    }
    RECEIVER_PATTERNS = [
        r"(?:To|Paid\s*To|Beneficiary|Receiver|Transfer\s*To)\s*:?\s*([A-Za-z][A-Za-z\s.]+?)(?:\s*(?:UPI|Via|On|At|Ref|\d|$))",
        r"(?:Beneficiary\s*Name|Beneficiary)\s*:?\s*([A-Za-z][A-Za-z\s.]+?)(?:\s*(?:UPI|Via|On|At|Ref|\d|$))",
    ]

    MONTHS = {
        "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3,
        "apr": 4, "april": 4, "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7,
        "aug": 8, "august": 8, "sep": 9, "september": 9, "oct": 10, "october": 10,
        "nov": 11, "november": 11, "dec": 12, "december": 12,
    }

    def parse(self, raw_text: str, layout_info: dict, app_name: str) -> dict:
        fields = {
            "amount": None,
            "utr": None,
            "receiver": None,
            "upi": None,
            "sender_vpa": None,
            "status": None,
            "date": None,
            "time": None,
            "bank": None,
        }
        if not raw_text:
            return fields

        lines = raw_text.split("\n")
        full_text = raw_text

        fields["amount"] = self._extract_amount(lines, full_text)
        fields["utr"] = self._extract_utr(lines, full_text)
        fields["receiver"] = self._extract_receiver(lines)
        fields["upi"] = self._extract_upi(lines, full_text)
        fields["sender_vpa"] = self._extract_sender_vpa(lines)
        fields["status"] = self._extract_status(full_text)
        fields["date"] = self._extract_date(lines, full_text)
        fields["time"] = self._extract_time(lines, full_text)
        fields["bank"] = self._extract_bank(full_text)

        if app_name and not fields["bank"]:
            bank_map = {
                "Google Pay": "Google Pay",
                "PhonePe": "PhonePe",
                "Paytm": "Paytm",
                "BHIM": "BHIM",
                "Amazon Pay": "Amazon Pay",
                "CRED": "CRED",
                "ICICI Bank": "ICICI Bank",
                "HDFC Bank": "HDFC Bank",
                "SBI": "SBI",
                "Axis Bank": "Axis Bank",
                "Kotak Mahindra": "Kotak Mahindra",
            }
            fields["bank"] = bank_map.get(app_name)

        return fields

    def _extract_amount(self, lines: list, full_text: str):
        for line in lines:
            for pat in self.AMOUNT_PATTERNS:
                m = re.search(pat, line, re.IGNORECASE)
                if m:
                    try:
                        val = float(m.group(1).replace(",", ""))
                        if 0 < val < 10000000:
                            return int(round(val))
                    except:
                        continue
        for pat in self.AMOUNT_PATTERNS[:2]:
            m = re.search(pat, full_text, re.IGNORECASE)
            if m:
                try:
                    val = float(m.group(1).replace(",", ""))
                    if 0 < val < 10000000:
                        return int(round(val))
                except:
                    continue
        return None

    def _extract_utr(self, lines: list, full_text: str):
        def _is_valid_utr(v: str) -> bool:
            v = v.strip().upper()
            if len(v) < 10 or len(v) > 30:
                return False
            if not re.match(r"^[A-Z0-9]+$", v):
                return False
            if re.search(r"@", v, re.IGNORECASE):
                return False
            if re.search(r"(?:GMAIL|YAHOO|OUTLOOK|HOTMAIL|ICICI|HDFC|SBI|AXIS|OKICI|OKSBI|OKAXIS|OKHDFC|YESBANK|PAYTM|PHONEPE|GOOGLE)", v):
                return False
            if re.match(r"^[A-Za-z]{2,10}\d{0,5}$", v) and len(v) < 14:
                return False
            return True

        found = []
        for line in lines:
            for pat in self.UTR_PATTERNS:
                for m in re.finditer(pat, line, re.IGNORECASE):
                    val = m.group(1).strip()
                    if _is_valid_utr(val) and val not in found:
                        found.append(val.upper())
        if not found:
            for pat in self.UTR_PATTERNS:
                for m in re.finditer(pat, full_text, re.IGNORECASE):
                    val = m.group(1).strip()
                    if _is_valid_utr(val) and val not in found:
                        found.append(val.upper())
        return found[0] if found else None

    def _extract_receiver(self, lines: list):
        for line in lines:
            for pat in self.RECEIVER_PATTERNS:
                m = re.search(pat, line, re.IGNORECASE)
                if m:
                    name = m.group(1).strip().rstrip(":")
                    if len(name) > 1 and not re.match(r"^\d+$", name):
                        return name
        return None

    def _extract_upi(self, lines: list, full_text: str):
        candidates = []
        for line in lines:
            for pat in self.UPI_PATTERNS:
                for m in re.finditer(pat, line, re.IGNORECASE):
                    upi = m.group(1).lower().strip()
                    if "@" in upi and len(upi.split("@")[1]) >= 2:
                        candidates.append(upi)
        if not candidates:
            for m in re.finditer(self.UPI_PATTERNS[0], full_text, re.IGNORECASE):
                upi = m.group(1).lower().strip()
                if "@" in upi and len(upi.split("@")[1]) >= 2:
                    candidates.append(upi)
        return candidates[0] if candidates else None

    def _extract_sender_vpa(self, lines: list):
        for line in lines:
            m = re.search(r"(?:From|Sender|Payer|Paid\s*By)\s*:?\s*([\w.\-]+@[\w.]+)", line, re.IGNORECASE)
            if m:
                return m.group(1).lower()
        return None

    def _extract_status(self, full_text: str):
        lower = full_text.lower()
        for status, keywords in self.STATUS_KEYWORDS.items():
            for kw in keywords:
                if kw in lower:
                    return status
        return None

    def _extract_date(self, lines: list, full_text: str):
        for line in lines:
            for pat in self.DATE_PATTERNS:
                m = re.search(pat, line, re.IGNORECASE)
                if not m:
                    continue
                if m.lastindex == 3:
                    a, b, y = m.group(1), m.group(2), m.group(3)
                else:
                    continue
                if b.isdigit():
                    d, mo, y = int(a), int(b), int(y)
                    if y < 100:
                        y += 2000
                    if 1 <= d <= 31 and 1 <= mo <= 12 and 2000 <= y <= 2100:
                        return f"{y:04d}-{mo:02d}-{d:02d}"
                else:
                    mo_str = b[:3].lower()
                    if mo_str in self.MONTHS:
                        d, mo, y = int(a), self.MONTHS[mo_str], int(y)
                        if y < 100:
                            y += 2000
                        if 1 <= d <= 31 and 1 <= mo <= 12 and 2000 <= y <= 2100:
                            return f"{y:04d}-{mo:02d}-{d:02d}"
        return None

    def _extract_time(self, lines: list, full_text: str):
        for line in lines:
            m = re.search(self.TIME_PATTERNS[0], line, re.IGNORECASE)
            if m:
                h, mi = int(m.group(1)), int(m.group(2))
                if 0 <= h <= 23 and 0 <= mi <= 59:
                    ampm = m.group(4).upper() if m.lastindex >= 4 and m.group(4) else ""
                    if ampm == "PM" and h < 12:
                        h += 12
                    elif ampm == "AM" and h >= 12:
                        h = 0
                    display = f"{h:02d}:{mi:02d}"
                    if m.group(3):
                        display += f":{m.group(3)}"
                    return display
        return None

    def _extract_bank(self, full_text: str):
        banks = [
            "SBI", "State Bank of India", "HDFC Bank", "ICICI Bank", "Axis Bank",
            "Kotak Mahindra", "Yes Bank", "PNB", "Canara Bank", "Bank of Baroda",
            "Union Bank", "IDBI Bank", "IndusInd Bank", "Federal Bank", "RBL Bank",
            "Bandhan Bank", "South Indian Bank", "IOB", "Indian Bank", "UCO Bank",
            "Indian Bank",
        ]
        lower = full_text.lower()
        sorted_banks = sorted(banks, key=len, reverse=True)
        for bank in sorted_banks:
            if bank.lower() in lower:
                return bank
        return None
