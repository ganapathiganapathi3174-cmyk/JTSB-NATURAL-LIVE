import cv2
import numpy as np
from typing import Dict, Any, List, Optional, Tuple

class LayoutAnalyzer:
    APP_LAYOUTS = {
        'Google Pay': {
            'amount': (0.2, 0.25, 0.6, 0.10),
            'status': (0.1, 0.03, 0.8, 0.07),
            'receiver': (0.15, 0.40, 0.7, 0.08),
            'utr': (0.15, 0.50, 0.7, 0.07),
            'date_time': (0.15, 0.58, 0.7, 0.07),
            'upi_id': (0.15, 0.65, 0.7, 0.06),
            'logo': (0.35, 0.15, 0.3, 0.08),
        },
        'PhonePe': {
            'amount': (0.2, 0.28, 0.6, 0.10),
            'status': (0.1, 0.05, 0.8, 0.07),
            'receiver': (0.15, 0.42, 0.7, 0.08),
            'utr': (0.15, 0.52, 0.7, 0.07),
            'date_time': (0.15, 0.60, 0.7, 0.07),
            'upi_id': (0.15, 0.67, 0.7, 0.06),
            'logo': (0.35, 0.18, 0.3, 0.08),
        },
        'Paytm': {
            'amount': (0.2, 0.22, 0.6, 0.09),
            'status': (0.15, 0.03, 0.7, 0.07),
            'receiver': (0.15, 0.38, 0.7, 0.08),
            'utr': (0.15, 0.48, 0.7, 0.07),
            'date_time': (0.15, 0.56, 0.7, 0.07),
            'upi_id': (0.15, 0.63, 0.7, 0.06),
            'logo': (0.35, 0.12, 0.3, 0.08),
        },
        'BHIM': {
            'amount': (0.2, 0.28, 0.6, 0.10),
            'status': (0.1, 0.05, 0.8, 0.07),
            'receiver': (0.15, 0.42, 0.7, 0.08),
            'utr': (0.15, 0.52, 0.7, 0.07),
            'date_time': (0.15, 0.60, 0.7, 0.07),
            'upi_id': (0.15, 0.67, 0.7, 0.06),
            'logo': (0.35, 0.18, 0.3, 0.08),
        },
        'Amazon Pay': {
            'amount': (0.2, 0.26, 0.6, 0.10),
            'status': (0.1, 0.04, 0.8, 0.07),
            'receiver': (0.15, 0.41, 0.7, 0.08),
            'utr': (0.15, 0.51, 0.7, 0.07),
            'date_time': (0.15, 0.59, 0.7, 0.07),
            'upi_id': (0.15, 0.66, 0.7, 0.06),
            'logo': (0.35, 0.16, 0.3, 0.08),
        },
        'CRED': {
            'amount': (0.2, 0.24, 0.6, 0.10),
            'status': (0.1, 0.03, 0.8, 0.07),
            'receiver': (0.15, 0.39, 0.7, 0.08),
            'utr': (0.15, 0.49, 0.7, 0.07),
            'date_time': (0.15, 0.57, 0.7, 0.07),
            'upi_id': (0.15, 0.64, 0.7, 0.06),
            'logo': (0.35, 0.14, 0.3, 0.08),
        },
    }

    DEFAULT_LAYOUT = {
        'amount': (0.2, 0.25, 0.6, 0.10),
        'status': (0.1, 0.03, 0.8, 0.07),
        'receiver': (0.15, 0.40, 0.7, 0.08),
        'utr': (0.15, 0.50, 0.7, 0.07),
        'date_time': (0.15, 0.58, 0.7, 0.07),
        'upi_id': (0.15, 0.65, 0.7, 0.06),
        'logo': (0.35, 0.15, 0.3, 0.08),
    }

    def analyze(self, img: np.ndarray, app_name: str = '') -> Dict[str, Any]:
        h, w = img.shape[:2]
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        info = {
            'type': 'unknown',
            'regions': {},
            'dimensions': {'width': w, 'height': h},
            'aspect_ratio': round(w / h, 4) if h > 0 else 0,
            'brightness': float(np.mean(gray)),
            'has_success_indicator': False,
            'has_payment_card': False,
            'separator_count': 0,
            'layout_confidence': 0.0,
        }

        if app_name in self.APP_LAYOUTS:
            layout = self.APP_LAYOUTS[app_name]
        else:
            layout = self.DEFAULT_LAYOUT

        for field, (rx, ry, rw, rh) in layout.items():
            info['regions'][field] = {
                'x': int(rx * w),
                'y': int(ry * h),
                'width': int(rw * w),
                'height': int(rh * h),
            }

        info['has_success_indicator'] = self._detect_success_indicator(img)
        info['has_payment_card'] = self._detect_payment_card(img, gray)
        info['separator_count'] = self._count_separators(gray, w, h)

        if info['has_success_indicator']:
            info['layout_confidence'] += 0.4
        if info['has_payment_card']:
            info['layout_confidence'] += 0.3
        if info['separator_count'] >= 3:
            info['layout_confidence'] += 0.2

        if app_name != 'Unknown':
            info['type'] = f'{app_name}_payment_screen'
            info['layout_confidence'] += 0.1

        info['layout_confidence'] = min(info['layout_confidence'], 1.0)
        return info

    def _detect_success_indicator(self, img: np.ndarray) -> bool:
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        lower_green = np.array([40, 40, 40])
        upper_green = np.array([80, 255, 255])
        green_mask = cv2.inRange(hsv, lower_green, upper_green)
        green_pct = np.count_nonzero(green_mask) / (img.shape[0] * img.shape[1])
        return green_pct > 0.02

    def _detect_payment_card(self, img: np.ndarray, gray: np.ndarray) -> bool:
        h, w = img.shape[:2]
        edges = cv2.Canny(gray, 30, 100)

        roi_y1, roi_y2 = int(h * 0.15), int(h * 0.85)
        roi_x1, roi_x2 = int(w * 0.05), int(w * 0.95)
        roi = edges[roi_y1:roi_y2, roi_x1:roi_x2]

        contours, _ = cv2.findContours(roi, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for cnt in contours:
            x, y, cw, ch = cv2.boundingRect(cnt)
            area = cw * ch
            roi_area = (roi_y2 - roi_y1) * (roi_x2 - roi_x1)
            if area > roi_area * 0.3:
                return True
        return False

    def _count_separators(self, gray: np.ndarray, w: int, h: int) -> int:
        edges = cv2.Canny(gray, 30, 100)
        lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=int(min(w, h) * 0.05),
                                minLineLength=int(w * 0.4), maxLineGap=20)
        separators = []
        if lines is not None:
            for line in lines:
                x1, y1, x2, y2 = line[0]
                angle = abs(np.degrees(np.arctan2(y2 - y1, x2 - x1)))
                if angle < 15 or angle > 165:
                    y_pos = (y1 + y2) // 2
                    length = abs(x2 - x1)
                    if length > w * 0.3:
                        separators.append(y_pos)
        uniq = []
        seen = set()
        for s in sorted(separators):
            if not any(abs(s - sy) < h * 0.03 for sy in seen):
                seen.add(s)
                uniq.append(s)
        return len(uniq)
