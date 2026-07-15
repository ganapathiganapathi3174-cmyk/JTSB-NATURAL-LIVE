#!/usr/bin/env python
"""
AI Payment Screenshot Verification Engine V3.0
Enterprise-grade 15-stage verification pipeline.

Replaces SMS verification with AI-powered payment screenshot verification.
Uses python-doctr as primary OCR with OpenCV/Tesseract fallback.

Usage:
  python _ai_engine.py --image <path> [--expected-amount 120] [--expected-receiver upi@bank] [--expected-utr UTR]
"""
import sys, os, json, re, time, traceback, base64, uuid
import warnings
warnings.filterwarnings('ignore')

from io import BytesIO
from datetime import datetime, date
from typing import Optional, List, Dict, Any, Tuple
from collections import defaultdict

import cv2
import numpy as np
from PIL import Image
from imagehash import phash

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'python_verifier'))
from image_validator import ImageValidator
from authenticity import AuthenticityDetector
from app_identifier import AppIdentifier
from layout_analyzer import LayoutAnalyzer
from text_extractor import TextExtractor
from field_extractor import FieldExtractor
from field_validator import FieldValidator
from fraud_detector import FraudDetector
from scoring_engine import ScoringEngine
from decision_engine import DecisionEngine

def log(phase: str, msg: str):
    print(f'[AI][{phase}] {msg}', file=sys.stderr)

def load_image(path: str) -> Optional[np.ndarray]:
    if path.startswith('data:image'):
        raw = base64.b64decode(path.split(',')[1] if ',' in path else path)
        buf = np.frombuffer(raw, np.uint8)
        return cv2.imdecode(buf, cv2.IMREAD_COLOR)
    img = cv2.imread(path)
    if img is None:
        try:
            pil = Image.open(path).convert('RGB')
            img = np.array(pil)
            img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
        except:
            return None
    return img

class NumpyEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, (np.integer,)): return int(obj)
        if isinstance(obj, (np.floating,)): return float(obj)
        if isinstance(obj, (np.ndarray,)): return obj.tolist()
        return super().default(obj)

