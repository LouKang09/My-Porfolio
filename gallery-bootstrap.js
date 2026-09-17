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
const commentAttempts = new Map();
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
  return { version: 1, photos: {} };
}

function ensurePhotoStore(store, key) {
  if (!store.photos || typeof store.photos !== 'object') store.photos = {};
  if (!store.photos[key] || typeof store.photos[key] !== 'object') {
    store.photos[key] = { reactions: {}, comments: [] };
  }
  const photo = store.photos[key];
  if (!photo.reactions || typeof photo.reactions !== 'object') photo.reactions = {};
  if (!Array.isArray(photo.comments)) photo.comments = [];
  for (const reaction of REACTIONS) {
    if (!Array.isArray(photo.reactions[reaction])) photo.reactions[reaction] = [];
  }
  return photo;
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
    const result = await mutator(store);
    await atomicJson(SOCIAL_FILE, store);
    return result;
  });
  writeQueue = task.catch(() => {});
  return task;
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
    const reaction = cleanText(body.reaction, 20).toLowerCase();
    if (!viewerId) return sendJson(res, 400, { error: 'Viewer identity is required.' });
    if (reaction && !REACTIONS.includes(reaction)) return sendJson(res, 400, { error: 'Unknown reaction.' });
    const items = await galleryMap();
    if (!items.some(item => item.key === key && item.image)) return sendJson(res, 404, { error: 'Gallery photo not found.' });
    const digest = viewerHash(viewerId);
    const photo = await mutateStore(store => {
      const current = ensurePhotoStore(store, key);
      for (const type of REACTIONS) current.reactions[type] = current.reactions[type].filter(x => x !== digest);
      if (reaction) current.reactions[reaction].push(digest);
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
    const photo = await mutateStore(store => {
      const current = ensurePhotoStore(store, key);
      current.comments.unshift({
        id: crypto.randomUUID(),
        name,
        text: comment,
        createdAt: new Date().toISOString()
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
