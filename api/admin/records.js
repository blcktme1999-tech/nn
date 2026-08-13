const { getJsonBody, json, methodNotAllowed, requireAdminSession, signInAdmin } = require('../_lib/admin');

module.exports = async function handler(req, res) {
  if (!['POST', 'PATCH', 'DELETE'].includes(req.method)) {
    methodNotAllowed(res, ['POST', 'PATCH', 'DELETE']);
    return;
  }

  if (!requireAdminSession(req, res)) {
    return;
  }

  try {
    const { client, user } = await signInAdmin();
    const body = req.method === 'DELETE' ? {} : await getJsonBody(req);

    if (req.method === 'POST') {
      const profileId = String(body?.profile_id || '').trim();
      if (!profileId) {
        json(res, 400, { error: '请先选择案件所属人员。' });
        return;
      }
      const ownerResult = await client.from('user_profiles').select('id').eq('id', profileId).eq('auth_user_id', user.id).maybeSingle();
      if (ownerResult.error) throw ownerResult.error;
      if (!ownerResult.data) {
        json(res, 400, { error: '案件所属人员不存在。' });
        return;
      }
      const payload = {
        auth_user_id: user.id,
        profile_id: profileId,
        title: body?.title || '未命名案件',
        info_text: body?.case_summary || body?.info_text || '',
        wanted_date: body?.wanted_date || null,
        case_category: body?.case_category || null,
        current_address: body?.current_address || null,
        filing_unit: body?.filing_unit || null,
        case_summary: body?.case_summary || null,
        notes: body?.notes || null,
        application_request: body?.application_request || null
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

    const profileId = String(body?.profile_id || '').trim();
    if (req.method === 'PATCH' && !profileId) {
      json(res, 400, { error: '请先选择案件所属人员。' });
      return;
    }
    if (req.method === 'PATCH') {
      const ownerResult = await client.from('user_profiles').select('id').eq('id', profileId).eq('auth_user_id', user.id).maybeSingle();
      if (ownerResult.error) throw ownerResult.error;
      if (!ownerResult.data) {
        json(res, 400, { error: '案件所属人员不存在。' });
        return;
      }
    }
    const payload = {
      profile_id: profileId,
      title: body?.title || '未命名案件',
      info_text: body?.case_summary || body?.info_text || '',
      wanted_date: body?.wanted_date || null,
      case_category: body?.case_category || null,
      current_address: body?.current_address || null,
      filing_unit: body?.filing_unit || null,
      case_summary: body?.case_summary || null,
      notes: body?.notes || null,
      application_request: body?.application_request || null
    };
    if (req.method === 'PATCH') {
      const { error } = await client.from('user_records').update(payload).eq('id', recordId).eq('auth_user_id', user.id);
      if (error) throw error;
      json(res, 200, { ok: true });
      return;
    }

    const { error } = await client.from('user_records').delete().eq('id', recordId).eq('auth_user_id', user.id);
    if (error) throw error;
    json(res, 200, { ok: true });
  } catch (error) {
    json(res, 500, { error: error.message || '案件资料操作失败。' });
  }
};