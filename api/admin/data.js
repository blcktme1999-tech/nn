const { json, methodNotAllowed, requireAdminSession, signInAdmin } = require('../_lib/admin');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET']);
    return;
  }

  if (!requireAdminSession(req, res)) {
    return;
  }

  try {
    const { client, user } = await signInAdmin();
    const [profileResult, recordsResult] = await Promise.all([
      client.from('user_profiles').select('*').eq('auth_user_id', user.id).maybeSingle(),
      client.from('user_records').select('*').eq('auth_user_id', user.id).order('created_at', { ascending: false })
    ]);

    if (profileResult.error) throw profileResult.error;
    if (recordsResult.error) throw recordsResult.error;

    const records = recordsResult.data || [];
    const recordIds = records.map((record) => record.id).filter(Boolean);

    let photos = [];
    if (recordIds.length) {
      const photosResult = await client
        .from('record_photos')
        .select('*')
        .in('record_id', recordIds)
        .order('created_at', { ascending: false });

      if (photosResult.error) throw photosResult.error;
      photos = photosResult.data || [];
    }

    json(res, 200, {
      profile: profileResult.data || {},
      records,
      photos
    });
  } catch (error) {
    json(res, 500, { error: error.message || '读取后台资料失败。' });
  }
};
