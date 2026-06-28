#!/usr/bin/env python
"""
Persistent AI Server — keeps OCR models (PaddleOCR, EasyOCR, Tesseract) in memory
across invocations. Communicates via JSON-line protocol over stdin/stdout.

Protocol:
  Request:  {"action":"analyze","imagePath":"...","expected":{...},"id":"..."}
  Response: {"action":"result","id":"...",...verificationResult}

  Request:  {"action":"ping","id":"..."}
  Response: {"action":"pong","id":"..."}
"""
import sys, os, json, time, traceback, ctypes
import warnings
warnings.filterwarnings('ignore')
os.environ['PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK'] = 'True'
os.environ['PYTHONIOENCODING'] = 'utf-8'

# ── Pre-load torch DLLs to avoid 'procedure not found' error ──
_torch_lib = os.path.join(os.path.dirname(sys.executable), 'Lib', 'site-packages', 'torch', 'lib')
if os.path.isdir(_torch_lib):
    os.environ['PATH'] = _torch_lib + os.pathsep + os.environ.get('PATH', '')
    if hasattr(os, 'add_dll_directory'):
        try:
            os.add_dll_directory(_torch_lib)
        except Exception:
            pass
    # Pre-load shm.dll and its dependencies
    for _dll_name in ['shm.dll', 'c10.dll', 'torch.dll', 'torch_cpu.dll', 'torch_python.dll', 'uv.dll']:
        _dll_path = os.path.join(_torch_lib, _dll_name)
        if os.path.exists(_dll_path):
            try:
                ctypes.CDLL(_dll_path)
            except Exception:
                pass  # some may fail due to deps, that's OK

# ── Import AI engine module ──
import importlib
engine_mod = importlib.import_module('_ai_engine')

# ── Eagerly warm up OCR models ──
print('[AI-SERVER] Warming up OCR models...', file=sys.stderr, flush=True)
warmup_t0 = time.time()
try:
    _ = engine_mod.get_paddle()
    _ = engine_mod.check_tesseract()
    print(f'[AI-SERVER] Warmup complete in {time.time()-warmup_t0:.1f}s', file=sys.stderr, flush=True)
except Exception as warmup_err:
    print(f'[AI-SERVER] Warmup failed: {warmup_err}', file=sys.stderr, flush=True)
    print('[AI-SERVER] Models will load lazily on first request', file=sys.stderr, flush=True)

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
                result = engine_mod.run_ai_engine(image_path, expected)
                result['action'] = 'result'
                result['id'] = req_id
                result['server_duration'] = round(time.time() - proc_t0, 2)
                # Ensure numpy types are serializable
                from _ai_engine import NumpyEncoder
                sys.stdout.write(json.dumps(result, cls=NumpyEncoder, default=str) + '\n')
                sys.stdout.flush()
                sys.stderr.write(f'[AI-SERVER] Done: id={req_id}, status={result.get("status")}, duration={result.get("duration")}s\n')
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
