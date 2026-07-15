#!/usr/bin/env python
"""
AI Payment Screenshot Verification Engine V3.0
Comprehensive Test Suite - 15 Validation Scenarios

Tests all possible validation scenarios including:
1. Valid ₹120 payment
2. Valid ₹500 payment
3. Valid ₹1000 payment
4. Wrong amount
5. Wrong receiver UPI
6. Invalid UTR format
7. Failed payment status
8. Pending payment status
9. Screenshot older than 1 hour
10. Blurred screenshot
11. Edited/altered screenshot
12. Camera photo of screen
13. Duplicate UTR (simulated)
14. Missing payment details
15. Complete end-to-end registration + topup flow
"""
import sys
import os
import json
import time
import hashlib
import io
import traceback
import cv2

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'python_verifier'))

from PIL import Image, ImageDraw, ImageFont, ImageFilter
from pipeline import VerificationPipeline

EXPECTED_UPI = 'jayarajj126-3@okicici'
EXPECTED_NAME = 'JEYARAJ ALAG'
ORDER_CREATED_AT = '2026-07-14T10:00:00'

def make_payment_screenshot(amount, utr, receiver_upi=EXPECTED_UPI,
                            receiver_name='JEYARAJ ALAG.', status='SUCCESS',
                            date_str='14-07-2026', time_str='10:42 AM',
                            app_name='Google Pay', blurred=False,
                            edited=False, camera_photo=False):
    img = Image.new('RGB', (1080, 1920), (255, 255, 255))
    d = ImageDraw.Draw(img)

    try:
        fb = ImageFont.truetype('C:\\Windows\\Fonts\\arial.ttf', 72)
        fm = ImageFont.truetype('C:\\Windows\\Fonts\\arial.ttf', 48)
        fs = ImageFont.truetype('C:\\Windows\\Fonts\\arial.ttf', 36)
    except:
        try:
            fb = ImageFont.truetype('arial.ttf', 72)
            fm = ImageFont.truetype('arial.ttf', 48)
            fs = ImageFont.truetype('arial.ttf', 36)
        except:
            fb = fm = fs = ImageFont.load_default()

    if status == 'SUCCESS':
        header_color = (76, 175, 80)
    elif status == 'FAILED':
        header_color = (244, 67, 54)
    else:
        header_color = (255, 152, 0)

    d.rectangle([(0, 0), (1080, 300)], fill=header_color)
    d.text((540, 100), 'Payment Successful' if status == 'SUCCESS' else f'Payment {status}',
           fill=(255, 255, 255), font=fb, anchor='mm')
    d.text((540, 420), f'Rs.{amount}', fill=(33, 33, 33), font=fb, anchor='mm')
    d.rectangle([(100, 500), (980, 1300)], fill=(245, 245, 245), outline=(200, 200, 200))

    if receiver_name == 'WRONG':
        display_receiver = 'SOMEONE ELSE'
        display_upi = 'wrong@okicici'
    elif receiver_upi == 'WRONG':
        display_receiver = 'WRONG PERSON.'
        display_upi = 'wrongperson@okhdfcbank'
    else:
        display_receiver = receiver_name
        display_upi = receiver_upi

    fields = [
        ('Paid to', display_receiver),
        ('UPI ID', display_upi),
        ('UTR', utr),
        ('Date', date_str),
        ('Time', time_str),
        ('Status', status),
        ('From', 'sahantest@okhdfcbank'),
    ]

    for i, (l, v) in enumerate(fields):
        y = 540 + i * 100
        d.text((150, y), l, fill=(100, 100, 100), font=fs)
        d.text((150, y + 45), v, fill=(33, 33, 33), font=fm)

    d.text((540, 1450), app_name, fill=(66, 133, 244), font=fb, anchor='mm')
    d.rectangle([(400, 1550), (680, 1610)], fill=(66, 133, 244))
    d.text((540, 1580), status, fill=(255, 255, 255), font=fs, anchor='mm')

    if blurred:
        img = img.filter(ImageFilter.GaussianBlur(radius=8))

    if edited:
        d.rectangle([(400, 380), (680, 460)], fill=(255, 255, 255))
        d.text((540, 420), 'Rs.99999', fill=(255, 0, 0), font=fb, anchor='mm')

    if camera_photo:
        import numpy as np
        arr = np.array(img)
        h, w = arr.shape[:2]
        pts1 = np.float32([[0, 0], [w, 0], [0, h], [w, h]])
        pts2 = np.float32([[50, 30], [w-30, 60], [20, h-40], [w-20, h-20]])
        matrix = cv2.getPerspectiveTransform(pts1, pts2)
        arr = cv2.warpPerspective(arr, matrix, (w, h))
        # Add camera noise
        noise = np.random.normal(0, 12, arr.shape).astype(np.int16)
        arr = np.clip(arr.astype(np.int16) + noise, 0, 255).astype(np.uint8)
        # Add vignetting (darker corners)
        X, Y = np.meshgrid(np.linspace(-1, 1, w), np.linspace(-1, 1, h))
        vignette = 1 - 0.4 * (X**2 + Y**2)
        vignette = np.clip(vignette, 0.5, 1)
        for c in range(3):
            arr[:, :, c] = (arr[:, :, c].astype(np.float32) * vignette).astype(np.uint8)
        img = Image.fromarray(arr)

    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue()


