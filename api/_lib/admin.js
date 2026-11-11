const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const SESSION_COOKIE = 'admin_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

function getConfig() {
  const config = {
    sessionSecret: process.env.SESSION_SECRET,
    sharedAdminLogin: String(process.env.SHARED_ADMIN_LOGIN || '').trim(),
    sharedAdminPassword: process.env.SHARED_ADMIN_PASSWORD,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
  };

  if (!config.sessionSecret || !config.sharedAdminLogin || !config.sharedAdminPassword || !config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error('Missing required environment variables.');
  }

  if (String(config.supabaseServiceRoleKey).startsWith('sb_publishable_')) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY looks like a publishable key. Please set a valid service role key.');
  }

  return config;
}

function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function methodNotAllowed(res, allowedMethods) {
  res.setHeader('Allow', allowedMethods.join(', '));
  json(res, 405, { error: 'Method not allowed.' });
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return header.split(';').reduce((cookies, part) => {
    const trimmed = part.trim();
    if (!trimmed) return cookies;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) return cookies;
    const key = trimmed.slice(0, separatorIndex);
    const value = trimmed.slice(separatorIndex + 1);
    cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function signSessionValue(loginId, expiresAt, sessionSecret) {
  return crypto.createHmac('sha256', sessionSecret).update(loginId + '.' + expiresAt).digest('hex');
}

function createSessionCookie() {
  const { sessionSecret, sharedAdminLogin } = getConfig();
  const expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const signature = signSessionValue(sharedAdminLogin, expiresAt, sessionSecret);
  const rawValue = [sharedAdminLogin, String(expiresAt), signature].join('.');
  const secure = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
  const parts = [
    SESSION_COOKIE + '=' + encodeURIComponent(rawValue),
    'Path=/',
    'HttpOnly',
    'SameSite=Lax'
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function createLogoutCookie() {
  const secure = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
  const parts = [
    SESSION_COOKIE + '=',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0'
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function hasAdminSession(req) {
  try {
    const { sessionSecret, sharedAdminLogin } = getConfig();
    const cookies = parseCookies(req);
    const raw = cookies[SESSION_COOKIE];
    if (!raw) return false;

    const parts = raw.split('.');
    if (parts.length !== 3) return false;

    const [loginId, expiresAtText, signature] = parts;
    const expiresAt = Number(expiresAtText);
    if (!expiresAt || expiresAt < Date.now()) return false;
    if (loginId !== sharedAdminLogin) return false;

    const expected = signSessionValue(loginId, expiresAt, sessionSecret);
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length) return false;

    return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
  } catch (_) {
    return false;
  }
}

async function getJsonBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function requireAdminSession(req, res) {
  if (!hasAdminSession(req)) {
    json(res, 401, { error: 'Unauthorized' });
    return false;
  }
  return true;
}

async function signInAdmin() {
  const config = getConfig();
  const client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });

  return { client };
}

const DATA_OWNER_EMAIL = 'case-data-owner@example.com';

async function getDataOwnerId(client) {
  if (globalThis.__caseDataOwnerId) return globalThis.__caseDataOwnerId;

  const listed = await client.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listed.error) throw listed.error;
  const existing = (listed.data?.users || []).find((user) => user.email === DATA_OWNER_EMAIL);
  if (existing?.id) {
    globalThis.__caseDataOwnerId = existing.id;
    return existing.id;
  }

  const created = await client.auth.admin.createUser({
    email: DATA_OWNER_EMAIL,
    password: crypto.randomBytes(24).toString('base64url'),
    email_confirm: true
  });
  if (created.error || !created.data?.user?.id) {
    throw created.error || new Error('无法建立资料栏位所需的内部账号。');
  }
  globalThis.__caseDataOwnerId = created.data.user.id;
  return created.data.user.id;
}

module.exports = {
  createLogoutCookie,
  createSessionCookie,
  getConfig,
  getDataOwnerId,
  getJsonBody,
  json,
  methodNotAllowed,
  requireAdminSession,
  signInAdmin
};
