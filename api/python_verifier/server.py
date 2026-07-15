import sys
import os
import json
import time
import hashlib
import traceback
from pathlib import Path
from typing import Optional, Dict, Any, List

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).parent))
from pipeline import VerificationPipeline

app = FastAPI(title='AI Payment Screenshot Verifier V3', version='3.0.0')
pipeline = None

class VerifyRequest(BaseModel):
    screenshot_url: str
    expected_amount: int
    expected_receiver_upi: str
    expected_receiver_name: str = 'JEYARAJ ALAG'
    order_id: str = ''
    created_at: str = ''
    user_entered_utr: str = ''
    user_entered_upi: str = ''

class VerifyResponse(BaseModel):
    verified: bool
    decision: str
    confidenc: float = Field(0.0, alias='confidence')
    reasons: List[str]
    extracted: Dict[str, Any]
    checks: Dict[str, bool]
    fraud: Dict[str, Any]
    processing_time_ms: int
    image_quality: Optional[Dict[str, Any]] = None
    authenticity: Optional[Dict[str, Any]] = None
    app_identified: Optional[str] = None

    class Config:
        allow_population_by_field_name = True

@app.on_event('startup')
async def startup():
    global pipeline
    try:
        pipeline = VerificationPipeline()
        print('[AI-VERIFIER] Pipeline initialized successfully')
    except Exception as e:
        print(f'[AI-VERIFIER] Pipeline init failed: {e}')
        print(traceback.format_exc())

@app.get('/health')
async def health():
    return {'status': 'ok', 'pipeline_ready': pipeline is not None, 'version': '3.0.0'}

@app.post('/verify')
async def verify_payment(req: VerifyRequest):
    t0 = time.time()
    if pipeline is None:
        raise HTTPException(503, 'Verification pipeline not initialized')

    try:
        image_data = await _fetch_image(req.screenshot_url)
    except Exception as e:
        return {
            'verified': False, 'decision': 'AUTO_REJECT', 'confidence': 0.0,
            'reasons': [f'Cannot fetch screenshot: {e}'],
            'extracted': {}, 'checks': {}, 'fraud': {'score': 100, 'flags': ['fetch_failed']},
            'image_quality': None, 'authenticity': None, 'app_identified': None,
            'processing_time_ms': int((time.time() - t0) * 1000),
        }

    result = pipeline.run(
        image_data=image_data,
        expected_amount=req.expected_amount,
        expected_receiver_upi=req.expected_receiver_upi,
        expected_receiver_name=req.expected_receiver_name,
        order_id=req.order_id,
        created_at=req.created_at,
        user_entered_utr=req.user_entered_utr,
        user_entered_upi=req.user_entered_upi,
    )
    result['processing_time_ms'] = int((time.time() - t0) * 1000)
    return result

async def _fetch_image(url: str) -> bytes:
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return resp.content

@app.get('/test-all')
async def test_all():
    """Generate test screenshots for all 3 amounts and verify them."""
    import io as _io
    from PIL import Image, ImageDraw, ImageFont

    def _make_img(amount, utr):
        img = Image.new('RGB', (1080, 1920), (255, 255, 255))
        d = ImageDraw.Draw(img)
        try:
            fb = ImageFont.truetype('arial.ttf', 72)
            fm = ImageFont.truetype('arial.ttf', 48)
            fs = ImageFont.truetype('arial.ttf', 36)
        except:
            fb = fm = fs = ImageFont.load_default()
        d.rectangle([(0,0),(1080,300)], fill=(76,175,80))
        d.text((540,100), 'Payment Successful', fill=(255,255,255), font=fb, anchor='mm')
        d.text((540,420), f'Rs.{amount}', fill=(33,33,33), font=fb, anchor='mm')
        d.rectangle([(100,500),(980,1300)], fill=(245,245,245), outline=(200,200,200))
        fields_data = [('Paid to', 'JEYARAJ ALAG.'), ('UPI ID', 'jayarajj126-3@okicici'),
                       ('UTR', utr), ('Date', '14-07-2026'), ('Time', '10:42 AM'),
                       ('Status', 'SUCCESS'), ('From', 'sahantest@okhdfcbank')]
        for i,(l,v) in enumerate(fields_data):
            y = 540 + i*100
            d.text((150,y), l, fill=(100,100,100), font=fs)
            d.text((150,y+45), v, fill=(33,33,33), font=fm)
        d.text((540,1450), 'Google Pay', fill=(66,133,244), font=fb, anchor='mm')
        d.rectangle([(400,1550),(680,1610)], fill=(66,133,244))
        d.text((540,1580), 'PAID', fill=(255,255,255), font=fs, anchor='mm')
        buf = _io.BytesIO()
        img.save(buf, format='PNG')
        return buf.getvalue()

    results = []
    for amt in [120, 500, 1000]:
        img_data = _make_img(amt, f'4289123456{amt}')
        r = pipeline.run(img_data, amt, 'jayarajj126-3@okicici', 'JEYARAJ ALAG',
                        f'TEST-{amt}', '2026-07-14T10:00:00',
                        f'4289123456{amt}', 'jayarajj126-3@okicici')
        results.append({'amount': amt, 'decision': r['decision'], 'confidence': r['confidence'],
                        'utr': r['extracted'].get('utr'), 'amount_match': r['checks'].get('amount'),
                        'time_ms': r.get('processing_time_ms', 0)})
    return {'results': results, 'all_passed': all(r['decision'] == 'AUTO_APPROVE' for r in results)}

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=5050)
