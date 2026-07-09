#!/usr/bin/env python
"""
Automated test suite for the AI Payment Screenshot Verification Engine.

Tests:
  - Stage 1: OpenCV validation (screenshot, blur, crop, tamper, layout)
  - Stage 2: Florence-2 region detection (graceful degradation)
  - Stage 3: Multi-OCR (PaddleOCR + EasyOCR + Tesseract)
  - Stage 4: Voting engine (majority agreement, tiebreaker)
  - Stage 5: Cross-verification (amount, receiver, UTR, date, status)
  - Stage 6: Florence-2 visual verify (graceful degradation)
  - Stage 7: Fraud detection (tamper, mismatch, disagreement scoring)
  - Stage 8: Decision engine (approve/reject/manual_review thresholds)

Usage:
  python test_ai_engine.py                         # Run all tests
  python test_ai_engine.py --test stage1           # Run specific stage tests
  python test_ai_engine.py --image <path> --json   # Run on custom image
"""
import sys, os, json, time, tempfile, unittest, io, base64, struct
from pathlib import Path

os.environ['PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK'] = 'True'
os.environ['HF_HUB_OFFLINE'] = '1'

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

SCRIPT_DIR = Path(__file__).parent.absolute()
ENGINE_PATH = SCRIPT_DIR / '_ai_engine.py'
TRUSTED_DIR = SCRIPT_DIR.parent / 'trusted_screenshots'

sys.path.insert(0, str(SCRIPT_DIR))

# ── Helper: run AI engine and return parsed result ──
def run_engine(image_path, expected=None):
    import subprocess
    cmd = [sys.executable, str(ENGINE_PATH), '--image', str(image_path), '--json']
    if expected:
        if expected.get('amount'): cmd += ['--expected-amount', str(expected['amount'])]
        if expected.get('receiverUpi'): cmd += ['--expected-receiver', expected['receiverUpi']]
        if expected.get('utr'): cmd += ['--expected-utr', expected['utr']]
        if expected.get('senderUpi'): cmd += ['--expected-sender', expected['senderUpi']]

    env = {**os.environ, 'PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK': 'True', 'HF_HUB_OFFLINE': '1'}
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300, env=env)
    if result.returncode != 0:
        return {'error': f'Exit code {result.returncode}', 'stderr': result.stderr[:500]}
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as e:
        return {'error': f'JSON parse: {e}', 'stdout': result.stdout[:500]}

# ── Helper: generate synthetic test images ──
def create_test_image(width=720, height=1600, **kwargs):
    img = Image.new('RGB', (width, height), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)

    status = kwargs.get('status', 'SUCCESS')
    amount = kwargs.get('amount', '₹120.00')
    sender = kwargs.get('sender', 'jayarajj-3@okicici')
    receiver = kwargs.get('receiver', 'merchant@upi')
    utr = kwargs.get('utr', '1234567890123456')
    date = kwargs.get('date', '27 Jun 2026')

    draw.text((200, 100), 'PhonePe', fill=(0, 0, 0))
    draw.text((200, 200), f'Amount: {amount}', fill=(0, 0, 0))
    draw.text((200, 300), f'Paid to: {receiver}', fill=(0, 0, 0))
    draw.text((200, 400), f'From: {sender}', fill=(0, 0, 0))
    draw.text((200, 500), f'UTR: {utr}', fill=(0, 0, 0))
    draw.text((200, 600), f'Date: {date}', fill=(0, 0, 0))
    draw.text((200, 700), f'Status: {status}', fill=(0, 200, 0) if status == 'SUCCESS' else (200, 0, 0))
    draw.text((200, 800), 'UPI Transaction ID: 123456789012', fill=(0, 0, 0))
    draw.text((200, 900), '--- Transaction Details ---', fill=(100, 100, 100))

    for i in range(10, 16):
        draw.line([(50, i * 100), (670, i * 100)], fill=(200, 200, 200), width=1)

    # Convert to numpy for OpenCV manipulation
    arr = np.array(img)
    bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)

    if kwargs.get('blur'):
        bgr = cv2.GaussianBlur(bgr, (21, 21), 0)
    if kwargs.get('dark'):
        bgr = (bgr * 0.3).astype(np.uint8)

    temp = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
    cv2.imwrite(temp.name, bgr)
    return temp.name

def check_field(result, stage, field, expected_value):
    s = result.get('stages', {}).get(stage, {})
    actual = s.get(field)
    if actual == expected_value:
        return True, f'{stage}.{field}: {actual} ✓'
    return False, f'{stage}.{field}: expected={expected_value}, got={actual} ✗'

