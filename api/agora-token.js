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

function normalizeUid(uidInput) {
  if (uidInput === undefined || uidInput === null) return null;
  const raw = String(uidInput).trim();
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    const num = Number(raw);
    if (Number.isSafeInteger(num) && num >= 0) {
      return num;
    }
  }

  return raw;
}

function uidToAgoraNumber(uid) {
  if (typeof uid === 'number') return uid;
  const text = String(uid || '').trim();
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function resolveExpiresIn() {
  // RTC token cannot be truly permanent; use a long TTL by default.
  const defaultSeconds = 60 * 60 * 24 * 365 * 10;
  const maxSeconds = 60 * 60 * 24 * 365 * 20;
  const minSeconds = 60;

  const raw = String(process.env.AGORA_TOKEN_EXPIRES_IN || '').trim();
  if (!raw) return defaultSeconds;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return defaultSeconds;

  const value = Math.floor(parsed);
  if (value <= 0) return maxSeconds;
  if (value < minSeconds) return minSeconds;
  if (value > maxSeconds) return maxSeconds;
  return value;
}

async function buildAgoraToken(payload) {
  const { RtcTokenBuilder, RtcRole } = require('agora-token');
  const appId = String(process.env.AGORA_APP_ID || '').trim();
  const appCertificate = String(process.env.AGORA_APP_CERTIFICATE || '').trim();

  if (!appId || !appCertificate) {
    throw new Error('Agora token service is not configured.');
  }

  const now = Math.floor(Date.now() / 1000);
  const maxUnixSeconds = 2147483647 - 60;
  const expiresIn = resolveExpiresIn();
  const expiresAt = Math.min(now + expiresIn, maxUnixSeconds);
  const role = RtcRole.PUBLISHER;

  const agoraUid = uidToAgoraNumber(payload.uid);
  const token = RtcTokenBuilder.buildTokenWithUid(appId, appCertificate, payload.channel, agoraUid, role, expiresAt);

  return {
    provider: 'agora',
    token,
    appId,
    uid: agoraUid,
    expiresIn: Math.max(60, expiresAt - now),
    expiresAt
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST']);
    return;
  }

  try {
    const body = await getJsonBody(req);
    const channel = String(body?.channel || '').trim();
    const uid = normalizeUid(body?.uid);

    if (!channel) {
      json(res, 400, { error: 'Missing channel.' });
      return;
    }

    if (uid === null) {
      json(res, 400, { error: 'Missing uid.' });
      return;
    }

    const payload = {
      channel,
      uid
    };
    const result = await buildAgoraToken(payload);

    json(res, 200, result);
  } catch (error) {
    json(res, 500, { error: error.message || 'Failed to build RTC token.' });
  }
};