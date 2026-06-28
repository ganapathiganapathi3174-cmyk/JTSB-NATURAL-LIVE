#!/usr/bin/env python
"""
Standalone EasyOCR runner — invoked by _pipelineEngine.js via child_process.
Accepts an image path, runs EasyOCR, outputs JSON to stdout.

Usage:
  python _easyOcrRunner.py <image_path>

Output (JSON on stdout):
  {"blocks": [...], "engine": "easyocr", "success": true/false, "error": null, "duration": 0.0}
"""
import sys, json, time, os
import warnings
warnings.filterwarnings('ignore')
os.environ['PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK'] = 'True'

import easyocr

_reader = None

def get_reader():
    global _reader
    if _reader is None:
        _reader = easyocr.Reader(['en'], gpu=False, verbose=False)
    return _reader

def run_easy_ocr(img_path: str) -> dict:
    t0 = time.time()
    result = {'blocks': [], 'engine': 'easyocr', 'success': False, 'error': None, 'duration': 0}
    try:
        if not os.path.exists(img_path):
            result['error'] = f'Image not found: {img_path}'
            return result

        reader = get_reader()
        raw = reader.readtext(img_path, paragraph=False, width_ths=0.7, height_ths=0.5)
        blocks = []
        for bbox, text, conf in raw:
            text = (text or '').strip()
            if not text:
                continue
            pts = [[int(p[0]), int(p[1])] for p in bbox]
            blocks.append({
                'text': text,
                'confidence': round(float(conf) * 100, 2),
                'bbox': pts,
                'engine': 'easyocr',
                'cx': int((bbox[0][0] + bbox[2][0]) / 2),
                'cy': int((bbox[0][1] + bbox[2][1]) / 2),
            })
        result['blocks'] = blocks
        result['success'] = len(blocks) > 0
        result['duration'] = round(time.time() - t0, 2)
    except Exception as e:
        result['error'] = str(e)
    return result

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'blocks': [], 'engine': 'easyocr', 'success': False, 'error': 'No image path provided'}))
        sys.exit(1)
    img_path = sys.argv[1]
    res = run_easy_ocr(img_path)
    print(json.dumps(res))
