const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const BUNDLED_DATA_DIR = path.join(ROOT, 'data');
const STORAGE_ROOT = process.env.STORAGE_DIR ? path.resolve(process.env.STORAGE_DIR) : ROOT;
const DATA_DIR = process.env.STORAGE_DIR ? path.join(STORAGE_ROOT, 'data') : BUNDLED_DATA_DIR;
const UPLOAD_DIR = process.env.STORAGE_DIR ? path.join(STORAGE_ROOT, 'uploads') : path.join(ROOT, 'uploads');
const CONTENT_FILE = path.join(DATA_DIR, 'content.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const AUTH_FILE = path.join(DATA_DIR, 'admin-auth.json');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DEFAULT_USER = process.env.ADMIN_USERNAME || 'admin';
const DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
const SESSION_TTL = 1000 * 60 * 60 * 12;
const sessions = new Map();
const loginAttempts = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

function json(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), ...extraHeaders });
  res.end(body);
}
function text(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}
function sessionFor(req) {
  const authHeader = String(req.headers.authorization || '');
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const token = bearer || parseCookies(req).resume_session;
  if (!token) return null;
  const s = sessions.get(token);
  if (!s || s.expires < Date.now()) { if (token) sessions.delete(token); return null; }
  s.expires = Date.now() + SESSION_TTL;
  return { token, ...s };
}
function requireAuth(req, res) {
  const s = sessionFor(req);
  if (!s) { json(res, 401, { error: 'Authentication required.' }); return null; }
  return s;
}
function safeEqual(a, b) {
  const aa = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, record) {
  const calc = crypto.scryptSync(password, record.salt, 64).toString('hex');
  return safeEqual(calc, record.hash);
}
async function ensureStorageFiles() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
  if (DATA_DIR !== BUNDLED_DATA_DIR) {
    try { await fsp.access(CONTENT_FILE); } catch { await fsp.copyFile(path.join(BUNDLED_DATA_DIR, 'content.json'), CONTENT_FILE); }
    try { await fsp.access(MESSAGES_FILE); } catch { await fsp.writeFile(MESSAGES_FILE, '[]\n'); }
  }
}
async function ensureAuthFile() {
  try { await fsp.access(AUTH_FILE); }
  catch {
    const { salt, hash } = hashPassword(DEFAULT_PASSWORD);
    await fsp.writeFile(AUTH_FILE, JSON.stringify({ username: DEFAULT_USER, salt, hash, usingDefault: !process.env.ADMIN_PASSWORD, updatedAt: new Date().toISOString() }, null, 2));
  }
}
async function readJson(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return fallback; }
}
async function atomicJson(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(temp, JSON.stringify(value, null, 2));
  await fsp.rename(temp, file);
}
async function backupContent() {
  try {
    const dir = path.join(DATA_DIR, 'backups'); await fsp.mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fsp.copyFile(CONTENT_FILE, path.join(dir, `content-${stamp}.json`));
    const files = (await fsp.readdir(dir)).filter(x => x.startsWith('content-')).sort();
    for (const old of files.slice(0, Math.max(0, files.length - 10))) await fsp.unlink(path.join(dir, old)).catch(() => {});
  } catch {}
}
function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > limit) { reject(Object.assign(new Error('Payload too large'), { status: 413 })); req.destroy(); } else chunks.push(chunk); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJsonBody(req) {
  const body = await readBody(req);
  if (!body.length) return {};
  try { return JSON.parse(body.toString('utf8')); } catch { throw Object.assign(new Error('Invalid JSON body.'), { status: 400 }); }
}
function splitBuffer(buf, sep) {
  const parts = []; let start = 0; let idx;
  while ((idx = buf.indexOf(sep, start)) !== -1) { parts.push(buf.slice(start, idx)); start = idx + sep.length; }
  parts.push(buf.slice(start)); return parts;
}
function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!match) throw Object.assign(new Error('Missing multipart boundary.'), { status: 400 });
  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  const parts = splitBuffer(buffer, boundary);
  const files = []; const fields = {};
  for (let part of parts) {
    if (part.length < 8) continue;
    if (part.slice(0,2).toString() === '\r\n') part = part.slice(2);
    if (part.slice(-2).toString() === '\r\n') part = part.slice(0,-2);
    if (part.slice(-2).toString() === '--') part = part.slice(0,-2);
    const marker = Buffer.from('\r\n\r\n'); const h = part.indexOf(marker);
    if (h === -1) continue;
    const headersText = part.slice(0, h).toString('utf8');
    let content = part.slice(h + marker.length);
    if (content.slice(-2).toString() === '\r\n') content = content.slice(0, -2);
    const disp = /content-disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i.exec(headersText);
    if (!disp) continue;
    const name = disp[1]; const filename = disp[2];
    const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headersText);
    if (filename !== undefined) files.push({ name, filename, mime: typeMatch ? typeMatch[1].trim().toLowerCase() : 'application/octet-stream', data: content });
    else fields[name] = content.toString('utf8');
  }
  return { fields, files };
}
function sanitizeContent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('Content must be an object.'), { status: 400 });
  const allowed = ['profile','skills','experiences','projects','timeline','education','certifications','gallery'];
  const output = {};
  for (const key of allowed) if (Object.prototype.hasOwnProperty.call(input, key)) output[key] = input[key];
  return output;
}
function clientIp(req) { return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(); }
function canAttemptLogin(req) {
  const ip = clientIp(req); const now = Date.now(); const item = loginAttempts.get(ip) || { count: 0, reset: now + 10 * 60 * 1000 };
  if (now > item.reset) { item.count = 0; item.reset = now + 10 * 60 * 1000; }
  loginAttempts.set(ip, item); return item.count < 12;
}
function failLogin(req) { const ip = clientIp(req); const item = loginAttempts.get(ip) || { count:0, reset: Date.now()+600000 }; item.count++; loginAttempts.set(ip, item); }
function clearLogin(req) { loginAttempts.delete(clientIp(req)); }
function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}
async function serveFile(res, file) {
  try {
    const stat = await fsp.stat(file); if (!stat.isFile()) throw new Error('Not file');
    const ext = path.extname(file).toLowerCase(); securityHeaders(res);
    const cacheControl = ['.html', '.js', '.css', '.json'].includes(ext) ? 'no-store, no-cache, must-revalidate' : 'public, max-age=300';
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': cacheControl });
    fs.createReadStream(file).pipe(res);
  } catch { text(res, 404, 'Not found'); }
}
function resolveStatic(base, urlPath) {
  let decoded; try { decoded = decodeURIComponent(urlPath); } catch { return null; }
  const cleaned = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
  const full = path.join(base, cleaned);
  if (!full.startsWith(base)) return null;
  return full;
}

