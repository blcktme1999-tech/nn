const { getJsonBody, json, methodNotAllowed, requireAdminSession, signInAdmin } = require('../_lib/admin');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST']);
    return;
  }

  if (!requireAdminSession(req, res)) {
    return;
  }

  try {
    const { client } = await signInAdmin();
    const body = await getJsonBody(req);
    const photoUrl = String(body?.photo_url || '').trim();

    if (!photoUrl) {
      json(res, 400, { error: '缺少照片内容。' });
      return;
    }

    const isHttpUrl = /^https?:\/\//i.test(photoUrl);
    const isDataImage = /^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(photoUrl);
    if (!isHttpUrl && !isDataImage) {
      json(res, 400, { error: '照片格式不支持，请使用图片网址或直接上传图片。' });
      return;
    }

    const payload = {
      record_id: body?.record_id,
      photo_url: photoUrl,
      caption: body?.caption || null
    };
    const countResult = await client.from('record_photos').select('id', { count: 'exact', head: true }).eq('record_id', payload.record_id);
    if (countResult.error) throw countResult.error;
    if ((countResult.count || 0) >= 3) {
      json(res, 400, { error: '每笔案件最多上传三张附件照片。' });
      return;
    }
    const { error } = await client.from('record_photos').insert(payload);
    if (error) throw error;
    json(res, 200, { ok: true });
  } catch (error) {
    json(res, 500, { error: error.message || '新增照片失败。' });
  }
};