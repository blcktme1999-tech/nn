const { getDataOwnerId, getJsonBody, json, methodNotAllowed, requireAdminSession, signInAdmin } = require('../_lib/admin');

module.exports = async function handler(req, res) {
  if (!['POST', 'DELETE'].includes(req.method)) {
    methodNotAllowed(res, ['POST', 'DELETE']);
    return;
  }

  if (!requireAdminSession(req, res)) {
    return;
  }

  try {
    const { client } = await signInAdmin();
    if (req.method === 'DELETE') {
      const profileId = String((req.query && req.query.id) || '').trim();
      if (!profileId) {
        json(res, 400, { error: '缺少人员 ID。' });
        return;
      }
      const { error } = await client.from('user_profiles').delete().eq('id', profileId);
      if (error) throw error;
      json(res, 200, { ok: true });
      return;
    }

    const body = await getJsonBody(req);
    const profileId = String(body?.id || '').trim();
    const payload = {
      display_name: body?.display_name || null,
      avatar_url: body?.avatar_url || null,
      issuing_place: body?.issuing_place || null,
      id_number: body?.id_number || null,
      gender: body?.gender || null,
      birth_date: body?.birth_date || null,
      current_identity: body?.current_identity || null,
      household_registration: body?.household_registration || null
    };
    if (!profileId) payload.auth_user_id = await getDataOwnerId(client);
    const profileResult = profileId
      ? await client.from('user_profiles').update(payload).eq('id', profileId).select('*').single()
      : await client.from('user_profiles').insert(payload).select('*').single();
    const { error } = profileResult;
    if (error) throw error;
    json(res, 200, { ok: true, profile: profileResult.data });
  } catch (error) {
    json(res, 500, { error: error.message || '更新基本资料失败。' });
  }
};