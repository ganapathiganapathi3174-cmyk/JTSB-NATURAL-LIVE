const https = require('https');
const crypto = require('crypto');

let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry - 60000) return cachedToken;
  const sa = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, 'base64').toString());
  const now = Math.floor(Date.now() / 1000);
  const jwt = (() => {
    const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const p = Buffer.from(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now })).toString('base64url');
    const s = crypto.createSign('RSA-SHA256').update(h + '.' + p).sign(sa.private_key, 'base64url');
    return h + '.' + p + '.' + s;
  })();
  const body = 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + encodeURIComponent(jwt);
  const resp = await new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } }, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(d); } }); });
    req.on('error', reject); req.write(body); req.end();
  });
  cachedToken = resp.access_token;
  tokenExpiry = now + (resp.expires_in || 3600);
  return cachedToken;
}

function docPath(projectId, collection, docId) {
  return 'projects/' + projectId + '/databases/(default)/documents/' + collection + '/' + docId;
}

function toFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string') fields[k] = { stringValue: v };
    else if (typeof v === 'number') fields[k] = Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    else if (v instanceof Date) fields[k] = { timestampValue: v.toISOString() };
    else if (Array.isArray(v)) fields[k] = { arrayValue: { values: v.map(item => toFields({ _: item })._) } };
    else if (typeof v === 'object') fields[k] = { mapValue: { fields: toFields(v) } };
  }
  return fields;
}

function fromFields(fields) {
  if (!fields) return null;
  const obj = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v.stringValue !== undefined) obj[k] = v.stringValue;
    else if (v.integerValue !== undefined) obj[k] = Number(v.integerValue);
    else if (v.doubleValue !== undefined) obj[k] = v.doubleValue;
    else if (v.booleanValue !== undefined) obj[k] = v.booleanValue;
    else if (v.timestampValue !== undefined) obj[k] = v.timestampValue;
    else if (v.nullValue !== undefined) obj[k] = null;
    else if (v.mapValue !== undefined) obj[k] = fromFields(v.mapValue.fields);
    else if (v.arrayValue !== undefined) obj[k] = (v.arrayValue.values || []).map(item => fromFields({ _: item })._);
  }
  return obj;
}

async function api(method, path, body) {
  const token = await getToken();
  return new Promise((resolve, reject) => {
    const opts = { hostname: 'firestore.googleapis.com', path, method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } };
    if (body) opts.headers['Content-Length'] = Buffer.byteLength(body);
    const req = https.request(opts, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d })); });
    req.on('error', reject); req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

async function getDocument(projectId, collection, docId) {
  const resp = await api('GET', '/v1/' + docPath(projectId, collection, docId));
  if (resp.status === 404) return null;
  if (resp.status !== 200) throw new Error('GET error ' + resp.status + ': ' + resp.body);
  const doc = JSON.parse(resp.body);
  return { id: docId, ...fromFields(doc.fields) };
}

async function deleteDocument(projectId, collection, docId) {
  const resp = await api('DELETE', '/v1/' + docPath(projectId, collection, docId));
  if (resp.status !== 200) throw new Error('DELETE error ' + resp.status + ': ' + resp.body);
  return true;
}

async function runQuery(projectId, collection, filters, limitVal) {
  const query = { from: [{ collectionId: collection }] };
  if (filters && filters.length) {
    query.where = { fieldFilter: filters[0] };
    for (let i = 1; i < filters.length; i++) {
      query.where = { compositeFilter: { op: 'AND', filters: [query.where, { fieldFilter: filters[i] }] } };
    }
  }
  if (limitVal) query.limit = limitVal;
  const path = '/v1/projects/' + projectId + '/databases/(default)/documents:runQuery';
  const resp = await api('POST', path, JSON.stringify({ structuredQuery: query }));
  if (resp.status !== 200) throw new Error('QUERY error ' + resp.status + ': ' + resp.body);
  const results = JSON.parse(resp.body);
  return results.filter(r => r.document).map(r => ({ id: r.document.name.split('/').pop(), ...fromFields(r.document.fields), _readTime: r.readTime }));
}

async function writeDoc(projectId, collection, docId, data) {
  const now = new Date().toISOString();
  const merged = { ...data };
  if (!merged.createdAt) merged.createdAt = now;
  const resp = await api('PATCH', '/v1/' + docPath(projectId, collection, docId), JSON.stringify({ fields: toFields(merged) }));
  if (resp.status !== 200) throw new Error('WRITE error ' + resp.status + ': ' + resp.body);
  const doc = JSON.parse(resp.body);
  return { id: docId, ...fromFields(doc.fields) };
}

async function updateDoc(projectId, collection, docId, data) {
  const fieldPaths = Object.keys(data);
  const mask = fieldPaths.map(k => encodeURIComponent(k)).join('&updateMask.fieldPaths=');
  const path = '/v1/' + docPath(projectId, collection, docId) + '?updateMask.fieldPaths=' + mask;
  const resp = await api('PATCH', path, JSON.stringify({ fields: toFields(data) }));
  if (resp.status !== 200) throw new Error('UPDATE error ' + resp.status + ': ' + resp.body);
  const doc = JSON.parse(resp.body);
  return { id: docId, ...fromFields(doc.fields) };
}

async function addDoc(projectId, collection, data) {
  const path = '/v1/projects/' + projectId + '/databases/(default)/documents/' + collection;
  const resp = await api('POST', path, JSON.stringify({ fields: toFields(data) }));
  if (resp.status !== 200) throw new Error('ADD error ' + resp.status + ': ' + resp.body);
  const doc = JSON.parse(resp.body);
  return { id: doc.name.split('/').pop(), ...fromFields(doc.fields) };
}

module.exports = {
  getDocument, deleteDocument, runQuery, writeDoc, updateDoc, addDoc,
};
