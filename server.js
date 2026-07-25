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
    res.status(401).json({ error: '帳號或密碼錯誤。' });
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

    res.json({
      profile: profileResult.data || {},
      records: recordsResult.data || []
    });
  } catch (error) {
    res.status(500).json({ error: error.message || '讀取後台資料失敗。' });
  }
});

app.post('/api/admin/profile', requireAdminSession, async (req, res) => {
  try {
    const { client, user } = await signInAdmin();
    const payload = {
      auth_user_id: user.id,
      display_name: req.body?.display_name || null,
      avatar_url: req.body?.avatar_url || null
    };
    const { error } = await client.from('user_profiles').upsert(payload, { onConflict: 'auth_user_id' });
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message || '更新基本資料失敗。' });
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
    res.status(500).json({ error: error.message || '新增案件失敗。' });
  }
});

app.patch('/api/admin/records/:id', requireAdminSession, async (req, res) => {
  try {
    const { client, user } = await signInAdmin();
    const payload = {
      title: req.body?.title || '未命名案件',
      info_text: req.body?.info_text || ''
    };
    const { error } = await client.from('user_records').update(payload).eq('id', req.params.id).eq('auth_user_id', user.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message || '更新案件失敗。' });
  }
});

app.post('/api/admin/photos', requireAdminSession, async (req, res) => {
  try {
    const { client } = await signInAdmin();
    const photoUrl = String(req.body?.photo_url || '').trim();
    if (!photoUrl) {
      res.status(400).json({ error: '缺少照片內容。' });
      return;
    }

    const isHttpUrl = /^https?:\/\//i.test(photoUrl);
    const isDataImage = /^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(photoUrl);
    if (!isHttpUrl && !isDataImage) {
      res.status(400).json({ error: '照片格式不支援，請使用圖片網址或直接上傳圖片。' });
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
    res.status(500).json({ error: error.message || '新增照片失敗。' });
  }
});

app.use(express.static(__dirname));

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
