const { getJsonBody, json, methodNotAllowed, signInAdmin } = require('./_lib/admin');

const MAX_TEXT_LENGTH = 280;
const MAX_MESSAGES_PER_CHANNEL = 200;
const MESSAGE_TTL_MS = 2 * 60 * 60 * 1000;

function getMemoryStore() {
  if (!globalThis.__videoChatStore) {
    globalThis.__videoChatStore = new Map();
  }
  return globalThis.__videoChatStore;
}

function isValidChannel(value) {
  return /^[A-Za-z0-9_-]{1,64}$/.test(String(value || '').trim());
}

function normalizeSender(value) {
  const sender = String(value || '').trim();
  return sender.slice(0, 80) || '访客';
}

function normalizeText(value) {
  return String(value || '').trim().slice(0, MAX_TEXT_LENGTH);
}

function mapDbMessage(row) {
  return {
    id: String(row.id),
    channel: row.channel,
    sender: row.sender,
    text: row.message,
    at: row.created_at
  };
}

function cleanupMemoryChannel(channel) {
  const store = getMemoryStore();
  const cutoff = Date.now() - MESSAGE_TTL_MS;
  const messages = (store.get(channel) || []).filter((message) => {
    const time = new Date(message.at).getTime();
    return Number.isFinite(time) && time >= cutoff;
  }).slice(-MAX_MESSAGES_PER_CHANNEL);
  store.set(channel, messages);
  return messages;
}

function readMemoryMessages(channel, afterId) {
  const messages = cleanupMemoryChannel(channel);
  if (!afterId) return messages;
  const afterNumber = Number(afterId);
  if (!Number.isFinite(afterNumber)) return messages;
  return messages.filter((message) => Number(message.id) > afterNumber);
}

function writeMemoryMessage(channel, sender, text) {
  const messages = cleanupMemoryChannel(channel);
  const nextId = messages.length ? Number(messages[messages.length - 1].id) + 1 : Date.now();
  const message = {
    id: String(nextId),
    channel,
    sender,
    text,
    at: new Date().toISOString()
  };
  messages.push(message);
  getMemoryStore().set(channel, messages.slice(-MAX_MESSAGES_PER_CHANNEL));
  return message;
}

async function getDbClient() {
  try {
    const { client } = await signInAdmin();
    return client;
  } catch (error) {
    console.warn('video chat db unavailable:', error.message || error);
    return null;
  }
}

async function readMessages(channel, afterId) {
  const client = await getDbClient();
  if (!client) return readMemoryMessages(channel, afterId);

  try {
    let query = client
      .from('video_chat_messages')
      .select('id, channel, sender, message, created_at')
      .eq('channel', channel)
      .order('id', { ascending: true })
      .limit(100);

    if (afterId) {
      query = query.gt('id', afterId);
    }

    const result = await query;
    if (result.error) throw result.error;
    return (result.data || []).map(mapDbMessage);
  } catch (error) {
    console.warn('video chat db read failed:', error.message || error);
    return readMemoryMessages(channel, afterId);
  }
}

async function writeMessage(channel, sender, text) {
  const client = await getDbClient();
  if (!client) return writeMemoryMessage(channel, sender, text);

  try {
    const result = await client
      .from('video_chat_messages')
      .insert({ channel, sender, message: text })
      .select('id, channel, sender, message, created_at')
      .single();

    if (result.error) throw result.error;
    return mapDbMessage(result.data);
  } catch (error) {
    console.warn('video chat db write failed:', error.message || error);
    return writeMemoryMessage(channel, sender, text);
  }
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const channel = String(req.query.channel || '').trim();
    const afterId = String(req.query.after || '').trim();

    if (!isValidChannel(channel)) {
      json(res, 400, { error: '频道名称格式无效。' });
      return;
    }

    const messages = await readMessages(channel, afterId);
    json(res, 200, { messages });
    return;
  }

  if (req.method === 'POST') {
    const body = await getJsonBody(req);
    const channel = String(body.channel || '').trim();
    const sender = normalizeSender(body.sender);
    const text = normalizeText(body.text);

    if (!isValidChannel(channel)) {
      json(res, 400, { error: '频道名称格式无效。' });
      return;
    }
    if (!text) {
      json(res, 400, { error: '消息不能为空。' });
      return;
    }

    const message = await writeMessage(channel, sender, text);
    json(res, 200, { message });
    return;
  }

  methodNotAllowed(res, ['GET', 'POST']);
};
