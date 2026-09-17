const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const BUNDLED_DATA_DIR = path.join(ROOT, 'data');
const STORAGE_ROOT = process.env.STORAGE_DIR ? path.resolve(process.env.STORAGE_DIR) : ROOT;
const DATA_DIR = process.env.STORAGE_DIR ? path.join(STORAGE_ROOT, 'data') : BUNDLED_DATA_DIR;
const CONTENT_FILE = path.join(DATA_DIR, 'content.json');
const SOCIAL_FILE = path.join(DATA_DIR, 'gallery-social.json');
const REACTIONS = ['like', 'love', 'care', 'haha', 'wow', 'sad', 'angry'];
const ADMIN_TOKEN_TTL = 1000 * 60 * 60 * 12;
const commentAttempts = new Map();
const knownAdminTokens = new Map();
let writeQueue = Promise.resolve();

function sendJson(res, status, payload) {
  if (res.headersSent) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  });
  res.end(body);
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return fallback; }
}

async function atomicJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(temp, JSON.stringify(value, null, 2));
  await fsp.rename(temp, file);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Payload too large.'), { status: 413 }));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const body = await readBody(req);
  if (!body.length) return {};
  try { return JSON.parse(body.toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON body.'), { status: 400 }); }
}

function cleanText(value, max) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

function galleryKey(item) {
  return crypto.createHash('sha256')
    .update(`${cleanText(item?.title, 300)}\n${cleanText(item?.image, 1200)}`)
    .digest('hex')
    .slice(0, 24);
}

function viewerHash(viewerId) {
  return crypto.createHash('sha256')
    .update(`gallery-viewer-v1:${cleanText(viewerId, 160)}`)
    .digest('hex');
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
    .split(',')[0]
    .trim();
}

function clientLabel(req) {
  const ua = String(req.headers['user-agent'] || '');
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return 'Facebook in-app browser';
  if (/Instagram/i.test(ua)) return 'Instagram in-app browser';
  if (/iPad|Tablet/i.test(ua)) return 'Tablet browser';
  if (/Android|iPhone|Mobile/i.test(ua)) return 'Mobile browser';
  if (ua) return 'Desktop browser';
  return 'Unknown browser';
}

function canComment(req) {
  const ip = clientIp(req) || 'unknown';
  const now = Date.now();
  const entry = commentAttempts.get(ip) || { count: 0, reset: now + 10 * 60 * 1000 };
  if (now > entry.reset) {
    entry.count = 0;
    entry.reset = now + 10 * 60 * 1000;
  }
  if (entry.count >= 12) return false;
  entry.count += 1;
  commentAttempts.set(ip, entry);
  return true;
}

function emptySocial() {
  return { version: 2, photos: {}, viewers: {} };
}

function ensurePhotoStore(store, key) {
  if (!store.photos || typeof store.photos !== 'object') store.photos = {};
  if (!store.photos[key] || typeof store.photos[key] !== 'object') {
    store.photos[key] = { reactions: {}, reactionMeta: {}, comments: [] };
  }
  const photo = store.photos[key];
  if (!photo.reactions || typeof photo.reactions !== 'object') photo.reactions = {};
  if (!photo.reactionMeta || typeof photo.reactionMeta !== 'object') photo.reactionMeta = {};
  if (!Array.isArray(photo.comments)) photo.comments = [];
  for (const reaction of REACTIONS) {
    if (!Array.isArray(photo.reactions[reaction])) photo.reactions[reaction] = [];
  }
  return photo;
}

function ensureViewerStore(store) {
  if (!store.viewers || typeof store.viewers !== 'object') store.viewers = {};
  return store.viewers;
}

function nameFromComments(store, digest) {
  if (!digest || !store?.photos) return '';
  for (const photo of Object.values(store.photos)) {
    const comments = Array.isArray(photo?.comments) ? photo.comments : [];
    const match = comments.find(comment => comment?.viewerDigest === digest && cleanText(comment?.name, 80));
    if (match) return cleanText(match.name, 80);
  }
  return '';
}

function updateViewer(store, digest, suppliedName, client, now) {
  const viewers = ensureViewerStore(store);
  const previous = viewers[digest] && typeof viewers[digest] === 'object' ? viewers[digest] : {};
  const resolvedName = cleanText(suppliedName, 80) || cleanText(previous.name, 80) || nameFromComments(store, digest);
  viewers[digest] = {
    name: resolvedName,
    firstSeen: cleanText(previous.firstSeen, 60) || now,
    lastSeen: now,
    client: client || cleanText(previous.client, 80) || 'Unknown browser'
  };
  return viewers[digest];
}

function publicPhoto(photo, viewerDigest = '') {
  const counts = {};
  let total = 0;
  let viewerReaction = '';
  for (const reaction of REACTIONS) {
    const list = Array.isArray(photo?.reactions?.[reaction]) ? photo.reactions[reaction] : [];
    counts[reaction] = list.length;
    total += list.length;
    if (viewerDigest && list.includes(viewerDigest)) viewerReaction = reaction;
  }
  const comments = (Array.isArray(photo?.comments) ? photo.comments : [])
    .slice(0, 120)
    .map(c => ({
      id: cleanText(c.id, 80),
      name: cleanText(c.name, 80) || 'Visitor',
      text: cleanText(c.text, 800),
      createdAt: cleanText(c.createdAt, 60)
    }));
  return { counts, total, viewerReaction, comments, commentCount: comments.length };
}

async function galleryMap() {
  const content = await readJson(CONTENT_FILE, {});
  const gallery = Array.isArray(content.gallery) ? content.gallery : [];
  return gallery.map((item, index) => ({
    key: galleryKey(item),
    index,
    title: cleanText(item?.title, 300),
    image: cleanText(item?.image, 1200)
  }));
}

async function mutateStore(mutator) {
  const task = writeQueue.then(async () => {
    const store = await readJson(SOCIAL_FILE, emptySocial());
    if (!store || typeof store !== 'object') Object.assign(store, emptySocial());
    if (!store.version || store.version < 2) store.version = 2;
    const result = await mutator(store);
    await atomicJson(SOCIAL_FILE, store);
    return result;
  });
  writeQueue = task.catch(() => {});
  return task;
}

function requestAdminToken(req) {
  const authHeader = String(req.headers.authorization || '');
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7).trim();
  const cookies = String(req.headers.cookie || '').split(';');
  for (const part of cookies) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (key === 'resume_session') {
      try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return part.slice(index + 1).trim(); }
    }
  }
  return '';
}

