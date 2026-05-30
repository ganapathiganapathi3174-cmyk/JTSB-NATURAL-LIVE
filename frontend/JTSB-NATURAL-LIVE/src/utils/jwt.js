// Browser-compatible JWT utility using Web Crypto API
// Replaces jsonwebtoken for frontend-only usage

// Base64 URL encoding
function base64UrlEncode(data) {
  return btoa(String.fromCharCode(...new Uint8Array(data)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = str.length % 4;
  if (pad) {
    str += '='.repeat(4 - pad);
  }
  return new Uint8Array([...atob(str)].map(c => c.charCodeAt(0)));
}

// Simple HMAC-SHA256 signing
async function sign(payload, secret) {
  const encoder = new TextEncoder();
  
  // Create header
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerEncoded = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  
  // Encode payload
  const payloadEncoded = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  
  // Create signature
  const data = encoder.encode(`${headerEncoded}.${payloadEncoded}`);
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', key, data);
  const signatureEncoded = base64UrlEncode(signature);
  
  return `${headerEncoded}.${payloadEncoded}.${signatureEncoded}`;
}

async function verify(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    
    const [headerEncoded, payloadEncoded, signatureEncoded] = parts;
    
    // Verify signature
    const encoder = new TextEncoder();
    const data = encoder.encode(`${headerEncoded}.${payloadEncoded}`);
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    
    const signature = base64UrlDecode(signatureEncoded);
    const isValid = await crypto.subtle.verify('HMAC', key, signature, data);
    
    if (!isValid) {
      return null;
    }
    
    // Decode payload
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadEncoded)));
    
    // Check expiration
    if (payload.exp && Date.now() >= payload.exp * 1000) {
      return null;
    }
    
    return payload;
  } catch {
    return null;
  }
}

export default { sign, verify };
