require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const OSS = require('ali-oss');
const localDb = require('./local-db');
const caseSearchHandler = require('./api/case-search');
const rtcTokenHandler = require('./api/agora-token');
const aliyunRtcTokenHandler = require('./api/aliyun-rtc-token');

const app = express();
const port = Number(process.env.PORT || 3000);
const {
  SESSION_SECRET,
  SHARED_ADMIN_LOGIN,
  SHARED_ADMIN_PASSWORD,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_ADMIN_EMAIL,
  SUPABASE_ADMIN_PASSWORD
} = process.env;

const dbMode = String(process.env.DB_MODE || 'supabase').trim().toLowerCase();
const useLocalDb = dbMode === 'local';

if (!SESSION_SECRET) {
  throw new Error('Missing required environment variables. Copy .env.example to .env and fill the values.');
}

if (!useLocalDb && (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_ADMIN_EMAIL || !SUPABASE_ADMIN_PASSWORD)) {
  throw new Error('Supabase mode requires SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_ADMIN_EMAIL / SUPABASE_ADMIN_PASSWORD.');
}

app.use(express.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 1000 * 60 * 60 * 8
  }
}));

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

async function signInAdmin() {
  if (useLocalDb) {
    return { client: null, user: { id: 'local-admin' } };
  }

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });

  const { data, error } = await client.auth.signInWithPassword({
    email: SUPABASE_ADMIN_EMAIL,
    password: SUPABASE_ADMIN_PASSWORD
  });

  if (error || !data?.user) {
    throw error || new Error('Unable to sign in admin user.');
  }

  return { client, user: data.user };
}

function requireAdminSession(req, res, next) {
  if (!req.session.adminAuthenticated) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

function parseImageDataUrl(dataUrl) {
  const raw = String(dataUrl || '').trim();
  const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\n\r]+)$/);
  if (!match) return null;
  return {
    mimeType: match[1],
    base64: match[2].replace(/[\n\r]/g, '')
  };
}

function extFromMimeType(mimeType) {
  const map = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg'
  };
  return map[String(mimeType || '').toLowerCase()] || 'jpg';
}

function sanitizeName(rawName) {
  const value = String(rawName || '').trim().toLowerCase();
  const onlyName = value.replace(/\.[a-z0-9]+$/i, '');
  const cleaned = onlyName.replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return cleaned || 'case-photo';
}

function getOssClient() {
  const region = String(process.env.ALI_OSS_REGION || '').trim();
  const bucket = String(process.env.ALI_OSS_BUCKET || '').trim();
  const accessKeyId = String(process.env.ALI_OSS_ACCESS_KEY_ID || '').trim();
  const accessKeySecret = String(process.env.ALI_OSS_ACCESS_KEY_SECRET || '').trim();

  if (!region || !bucket || !accessKeyId || !accessKeySecret) {
    return null;
  }

  return new OSS({
    region,
    bucket,
    accessKeyId,
    accessKeySecret,
    secure: true
  });
}