def run_ai_engine(img_path: str, expected: Dict[str, Any] = None) -> Dict[str, Any]:
    t_start = time.time()
    log('ENGINE', f'Starting AI Verification Engine V3: {img_path}')
    expected = expected or {}
    log('ENGINE', f'Expected: amount={expected.get("amount")}, receiver={expected.get("receiverUpi")}, utr={str(expected.get("utr"))[:8] if expected.get("utr") else None}****')

    result = {
        'error': None,
        'imagePath': img_path,
        'expected': expected,
        'status': 'failed',
        'reasons': [],
        'confidence': 0,
        'duration': 0,
        'stages': {},
        'matched_fields': {},
    }

    if not os.path.exists(img_path):
        result['error'] = f'Image not found: {img_path}'
        return result

    img = load_image(img_path)
    if img is None:
        result['error'] = 'Failed to load image'
        return result

    h, w = img.shape[:2]
    file_size = os.path.getsize(img_path) if os.path.exists(img_path) else 0
    log('ENGINE', f'Image: {w}x{h}, {file_size/1024:.0f}KB')

    pipeline = VerificationPipelineV3()

    with open(img_path, 'rb') as f:
        image_data = f.read()

    pipeline_result = pipeline.run(
        image_data=image_data,
        expected_amount=expected.get('amount', 0),
        expected_receiver_upi=expected.get('receiverUpi', 'jayarajj126-3@okicici'),
        expected_receiver_name=expected.get('receiverName', 'JEYARAJ ALAG'),
        order_id=expected.get('orderId', ''),
        created_at=expected.get('date', ''),
        user_entered_utr=expected.get('utr', ''),
        user_entered_upi=expected.get('senderUpi', ''),
    )

    result['status'] = pipeline_result.get('decision', 'failed').lower()
    result['reasons'] = pipeline_result.get('reasons', [])
    result['confidence'] = pipeline_result.get('confidence', 0)
    result['duration'] = round(time.time() - t_start, 2)
    result['pipeline_duration'] = pipeline_result.get('processing_time_ms', 0)
    result['matched_fields'] = pipeline_result.get('checks', {})
    result['decision'] = pipeline_result.get('decision', 'MANUAL_REVIEW')

    extracted = pipeline_result.get('extracted', {})
    fraud = pipeline_result.get('fraud', {})
    authenticity = pipeline_result.get('authenticity', {})
    image_quality = pipeline_result.get('image_quality', {})

    result['stages'] = {
        'stage1_image_validation': {
            'passed': not not img is not None,
            'width': w,
            'height': h,
            'file_size': file_size,
        },
        'stage2_image_quality': image_quality,
        'stage3_authenticity': authenticity,
        'stage4_app_identification': {
            'app': pipeline_result.get('app_identified', 'Unknown'),
        },
        'stage5_layout_analysis': {
            'type': pipeline_result.get('layout_type', 'unknown'),
        },
        'stage6_ocr': {
            'engine': pipeline_result.get('ocr_engine', 'unknown'),
            'raw_text_len': pipeline_result.get('raw_text_length', 0),
            'confidence': pipeline_result.get('ocr_confidence', 0),
        },
        'stage7_field_extraction': extracted,
        'stage8_amount_validation': {
            'matched': pipeline_result.get('checks', {}).get('amount', False),
            'extracted': extracted.get('amount'),
            'expected': expected.get('amount'),
        },
        'stage9_receiver_validation': {
            'matched': pipeline_result.get('checks', {}).get('receiver', False),
            'extracted_upi': extracted.get('upi'),
        },
        'stage10_status_validation': {
            'matched': pipeline_result.get('checks', {}).get('status', False),
            'extracted': extracted.get('status'),
        },
        'stage11_date_validation': {
            'matched': pipeline_result.get('checks', {}).get('date', False),
            'extracted': extracted.get('date'),
        },
        'stage12_time_validation': {
            'matched': pipeline_result.get('checks', {}).get('time', False),
            'extracted': extracted.get('time'),
        },
        'stage13_utr_validation': {
            'matched': pipeline_result.get('checks', {}).get('utr', False),
            'extracted': extracted.get('utr'),
        },
        'stage14_fraud_detection': {
            'score': fraud.get('score', 0),
            'flags': fraud.get('flags', []),
        },
        'stage15_decision': {
            'decision': pipeline_result.get('decision', 'MANUAL_REVIEW'),
            'confidence': pipeline_result.get('confidence', 0),
            'reasons': pipeline_result.get('reasons', []),
        },
    }

    log('ENGINE', f'Decision: {result["decision"]}, confidence: {result["confidence"]}%, duration: {result["duration"]}s')
    return result

