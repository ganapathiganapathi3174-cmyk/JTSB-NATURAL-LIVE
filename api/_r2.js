const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');

let client = null;

function getClient() {
  if (client) return client;
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    console.warn('[R2] R2 credentials not set — file storage disabled');
    return null;
  }
  client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    requestHandler: { requestTimeout: 30000 },
  });
  return client;
}

function getBucket() {
  return process.env.R2_BUCKET || 'jsree-apex-payments';
}

async function uploadFile(key, buffer, contentType = 'image/jpeg') {
  const c = getClient();
  if (!c) return { error: 'R2 not configured' };
  try {
    await c.send(new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }));
    const publicUrl = `https://${getBucket()}.${process.env.R2_PUBLIC_DOMAIN || 'r2.cloudflarestorage.com'}/${key}`;
    return { url: publicUrl, key };
  } catch (err) {
    console.error('[R2] uploadFile error:', err.message);
    return { error: 'Upload failed' };
  }
}

async function getFile(key) {
  const c = getClient();
  if (!c) return null;
  try {
    const result = await c.send(new GetObjectCommand({
      Bucket: getBucket(),
      Key: key,
    }));
    const chunks = [];
    for await (const chunk of result.Body) {
      chunks.push(chunk);
    }
    return { buffer: Buffer.concat(chunks), contentType: result.ContentType };
  } catch (err) {
    if (err.name === 'NoSuchKey') return null;
    console.error('[R2] getFile error:', err.message);
    return null;
  }
}

async function deleteFile(key) {
  const c = getClient();
  if (!c) return false;
  try {
    await c.send(new DeleteObjectCommand({
      Bucket: getBucket(),
      Key: key,
    }));
    return true;
  } catch (err) {
    console.error('[R2] deleteFile error:', err.message);
    return false;
  }
}

async function listFiles(prefix = '') {
  const c = getClient();
  if (!c) return [];
  try {
    const result = await c.send(new ListObjectsV2Command({
      Bucket: getBucket(),
      Prefix: prefix,
    }));
    return (result.Contents || []).map(item => ({
      key: item.Key,
      size: item.Size,
      lastModified: item.LastModified,
    }));
  } catch (err) {
    console.error('[R2] listFiles error:', err.message);
    return [];
  }
}

function getPublicUrl(key) {
  const bucket = getBucket();
  const domain = process.env.R2_PUBLIC_DOMAIN || `${bucket}.r2.cloudflarestorage.com`;
  return `https://${domain}/${key}`;
}

async function verifyConnection() {
  const c = getClient();
  if (!c) return false;
  try {
    await c.send(new ListObjectsV2Command({ Bucket: getBucket(), MaxKeys: 1 }));
    return true;
  } catch {
    return false;
  }
}

module.exports = { uploadFile, getFile, deleteFile, listFiles, getPublicUrl, verifyConnection };