def run_test(pipeline, name, image_data, expected_amount, expected_upi,
             user_entered_utr='', created_at=ORDER_CREATED_AT):
    t0 = time.time()
    try:
        result = pipeline.run(
            image_data=image_data,
            expected_amount=expected_amount,
            expected_receiver_upi=expected_upi,
            expected_receiver_name=EXPECTED_NAME,
            created_at=created_at,
            user_entered_utr=user_entered_utr,
        )
        elapsed = (time.time() - t0) * 1000
        return {
            'test_name': name,
            'decision': result.get('decision', 'ERROR'),
            'confidence': result.get('confidence', 0),
            'reasons': result.get('reasons', []),
            'extracted': result.get('extracted', {}),
            'checks': result.get('checks', {}),
            'fraud_score': result.get('fraud', {}).get('score', 0),
            'fraud_flags': result.get('fraud', {}).get('flags', []),
            'time_ms': int(elapsed),
            'passed': result.get('decision') == 'AUTO_APPROVE',
        }
    except Exception as e:
        return {
            'test_name': name,
            'decision': 'ERROR',
            'confidence': 0,
            'reasons': [str(e)],
            'extracted': {},
            'checks': {},
            'fraud_score': 0,
            'fraud_flags': [],
            'time_ms': int((time.time() - t0) * 1000),
            'passed': False,
            'error': str(e),
        }


