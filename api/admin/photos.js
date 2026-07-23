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
    const payload = {
      record_id: body?.record_id,
      photo_url: body?.photo_url,
      caption: body?.caption || null
    };
    const { error } = await client.from('record_photos').insert(payload);
    if (error) throw error;
    json(res, 200, { ok: true });
  } catch (error) {
    json(res, 500, { error: error.message || '新增照片失敗。' });
  }
};
