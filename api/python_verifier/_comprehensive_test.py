import sys, io, json
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, '.')
from pipeline import VerificationPipeline

def make_screenshot(amount=120, utr='428912345678', pay_status='SUCCESS',
                    receiver_upi='jayarajj126-3@okicici', date_str='14-07-2026',
                    time_str='10:42 AM', blurred=False, edited=False, camera=False):
    img = Image.new('RGB', (1080, 1920), (255, 255, 255))
    d = ImageDraw.Draw(img)
    try:
        fb = ImageFont.truetype('C:\\Windows\\Fonts\\arial.ttf', 72)
        fm = ImageFont.truetype('C:\\Windows\\Fonts\\arial.ttf', 48)
        fs = ImageFont.truetype('C:\\Windows\\Fonts\\arial.ttf', 36)
    except:
        fb = fm = fs = ImageFont.load_default()

    head_color = (76, 175, 80) if pay_status == 'SUCCESS' else (244, 67, 54) if pay_status == 'FAILED' else (255, 152, 0)
    d.rectangle([(0, 0), (1080, 300)], fill=head_color)
    d.text((540, 100), 'Payment Successful' if pay_status == 'SUCCESS' else f'Payment {pay_status}',
           fill=(255, 255, 255), font=fb, anchor='mm')
    d.text((540, 420), f'Rs.{amount}', fill=(33, 33, 33), font=fb, anchor='mm')
    d.rectangle([(100, 500), (980, 1300)], fill=(245, 245, 245), outline=(200, 200, 200))
    fields = [
        ('Paid to', 'JEYARAJ ALAG.'), ('UPI ID', receiver_upi),
        ('UTR', utr), ('Date', date_str), ('Time', time_str),
        ('Status', pay_status), ('From', 'sahantest@okhdfcbank'),
    ]
    for i, (l, v) in enumerate(fields):
        y = 540 + i * 100
        d.text((150, y), l, fill=(100, 100, 100), font=fs)
        d.text((150, y + 45), v, fill=(33, 33, 33), font=fm)
    d.text((540, 1450), 'Google Pay', fill=(66, 133, 244), font=fb, anchor='mm')
    d.rectangle([(400, 1550), (680, 1610)], fill=(66, 133, 244))
    d.text((540, 1580), pay_status, fill=(255, 255, 255), font=fs, anchor='mm')

    if edited:
        # Overlay a fake amount on top of the real amount
        d.rectangle([(300, 380), (780, 500)], fill=(255, 255, 255))
        d.text((540, 440), 'Rs.99999', fill=(255, 0, 0), font=fb, anchor='mm')
        d.text((540, 500), 'FAKE EDITED', fill=(255, 0, 0), font=fs, anchor='mm')
    if camera:
        import cv2 as _cv2, numpy as _np
        arr = _np.array(img)
        h, w = arr.shape[:2]
        # Strong perspective distortion (makes edges non-parallel)
        pts1 = _np.float32([[0, 0], [w, 0], [0, h], [w, h]])
        pts2 = _np.float32([[150, 50], [w - 100, 80], [60, h - 100], [w - 40, h - 60]])
        M = _cv2.getPerspectiveTransform(pts1, pts2)
        arr = _cv2.warpPerspective(arr, M, (w, h))
        # Moderate Gaussian noise (camera grain)
        noise = _np.random.normal(0, 12, arr.shape).astype(_np.int16)
        arr = _np.clip(arr.astype(_np.int16) + noise, 0, 255).astype(_np.uint8)
        # Moderate vignetting (darkened corners)
        _X, _Y = _np.meshgrid(_np.linspace(-1, 1, w), _np.linspace(-1, 1, h))
        _vignette = 1 - 0.35 * (_X**2 + _Y**2)
        _vignette = _np.clip(_vignette, 0.5, 1)
        for _c in range(3):
            arr[:, :, _c] = (arr[:, :, _c].astype(_np.float32) * _vignette).astype(_np.uint8)
        img = Image.fromarray(arr)
    if blurred:
        from PIL import ImageFilter
        img = img.filter(ImageFilter.GaussianBlur(radius=6))
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue()

