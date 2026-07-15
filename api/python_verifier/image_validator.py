import io
import cv2
import numpy as np
from PIL import Image
from typing import Tuple, Dict, Any, Optional

class ImageValidator:
    MIN_WIDTH = 200
    MIN_HEIGHT = 200
    MAX_WIDTH = 4000
    MAX_HEIGHT = 8000
    MIN_ASPECT = 0.3
    MAX_ASPECT = 3.0
    MIN_FILE_SIZE = 5000
    MAX_FILE_SIZE = 15 * 1024 * 1024

    ALLOWED_FORMATS = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'}

    def validate(self, image_data: bytes) -> Tuple[bool, Dict[str, Any], Optional[np.ndarray]]:
        issues = []
        result = {
            'format': None,
            'width': 0,
            'height': 0,
            'file_size': len(image_data),
            'aspect_ratio': 0.0,
            'is_corrupted': False,
        }

        if len(image_data) < self.MIN_FILE_SIZE:
            issues.append(f'File too small: {len(image_data)} bytes (min {self.MIN_FILE_SIZE})')
        if len(image_data) > self.MAX_FILE_SIZE:
            issues.append(f'File too large: {len(image_data)} bytes (max {self.MAX_FILE_SIZE})')

        try:
            pil_img = Image.open(io.BytesIO(image_data))
            result['format'] = pil_img.format
            w, h = pil_img.size
            result['width'] = w
            result['height'] = h
            result['aspect_ratio'] = round(w / h, 4) if h > 0 else 0

            pil_img.verify()
            pil_img = Image.open(io.BytesIO(image_data))
            pil_img.load()
        except Exception as e:
            result['is_corrupted'] = True
            issues.append(f'Corrupted image: {e}')
            return False, {'passed': False, 'issues': issues, 'details': result}, None

        if w < self.MIN_WIDTH or h < self.MIN_HEIGHT:
            issues.append(f'Resolution too low: {w}x{h} (min {self.MIN_WIDTH}x{self.MIN_HEIGHT})')
        if w > self.MAX_WIDTH or h > self.MAX_HEIGHT:
            issues.append(f'Resolution too high: {w}x{h} (max {self.MAX_WIDTH}x{self.MAX_HEIGHT})')

        ar = w / h if h > 0 else 0
        if ar < self.MIN_ASPECT or ar > self.MAX_ASPECT:
            issues.append(f'Aspect ratio abnormal: {ar:.2f}')

        try:
            arr = np.frombuffer(image_data, np.uint8)
            img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if img is None:
                img_rgb = np.array(pil_img.convert('RGB'))
                img = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
            if img is None:
                issues.append('Failed to decode image for CV processing')
                return len(issues) == 0, {'passed': len(issues) == 0, 'issues': issues, 'details': result}, None
        except Exception as e:
            issues.append(f'CV decode failed: {e}')
            return len(issues) == 0, {'passed': len(issues) == 0, 'issues': issues, 'details': result}, None

        return len(issues) == 0, {'passed': len(issues) == 0, 'issues': issues, 'details': result}, img

    def get_image_quality(self, img: np.ndarray) -> Dict[str, Any]:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        h, w = img.shape[:2]

        blur = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        brightness = float(np.mean(gray))
        contrast = float(np.std(gray))

        edges = cv2.Canny(gray, 50, 150)
        edge_density = float(np.count_nonzero(edges) / (w * h)) if w * h > 0 else 0

        kernel = np.ones((3, 3), np.float32) / 9
        diff = cv2.absdiff(gray, cv2.filter2D(gray, -1, kernel).astype(np.uint8))
        noise = float(np.mean(diff))

        return {
            'blur_score': round(blur, 2),
            'brightness': round(brightness, 1),
            'contrast': round(contrast, 1),
            'edge_density': round(edge_density, 4),
            'noise_score': round(noise, 2),
            'is_blurred': blur < 50.0,
            'is_dark': brightness < 30.0,
            'is_bright': brightness > 230.0,
            'is_low_contrast': contrast < 15.0,
        }
