from typing import Dict, Any, List

class ScoringEngine:
    WEIGHTS = {
        'amount': 20,
        'receiver': 20,
        'status': 15,
        'date': 10,
        'time': 5,
        'utr': 10,
        'app_identified': 5,
        'ocr_quality': 5,
        'image_quality': 3,
        'authenticity': 5,
        'fraud': 2,
    }

    def compute(self, checks: Dict[str, Dict], ocr_confidence: float) -> float:
        earned = 0.0
        total = 0.0

        for key, info in checks.items():
            w = self.WEIGHTS.get(key, 5)
            total += w
            if info.get('passed'):
                earned += w
            elif key == 'date':
                total -= w * 0.5
            elif key == 'time':
                total -= w * 0.5

        base_score = (earned / total * 100) if total > 0 else 0

        ocr_factor = min(ocr_confidence / 100, 1.0)
        final_score = base_score * (0.7 + 0.3 * ocr_factor)
        return round(final_score, 1)

    def confidence_level(self, score: float) -> str:
        if score >= 90:
            return 'HIGH'
        elif score >= 75:
            return 'MEDIUM'
        elif score >= 50:
            return 'LOW'
        else:
            return 'VERY_LOW'
