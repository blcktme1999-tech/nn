const { getJsonBody, json, methodNotAllowed, requireAdminSession, signInAdmin } = require('../_lib/admin');

module.exports = async function handler(req, res) {
  if (!['POST', 'PATCH'].includes(req.method)) {
    methodNotAllowed(res, ['POST', 'PATCH']);
    return;
  }

  if (!requireAdminSession(req, res)) {
    return;
  }

  try {
    const { client, user } = await signInAdmin();
    const body = await getJsonBody(req);

    if (req.method === 'POST') {
      const payload = {
        auth_user_id: user.id,
        title: body?.title || '未命名案件',
        info_text: body?.info_text || ''
      };
      const { error } = await client.from('user_records').insert(payload);
      if (error) throw error;
      json(res, 200, { ok: true });
      return;
    }

    const recordId = String((req.query && req.query.id) || '').trim();
    if (!recordId) {
      json(res, 400, { error: '缺少案件 ID。' });
      return;
    }

    const payload = {
      title: body?.title || '未命名案件',
      info_text: body?.info_text || ''
    };
    const { error } = await client.from('user_records').update(payload).eq('id', recordId).eq('auth_user_id', user.id);
    if (error) throw error;
    json(res, 200, { ok: true });
  } catch (error) {
    json(res, 500, { error: error.message || '案件資料操作失敗。' });
  }
};