function buildPublicUrl(clientUrl, objectKey) {
  const base = String(process.env.ALI_OSS_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (base) {
    return base + '/' + objectKey.split('/').map((part) => encodeURIComponent(part)).join('/');
  }
  return String(clientUrl || '').trim();
}

app.post('/api/admin/login', (req, res) => {
  const { loginId, password } = req.body || {};
  if (loginId !== SHARED_ADMIN_LOGIN || password !== SHARED_ADMIN_PASSWORD) {
    res.status(401).json({ error: '账号或密码错误。' });
    return;
  }

  req.session.adminAuthenticated = true;
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get('/api/admin/session', (req, res) => {
  res.json({ authenticated: Boolean(req.session.adminAuthenticated) });
});

app.get('/api/admin/data', requireAdminSession, async (req, res) => {
  try {
    if (useLocalDb) {
      const data = localDb.getData();
      res.json(data);
      return;
    }

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

    res.json({
      profile: profileResult.data || {},
      records,
      photos
    });
  } catch (error) {
    res.status(500).json({ error: error.message || '读取后台资料失败。' });
  }
});

app.post('/api/admin/profile', requireAdminSession, async (req, res) => {
  try {
    if (useLocalDb) {
      localDb.upsertProfile({
        id: req.body?.id || null,
        display_name: req.body?.display_name || null,
        avatar_url: req.body?.avatar_url || null,
        issuing_place: req.body?.issuing_place || null,
        id_number: req.body?.id_number || null
      });
      res.json({ ok: true });
      return;
    }

    const { client, user } = await signInAdmin();
    const payload = {
      auth_user_id: user.id,
      display_name: req.body?.display_name || null,
      avatar_url: req.body?.avatar_url || null,
      issuing_place: req.body?.issuing_place || null,
      id_number: req.body?.id_number || null
    };
    const { error } = await client.from('user_profiles').upsert(payload, { onConflict: 'auth_user_id' });
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message || '更新基本资料失败。' });
  }
});

app.delete('/api/admin/profile', requireAdminSession, async (req, res) => {
  try {
    const profileId = String((req.query && req.query.id) || '').trim();
    if (!profileId) {
      res.status(400).json({ error: '缺少人员 ID。' });
      return;
    }

    if (useLocalDb) {
      const deleted = localDb.deleteProfile(profileId);
      if (!deleted) {
        res.status(404).json({ error: '人员不存在。' });
        return;
      }
      res.json({ ok: true });
      return;
    }

    res.status(400).json({ error: '当前 Supabase 结构不支持从此后台删除多个人员资料。' });
  } catch (error) {
    res.status(500).json({ error: error.message || '删除人员失败。' });
  }
});

app.post('/api/admin/records', requireAdminSession, async (req, res) => {
  try {
    if (useLocalDb) {
      localDb.createRecord({
        profile_id: req.body?.profile_id || null,
        title: req.body?.title || '未命名案件',
        info_text: req.body?.info_text || ''
      });
      res.json({ ok: true });
      return;
    }

    const { client, user } = await signInAdmin();
    const payload = {
      auth_user_id: user.id,
      title: req.body?.title || '未命名案件',
      info_text: req.body?.info_text || ''
    };
    const { error } = await client.from('user_records').insert(payload);
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message || '新增案件失败。' });
  }
});

app.patch('/api/admin/records', requireAdminSession, async (req, res) => {
  try {
    const recordId = String((req.query && req.query.id) || '').trim();
    if (!recordId) {
      res.status(400).json({ error: '缺少案件 ID。' });
      return;
    }

    if (useLocalDb) {
      const updated = localDb.updateRecord(recordId, {
        profile_id: req.body?.profile_id || null,
        title: req.body?.title || '未命名案件',
        info_text: req.body?.info_text || ''
      });
      if (!updated) {
        res.status(404).json({ error: '案件不存在。' });
        return;
      }
      res.json({ ok: true });
      return;
    }

    const { client, user } = await signInAdmin();
    const payload = {
      title: req.body?.title || '未命名案件',
      info_text: req.body?.info_text || ''
    };
    const { error } = await client.from('user_records').update(payload).eq('id', recordId).eq('auth_user_id', user.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message || '更新案件失败。' });
  }
});

app.delete('/api/admin/records', requireAdminSession, async (req, res) => {
  try {
    const recordId = String((req.query && req.query.id) || '').trim();
    if (!recordId) {
      res.status(400).json({ error: '缺少案件 ID。' });
      return;
    }

    if (useLocalDb) {
      const deleted = localDb.deleteRecord(recordId);
      if (!deleted) {
        res.status(404).json({ error: '案件不存在。' });
        return;
      }
      res.json({ ok: true });
      return;
    }

    const { client, user } = await signInAdmin();
    const { error } = await client.from('user_records').delete().eq('id', recordId).eq('auth_user_id', user.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message || '删除案件失败。' });
  }
});

