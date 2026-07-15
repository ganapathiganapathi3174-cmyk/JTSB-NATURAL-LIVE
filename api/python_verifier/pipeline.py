import cv2
import numpy as np
from PIL import Image
import io
import time
import hashlib
import traceback
from typing import Dict, Any, Optional

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

class VerificationPipeline:
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
                result['decision'] = 'AUTO_REJECT'
                result['processing_time_ms'] = int((time.time() - t0) * 1000)
                return self._to_response(result)

            if img is None:
                result['reasons'] = ['Failed to decode image']
                result['processing_time_ms'] = int((time.time() - t0) * 1000)
                return self._to_response(result)

            image_hash = hashlib.sha256(image_data).hexdigest()
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
                expected_amount=expected_amount,
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

            extracted = {
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
                'transaction_ref': fields.get('transaction_ref'),
            }

            result = {
                'verified': decision == 'AUTO_APPROVE',
                'decision': decision,
                'confidence': score,
                'reasons': reasons,
                'extracted': extracted,
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
                'ocr_engine': ocr_data.get('engine', 'unknown'),
            }

        except Exception as e:
            print(f'[AI-VERIFIER] Pipeline error: {e}')
            print(traceback.format_exc())
            result['reasons'].append(f'Verification pipeline error: {str(e)}')

        result['processing_time_ms'] = int((time.time() - t0) * 1000)
        return self._to_response(result)

    def _to_response(self, result: dict) -> dict:
        return result