tests = [
    ('Valid Rs.120', 120, '428912345678', 'SUCCESS', 'jayarajj126-3@okicici', '14-07-2026', '10:42 AM', False, False, False, 120),
    ('Valid Rs.500', 500, '428912345679', 'SUCCESS', 'jayarajj126-3@okicici', '14-07-2026', '10:42 AM', False, False, False, 500),
    ('Valid Rs.1000', 1000, '428912345680', 'SUCCESS', 'jayarajj126-3@okicici', '14-07-2026', '10:42 AM', False, False, False, 1000),
    ('Wrong Amount', 500, '428912345681', 'SUCCESS', 'jayarajj126-3@okicici', '14-07-2026', '10:42 AM', False, False, False, 120),
    ('Wrong Receiver', 120, '428912345682', 'wrong@okicici', None, '14-07-2026', '10:42 AM', False, False, False, 120),
    ('Failed Status', 120, '428912345683', 'FAILED', 'jayarajj126-3@okicici', '14-07-2026', '10:42 AM', False, False, False, 120),
    ('Pending Status', 120, '428912345684', 'PENDING', 'jayarajj126-3@okicici', '14-07-2026', '10:42 AM', False, False, False, 120),
    ('Time Outside 1hr', 120, '428912345685', 'SUCCESS', 'jayarajj126-3@okicici', '14-07-2026', '08:30 AM', False, False, False, 120),
    ('Yesterday Date', 120, '428912345686', 'SUCCESS', 'jayarajj126-3@okicici', '13-07-2026', '10:42 AM', False, False, False, 120),
    ('Blurred', 120, '428912345687', 'SUCCESS', 'jayarajj126-3@okicici', '14-07-2026', '10:42 AM', True, False, False, 120),
    ('Edited', 120, '428912345688', 'SUCCESS', 'jayarajj126-3@okicici', '14-07-2026', '10:42 AM', False, True, False, 120),
    ('Camera Photo', 120, '428912345689', 'SUCCESS', 'jayarajj126-3@okicici', '14-07-2026', '10:42 AM', False, False, True, 120, 'MANUAL_REVIEW'),
]

pipeline = VerificationPipeline()
results = []

for row in tests:
    # Unpack: support optional 12th element (override expected)
    name, amt, utr, status, recv_upi, date_str, time_str, blurred, edited, camera, exp_amt = row[:11]
    override_expected = row[11] if len(row) > 11 else None
    rupi = recv_upi if recv_upi is not None else 'wrong@okicici'
    img = make_screenshot(amt, utr, status, rupi, date_str, time_str, blurred, edited, camera)

    r = pipeline.run(img, exp_amt, 'jayarajj126-3@okicici', 'JEYARAJ ALAG',
                     'TEST', '2026-07-14T10:00:00', utr)

    dec = r.get('decision', 'ERROR')
    conf = r.get('confidence', 0)
    reasons = r.get('reasons', [])

    if override_expected:
        expected = override_expected
    else:
        expected = 'AUTO_APPROVE'
        if name == 'Wrong Amount':
            expected = 'MANUAL_REVIEW'
        elif name == 'Wrong Receiver':
            expected = 'MANUAL_REVIEW'
        elif name in ('Failed Status', 'Pending Status', 'Edited'):
            expected = 'AUTO_REJECT'
        elif name in ('Time Outside 1hr', 'Yesterday Date', 'Blurred'):
            expected = 'MANUAL_REVIEW'

    ok = (dec == expected) or (expected == 'MANUAL_REVIEW' and dec in ('MANUAL_REVIEW', 'AUTO_REJECT'))
    status_icon = 'PASS' if ok else 'ISSUE'
    reason_str = '; '.join(str(r).replace('\u20b9', 'INR') for r in reasons[:2])
    print(f'  [{status_icon}] {name}: {dec} (conf={conf:.0f}%) expected={expected}')
    if not ok:
        print(f'         Reasons: {reason_str}')
    results.append({'name': name, 'decision': dec, 'expected': expected, 'confidence': conf, 'ok': ok})

passed = sum(1 for r in results if r['ok'])
total = len(results)
print(f'\n  Results: {passed}/{total} tests passed')
for r in results:
    if not r['ok']:
        print(f'    FAIL: {r["name"]} - got {r["decision"]}, expected {r["expected"]}')
