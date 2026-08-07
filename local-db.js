const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dbFile = path.resolve(process.env.LOCAL_DB_FILE || path.join(__dirname, 'data', 'local-db.json'));

function nowIso() {
  return new Date().toISOString();
}

function ensureState(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const legacyProfile = source.profile && typeof source.profile === 'object' ? source.profile : null;
  const profiles = Array.isArray(source.profiles) ? source.profiles : (legacyProfile ? [{
    ...legacyProfile,
    id: legacyProfile.id || 'default-profile'
  }] : []);
  const defaultProfileId = profiles[0]?.id || null;
  return {
    profile: legacyProfile,
    profiles,
    records: Array.isArray(source.records) ? source.records.map((record) => ({
      ...record,
      profile_id: record.profile_id || defaultProfileId
    })) : [],
    photos: Array.isArray(source.photos) ? source.photos : []
  };
}

function readState() {
  if (!fs.existsSync(dbFile)) {
    return ensureState(null);
  }

  try {
    const text = fs.readFileSync(dbFile, 'utf8');
    if (!text.trim()) return ensureState(null);
    return ensureState(JSON.parse(text));
  } catch (_) {
    return ensureState(null);
  }
}

function writeState(state) {
  const dir = path.dirname(dbFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(dbFile, JSON.stringify(state, null, 2), 'utf8');
}

function getData() {
  const state = readState();
  const sortedProfiles = [...state.profiles].sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)));
  const sortedRecords = [...state.records].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const recordIdSet = new Set(sortedRecords.map((item) => item.id));
  const sortedPhotos = state.photos
    .filter((item) => recordIdSet.has(item.record_id))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  return {
    profile: sortedProfiles[0] || state.profile || {},
    profiles: sortedProfiles,
    records: sortedRecords,
    photos: sortedPhotos
  };
}

function upsertProfile(payload) {
  const state = readState();
  const profileId = String(payload.id || '').trim();
  const current = profileId
    ? state.profiles.find((item) => String(item.id) === profileId) || {}
    : {};
  const createdAt = current.created_at || nowIso();
  const profile = {
    ...current,
    id: current.id || crypto.randomUUID(),
    display_name: payload.display_name || null,
    avatar_url: payload.avatar_url || null,
    issuing_place: payload.issuing_place || null,
    id_number: payload.id_number || null,
    created_at: createdAt,
    updated_at: nowIso()
  };
  const existingIndex = state.profiles.findIndex((item) => String(item.id) === String(profile.id));
  if (existingIndex >= 0) {
    state.profiles[existingIndex] = profile;
  } else {
    state.profiles.push(profile);
  }
  state.profile = state.profiles[0] || profile;
  writeState(state);
  return profile;
}

function deleteProfile(profileId) {
  const state = readState();
  const targetId = String(profileId || '').trim();
  if (!targetId) return false;

  const before = state.profiles.length;
  state.profiles = state.profiles.filter((item) => String(item.id) !== targetId);
  if (state.profiles.length === before) return false;

  const removedRecordIds = new Set(
    state.records
      .filter((record) => String(record.profile_id || '') === targetId)
      .map((record) => String(record.id || ''))
  );
  state.records = state.records.filter((record) => String(record.profile_id || '') !== targetId);
  state.photos = state.photos.filter((photo) => !removedRecordIds.has(String(photo.record_id || '')));
  state.profile = state.profiles[0] || null;
  writeState(state);
  return true;
}

function createRecord(payload) {
  const state = readState();
  const profileId = String(payload.profile_id || '').trim() || state.profiles[0]?.id || null;
  const now = nowIso();
  const record = {
    id: crypto.randomUUID(),
    profile_id: profileId,
    title: payload.title || '未命名案件',
    info_text: payload.info_text || '',
    created_at: now,
    updated_at: now
  };
  state.records.push(record);
  writeState(state);
  return record;
}

function updateRecord(recordId, payload) {
  const state = readState();
  const target = state.records.find((item) => item.id === recordId);
  if (!target) return false;

  if (payload.profile_id) target.profile_id = payload.profile_id;
  target.title = payload.title || '未命名案件';
  target.info_text = payload.info_text || '';
  target.updated_at = nowIso();
  writeState(state);
  return true;
}

function deleteRecord(recordId) {
  const state = readState();
  const before = state.records.length;
  state.records = state.records.filter((item) => item.id !== recordId);
  if (state.records.length === before) return false;

  state.photos = state.photos.filter((item) => item.record_id !== recordId);
  writeState(state);
  return true;
}

function addPhoto(payload) {
  const state = readState();
  const record = state.records.find((item) => item.id === payload.record_id);
  if (!record) {
    return { ok: false, reason: 'missing-record' };
  }

  const photo = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    record_id: payload.record_id,
    photo_url: payload.photo_url,
    caption: payload.caption || null,
    created_at: nowIso()
  };
  state.photos.push(photo);
  writeState(state);
  return { ok: true, photo };
}

module.exports = {
  dbFile,
  getData,
  upsertProfile,
  deleteProfile,
  createRecord,
  updateRecord,
  deleteRecord,
  addPhoto
};