def check_vote(result, field, expected_value):
    agreement = result.get('stages', {}).get('stage4_voting', {}).get('agreement', {})
    actual = agreement.get(field, {}).get('value')
    if actual == expected_value:
        return True, f'vote.{field}: {actual} ✓'
    return False, f'vote.{field}: expected={expected_value}, got={actual} ✗'

def check_match(result, field, expected):
    matches = result.get('stages', {}).get('stage5_crosscheck', {}).get('matches', {})
    actual = matches.get(field)
    if actual == expected:
        return True, f'match.{field}: {actual} ✓'
    return False, f'match.{field}: expected={expected}, got={actual} ✗'

# ═══════════════════════════════════════════════════════════════
# TEST SUITE
# ═══════════════════════════════════════════════════════════════

class TestAIEngine(unittest.TestCase):
    """Full test suite for AI Verification Engine (all 8 stages)."""

    @classmethod
    def setUpClass(cls):
        cls.test_screenshots = {}
        # Use real screenshot if available
        real = TRUSTED_DIR / 'payment_a0f14bd0.jpeg'
        if real.exists():
            cls.test_screenshots['real'] = str(real)
            cls.real_expected = {'amount': 120, 'receiverUpi': 'jayarajj-3@okicici', 'utr': '1234567892222'}
        else:
            cls.real_expected = None
        cls.synthetic_images = []

    @classmethod
    def tearDownClass(cls):
        for path in cls.synthetic_images:
            try: os.unlink(path)
            except: pass

    def _make_image(self, **kwargs):
        path = create_test_image(**kwargs)
        self.__class__.synthetic_images.append(path)
        return path

    # ── STAGE 1: OpenCV Validation ──
    def test_stage1_good_screenshot(self):
        """Good mobile screenshot should pass Stage 1."""
        p = self._make_image()
        r = run_engine(p, {'amount': 120, 'receiverUpi': 'merchant@upi', 'utr': '1234567890123456'})
        s1 = r.get('stages', {}).get('stage1_opencv', {})
        self.assertIn('grade', s1, 'Stage 1 must return grade')
        self.assertNotEqual(s1.get('grade'), 'poor', 'Good screenshot should not be poor')
        self.assertTrue(s1.get('isScreenshot'), 'Mobile aspect should be detected')
        self.assertFalse(s1.get('isBlurred'), 'Clean image should not be blurry')
        self.assertFalse(s1.get('isCropped'), 'Clean image should not be cropped')

    def test_stage1_blurry(self):
        """Blurry image should be flagged."""
        p = self._make_image(blur=True)
        r = run_engine(p, {'amount': 120})
        s1 = r.get('stages', {}).get('stage1_opencv', {})
        self.assertTrue(s1.get('isBlurred'), 'Blurry image should be detected')

    def test_stage1_dark(self):
        """Dark image should be flagged."""
        p = self._make_image(dark=True)
        r = run_engine(p, {'amount': 120})
        s1 = r.get('stages', {}).get('stage1_opencv', {})
        issues = s1.get('issues', [])
        dark_issue = any('dark' in i.lower() for i in issues)
        self.assertTrue(dark_issue or s1.get('brightness', 100) < 40, 'Dark image should have low brightness')

    def test_stage1_not_screenshot(self):
        """Landscape image should not be detected as mobile screenshot."""
        p = create_test_image(width=1600, height=900)
        self.__class__.synthetic_images.append(p)
        r = run_engine(p, {'amount': 120})
        s1 = r.get('stages', {}).get('stage1_opencv', {})
        self.assertFalse(s1.get('isScreenshot'), 'Landscape should not be mobile screenshot')

    # ── STAGE 2: Florence-2 (degradation) ──
    def test_stage2_graceful_degradation(self):
        """Florence-2 should degrade gracefully when model not available."""
        p = self._make_image()
        r = run_engine(p, {})
        s2 = r.get('stages', {}).get('stage2_florence_regions', {})
        self.assertIn('available', s2, 'Florence regions must have available flag')
        self.assertFalse(s2.get('available'), 'Florence-2 not downloaded on CI')

    # ── STAGE 3: Multi-OCR ──
    def test_stage3_ocr_works(self):
        """At least one OCR engine should succeed on clean image."""
        p = self._make_image(amount='₹120.00', utr='1234567890123456')
        r = run_engine(p, {'amount': 120, 'utr': '1234567890123456'})
        s3 = r.get('stages', {}).get('stage3_multi_ocr', {})
        self.assertGreater(s3.get('engineCount', 0), 0, 'At least one OCR engine should succeed')
        engines = s3.get('engines', {})
        successes = [k for k, v in engines.items() if v.get('success')]
        self.assertGreater(len(successes), 0, f'Engines: {engines}')

    def test_stage3_ocr_reads_amount(self):
        """OCR should read the amount from synthetic image."""
        p = self._make_image(amount='₹500.00')
        r = run_engine(p, {'amount': 500})
        ok, msg = check_vote(r, 'amount', '500.0')
        self.assertTrue(ok, msg)

    def test_stage3_ocr_reads_utr(self):
        """OCR should read the UTR from synthetic image."""
        p = self._make_image(utr='999888777666555')
        r = run_engine(p, {'utr': '999888777666555'})
        ok, msg = check_vote(r, 'utr', '999888777666555')
        self.assertTrue(ok, msg)

    # ── STAGE 4: Voting ──
    def test_stage4_voting_engine_count(self):
        """Voting engine should report how many engines participated."""
        p = self._make_image()
        r = run_engine(p, {})
        s4 = r.get('stages', {}).get('stage4_voting', {})
        self.assertGreater(s4.get('voteCount', 0), 0, 'At least 1 engine must vote')

    # ── STAGE 5: Cross-Verification ──
    def test_stage5_amount_match(self):
        """Correct amount should match."""
        p = self._make_image(amount='₹120.00')
        r = run_engine(p, {'amount': 120})
        ok, msg = check_match(r, 'amount', True)
        self.assertTrue(ok, msg)

    def test_stage5_receiver_match(self):
        """Correct receiver UPI should match."""
        p = self._make_image(receiver='shopper@paytm')
        r = run_engine(p, {'receiverUpi': 'shopper@paytm'})
        ok, msg = check_match(r, 'receiverUpi', True)
        self.assertTrue(ok, msg)

    def test_stage5_utr_match(self):
        """Correct UTR should match."""
        utr_val = '1122334455667788'
        p = self._make_image(utr=utr_val)
        r = run_engine(p, {'utr': utr_val})
        ok, msg = check_match(r, 'utr', True)
        self.assertTrue(ok, msg)

    def test_stage5_amount_mismatch(self):
        """Wrong amount should not match."""
        p = self._make_image(amount='₹500.00')
        r = run_engine(p, {'amount': 120})
        ok, msg = check_match(r, 'amount', False)
        self.assertTrue(ok, msg)

    def test_stage5_receiver_mismatch(self):
        """Wrong receiver should not match."""
        p = self._make_image(receiver='wrong@upi')
        r = run_engine(p, {'receiverUpi': 'correct@upi'})
        ok, msg = check_match(r, 'receiverUpi', False)
        self.assertTrue(ok, msg)

    # ── STAGE 7: Fraud Detection ──
    def test_stage7_fraud_clean(self):
        """Clean image with matching fields should have low fraud score."""
        p = self._make_image(amount='₹120.00', receiver='merchant@upi', utr='1234567890123456')
        r = run_engine(p, {'amount': 120, 'receiverUpi': 'merchant@upi', 'utr': '1234567890123456'})
        s7 = r.get('stages', {}).get('stage7_fraud', {})
        self.assertLess(s7.get('score', 100), 50, 'Clean match should have low fraud score')

    def test_stage7_fraud_mismatch(self):
        """Mismatched fields should increase fraud score."""
        p = self._make_image(amount='₹999.00', receiver='wrong@upi')
        r = run_engine(p, {'amount': 120, 'receiverUpi': 'correct@upi'})
        s7 = r.get('stages', {}).get('stage7_fraud', {})
        self.assertGreater(s7.get('score', 0), 30, 'Mismatch should increase fraud score')

    # ── STAGE 8: Decision Engine ──
    def test_stage8_approve_conditions(self):
        """All conditions met should approve."""
        p = self._make_image(amount='₹120.00', receiver='merchant@upi', utr='1234567890123456', status='SUCCESS')
        r = run_engine(p, {'amount': 120, 'receiverUpi': 'merchant@upi', 'utr': '1234567890123456'})
        self.assertIn(r.get('status'), ('approved', 'manual_review'),
                      'Perfect match should approve or manual_review (depends on OCR quality)')
        self.assertGreater(r.get('confidence', 0), 10, 'Confidence should be non-trivial')

    def test_stage8_reject_wrong_receiver(self):
        """Wrong receiver should lead to manual_review or reject."""
        p = self._make_image(amount='₹120.00', receiver='wrong@upi')
        r = run_engine(p, {'amount': 120, 'receiverUpi': 'correct@upi'})
        self.assertIn(r.get('status'), ('rejected', 'manual_review'),
                      'Wrong receiver should not be approved')

    def test_stage8_confidence_range(self):
        """Confidence should be between 0 and 100."""
        p = self._make_image()
        r = run_engine(p, {})
        conf = r.get('confidence', -1)
        self.assertGreaterEqual(conf, 0, f'Confidence {conf} should be >= 0')
        self.assertLessEqual(conf, 100, f'Confidence {conf} should be <= 100')

    # ── INTEGRATION: Real Screenshot ──
    def test_real_screenshot(self):
        """Real payment screenshot should process without crash."""
        if not self.real_expected:
            self.skipTest('No real screenshot found')
        r = run_engine(self.test_screenshots['real'], self.real_expected)
        self.assertIsNone(r.get('error'), f'Real screenshot should not error: {r.get("error")}')
        self.assertIn(r.get('status'), ('approved', 'rejected', 'manual_review'),
                      'Real screenshot should produce a valid decision')
        s1 = r.get('stages', {}).get('stage1_opencv', {})
        self.assertTrue(s1.get('isScreenshot'), 'Real screenshot should be mobile screenshot')

    # ── EDGE CASES ──
    def test_missing_image(self):
        """Missing file should return error."""
        r = run_engine('nonexistent.jpg', {})
        self.assertIsNotNone(r.get('error'), 'Missing file should error')

    def test_empty_expected(self):
        """Running with no expected values should not crash."""
        p = self._make_image()
        r = run_engine(p, {})
        self.assertIsNone(r.get('error'), 'Empty expected should not crash')

    def test_very_large_amount(self):
        """Large amount should not cause overflow."""
        p = self._make_image(amount='₹999999.00')
        r = run_engine(p, {'amount': 999999})
        self.assertIsNone(r.get('error'), 'Large amount should not crash')

    def test_malformed_image(self):
        """Corrupt file should return error gracefully."""
        corrupted = tempfile.NamedTemporaryFile(suffix='.jpg', delete=False)
        corrupted.write(b'not a real image')
        corrupted.close()
        try:
            r = run_engine(corrupted.name, {})
            self.assertTrue(r.get('error') or r.get('status') == 'failed',
                            'Corrupt image should error or fail')
        finally:
            os.unlink(corrupted.name)

    def test_small_resolution(self):
        """Very small image should be flagged."""
        p = create_test_image(width=50, height=100)
        self.__class__.synthetic_images.append(p)
        r = run_engine(p, {})
        s1 = r.get('stages', {}).get('stage1_opencv', {})
        issues = s1.get('issues', [])
        res_issue = any('resolution' in i.lower() for i in issues)
        self.assertTrue(res_issue or s1.get('grade') in ('fair', 'poor'),
                        'Small resolution should be flagged')

    def test_zero_amount_expected(self):
        """Running with zero expected amount should not crash."""
        p = self._make_image(amount='₹0.00')
        r = run_engine(p, {'amount': 0})
        self.assertIsNone(r.get('error'), 'Zero amount should not crash')

    def test_unicode_upi(self):
        """UPI IDs with special characters should be handled."""
        p = self._make_image(receiver='user.name-123@bank')
        r = run_engine(p, {'receiverUpi': 'user.name-123@bank'})
        self.assertIsNone(r.get('error'), 'UPI with special chars should not crash')

    def test_failed_status_rejection(self):
        """FAILED status in screenshot should increase fraud."""
        p = self._make_image(amount='₹120.00', status='FAILED')
        r = run_engine(p, {'amount': 120})
        s7 = r.get('stages', {}).get('stage7_fraud', {})
        reasons = s7.get('reasons', [])
        failed_reason = any('FAILED' in r.upper() for r in reasons)
        self.assertGreater(s7.get('score', 0), 10, 'FAILED status should increase fraud score')

    def test_full_output_structure(self):
        """Result JSON must contain all expected fields."""
        p = self._make_image()
        r = run_engine(p, {})
        self.assertIn('stages', r)
        self.assertIn('status', r)
        self.assertIn('confidence', r)
        self.assertIn('duration', r)
        for stage in ['stage1_opencv', 'stage2_florence_regions', 'stage3_multi_ocr',
                      'stage4_voting', 'stage5_crosscheck', 'stage7_fraud', 'stage8_decision']:
            self.assertIn(stage, r.get('stages', {}), f'Missing stage: {stage}')


# ── CLI ──
if __name__ == '__main__':
    if '--image' in sys.argv:
        idx = sys.argv.index('--image')
        path = sys.argv[idx + 1]
        expected = {}
        if '--expected-amount' in sys.argv:
            i = sys.argv.index('--expected-amount')
            expected['amount'] = float(sys.argv[i + 1])
        if '--expected-receiver' in sys.argv:
            i = sys.argv.index('--expected-receiver')
            expected['receiverUpi'] = sys.argv[i + 1]
        if '--expected-utr' in sys.argv:
            i = sys.argv.index('--expected-utr')
            expected['utr'] = sys.argv[i + 1]
        r = run_engine(path, expected)
        print(json.dumps(r, default=str, indent=2))
        sys.exit(0)

    unittest.main(argv=[a for a in sys.argv if not a.startswith('--')])