async function api(req, res, pathname) {
  if (pathname === '/api/content' && req.method === 'GET') {
    return json(res, 200, await readJson(CONTENT_FILE, {}));
  }
  if (pathname === '/api/contact' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const name = String(body.name || '').trim().slice(0,120), email = String(body.email || '').trim().slice(0,200), subject = String(body.subject || '').trim().slice(0,200), message = String(body.message || '').trim().slice(0,5000);
    if (!name || !email || !message || !email.includes('@')) return json(res, 400, { error: 'Name, valid email, and message are required.' });
    const messages = await readJson(MESSAGES_FILE, []);
    messages.unshift({ id: crypto.randomUUID(), name, email, subject, message, createdAt: new Date().toISOString(), read: false });
    await atomicJson(MESSAGES_FILE, messages.slice(0, 500));
    return json(res, 201, { ok: true, message: 'Your message was sent.' });
  }
  if (pathname === '/api/auth/status' && req.method === 'GET') {
    const session = sessionFor(req); const auth = await readJson(AUTH_FILE, {});
    return json(res, 200, { authenticated: !!session, username: session?.username || null, usingDefault: !!auth.usingDefault });
  }
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    if (!canAttemptLogin(req)) return json(res, 429, { error: 'Too many login attempts. Try again later.' });
    const body = await readJsonBody(req); const auth = await readJson(AUTH_FILE, {});
    if (!safeEqual(String(body.username || ''), String(auth.username || '')) || !verifyPassword(String(body.password || ''), auth)) { failLogin(req); return json(res, 401, { error: 'Invalid username or password.' }); }
    clearLogin(req); const token = crypto.randomBytes(32).toString('hex'); sessions.set(token, { username: auth.username, expires: Date.now() + SESSION_TTL });
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    const secure = (req.socket.encrypted || forwardedProto === 'https') ? '; Secure' : '';
    return json(res, 200, { ok: true, username: auth.username, usingDefault: !!auth.usingDefault, token }, { 'Set-Cookie': `resume_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL/1000}${secure}` });
  }
  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    const s = sessionFor(req); if (s) sessions.delete(s.token);
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'resume_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0' });
  }
  if (pathname === '/api/auth/change-password' && req.method === 'POST') {
    const session = requireAuth(req, res); if (!session) return;
    const body = await readJsonBody(req); const auth = await readJson(AUTH_FILE, {});
    if (!verifyPassword(String(body.currentPassword || ''), auth)) return json(res, 400, { error: 'Current password is incorrect.' });
    const next = String(body.newPassword || ''); if (next.length < 10) return json(res, 400, { error: 'New password must be at least 10 characters.' });
    const { salt, hash } = hashPassword(next); await atomicJson(AUTH_FILE, { username: String(body.username || auth.username).trim() || auth.username, salt, hash, usingDefault: false, updatedAt: new Date().toISOString() });
    sessions.clear(); return json(res, 200, { ok: true, message: 'Credentials updated. Please sign in again.' }, { 'Set-Cookie': 'resume_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0' });
  }
  if (pathname === '/api/admin/content' && req.method === 'GET') {
    if (!requireAuth(req, res)) return; return json(res, 200, await readJson(CONTENT_FILE, {}));
  }
  if (pathname === '/api/admin/content' && req.method === 'PUT') {
    if (!requireAuth(req, res)) return; const body = sanitizeContent(await readJsonBody(req)); await backupContent(); await atomicJson(CONTENT_FILE, body); return json(res, 200, { ok: true, savedAt: new Date().toISOString() });
  }
  if (pathname === '/api/admin/messages' && req.method === 'GET') {
    if (!requireAuth(req, res)) return; return json(res, 200, await readJson(MESSAGES_FILE, []));
  }
  if (pathname.startsWith('/api/admin/messages/') && req.method === 'PATCH') {
    if (!requireAuth(req, res)) return; const id = pathname.split('/').pop(); const body = await readJsonBody(req); const messages = await readJson(MESSAGES_FILE, []); const item = messages.find(m => m.id === id); if (!item) return json(res, 404, {error:'Message not found.'}); item.read = body.read !== false; await atomicJson(MESSAGES_FILE, messages); return json(res, 200, {ok:true});
  }
  if (pathname.startsWith('/api/admin/messages/') && req.method === 'DELETE') {
    if (!requireAuth(req, res)) return; const id = pathname.split('/').pop(); let messages = await readJson(MESSAGES_FILE, []); messages = messages.filter(m => m.id !== id); await atomicJson(MESSAGES_FILE, messages); return json(res, 200, {ok:true});
  }
  if (pathname === '/api/admin/upload' && req.method === 'POST') {
    if (!requireAuth(req, res)) return;
    const body = await readBody(req, 8 * 1024 * 1024); const { files } = parseMultipart(body, req.headers['content-type']); const file = files.find(f => f.name === 'image') || files[0];
    if (!file || !file.data.length) return json(res, 400, { error: 'Choose an image first.' });
    const extensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }; const ext = extensions[file.mime];
    if (!ext) return json(res, 400, { error: 'Only JPG, PNG, WEBP, and GIF images are allowed.' });
    const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`; await fsp.writeFile(path.join(UPLOAD_DIR, filename), file.data);
    return json(res, 201, { ok: true, url: `/uploads/${filename}` });
  }
  if (pathname === '/api/admin/upload-resume' && req.method === 'POST') {
    if (!requireAuth(req, res)) return;
    const body = await readBody(req, 12 * 1024 * 1024);
    const { files } = parseMultipart(body, req.headers['content-type']);
    const file = files.find(f => f.name === 'resume') || files[0];
    if (!file || !file.data.length) return json(res, 400, { error: 'Choose a resume file first.' });
    const extensions = {
      'application/pdf': '.pdf',
      'application/msword': '.doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx'
    };
    const ext = extensions[file.mime];
    if (!ext) return json(res, 400, { error: 'Only PDF, DOC, and DOCX resume files are allowed.' });
    const filename = `resume-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    await fsp.writeFile(path.join(UPLOAD_DIR, filename), file.data);
    const originalName = path.basename(String(file.filename || `resume${ext}`)).replace(/[\r\n]/g, '').slice(0, 180) || `resume${ext}`;
    return json(res, 201, { ok: true, url: `/uploads/${filename}`, originalName, mime: file.mime });
  }
  return json(res, 404, { error: 'API route not found.' });
}

