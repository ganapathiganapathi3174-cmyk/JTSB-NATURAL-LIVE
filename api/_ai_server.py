#!/usr/bin/env python
"""
Persistent AI Server V3.0 — keeps verification pipeline in memory across invocations.
Communicates via JSON-line protocol over stdin/stdout.

Protocol:
  Request:  {"action":"analyze","imagePath":"...","expected":{...},"id":"..."}
  Response: {"action":"result","id":"...",...verificationResult}

  Request:  {"action":"ping","id":"..."}
  Response: {"action":"pong","id":"..."}
"""
import sys, os, json, time, traceback
import warnings
warnings.filterwarnings('ignore')
os.environ['PYTHONIOENCODING'] = 'utf-8'

import importlib
engine_mod = importlib.import_module('_ai_engine')

from _ai_engine import VerificationPipelineV3

pipeline = None

print('[AI-SERVER] Initializing verification pipeline V3...', file=sys.stderr, flush=True)
warmup_t0 = time.time()
try:
    pipeline = VerificationPipelineV3()
    print(f'[AI-SERVER] Pipeline ready in {time.time()-warmup_t0:.1f}s', file=sys.stderr, flush=True)
except Exception as warmup_err:
    print(f'[AI-SERVER] Pipeline init failed: {warmup_err}', file=sys.stderr, flush=True)

print('[AI-SERVER] Ready for requests', file=sys.stderr, flush=True)

def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            resp = json.dumps({'action': 'error', 'message': f'Invalid JSON: {e}', 'id': 'unknown'})
            sys.stdout.write(resp + '\n')
            sys.stdout.flush()
            continue

        action = req.get('action')
        req_id = req.get('id', 'unknown')

        if action == 'ping':
            sys.stdout.write(json.dumps({'action': 'pong', 'id': req_id}) + '\n')
            sys.stdout.flush()

        elif action == 'analyze':
            proc_t0 = time.time()
            try:
                image_path = req['imagePath']
                expected = req.get('expected', {})
                sys.stderr.write(f'[AI-SERVER] Analyzing: {image_path} (id={req_id})\n')
                sys.stderr.flush()

                with open(image_path, 'rb') as f:
                    image_data = f.read()

                result = pipeline.run(
                    image_data=image_data,
                    expected_amount=expected.get('amount', 0),
                    expected_receiver_upi=expected.get('receiverUpi', 'jayarajj126-3@okicici'),
                    expected_receiver_name=expected.get('receiverName', 'JEYARAJ ALAG'),
                    order_id=expected.get('orderId', ''),
                    created_at=expected.get('date', ''),
                    user_entered_utr=expected.get('utr', ''),
                    user_entered_upi=expected.get('senderUpi', ''),
                )
                result['action'] = 'result'
                result['id'] = req_id
                result['server_duration'] = round(time.time() - proc_t0, 2)

                sys.stdout.write(json.dumps(result, default=str) + '\n')
                sys.stdout.flush()
                sys.stderr.write(f'[AI-SERVER] Done: id={req_id}, decision={result.get("decision")}, confidence={result.get("confidence")}%, duration={result.get("processing_time_ms")}ms\n')
                sys.stderr.flush()
            except Exception as e:
                err = {
                    'action': 'error', 'id': req_id,
                    'error': str(e), 'traceback': traceback.format_exc(),
                    'status': 'failed', 'reasons': [str(e)],
                    'duration': round(time.time() - proc_t0, 2),
                }
                sys.stdout.write(json.dumps(err, default=str) + '\n')
                sys.stdout.flush()
        else:
            err = {'action': 'error', 'id': req_id, 'message': f'Unknown action: {action}'}
            sys.stdout.write(json.dumps(err) + '\n')
            sys.stdout.flush()

if __name__ == '__main__':
    main()
