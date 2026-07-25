require('dotenv').config();

const express = require('express');
const session = require('express-session');
const { createClient } = require('@supabase/supabase-js');

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

if (!SESSION_SECRET || !SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_ADMIN_EMAIL || !SUPABASE_ADMIN_PASSWORD) {
  throw new Error('Missing required environment variables. Copy .env.example to .env and fill the values.');
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

app.post('/api/admin/records', requireAdminSession, async (req, res) => {
  try {
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
    const apiKey = String(process.env.IMGBB_API_KEY || '').trim();
    if (!apiKey) {
      res.status(500).json({ error: '缺少 IMGBB_API_KEY，请先在环境变量设置图床密钥。' });
      return;
    }

    const dataUrl = String(req.body?.dataUrl || '').trim();
    const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\n\r]+)$/);
    if (!match) {
      res.status(400).json({ error: '图片格式错误，请重新选择照片上传。' });
      return;
    }

    const base64 = match[2].replace(/[\n\r]/g, '');
    const fileName = String(req.body?.fileName || 'case-photo.jpg').trim().slice(0, 120);
    const params = new URLSearchParams();
    params.set('image', base64);
    params.set('name', fileName || 'case-photo.jpg');

    const response = await fetch('https://api.imgbb.com/1/upload?key=' + encodeURIComponent(apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    const rawText = await response.text();
    let data = {};
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch (_) {
      data = {};
    }

    if (!response.ok || !data?.success) {
      const message = data?.error?.message || ('图床上传失败（HTTP ' + response.status + '）');
      res.status(502).json({ error: message });
      return;
    }

    const hostedUrl = String(data?.data?.url || data?.data?.display_url || '').trim();
    if (!hostedUrl) {
      res.status(502).json({ error: '图床未返回可用网址。' });
      return;
    }

    res.json({ ok: true, url: hostedUrl });
  } catch (error) {
    res.status(500).json({ error: error.message || '图片上传失败。' });
  }
});

app.post('/api/admin/photos', requireAdminSession, async (req, res) => {
  try {
    const { client } = await signInAdmin();
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
    const { error } = await client.from('record_photos').insert(payload);
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message || '新增照片失败。' });
  }
});

app.use(express.static(__dirname));

app.listen(port, () => {
  console.log('Server running on http://localhost:' + port);
});