async function handler(req, res) {
  securityHeaders(res);
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); const pathname = url.pathname;
  try {
    if (pathname === '/health' && req.method === 'GET') {
      return json(res, 200, { ok: true, service: 'resume-cms' }, { 'Cache-Control': 'no-store' });
    }
    if (pathname.startsWith('/api/')) return await api(req, res, pathname);
    if (pathname.startsWith('/uploads/')) { const f = resolveStatic(UPLOAD_DIR, pathname.slice('/uploads/'.length)); if (!f) return text(res, 400, 'Bad path'); return serveFile(res, f); }
    if (pathname === '/') return serveFile(res, path.join(PUBLIC_DIR, 'index.html'));
    const file = resolveStatic(PUBLIC_DIR, pathname); if (!file) return text(res, 400, 'Bad path'); return serveFile(res, file);
  } catch (err) {
    console.error(err); if (!res.headersSent) json(res, err.status || 500, { error: err.status ? err.message : 'Server error.' }); else res.end();
  }
}

(async () => {
  await ensureStorageFiles(); await ensureAuthFile();
  const server = http.createServer(handler); server.listen(PORT, HOST, () => {
    console.log(`Resume CMS running at http://localhost:${PORT}`);
    if (!process.env.ADMIN_PASSWORD) console.log('Initial admin login: admin / ChangeMe123!  (change it after first login)');
  });
})();