function adminAuthorized(req) {
  const token = requestAdminToken(req);
  if (!token) return false;
  const expires = knownAdminTokens.get(token) || 0;
  if (expires <= Date.now()) {
    knownAdminTokens.delete(token);
    return false;
  }
  knownAdminTokens.set(token, Date.now() + ADMIN_TOKEN_TTL);
  return true;
}

function captureAdminLogin(req, res, listener) {
  const originalEnd = res.end;
  res.end = function patchedEnd(chunk, encoding, callback) {
    try {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
      const payload = JSON.parse(text || '{}');
      if (payload?.ok && typeof payload.token === 'string' && payload.token.length >= 32) {
        knownAdminTokens.set(payload.token, Date.now() + ADMIN_TOKEN_TTL);
      }
    } catch {}
    return originalEnd.call(this, chunk, encoding, callback);
  };
  return listener(req, res);
}

function forgetAdminToken(req) {
  const token = requestAdminToken(req);
  if (token) knownAdminTokens.delete(token);
}

async function handleAdminReactors(req, res) {
  if (!adminAuthorized(req)) return sendJson(res, 401, { error: 'Authentication required.' });

  const items = await galleryMap();
  const store = await readJson(SOCIAL_FILE, emptySocial());
  const reactors = [];

  for (const item of items) {
    const photo = store?.photos?.[item.key] || {};
    const reactionMeta = photo?.reactionMeta && typeof photo.reactionMeta === 'object' ? photo.reactionMeta : {};
    const viewers = store?.viewers && typeof store.viewers === 'object' ? store.viewers : {};

    for (const reaction of REACTIONS) {
      const list = Array.isArray(photo?.reactions?.[reaction]) ? photo.reactions[reaction] : [];
      for (const digest of list) {
        const perPhoto = reactionMeta[digest] && typeof reactionMeta[digest] === 'object' ? reactionMeta[digest] : {};
        const viewer = viewers[digest] && typeof viewers[digest] === 'object' ? viewers[digest] : {};
        const name = cleanText(perPhoto.name, 80) || cleanText(viewer.name, 80) || 'Anonymous visitor';
        reactors.push({
          galleryIndex: item.index,
          galleryTitle: item.title || `Gallery photo ${item.index + 1}`,
          image: item.image,
          reaction,
          name,
          identified: name !== 'Anonymous visitor',
          reactedAt: cleanText(perPhoto.reactedAt, 60) || cleanText(viewer.lastSeen, 60),
          client: cleanText(perPhoto.client, 80) || cleanText(viewer.client, 80) || 'Unknown browser',
          viewerRef: cleanText(digest, 64).slice(0, 10)
        });
      }
    }
  }

  reactors.sort((a, b) => String(b.reactedAt || '').localeCompare(String(a.reactedAt || '')));
  return sendJson(res, 200, { ok: true, reactors, total: reactors.length });
}

