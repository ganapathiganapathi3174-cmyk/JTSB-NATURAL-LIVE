import cv2
import numpy as np
from PIL import Image
import io
from typing import Dict, Any, Tuple

class AuthenticityDetector:
    def analyze(self, img: np.ndarray) -> Dict[str, Any]:
        result = {
            'is_screenshot': False,
            'is_camera_photo': False,
            'is_edited': False,
            'is_cropped': False,
            'is_collage': False,
            'tamper_score': 0,
            'issues': [],
        }

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        h, w = img.shape[:2]
        ar = w / h if h > 0 else 0

        result['is_screenshot'] = 0.4 <= ar <= 0.6

        camera_score, camera_reasons = self._detect_camera_photo(img, gray)
        if camera_score > 60:
            result['is_camera_photo'] = True
            result['issues'].extend(camera_reasons)
            result['tamper_score'] += camera_score * 0.3

        ela_score, ela_reasons = self._ela_analysis(img)
        if ela_score > 30:
            result['is_edited'] = True
            result['issues'].extend(ela_reasons)
            result['tamper_score'] += ela_score * 0.3

        # Additional edit detection: check for unnatural color patches
        edit_score2, edit_reasons2 = self._detect_color_anomaly(img)
        if edit_score2 > 30:
            result['is_edited'] = True
            result['issues'].extend(edit_reasons2)
            result['tamper_score'] += edit_score2 * 0.2

        crop_score, crop_reasons = self._detect_crop(img, gray)
        if crop_score > 40:
            result['is_cropped'] = True
            result['issues'].extend(crop_reasons)
            result['tamper_score'] += crop_score * 0.2

        collage_score, collage_reasons = self._detect_collage(img, gray)
        if collage_score > 50:
            result['is_collage'] = True
            result['issues'].extend(collage_reasons)
            result['tamper_score'] += collage_score * 0.2

        result['tamper_score'] = min(int(result['tamper_score']), 100)
        return result

    def _detect_camera_photo(self, img: np.ndarray, gray: np.ndarray) -> Tuple[float, list]:
        score = 0.0
        reasons = []
        h, w = img.shape[:2]

        # Edge angle uniformity (perspective distortion makes edges non-parallel)
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
                if angle_std > 15:
                    score += min(angle_std * 3, 40)
                    reasons.append(f'Non-uniform edge angles ({angle_std:.1f}deg)')

        # Color noise: camera photos have more chroma noise than clean screenshots
        ycrcb = cv2.cvtColor(img, cv2.COLOR_BGR2YCrCb)
        cr_std = float(np.std(ycrcb[:, :, 1]))
        cb_std = float(np.std(ycrcb[:, :, 2]))
        if cr_std < 3 or cb_std < 3:
            score += 10
            reasons.append(f'Low chroma variance (Cr={cr_std:.1f}, Cb={cb_std:.1f})')

        # Moire pattern: dominant grid-like frequencies
        gray_float = gray.astype(np.float32)
        fft = np.fft.fft2(gray_float)
        fft_shift = np.fft.fftshift(fft)
        magnitude = np.log(np.abs(fft_shift) + 1)
        center = magnitude[h//4:3*h//4, w//4:3*w//4]
        high_freq = float(np.mean(center))
        border = magnitude[:h//8, :w//8]
        border_hf = float(np.mean(border)) if border.size > 0 else 0
        if border_hf > 0 and high_freq / border_hf > 2:
            score += 25
            reasons.append('Moire pattern detected')

        # Vignetting: corners darker than center (real camera)
        center_bright = float(np.mean(gray[h//4:3*h//4, w//4:3*w//4]))
        corners_bright = np.mean([
            np.mean(gray[:h//8, :w//8]),
            np.mean(gray[:h//8, 5*w//8:]),
            np.mean(gray[5*h//8:, :w//8]),
            np.mean(gray[5*h//8:, 5*w//8:])
        ])
        if corners_bright > 0 and center_bright / corners_bright > 1.1:
            score += min((center_bright / corners_bright - 1) * 100, 20)
            reasons.append('Vignetting pattern detected')

        return min(score, 100), reasons

    def _ela_analysis(self, img: np.ndarray, quality: int = 75) -> Tuple[float, list]:
        score = 0.0
        reasons = []
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
            score = min(anomalous * 3, 100)

            if score > 30:
                reasons.append(f'ELA anomalous pixels: {anomalous:.1f}%')
            if score > 50:
                reasons.append(f'ELA score {score:.0f} suggests tampering')

            # Additional check using lower quality (more sensitive)
            buf2 = io.BytesIO()
            pil_img.save(buf2, format='JPEG', quality=50)
            buf2.seek(0)
            resaved2 = Image.open(buf2).convert('RGB')
            ela_arr2 = np.abs(
                np.array(pil_img, dtype=np.float32) - np.array(resaved2, dtype=np.float32)
            ).astype(np.uint8)
            ela_gray2 = np.mean(ela_arr2, axis=2)
            mean2 = float(np.mean(ela_gray2))
            std2 = float(np.std(ela_gray2))
            threshold2 = mean2 + 1.5 * std2
            anomalous2 = float(np.sum(ela_gray2 > threshold2) / ela_gray2.size * 100)
            if anomalous2 > 20:
                score = max(score, min(anomalous2 * 2, 100))
                if anomalous2 > 25:
                    reasons.append(f'Enhanced ELA: {anomalous2:.1f}% anomalous regions')
        except:
            score = 0
        return score, reasons

    def _detect_crop(self, img: np.ndarray, gray: np.ndarray) -> Tuple[float, list]:
        score = 0.0
        reasons = []
        h, w = img.shape[:2]

        _, thresh = cv2.threshold(gray, 240, 255, cv2.THRESH_BINARY)
        coords = cv2.findNonZero(cv2.bitwise_not(thresh))
        if coords is not None:
            x, y, cw, ch = cv2.boundingRect(coords)
            margin = 0.03
            expected_w = w * (1 - 2 * margin)
            expected_h = h * (1 - 2 * margin)
            crop_ratio = min(cw / expected_w, ch / expected_h) if expected_w > 0 and expected_h > 0 else 1.0
            if crop_ratio < 0.5:
                score += 60
                reasons.append(f'Cropped content (ratio={crop_ratio:.2f})')
            elif crop_ratio < 0.8:
                score += 30
                reasons.append(f'Partially cropped (ratio={crop_ratio:.2f})')

        for side in range(5):
            strip = gray[side, :]
            edge_pixels = np.sum(strip < 240)
            if edge_pixels > w * 0.9:
                score += 10
                break

        for side in range(5):
            strip = gray[h - 1 - side, :]
            edge_pixels = np.sum(strip < 240)
            if edge_pixels > w * 0.9:
                score += 10
                break

        for side in range(5):
            strip = gray[:, side]
            edge_pixels = np.sum(strip < 240)
            if edge_pixels > h * 0.9:
                score += 10
                break

        for side in range(5):
            strip = gray[:, w - 1 - side]
            edge_pixels = np.sum(strip < 240)
            if edge_pixels > h * 0.9:
                score += 10
                break

        return min(score, 100), reasons

    def _detect_collage(self, img: np.ndarray, gray: np.ndarray) -> Tuple[float, list]:
        score = 0.0
        reasons = []
        h, w = img.shape[:2]

        edges = cv2.Canny(gray, 30, 100)
        horizontal = np.sum(edges, axis=1) / w
        vertical = np.sum(edges, axis=0) / h

        sharp_h = np.sum((np.diff(horizontal) > 0.05).astype(float))
        sharp_v = np.sum((np.diff(vertical) > 0.05).astype(float))
        edge_transitions = sharp_h + sharp_v
        expected = 20
        if edge_transitions > expected * 3:
            score += min((edge_transitions / expected) * 10, 40)
            reasons.append(f'Abnormal edge transitions ({int(edge_transitions)})')

        lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=int(min(w, h) * 0.3),
                                minLineLength=int(min(w, h) * 0.5), maxLineGap=20)
        if lines is not None:
            full_width_lines = 0
            for line in lines:
                x1, y1, x2, y2 = line[0]
                length = abs(x2 - x1)
                if length > w * 0.8 and abs(y2 - y1) < 5:
                    full_width_lines += 1
            if full_width_lines > 5:
                score += 30
                reasons.append(f'Multiple full-width separators ({full_width_lines})')

        return min(score, 100), reasons

    def _detect_color_anomaly(self, img: np.ndarray) -> Tuple[float, list]:
        score = 0.0
        reasons = []
        h, w = img.shape[:2]

        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        sat = hsv[:, :, 1].astype(np.float32)
        val = hsv[:, :, 2].astype(np.float32)

        full_white_mask = (sat < 30) & (val > 240)
        white_pct = float(np.sum(full_white_mask) / (h * w))

        full_black_mask = (val < 20)
        black_pct = float(np.sum(full_black_mask) / (h * w))

        if white_pct > 0.5:
            score += 20
            reasons.append(f'Large white region ({white_pct:.0%})')
        if black_pct > 0.3:
            score += 20
            reasons.append(f'Large black region ({black_pct:.0%})')

        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
        a_channel = lab[:, :, 1].astype(np.float32)
        b_channel = lab[:, :, 2].astype(np.float32)
        a_std = float(np.std(a_channel))
        b_std = float(np.std(b_channel))

        if a_std > 30 or b_std > 30:
            score += 20
            reasons.append(f'Abnormal color variance (a={a_std:.0f}, b={b_std:.0f})')

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        equalized = cv2.equalizeHist(gray)
        hist = cv2.calcHist([equalized], [0], None, [256], [0, 256]).flatten()
        hist_peaks = np.sum(hist > np.mean(hist) * 3)
        if hist_peaks > 8:
            score += 15
            reasons.append(f'Unnatural histogram peaks ({int(hist_peaks)})')

        return min(score, 100), reasons
