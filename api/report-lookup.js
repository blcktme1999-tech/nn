const { getJsonBody, json, methodNotAllowed, signInAdmin } = require('./_lib/admin');

function normalizeName(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function normalizeId(value) {
  return String(value || '').replace(/\s+/g, '').toUpperCase();
}

function publicPhoto(photo) {
  const url = String(photo?.photo_url || '').trim();
  if (!/^https?:\/\//i.test(url) && !url.startsWith('data:image/')) return null;
  return { url, caption: String(photo?.caption || '').trim() };
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
    if (!citizenName || !certificateNumber) {
      json(res, 400, { error: '请输入姓名与证件号码。' });
      return;
    }

    const { client } = await signInAdmin();
    const profileResult = await client
      .from('user_profiles')
      .select('id, display_name, id_number');
    if (profileResult.error) throw profileResult.error;

    const nameKey = normalizeName(citizenName);
    const profiles = (profileResult.data || []).filter((profile) => {
      return normalizeName(profile.display_name) === nameKey && normalizeId(profile.id_number) === certificateNumber;
    });
    if (!profiles.length) {
      json(res, 404, { error: '查无资料' });
      return;
    }

    const profileIds = profiles.map((profile) => profile.id);
    const recordResult = await client
      .from('user_records')
      .select('id, profile_id, title, document_official, case_reason, case_unit, case_order, created_at')
      .in('profile_id', profileIds)
      .order('created_at', { ascending: false });
    if (recordResult.error) throw recordResult.error;

    const records = recordResult.data || [];
    if (!records.length) {
      json(res, 404, { error: '查无资料' });
      return;
    }

    const recordIds = records.map((record) => record.id);
    const photoResult = await client
      .from('record_photos')
      .select('record_id, photo_url, caption, created_at')
      .in('record_id', recordIds)
      .order('created_at', { ascending: true });
    if (photoResult.error) throw photoResult.error;

    const photosByRecord = {};
    (photoResult.data || []).forEach((photo) => {
      const item = publicPhoto(photo);
      if (!item) return;
      const key = photo.record_id;
      photosByRecord[key] = photosByRecord[key] || [];
      photosByRecord[key].push(item);
    });

    json(res, 200, {
      citizenName,
      cases: records.map((record) => ({
        id: record.id,
        caseNumber: String(record.title || '').trim(),
        documentOfficial: record.document_official || '',
        caseReason: record.case_reason || '',
        caseUnit: record.case_unit || '',
        caseOrder: record.case_order || '',
        photos: photosByRecord[record.id] || []
      }))
    });
  } catch (error) {
    json(res, 500, { error: error.message || '查询失败。' });
  }
};
