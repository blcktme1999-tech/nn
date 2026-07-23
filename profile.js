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
    const { client, user } = await signInAdmin();
    const body = await getJsonBody(req);
    const payload = {
      auth_user_id: user.id,
      display_name: body?.display_name || null,
      avatar_url: body?.avatar_url || null
    };
    const { error } = await client.from('user_profiles').upsert(payload, { onConflict: 'auth_user_id' });
    if (error) throw error;
    json(res, 200, { ok: true });
  } catch (error) {
    json(res, 500, { error: error.message || '更新基本資料失敗。' });
  }
};