app.post('/api/admin/upload-image', requireAdminSession, async (req, res) => {
  try {
    const client = getOssClient();
    if (!client) {
      res.status(500).json({ error: '缺少阿里云 OSS 配置，请先设置 ALI_OSS_REGION / ALI_OSS_BUCKET / ALI_OSS_ACCESS_KEY_ID / ALI_OSS_ACCESS_KEY_SECRET。' });
      return;
    }

    const parsed = parseImageDataUrl(req.body?.dataUrl);
    if (!parsed) {
      res.status(400).json({ error: '图片格式错误，请重新选择照片上传。' });
      return;
    }

    const ext = extFromMimeType(parsed.mimeType);
    const name = sanitizeName(String(req.body?.fileName || 'case-photo'));
    const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
    const objectKey = 'case-photos/' + datePrefix + '/' + Date.now() + '-' + name + '.' + ext;
    const imageBuffer = Buffer.from(parsed.base64, 'base64');

    const putResult = await client.put(objectKey, imageBuffer, {
      headers: {
        'Content-Type': parsed.mimeType
      }
    });

    const hostedUrl = buildPublicUrl(putResult?.url, objectKey);
    if (!hostedUrl) {
      res.status(502).json({ error: 'OSS 未返回可用网址。' });
      return;
    }

    res.json({ ok: true, url: hostedUrl });
  } catch (error) {
    res.status(500).json({ error: error.message || '图片上传失败。' });
  }
});

app.post('/api/admin/photos', requireAdminSession, async (req, res) => {
  try {
    const photoUrl = String(req.body?.photo_url || '').trim();
    if (!photoUrl) {
      res.status(400).json({ error: '缺少照片内容。' });
      return;
    }

    const isHttpUrl = /^https?:\/\//i.test(photoUrl);
    const isDataImage = /^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(photoUrl);
    if (!isHttpUrl && !isDataImage) {
      res.status(400).json({ error: '照片格式不支持，请使用图片网址或直接上传图片。' });
      return;
    }

    const payload = {
      record_id: req.body?.record_id,
      photo_url: photoUrl,
      caption: req.body?.caption || null
    };

    if (useLocalDb) {
      const result = localDb.addPhoto(payload);
      if (!result.ok) {
        res.status(400).json({ error: '案件不存在，无法新增照片。' });
        return;
      }
      res.json({ ok: true });
      return;
    }

    const { client } = await signInAdmin();
    const { error } = await client.from('record_photos').insert(payload);
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message || '新增照片失败。' });
  }
});

app.post('/api/agora-token', async (req, res) => {
  await rtcTokenHandler(req, res);
});

app.post('/api/rtc-token', async (req, res) => {
  await rtcTokenHandler(req, res);
});

app.post('/api/case-search', async (req, res) => {
  try {
    const displayName = String(req.body?.displayName || '').trim();
    const caseNumber = String(req.body?.caseNumber || '').trim();

    if (!displayName || !caseNumber) {
      res.status(400).json({ error: '请输入姓名与案件编号。' });
      return;
    }

    if (useLocalDb) {
      const data = localDb.getData();
      const profiles = Array.isArray(data.profiles) ? data.profiles : [];
      const records = Array.isArray(data.records) ? data.records : [];
      const photos = Array.isArray(data.photos) ? data.photos : [];

      const ownRecords = records.filter((record) => String(record?.title || '').trim() === caseNumber);
      if (!ownRecords.length) {
        res.status(404).json({ error: '查无符合的案件资料。' });
        return;
      }

      const matchedProfile = profiles.find((profile) => String(profile?.display_name || '').trim() === displayName);
      if (!matchedProfile) {
        res.status(404).json({ error: '姓名与案件编号不符。' });
        return;
      }

      const matchedRecords = ownRecords.filter((record) => String(record?.profile_id || '') === String(matchedProfile.id || ''));
      if (!matchedRecords.length) {
        res.status(404).json({ error: '姓名与案件编号不符。' });
        return;
      }

      const activeRecord = matchedRecords[0] || null;
      const matchedPhotos = activeRecord
        ? photos.filter((photo) => String(photo?.record_id || '') === String(activeRecord.id || ''))
        : [];

      res.json({
        profile: matchedProfile,
        records: matchedRecords,
        activeRecordId: activeRecord?.id || null,
        photos: matchedPhotos,
        messages: []
      });
      return;
    }

    await caseSearchHandler(req, res);
  } catch (error) {
    res.status(500).json({ error: error.message || '查询失败。' });
  }
});

app.post('/api/aliyun-rtc-token', async (req, res) => {
  await aliyunRtcTokenHandler(req, res);
});

app.get(['/', '/index.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'index (2).html'));
});

app.use(express.static(__dirname));

app.listen(port, () => {
  console.log('Server running on http://localhost:' + port);
});
