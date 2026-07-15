from typing import Dict, Any, List, Tuple

class DecisionEngine:
    def decide(self, checks: Dict[str, Dict], fraud_result: Dict[str, Any],
               ocr_confidence: float, score: float) -> Tuple[str, List[str]]:

        critical_failures = []
        manual_review_reasons = []

        amount_check = checks.get('amount', {})
        receiver_check = checks.get('receiver', {})
        status_check = checks.get('status', {})
        date_check = checks.get('date', {})
        time_check = checks.get('time', {})
        utr_check = checks.get('utr', {})
        authenticity_check = checks.get('authenticity', {})
        fraud_check = checks.get('fraud', {})
        image_quality_check = checks.get('image_quality', {})

        if authenticity_check.get('is_edited'):
            critical_failures.append('Screenshot appears edited or manipulated')
        if authenticity_check.get('is_camera_photo'):
            critical_failures.append('Camera photo of screen detected')

        if fraud_result.get('flags') and 'unreadable_image' in fraud_result['flags']:
            critical_failures.append('Screenshot is unreadable')

        fraud_flags = fraud_result.get('flags', [])
        fraud_score = fraud_result.get('score', 0)
        if 'utr_fingerprint_mismatch' in fraud_flags and fraud_score >= 50:
            critical_failures.append('UTR fingerprint mismatch indicates different transaction')

        if fraud_score >= 70:
            critical_failures.append(f'High fraud score: {fraud_score}')

        fraud_details = fraud_result.get('details', {})
        amount_anomaly = fraud_details.get('amount_anomaly', {})
        if amount_anomaly.get('score', 0) >= 30:
            critical_failures.append(f'Suspicious/fake amount detected: {amount_anomaly.get("reasons", [""])[0]}')

        if status_check.get('found', '') in {'FAILED', 'REJECTED', 'DECLINED', 'CANCELLED', 'PENDING', 'PROCESSING'}:
            critical_failures.append(f'Payment status is {status_check["found"]}')

        if fraud_score >= 50 and len(fraud_flags) >= 2:
            manual_review_reasons.append(f'Multiple fraud indicators: {", ".join(fraud_flags[:3])}')

        if amount_check.get('found') != 'missing' and not amount_check.get('passed'):
            if ocr_confidence >= 50:
                manual_review_reasons.append(amount_check.get('reason', 'Amount mismatch'))
            else:
                manual_review_reasons.append('Amount uncertain due to low OCR confidence')

        if not receiver_check.get('passed'):
            manual_review_reasons.append(receiver_check.get('reason', 'Receiver mismatch'))

        if not status_check.get('passed') and status_check.get('found') not in ('missing', 'PENDING', 'PROCESSING'):
            manual_review_reasons.append(status_check.get('reason', 'Invalid payment status'))

        if not date_check.get('passed'):
            manual_review_reasons.append(date_check.get('reason', 'Date not today'))

        if not time_check.get('passed'):
            manual_review_reasons.append(time_check.get('reason', 'Time outside window'))

        if not utr_check.get('passed'):
            manual_review_reasons.append(utr_check.get('reason', 'UTR invalid or missing'))

        ocr_confidence_check = checks.get('ocr_quality', {})
        if not ocr_confidence_check.get('passed'):
            manual_review_reasons.append(ocr_confidence_check.get('reason', 'Low OCR confidence'))

        image_quality_issues = image_quality_check.get('issues', [])
        if image_quality_issues:
            manual_review_reasons.extend(image_quality_issues)

        authenticity_issues = authenticity_check.get('issues', [])
        if authenticity_issues:
            manual_review_reasons.extend(authenticity_issues[:2])

        if not critical_failures and not manual_review_reasons:
            return 'AUTO_APPROVE', ['All checks passed', f'Confidence score: {score}%']

        if critical_failures:
            return 'AUTO_REJECT', critical_failures + manual_review_reasons[:2]

        return 'MANUAL_REVIEW', manual_review_reasons[:5]
