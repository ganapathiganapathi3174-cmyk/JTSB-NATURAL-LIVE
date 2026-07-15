import cv2
import numpy as np

APP_SIGNATURES = {
    "Google Pay": {
        "colors": [(245, 245, 245), (66, 133, 244), (52, 168, 83)],
        "keywords": ["google pay", "gpay", "upi", "sent", "payment successful"],
        "logo_hashes": [],
    },
    "PhonePe": {
        "colors": [(130, 50, 210), (255, 255, 255), (80, 30, 140)],
        "keywords": ["phonepe", "phone pe", "payment successful", "upi"],
        "logo_hashes": [],
    },
    "Paytm": {
        "colors": [(0, 186, 242), (255, 255, 255), (0, 150, 200)],
        "keywords": ["paytm", "payment successful", "upi", "sent"],
        "logo_hashes": [],
    },
    "BHIM": {
        "colors": [(0, 100, 180), (255, 255, 255)],
        "keywords": ["bhim", "upi", "payment successful", "bharatpe"],
        "logo_hashes": [],
    },
    "Amazon Pay": {
        "colors": [(255, 153, 0), (0, 0, 0)],
        "keywords": ["amazon pay", "amazon", "payment successful"],
        "logo_hashes": [],
    },
    "CRED": {
        "colors": [(30, 30, 50), (140, 210, 80), (255, 255, 255)],
        "keywords": ["cred", "payment successful", "paid"],
        "logo_hashes": [],
    },
    "ICICI Bank": {
        "colors": [(230, 50, 50), (255, 255, 255)],
        "keywords": ["icici", "payment successful", "upi"],
        "logo_hashes": [],
    },
    "HDFC Bank": {
        "colors": [(0, 60, 120), (255, 255, 255)],
        "keywords": ["hdfc", "payment successful", "upi"],
        "logo_hashes": [],
    },
    "SBI": {
        "colors": [(50, 100, 200), (255, 255, 255)],
        "keywords": ["sbi", "state bank", "upi", "payment successful"],
        "logo_hashes": [],
    },
    "Axis Bank": {
        "colors": [(140, 20, 30), (255, 255, 255)],
        "keywords": ["axis", "axis bank", "payment successful"],
        "logo_hashes": [],
    },
    "Kotak Mahindra": {
        "colors": [(200, 40, 50), (255, 255, 255)],
        "keywords": ["kotak", "kotak mahindra", "payment successful"],
        "logo_hashes": [],
    },
}

class AppDetector:
    def __init__(self):
        self.signatures = APP_SIGNATURES

    def detect(self, img: np.ndarray, ocr_text: str = "") -> str:
        scores = {}
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)

        for app_name, sig in self.signatures.items():
            score = 0.0

            color_score = self._match_colors(hsv, sig["colors"])
            score += color_score * 0.4

            keyword_score = self._match_keywords(ocr_text, sig["keywords"])
            score += keyword_score * 0.6

            scores[app_name] = score

        if ocr_text:
            text_lower = ocr_text.lower()
            for app_name in list(scores.keys()):
                for kw in self.signatures[app_name]["keywords"]:
                    if kw in text_lower:
                        scores[app_name] += 15
                        break

        if not scores:
            return "Unknown"

        best = max(scores, key=scores.get)
        return best if scores[best] >= 10 else "Unknown"

    def _match_colors(self, hsv: np.ndarray, target_colors: list) -> float:
        if not target_colors:
            return 0.0
        h, w = hsv.shape[:2]
        center_region = hsv[h//4:3*h//4, w//4:3*w//4]
        avg_color = cv2.mean(center_region)[:3]
        best_dist = float("inf")
        for tc in target_colors:
            tc_hsv = cv2.cvtColor(np.uint8([[list(reversed(tc))]]), cv2.COLOR_BGR2HSV)[0][0]
            dist = sum((a - b) ** 2 for a, b in zip(avg_color, tc_hsv)) ** 0.5
            best_dist = min(best_dist, dist)
        score = max(0, 100 - best_dist * 2)
        return min(score / 100, 1.0)

    def _match_keywords(self, text: str, keywords: list) -> float:
        if not text or not keywords:
            return 0.0
        text_lower = text.lower()
        matched = sum(1 for kw in keywords if kw in text_lower)
        return matched / len(keywords)
