import re
from typing import Optional, Dict, Any, List
from datetime import datetime

class FieldExtractor:
    AMOUNT_PATTERNS = [
        r'(?:Rs|INR|₹)\s*[:.]?\s*([\d,]+\.?\d{0,2})',
        r'(?:Amount|Amt|Total|Paid)\s*:?\s*(?:Rs|INR|₹)?\s*([\d,]+\.?\d{0,2})',
        r'([\d,]+\.\d{2})\s*(?:credited|debited|paid|sent)',
        r'(?:credited|debited|paid|sent)\s+(?:Rs|INR|₹)?\s*([\d,]+\.?\d{0,2})',
        r'\b(1[2]?0|500|1000)\s*(?:Rs|INR|₹)?',
    ]

    UTR_PATTERNS = [
        r'(?:UPI\s*(?:Ref|Reference|Transaction\s*(?:Ref|ID)?|Trxn|TXN|Number)\s*(?:No|Number|ID|Ref)?\.?\s*:?\s*([A-Z0-9]{10,30}))',
        r'(?:Ref(?!erence)|Reference|Transaction\s*(?:ID|Ref)?|TXN?\s*(?:ID|No|Number)?|RRN|UTR)\s*(?:No(?!t)|Number|ID|Ref)?\.?\s*:?\s*([A-Z0-9]{10,30})',
        r'\b(\d{10,22})\b',
    ]

    UPI_PATTERNS = [
        r'([\w.\-]+@[\w.]+)',
    ]

    DATE_PATTERNS = [
        r'(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})',
        r'(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{2,4})',
        r'(\d{1,2})(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(\d{2,4})',
        r'(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{2,4})',
    ]

    TIME_PATTERNS = [
        r'(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)?',
        r'(\d{1,2})\s*:\s*(\d{2})\s*(AM|PM|am|pm)?',
    ]

    STATUS_KEYWORDS = {
        'SUCCESS': ['success', 'successful', 'completed', 'paid', 'credited', 'done', 'sent'],
        'FAILED': ['failed', 'rejected', 'declined', 'cancelled', 'unsuccessful', 'reversed', 'expired', 'failed '],
        'PENDING': ['pending', 'processing', 'initiated', 'awaiting'],
    }

    RECEIVER_PATTERNS = [
        r'(?:To|Paid\s*To|Beneficiary|Receiver|Transfer\s*To)\s*:?\s*([A-Za-z][A-Za-z\s.]+?)(?:\s*(?:UPI|Via|On|At|Ref|\d|$))',
        r'(?:Beneficiary\s*Name|Beneficiary)\s*:?\s*([A-Za-z][A-Za-z\s.]+?)(?:\s*(?:UPI|Via|On|At|Ref|\d|$))',
    ]

    MONTHS = {
        'jan': 1, 'january': 1, 'feb': 2, 'february': 2, 'mar': 3, 'march': 3,
        'apr': 4, 'april': 4, 'may': 5, 'june': 6, 'jun': 6,
        'jul': 7, 'july': 7, 'aug': 8, 'august': 8, 'sep': 9, 'september': 9,
        'oct': 10, 'october': 10, 'nov': 11, 'november': 11, 'dec': 12, 'december': 12,
    }

    BANKS = [
        'SBI', 'State Bank of India', 'HDFC Bank', 'ICICI Bank', 'Axis Bank',
        'Kotak Mahindra', 'Yes Bank', 'PNB', 'Canara Bank', 'Bank of Baroda',
        'Union Bank', 'IDBI Bank', 'IndusInd Bank', 'Federal Bank', 'RBL Bank',
        'Bandhan Bank', 'South Indian Bank', 'IOB', 'Indian Bank', 'UCO Bank',
    ]

    def extract(self, raw_text: str, ocr_words: List[Dict] = None) -> Dict[str, Any]:
        fields = {
            'amount': None,
            'utr': None,
            'receiver': None,
            'upi': None,
            'sender_vpa': None,
            'status': None,
            'date': None,
            'time': None,
            'bank': None,
            'transaction_ref': None,
        }

        if not raw_text:
            return fields

        lines = raw_text.split('\n')
        full_text = raw_text

        fields['amount'] = self._extract_amount(lines, full_text)
        fields['utr'] = self._extract_utr(lines, full_text)
        fields['receiver'] = self._extract_receiver(lines)
        fields['upi'] = self._extract_upi(lines, full_text)
        fields['sender_vpa'] = self._extract_sender_vpa(lines)
        fields['status'] = self._extract_status(full_text)
        fields['date'] = self._extract_date(lines, full_text)
        fields['time'] = self._extract_time(lines, full_text)
        fields['bank'] = self._extract_bank(full_text)
        fields['transaction_ref'] = self._extract_transaction_ref(lines, full_text)

        return fields

    def _extract_amount(self, lines: list, full_text: str) -> Optional[int]:
        for line in lines:
            for pat in self.AMOUNT_PATTERNS:
                m = re.search(pat, line, re.IGNORECASE)
                if m:
                    try:
                        val = float(m.group(1).replace(',', ''))
                        if 0 < val < 10000000:
                            return int(round(val))
                    except:
                        continue
        for pat in self.AMOUNT_PATTERNS[:3]:
            m = re.search(pat, full_text, re.IGNORECASE)
            if m:
                try:
                    val = float(m.group(1).replace(',', ''))
                    if 0 < val < 10000000:
                        return int(round(val))
                except:
                    continue
        return None

    def _extract_utr(self, lines: list, full_text: str) -> Optional[str]:
        def _is_valid_utr(v: str) -> bool:
            v = v.strip().upper()
            if len(v) < 10 or len(v) > 30:
                return False
            if not re.match(r'^[A-Z0-9]+$', v):
                return False
            if re.search(r'@', v, re.IGNORECASE):
                return False
            if re.search(r'(?:GMAIL|YAHOO|OUTLOOK|HOTMAIL|ICICI|HDFC|SBI|AXIS|OKICI|OKSBI|OKAXIS|OKHDFC|YESBANK|PAYTM|PHONEPE|GOOGLE)', v):
                return False
            if re.match(r'^[A-Za-z]{2,10}\d{0,5}$', v) and len(v) < 14:
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

    def _extract_receiver(self, lines: list) -> Optional[str]:
        for line in lines:
            for pat in self.RECEIVER_PATTERNS:
                m = re.search(pat, line, re.IGNORECASE)
                if m:
                    name = m.group(1).strip().rstrip(':')
                    if len(name) > 1 and not re.match(r'^\d+$', name):
                        return name
        return None

    def _extract_upi(self, lines: list, full_text: str) -> Optional[str]:
        candidates = []
        for line in lines:
            for pat in self.UPI_PATTERNS:
                for m in re.finditer(pat, line, re.IGNORECASE):
                    upi = m.group(1).lower().strip()
                    if '@' in upi and len(upi.split('@')[1]) >= 2:
                        candidates.append(upi)
        if not candidates:
            for m in re.finditer(self.UPI_PATTERNS[0], full_text, re.IGNORECASE):
                upi = m.group(1).lower().strip()
                if '@' in upi and len(upi.split('@')[1]) >= 2:
                    candidates.append(upi)
        seen = set()
        uniq = []
        for c in candidates:
            if c not in seen:
                seen.add(c)
                uniq.append(c)
        return uniq[0] if uniq else None

    def _extract_sender_vpa(self, lines: list) -> Optional[str]:
        for line in lines:
            m = re.search(r'(?:From|Sender|Payer|Paid\s*By)\s*:?\s*([\w.\-]+@[\w.]+)', line, re.IGNORECASE)
            if m:
                return m.group(1).lower()
        return None

    def _extract_status(self, full_text: str) -> Optional[str]:
        if not full_text:
            return None
        lower = full_text.lower()

        # First priority: explicit status field labels (Status: X, Payment Status: X)
        for pat in [
            r'status\s*:?\s*(success|successful|completed|paid|credited|done|sent|failed|rejected|declined|cancelled|unsuccessful|reversed|expired|pending|processing|initiated)',
            r'payment\s*:?\s*(success|successful|completed|paid|credited|done|sent|failed|rejected|declined|cancelled|unsuccessful|reversed|expired|pending|processing)',
        ]:
            m = re.search(pat, lower)
            if m:
                val = m.group(1)
                for status_key, keywords in self.STATUS_KEYWORDS.items():
                    if val in keywords or status_key.lower().startswith(val[:3]):
                        return status_key

        # Second priority: status badges/keywords found near bottom of screenshot
        # Check for FAILED/REJECTED/CANCELLED first (more specific)
        for kw in ['failed', 'rejected', 'declined', 'cancelled', 'unsuccessful', 'reversed']:
            if kw in lower:
                return 'FAILED'

        for kw in ['pending', 'processing', 'initiated', 'awaiting']:
            if kw in lower:
                return 'PENDING'

        # Third priority: generic success keywords (could be from header text)
        for kw in ['successful', 'payment successful']:
            if kw in lower:
                return 'SUCCESS'

        # Last resort: generic individual words
        if 'success' in lower or 'completed' in lower:
            return 'SUCCESS'
        if 'paid' in lower or 'credited' in lower:
            return 'SUCCESS'

        return None

    def _extract_date(self, lines: list, full_text: str) -> Optional[str]:
        for line in lines:
            for pat in self.DATE_PATTERNS:
                m = re.search(pat, line, re.IGNORECASE)
                if not m:
                    continue
                try:
                    if m.lastindex == 3:
                        a, b, y = m.group(1), m.group(2), m.group(3)
                    else:
                        continue
                    if b.isdigit():
                        d, mo, y = int(a), int(b), int(y)
                        if y < 100:
                            y += 2000
                        if 1 <= d <= 31 and 1 <= mo <= 12 and 2000 <= y <= 2100:
                            return f'{y:04d}-{mo:02d}-{d:02d}'
                    else:
                        mo_str = b[:3].lower()
                        if mo_str in self.MONTHS:
                            d, mo, y = int(a), self.MONTHS[mo_str], int(y)
                            if y < 100:
                                y += 2000
                            if 1 <= d <= 31 and 1 <= mo <= 12 and 2000 <= y <= 2100:
                                return f'{y:04d}-{mo:02d}-{d:02d}'
                except:
                    continue
        for pat in self.DATE_PATTERNS:
            m = re.search(pat, full_text, re.IGNORECASE)
            if m and m.lastindex == 3:
                try:
                    a, b, y = m.group(1), m.group(2), m.group(3)
                    if b.isdigit():
                        d, mo, y = int(a), int(b), int(y)
                        if y < 100:
                            y += 2000
                        if 1 <= d <= 31 and 1 <= mo <= 12 and 2000 <= y <= 2100:
                            return f'{y:04d}-{mo:02d}-{d:02d}'
                except:
                    continue
        return None

    def _extract_time(self, lines: list, full_text: str) -> Optional[str]:
        for line in lines:
            for pat in self.TIME_PATTERNS:
                m = re.search(pat, line, re.IGNORECASE)
                if m:
                    try:
                        h, mi = int(m.group(1)), int(m.group(2))
                        if 0 <= h <= 23 and 0 <= mi <= 59:
                            ampm = m.group(4).upper() if m.lastindex >= 4 and m.group(4) else ''
                            if ampm == 'PM' and h < 12:
                                h += 12
                            elif ampm == 'AM' and h >= 12:
                                h = 0
                            display = f'{h:02d}:{mi:02d}'
                            if m.lastindex >= 3 and m.group(3):
                                display += f':{m.group(3)}'
                            return display
                    except:
                        continue
        return None

    def _extract_bank(self, full_text: str) -> Optional[str]:
        lower = full_text.lower()
        sorted_banks = sorted(self.BANKS, key=len, reverse=True)
        for bank in sorted_banks:
            if bank.lower() in lower:
                return bank
        return None

    def _extract_transaction_ref(self, lines: list, full_text: str) -> Optional[str]:
        ref_patterns = [
            r'(?:Txn\s*(?:ID|Ref|No|Number)|Transaction\s*(?:ID|Ref))\s*:?\s*([A-Z0-9]{6,30})',
            r'(?:Ref\s*(?:No|Number|ID))\s*:?\s*([A-Z0-9]{6,30})',
        ]
        for line in lines:
            for pat in ref_patterns:
                m = re.search(pat, line, re.IGNORECASE)
                if m:
                    return m.group(1).upper()
        for pat in ref_patterns:
            m = re.search(pat, full_text, re.IGNORECASE)
            if m:
                return m.group(1).upper()
        return None