class VerificationPipelineV3:
    def __init__(self):
        self.image_validator = ImageValidator()
        self.authenticity = AuthenticityDetector()
        self.app_identifier = AppIdentifier()
        self.layout_analyzer = LayoutAnalyzer()
        self.text_extractor = TextExtractor()
        self.field_extractor = FieldExtractor()
        self.field_validator = FieldValidator()
        self.fraud_detector = FraudDetector()
        self.scoring_engine = ScoringEngine()
        self.decision_engine = DecisionEngine()

    def run(self, image_data: bytes, expected_amount: int,
            expected_receiver_upi: str, expected_receiver_name: str = 'JEYARAJ ALAG',
            order_id: str = '', created_at: str = '',
            user_entered_utr: str = '', user_entered_upi: str = '') -> Dict[str, Any]:
        t0 = time.time()
        result = {
            'verified': False,
            'decision': 'AUTO_REJECT',
            'confidence': 0.0,
            'reasons': [],
            'extracted': {},
            'checks': {},
            'fraud': {'score': 0, 'flags': []},
        }

        try:
            valid, validation_result, img = self.image_validator.validate(image_data)
            if not valid:
                result['reasons'] = validation_result['issues']
                result['processing_time_ms'] = int((time.time() - t0) * 1000)
                return result

            if img is None:
                result['reasons'] = ['Failed to decode image']
                result['processing_time_ms'] = int((time.time() - t0) * 1000)
                return result

            image_hash = str(phash(Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))))
            image_quality = self.image_validator.get_image_quality(img)
            authenticity_result = self.authenticity.analyze(img)

            ocr_data = self.text_extractor.extract(img)
            raw_text = ocr_data.get('text', '')
            ocr_confidence = ocr_data.get('confidence', 0.0)

            app_name = self.app_identifier.identify(img, raw_text)

            layout_info = self.layout_analyzer.analyze(img, app_name)

            fields = self.field_extractor.extract(raw_text, ocr_data.get('words'))

            fraud_result = self.fraud_detector.analyze(
                image_data=image_data,
                image_hash=image_hash,
                extracted_fields=fields,
                raw_text=raw_text,
                expected_utr=user_entered_utr,
                order_id=order_id,
            )

            checks = self.field_validator.validate_all(
                extracted=fields,
                expected_amount=expected_amount,
                expected_receiver_upi=expected_receiver_upi,
                expected_receiver_name=expected_receiver_name,
                created_at=created_at,
                fraud_score=fraud_result['score'],
                fraud_flags=fraud_result['flags'],
                ocr_confidence=ocr_confidence,
                app_name=app_name,
                image_quality=image_quality,
                authenticity=authenticity_result,
            )

            score = self.scoring_engine.compute(checks, ocr_confidence)
            decision, reasons = self.decision_engine.decide(checks, fraud_result, ocr_confidence, score)

            result = {
                'verified': decision == 'AUTO_APPROVE',
                'decision': decision,
                'confidence': score,
                'reasons': reasons,
                'extracted': {
                    'amount': fields.get('amount'),
                    'utr': fields.get('utr'),
                    'receiver': fields.get('receiver'),
                    'upi': fields.get('upi'),
                    'sender_vpa': fields.get('sender_vpa'),
                    'status': fields.get('status'),
                    'date': fields.get('date'),
                    'time': fields.get('time'),
                    'bank': fields.get('bank'),
                    'app': app_name,
                },
                'checks': {k: v.get('passed', False) for k, v in checks.items()},
                'check_details': {k: v for k, v in checks.items()},
                'fraud': fraud_result,
                'image_quality': image_quality,
                'authenticity': {
                    'is_screenshot': authenticity_result.get('is_screenshot'),
                    'tamper_score': authenticity_result.get('tamper_score'),
                    'issues': authenticity_result.get('issues'),
                },
                'app_identified': app_name,
                'layout_type': layout_info.get('type'),
                'raw_text_length': len(raw_text),
                'ocr_confidence': ocr_confidence,
            }

        except Exception as e:
            log('ENGINE', f'Pipeline error: {e}')
            log('ENGINE', traceback.format_exc())
            result['reasons'].append(f'Verification error: {str(e)}')

        result['processing_time_ms'] = int((time.time() - t0) * 1000)
        return result

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='AI Payment Screenshot Verification Engine V3')
    parser.add_argument('--image', required=True, help='Path to screenshot')
    parser.add_argument('--expected-amount', type=float, help='Expected payment amount')
    parser.add_argument('--expected-receiver', help='Expected receiver UPI ID')
    parser.add_argument('--expected-utr', help='Expected UTR number')
    parser.add_argument('--expected-sender', help='Expected sender UPI ID')
    parser.add_argument('--expected-date', help='Expected transaction date (YYYY-MM-DD)')
    parser.add_argument('--json', action='store_true', help='Output JSON only')
    args = parser.parse_args()

    expected = {}
    if args.expected_amount: expected['amount'] = args.expected_amount
    if args.expected_receiver: expected['receiverUpi'] = args.expected_receiver
    if args.expected_utr: expected['utr'] = args.expected_utr
    if args.expected_sender: expected['senderUpi'] = args.expected_sender
    if args.expected_date: expected['date'] = args.expected_date

    result = run_ai_engine(args.image, expected)
    print(json.dumps(result, cls=NumpyEncoder, default=str))
