const { getJsonBody, json, methodNotAllowed, signInAdmin } = require('./_lib/admin');

function normalizeName(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function normalizeId(value) {
  return String(value || '').replace(/\s+/g, '').toUpperCase();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST']);
    return;
  }

  try {
    const body = await getJsonBody(req);
    const citizenName = String(body?.citizenName || '').trim();
    const certificateNumber = normalizeId(body?.certificateNumber);
    const recordId = String(body?.recordId || '').trim();
    const image = String(body?.image || '');
    if (!citizenName || !certificateNumber || !recordId) {
      json(res, 400, { error: '请完成签名资料。' });
      return;
    }
    if (!/^data:image\/png;base64,[a-z0-9+/=\s]+$/i.test(image) || image.length > 700000) {
      json(res, 400, { error: '签名档无法储存。' });
      return;
    }

    const { client, user } = await signInAdmin();
    const recordResult = await client
      .from('user_records')
      .select('id, profile_id')
      .eq('id', recordId)
      .eq('auth_user_id', user.id)
      .maybeSingle();
    if (recordResult.error) throw recordResult.error;
    if (!recordResult.data) {
      json(res, 404, { error: '查无资料' });
      return;
    }

    const profileResult = await client
      .from('user_profiles')
      .select('display_name, id_number')
      .eq('id', recordResult.data.profile_id)
      .eq('auth_user_id', user.id)
      .maybeSingle();
    if (profileResult.error) throw profileResult.error;
    const profile = profileResult.data;
    if (!profile || normalizeName(profile.display_name) !== normalizeName(citizenName) || normalizeId(profile.id_number) !== certificateNumber) {
      json(res, 404, { error: '查无资料' });
      return;
    }

    const updated = await client
      .from('user_records')
      .update({ interview_signature: image })
      .eq('id', recordId)
      .eq('auth_user_id', user.id);
    if (updated.error) throw updated.error;
    json(res, 200, { ok: true });
  } catch (error) {
    json(res, 500, { error: error.message || '签名储存失败。' });
  }
};
