#!/usr/bin/env python
"""
Download Florence-2 model weights for the AI Verification Engine.
Run once: python _download_models.py
"""
import os, sys
os.environ['HF_HUB_OFFLINE'] = '0'

print('[MODELS] Downloading Florence-2 model...')
from transformers import AutoModelForCausalLM, AutoProcessor
model = AutoModelForCausalLM.from_pretrained(
    'microsoft/Florence-2-base', trust_remote_code=True, torch_dtype='auto'
)
processor = AutoProcessor.from_pretrained(
    'microsoft/Florence-2-base', trust_remote_code=True
)
print(f'[MODELS] Florence-2 downloaded: {model.__class__.__name__}')
print('[MODELS] DONE')