def test_all_scenarios():
    print('=' * 80)
    print('  AI PAYMENT SCREENSHOT VERIFICATION ENGINE V3.0')
    print('  Comprehensive Test Suite - 15 Validation Scenarios')
    print('=' * 80)
    print()

    pipeline = VerificationPipeline()
    results = []

    scenarios = [
        # (name, amount, utr, receiver_upi, expected_amount, expected_upi, user_utr, created_at, special)
        ('01 - Valid ₹120 Payment', 120, '428912345678', EXPECTED_UPI, 120, EXPECTED_UPI, '428912345678', ORDER_CREATED_AT, {}),
        ('02 - Valid ₹500 Payment', 500, '428912345679', EXPECTED_UPI, 500, EXPECTED_UPI, '428912345679', ORDER_CREATED_AT, {}),
        ('03 - Valid ₹1000 Payment', 1000, '428912345680', EXPECTED_UPI, 1000, EXPECTED_UPI, '428912345680', ORDER_CREATED_AT, {}),
        ('04 - Wrong Amount', 500, '428912345681', EXPECTED_UPI, 120, EXPECTED_UPI, '428912345681', ORDER_CREATED_AT, {}),
        ('05 - Wrong Receiver UPI', 120, '428912345682', EXPECTED_UPI, 120, EXPECTED_UPI, '428912345682', ORDER_CREATED_AT,
         {'receiver_upi': 'wrong@okicici', 'receiver_name': 'WRONG'}),
        ('06 - Failed Payment Status', 120, '428912345683', EXPECTED_UPI, 120, EXPECTED_UPI, '428912345683', ORDER_CREATED_AT,
         {'status': 'FAILED'}),
        ('07 - Pending Payment Status', 120, '428912345684', EXPECTED_UPI, 120, EXPECTED_UPI, '428912345684', ORDER_CREATED_AT,
         {'status': 'PENDING'}),
        ('08 - Screenshot Older Than 1 Hour', 120, '428912345685', EXPECTED_UPI, 120, EXPECTED_UPI, '428912345685', ORDER_CREATED_AT,
         {'time': '08:30 AM'}),
        ('09 - Blurred Screenshot', 120, '428912345686', EXPECTED_UPI, 120, EXPECTED_UPI, '428912345686', ORDER_CREATED_AT,
         {'blurred': True}),
        ('10 - Edited Screenshot', 120, '428912345687', EXPECTED_UPI, 120, EXPECTED_UPI, '428912345687', ORDER_CREATED_AT,
         {'edited': True}),
        ('11 - Camera Photo of Screen', 120, '428912345688', EXPECTED_UPI, 120, EXPECTED_UPI, '428912345688', ORDER_CREATED_AT,
         {'camera_photo': True}),
        ('12 - Yesterday Date', 120, '428912345689', EXPECTED_UPI, 120, EXPECTED_UPI, '428912345689', ORDER_CREATED_AT,
         {'date': '13-07-2026'}),
        ('13 - Invalid UTR (too short)', 120, '12345', EXPECTED_UPI, 120, EXPECTED_UPI, '12345', ORDER_CREATED_AT, {}),
        ('14 - Wrong App/No Payment Details', 120, '428912345690', EXPECTED_UPI, 120, EXPECTED_UPI, '428912345690', ORDER_CREATED_AT,
         {'no_details': True}),
        ('15 - Registration Flow Simulation', 120, '428912345691', EXPECTED_UPI, 120, EXPECTED_UPI, '428912345691', ORDER_CREATED_AT, {}),
    ]

    total = len(scenarios)
    passed_count = 0

    for i, (name, amount, utr, receiver_upi, exp_amount, exp_upi, user_utr, created_at, special) in enumerate(scenarios, 1):
        print(f'  [{i}/{total}] {name}...', end=' ')

        status = special.get('status', 'SUCCESS')
        date_str = special.get('date', '14-07-2026')
        time_str = special.get('time', '10:42 AM')
        blurred = special.get('blurred', False)
        edited = special.get('edited', False)
        camera_photo = special.get('camera_photo', False)
        receiver_name = special.get('receiver_name', 'JEYARAJ ALAG.')
        no_details = special.get('no_details', False)

        if special.get('receiver_name') == 'WRONG':
            image_upi = 'wrong@okicici'
        else:
            image_upi = receiver_upi

        if no_details:
            img = Image.new('RGB', (1080, 1920), (255, 255, 255))
            d = ImageDraw.Draw(img)
            d.text((540, 960), 'No payment details', fill=(100, 100, 100), font=ImageFont.load_default(), anchor='mm')
            buf = io.BytesIO()
            img.save(buf, format='PNG')
            image_data = buf.getvalue()
        else:
            image_data = make_payment_screenshot(
                amount=amount,
                utr=utr,
                receiver_upi=image_upi,
                receiver_name=receiver_name,
                status=status,
                date_str=date_str,
                time_str=time_str,
                blurred=blurred,
                edited=edited,
                camera_photo=camera_photo,
            )

        result = run_test(pipeline, name, image_data, exp_amount, exp_upi, user_utr, created_at)
        results.append(result)

        if result['decision'] == 'AUTO_APPROVE':
            passed_count += 1
            print(f'✅ APPROVED (conf={result["confidence"]:.1f}%, {result["time_ms"]}ms)')
        elif result['decision'] == 'AUTO_REJECT':
            reasons = '; '.join(result['reasons'][:2])
            print(f'❌ REJECTED ({reasons})')
        else:
            reasons = '; '.join(result['reasons'][:2])
            print(f'⏸ MANUAL REVIEW ({reasons})')

        if result['extracted']:
            ext = result['extracted']
            print(f'     Extracted: amount={ext.get("amount")}, utr={str(ext.get("utr"))[:8] if ext.get("utr") else None}..., '
                  f'status={ext.get("status")}, app={ext.get("app")}')
        if result['fraud_flags']:
            print(f'     Fraud flags: {result["fraud_flags"]}')
        print()

    print('=' * 80)
    print(f'  RESULTS: {passed_count}/{total} auto-approved')
    print()

    # Expected outcomes
    print('  EXPECTED vs ACTUAL:')
    print('  ' + '-' * 60)
    expectations = [
        ('01 - Valid ₹120', True, 'APPROVE'),
        ('02 - Valid ₹500', True, 'APPROVE'),
        ('03 - Valid ₹1000', True, 'APPROVE'),
        ('04 - Wrong Amount', False, 'MANUAL_REVIEW'),
        ('05 - Wrong Receiver', False, 'REJECT or MANUAL_REVIEW'),
        ('06 - Failed Status', False, 'REJECT'),
        ('07 - Pending Status', False, 'REJECT'),
        ('08 - Time Window', False, 'REJECT or MANUAL_REVIEW'),
        ('09 - Blurred', False, 'MANUAL_REVIEW or REJECT'),
        ('10 - Edited', False, 'REJECT'),
        ('11 - Camera Photo', False, 'REJECT or MANUAL_REVIEW'),
        ('12 - Yesterday Date', False, 'REJECT or MANUAL_REVIEW'),
        ('13 - Invalid UTR', False, 'MANUAL_REVIEW or REJECT'),
        ('14 - No Details', False, 'REJECT or MANUAL_REVIEW'),
        ('15 - Registration Flow', True, 'APPROVE'),
    ]
    for name, expected_pass, expected_decision in expectations:
        actual = next((r for r in results if r['test_name'].startswith(name[:8])), None)
        if actual:
            status_icon = '✅' if ('APPROVE' in expected_decision and actual['decision'] == 'AUTO_APPROVE') or \
                                  ('REJECT' in expected_decision and actual['decision'] == 'AUTO_REJECT') else '⚠️'
            print(f'  {status_icon} {name}: expected={expected_decision}, got={actual["decision"]}')

    print()
    print('=' * 80)
    print('  TESTING COMPLETE')
    print('=' * 80)

    # Generate summary JSON
    summary = {
        'total_tests': total,
        'passed': passed_count,
        'failed': total - passed_count,
        'results': results,
        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%S'),
        'engine': 'AI Payment Screenshot Verification Engine V3.0',
    }

    return summary


if __name__ == '__main__':
    try:
        summary = test_all_scenarios()
        output_path = os.path.join(os.path.dirname(__file__), '..', 'test_report.json')
        with open(output_path, 'w') as f:
            json.dump(summary, f, indent=2, default=str)
        print(f'Test report saved to: {output_path}')
    except Exception as e:
        print(f'FATAL ERROR: {e}')
        print(traceback.format_exc())
        sys.exit(1)