async function handleGalleryApi(req, res, pathname, url) {
  if (pathname === '/api/gallery-social' && req.method === 'GET') {
    const viewerId = cleanText(url.searchParams.get('viewer'), 160);
    const digest = viewerId ? viewerHash(viewerId) : '';
    const items = await galleryMap();
    const store = await readJson(SOCIAL_FILE, emptySocial());
    const photos = {};
    for (const item of items) {
      const photo = store?.photos?.[item.key] || { reactions: {}, comments: [] };
      photos[item.key] = publicPhoto(photo, digest);
    }
    return sendJson(res, 200, { reactions: REACTIONS, items, photos });
  }

  if (pathname === '/api/gallery-social/reaction' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const key = cleanText(body.galleryKey, 80);
    const viewerId = cleanText(body.viewerId, 160);
    const viewerName = cleanText(body.viewerName, 80);
    const reaction = cleanText(body.reaction, 20).toLowerCase();
    if (!viewerId) return sendJson(res, 400, { error: 'Viewer identity is required.' });
    if (reaction && !REACTIONS.includes(reaction)) return sendJson(res, 400, { error: 'Unknown reaction.' });
    const items = await galleryMap();
    if (!items.some(item => item.key === key && item.image)) return sendJson(res, 404, { error: 'Gallery photo not found.' });
    const digest = viewerHash(viewerId);
    const now = new Date().toISOString();
    const client = clientLabel(req);
    const photo = await mutateStore(store => {
      const current = ensurePhotoStore(store, key);
      const viewer = updateViewer(store, digest, viewerName, client, now);
      for (const type of REACTIONS) current.reactions[type] = current.reactions[type].filter(x => x !== digest);
      if (reaction) {
        current.reactions[reaction].push(digest);
        current.reactionMeta[digest] = {
          name: cleanText(viewer.name, 80),
          reactedAt: now,
          client
        };
      } else {
        delete current.reactionMeta[digest];
      }
      return publicPhoto(current, digest);
    });
    return sendJson(res, 200, { ok: true, photo });
  }

  if (pathname === '/api/gallery-social/comment' && req.method === 'POST') {
    if (!canComment(req)) return sendJson(res, 429, { error: 'Too many comments from this connection. Please try again later.' });
    const body = await readJsonBody(req);
    const key = cleanText(body.galleryKey, 80);
    const name = cleanText(body.name, 80);
    const comment = cleanText(body.comment, 800);
    const viewerId = cleanText(body.viewerId, 160);
    if (!name || !comment) return sendJson(res, 400, { error: 'Name and comment are required.' });
    const items = await galleryMap();
    if (!items.some(item => item.key === key && item.image)) return sendJson(res, 404, { error: 'Gallery photo not found.' });
    const digest = viewerId ? viewerHash(viewerId) : '';
    const now = new Date().toISOString();
    const client = clientLabel(req);
    const photo = await mutateStore(store => {
      const current = ensurePhotoStore(store, key);
      if (digest) updateViewer(store, digest, name, client, now);
      current.comments.unshift({
        id: crypto.randomUUID(),
        name,
        text: comment,
        createdAt: now,
        viewerDigest: digest || undefined
      });
      current.comments = current.comments.slice(0, 120);
      return publicPhoto(current, digest);
    });
    return sendJson(res, 201, { ok: true, photo });
  }

  return false;
}

const originalCreateServer = http.createServer.bind(http);
http.createServer = function patchedCreateServer(listener) {
  return originalCreateServer(async (req, res) => {
    let url;
    try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
    catch { return listener(req, res); }

    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      return captureAdminLogin(req, res, listener);
    }
    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      forgetAdminToken(req);
      return listener(req, res);
    }
    if (url.pathname === '/api/admin/gallery-reactors' && req.method === 'GET') {
      try { return await handleAdminReactors(req, res); }
      catch (err) {
        console.error('Gallery reactors admin API error:', err);
        return sendJson(res, err.status || 500, { error: 'Unable to load reactor details.' });
      }
    }

    if (!url.pathname.startsWith('/api/gallery-social')) return listener(req, res);

    try {
      const handled = await handleGalleryApi(req, res, url.pathname, url);
      if (handled === false && !res.headersSent) sendJson(res, 404, { error: 'Gallery API route not found.' });
    } catch (err) {
      console.error('Gallery social API error:', err);
      if (!res.headersSent) sendJson(res, err.status || 500, { error: err.status ? err.message : 'Gallery service error.' });
      else res.end();
    }
  });
};

require('./server.js');
