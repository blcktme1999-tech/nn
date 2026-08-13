const { getJsonBody, json, methodNotAllowed, requireAdminSession, signInAdmin } = require('../_lib/admin');

function parseDataUrl(dataUrl) {
  const raw = String(dataUrl || '').trim();
  const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\n\r]+)$/);
  if (!match) {
    return null;
  }

  return {
    mimeType: match[1],
    base64: match[2].replace(/[\n\r]/g, '')
  };
}

function extFromMimeType(mimeType) {
  const map = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg'
  };
  return map[String(mimeType || '').toLowerCase()] || 'jpg';
}

function sanitizeName(rawName) {
  const value = String(rawName || '').trim().toLowerCase();
  const onlyName = value.replace(/\.[a-z0-9]+$/i, '');
  const cleaned = onlyName.replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return cleaned || 'case-photo';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST']);
    return;
  }

  if (!requireAdminSession(req, res)) {
    return;
  }

  try {
    const body = await getJsonBody(req);
    const parsed = parseDataUrl(body?.dataUrl);
    if (!parsed) {
      json(res, 400, { error: '图片格式错误，请重新选择照片上传。' });
      return;
    }

    const ext = extFromMimeType(parsed.mimeType);
    const name = sanitizeName(String(body?.fileName || 'case-photo'));
    const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
    const objectKey = 'case-photos/' + datePrefix + '/' + Date.now() + '-' + name + '.' + ext;
    const imageBuffer = Buffer.from(parsed.base64, 'base64');
    const bucket = String(process.env.SUPABASE_STORAGE_BUCKET || 'case-photos').trim();
    const { client } = await signInAdmin();

    const uploadResult = await client.storage.from(bucket).upload(objectKey, imageBuffer, {
      contentType: parsed.mimeType,
      cacheControl: '3600',
      upsert: false
    });
    if (uploadResult.error) throw uploadResult.error;

    const publicResult = client.storage.from(bucket).getPublicUrl(objectKey);
    const hostedUrl = String(publicResult.data?.publicUrl || '').trim();
    if (!hostedUrl) {
      json(res, 502, { error: 'Supabase Storage 未返回可用网址。' });
      return;
    }

    json(res, 200, {
      ok: true,
      url: hostedUrl,
      mimeType: parsed.mimeType
    });
  } catch (error) {
    json(res, 500, { error: error.message || '图片上传失败。' });
  }
};