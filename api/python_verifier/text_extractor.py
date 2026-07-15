import cv2
import numpy as np
from typing import Dict, Any, List, Optional

class TextExtractor:
    def __init__(self):
        self._predictor = None
        self._document_file = None
        self._doctr_loaded = False

    def extract(self, img: np.ndarray) -> Dict[str, Any]:
        doctr_result = self._try_doctr(img)
        if doctr_result and doctr_result.get('text', '').strip():
            return doctr_result

        return self._extract_opencv_fallback(img)

    def _try_doctr(self, img: np.ndarray) -> Optional[Dict[str, Any]]:
        if not self._doctr_loaded:
            self._load_doctr()
        if not self._predictor:
            return None

        try:
            img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            doc = self._document_file.from_array(img_rgb)
            result = self._predictor(doc)

            full_text: List[str] = []
            words_data: List[Dict] = []
            for page in result.pages:
                for block in page.blocks:
                    for line in block.lines:
                        for word in line.words:
                            full_text.append(word.value)
                            words_data.append({
                                'value': word.value,
                                'confidence': float(word.confidence),
                                'geometry': word.geometry,
                            })

            text = ' '.join(full_text)
            confidences = [w['confidence'] for w in words_data if w['confidence']]
            avg_conf = (sum(confidences) / len(confidences) * 100) if confidences else 0.0

            return {
                'text': text,
                'words': words_data,
                'confidence': round(avg_conf, 2),
                'engine': 'doctr',
                'word_count': len(words_data),
            }
        except Exception as e:
            print(f'[AI-VERIFIER] docTR extraction failed: {e}')
            return None

    def _load_doctr(self):
        self._doctr_loaded = True
        try:
            from doctr.io import DocumentFile
            from doctr.models import ocr_predictor
            import torch

            self._predictor = ocr_predictor(
                det_arch='db_resnet50',
                reco_arch='crnn_vgg16_bn',
                pretrained=True,
            )
            if torch.cuda.is_available():
                self._predictor = self._predictor.cuda().half()
            self._document_file = DocumentFile
            print('[AI-VERIFIER] docTR model loaded successfully')
        except ImportError:
            print('[AI-VERIFIER] docTR not available, using OpenCV fallback')
        except Exception as e:
            print(f'[AI-VERIFIER] docTR load failed: {e}')
            self._predictor = None

    def _extract_opencv_fallback(self, img: np.ndarray) -> Dict[str, Any]:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        results: List[Dict] = []

        try:
            import pytesseract
            pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
            pytesseract.get_tesseract_version()
        except:
            print('[AI-VERIFIER] Tesseract not available — returning empty OCR')
            return {'text': '', 'words': [], 'confidence': 0.0, 'engine': 'none', 'word_count': 0}

        for scale in [1.0, 1.5]:
            if scale > 1:
                h, w = gray.shape
                scaled = cv2.resize(gray, (int(w * scale), int(h * scale)))
            else:
                scaled = gray

            processed = self._preprocess(scaled)
            try:
                import pytesseract
                data = pytesseract.image_to_data(processed, lang='eng', output_type=pytesseract.Output.DICT)
                for i, text in enumerate(data['text']):
                    text = text.strip()
                    if text and int(data['conf'][i]) > 0:
                        results.append({
                            'value': text,
                            'confidence': int(data['conf'][i]) / 100.0,
                            'box': [data['left'][i], data['top'][i], data['width'][i], data['height'][i]],
                        })
            except:
                pass

        words = sorted(results, key=lambda x: (x['box'][1], x['box'][0]))
        text = ' '.join(w['value'] for w in words)
        confs = [w['confidence'] for w in words if w['confidence']]
        avg_conf = (sum(confs) / len(confs) * 100) if confs else 0.0

        return {
            'text': text,
            'words': [{'value': w['value'], 'confidence': w['confidence']} for w in words],
            'confidence': round(avg_conf, 2),
            'engine': 'tesseract',
            'word_count': len(words),
        }

    def _preprocess(self, gray: np.ndarray) -> np.ndarray:
        blurred = cv2.GaussianBlur(gray, (3, 3), 0)
        if np.mean(blurred) < 128:
            thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
        else:
            thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 1))
        cleaned = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
        return cleaned
