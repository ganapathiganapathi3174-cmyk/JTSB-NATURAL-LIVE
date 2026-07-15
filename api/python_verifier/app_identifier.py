import cv2
import numpy as np
from typing import Dict, List, Tuple

APP_SIGNATURES = {
    'Google Pay': {
        'color_ranges': [
            ((35, 80, 200), (45, 130, 255)),
            ((100, 140, 50), (130, 200, 120)),
        ],
        'keywords': ['google pay', 'gpay', 'google', 'payment successful', 'paid to', 'sent'],
        'dominant_colors': [(66, 133, 244), (52, 168, 83)],
        'status_keywords': ['successful', 'paid'],
    },
    'PhonePe': {
        'color_ranges': [
            ((130, 40, 190), (140, 70, 230)),
            ((0, 240, 235), (10, 255, 250)),
        ],
        'keywords': ['phonepe', 'phone pe', 'phone', 'payment successful', 'upi', 'paid'],
        'dominant_colors': [(130, 50, 210), (80, 30, 140)],
        'status_keywords': ['successful', 'paid'],
    },
    'Paytm': {
        'color_ranges': [
            ((90, 180, 235), (100, 200, 255)),
            ((0, 130, 180), (15, 170, 220)),
        ],
        'keywords': ['paytm', 'payment successful', 'sent', 'paytm wallet'],
        'dominant_colors': [(0, 186, 242), (0, 150, 200)],
        'status_keywords': ['successful', 'sent'],
    },
    'BHIM': {
        'color_ranges': [
            ((110, 80, 5), (130, 130, 25)),
            ((0, 0, 200), (20, 30, 255)),
        ],
        'keywords': ['bhim', 'upi', 'bharat', 'payment successful', 'bhim app'],
        'dominant_colors': [(0, 100, 180), (0, 70, 140)],
        'status_keywords': ['successful'],
    },
    'Amazon Pay': {
        'color_ranges': [
            ((5, 140, 250), (20, 170, 255)),
        ],
        'keywords': ['amazon pay', 'amazon', 'payment successful', 'amazon.in'],
        'dominant_colors': [(255, 153, 0)],
        'status_keywords': ['successful'],
    },
    'CRED': {
        'color_ranges': [
            ((25, 25, 45), (35, 35, 55)),
            ((130, 200, 70), (150, 220, 90)),
        ],
        'keywords': ['cred', 'payment successful', 'paid', 'cred app'],
        'dominant_colors': [(30, 30, 50), (140, 210, 80)],
        'status_keywords': ['paid', 'successful'],
    },
    'ICICI Bank': {
        'color_ranges': [
            ((0, 40, 220), (10, 60, 240)),
        ],
        'keywords': ['icici', 'icici bank', 'payment successful', 'icici upi'],
        'dominant_colors': [(230, 50, 50)],
        'status_keywords': ['successful'],
    },
    'HDFC Bank': {
        'color_ranges': [
            ((105, 50, 0), (115, 70, 15)),
        ],
        'keywords': ['hdfc', 'hdfc bank', 'payment successful', 'hdfc upi'],
        'dominant_colors': [(0, 60, 120)],
        'status_keywords': ['successful'],
    },
    'SBI': {
        'color_ranges': [
            ((100, 85, 45), (115, 110, 60)),
        ],
        'keywords': ['sbi', 'state bank', 'sbi upi', 'payment successful', 'state bank of india'],
        'dominant_colors': [(50, 100, 200)],
        'status_keywords': ['successful'],
    },
    'Axis Bank': {
        'color_ranges': [
            ((0, 15, 135), (10, 25, 145)),
        ],
        'keywords': ['axis', 'axis bank', 'payment successful', 'axis upi'],
        'dominant_colors': [(140, 20, 30)],
        'status_keywords': ['successful'],
    },
    'Kotak Mahindra': {
        'color_ranges': [
            ((0, 35, 195), (10, 45, 205)),
        ],
        'keywords': ['kotak', 'kotak mahindra', 'payment successful', 'kotak upi'],
        'dominant_colors': [(200, 40, 50)],
        'status_keywords': ['successful'],
    },
}

class AppIdentifier:
    def __init__(self):
        self.signatures = APP_SIGNATURES

    def identify(self, img: np.ndarray, ocr_text: str = '') -> str:
        scores: Dict[str, float] = {}
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        h, w = img.shape[:2]

        for app_name, sig in self.signatures.items():
            score = 0.0
            color_score = self._match_colors(hsv, sig['color_ranges'])
            score += color_score * 0.35

            if ocr_text:
                text_score = self._match_text(ocr_text, sig['keywords'])
                score += text_score * 0.65

            if score > 0:
                scores[app_name] = score

        if not scores:
            return 'Unknown'

        for app_name, sig in self.signatures.items():
            text_lower = ocr_text.lower() if ocr_text else ''
            for kw in sig['keywords']:
                if kw in text_lower:
                    scores[app_name] = scores.get(app_name, 0) + 15

        best_app = max(scores, key=scores.get)
        best_score = scores[best_app]
        return best_app if best_score >= 15 else 'Unknown'

    def _match_colors(self, hsv: np.ndarray, color_ranges: List[Tuple[Tuple, Tuple]]) -> float:
        if not color_ranges:
            return 0.0
        total_pixels = hsv.shape[0] * hsv.shape[1]
        match_pixels = 0
        for lower, upper in color_ranges:
            lower_arr = np.array([max(0, min(179, int(lower[0]))), max(0, min(255, int(lower[1]))), max(0, min(255, int(lower[2])))], dtype=np.uint8)
            upper_arr = np.array([max(0, min(179, int(upper[0]))), max(0, min(255, int(upper[1]))), max(0, min(255, int(upper[2])))], dtype=np.uint8)
            mask = cv2.inRange(hsv, lower_arr, upper_arr)
            match_pixels += np.count_nonzero(mask)

        ratio = match_pixels / max(total_pixels, 1)
        return min(ratio * 5, 1.0)

    def _match_text(self, text: str, keywords: List[str]) -> float:
        if not text or not keywords:
            return 0.0
        text_lower = text.lower()
        matched = sum(1 for kw in keywords if kw in text_lower)
        return matched / len(keywords)
