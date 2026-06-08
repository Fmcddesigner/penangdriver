const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const JWT_SECRET = process.env.JWT_SECRET || 'tukar-jwt-secret-dalam-render';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function readUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeUsers(users) {
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function isValidUsername(username) {
  return /^[a-zA-Z0-9_-]{2,20}$/.test(username);
}

function signToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({
    ...payload,
    exp: Date.now() + TOKEN_TTL_MS
  })).toString('base64url');
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verifyToken(token) {
  try {
    const [header, body, signature] = token.split('.');
    const expected = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${header}.${body}`)
      .digest('base64url');
    if (signature !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function getAuth(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  return verifyToken(header.slice(7));
}

function requireAuth(req, res, next) {
  const auth = getAuth(req);
  if (!auth) {
    return res.status(401).json({ error: 'Sila login dahulu' });
  }
  req.auth = auth;
  next();
}

function requireAdmin(req, res, next) {
  const auth = getAuth(req);
  if (!auth || auth.role !== 'admin') {
    return res.status(403).json({ error: 'Admin sahaja' });
  }
  req.auth = auth;
  next();
}

async function createUser(username, password) {
  const users = readUsers();
  if (users[username]) {
    throw new Error('Username sudah wujud');
  }
  users[username] = {
    passwordHash: await bcrypt.hash(password, 10),
    createdAt: new Date().toISOString()
  };
  writeUsers(users);
}

async function verifyUser(username, password) {
  const users = readUsers();
  const user = users[username];
  if (!user) return false;
  return bcrypt.compare(password, user.passwordHash);
}

async function updateUserPassword(username, password) {
  const users = readUsers();
  if (!users[username]) {
    throw new Error('User tidak dijumpai');
  }
  users[username].passwordHash = await bcrypt.hash(password, 10);
  writeUsers(users);
}

function deleteUser(username) {
  const users = readUsers();
  if (!users[username]) {
    throw new Error('User tidak dijumpai');
  }
  delete users[username];
  writeUsers(users);
}

function listUsers() {
  return Object.entries(readUsers()).map(([username, data]) => ({
    username,
    createdAt: data.createdAt
  }));
}

function verifyAdminPassword(password) {
  return ADMIN_PASSWORD && password === ADMIN_PASSWORD;
}

function registerAuthRoutes(app, { authEnabled }) {
  app.get('/api/auth/status', (req, res) => {
    const auth = getAuth(req);
    res.json({
      authEnabled,
      adminConfigured: !!ADMIN_PASSWORD,
      user: auth ? { username: auth.username, role: auth.role } : null
    });
  });

  app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username dan password diperlukan' });
    }
    if (!isValidUsername(username)) {
      return res.status(400).json({ error: 'Username tidak sah' });
    }
    const ok = await verifyUser(username, password);
    if (!ok) {
      return res.status(401).json({ error: 'Username atau password salah' });
    }
    const token = signToken({ username, role: 'user' });
    res.json({ token, username, role: 'user' });
  });

  app.post('/api/auth/admin/login', (req, res) => {
    const { password } = req.body;
    if (!verifyAdminPassword(password)) {
      return res.status(401).json({ error: 'Password admin salah' });
    }
    const token = signToken({ username: 'admin', role: 'admin' });
    res.json({ token, username: 'admin', role: 'admin' });
  });

  app.get('/api/admin/users', requireAdmin, (req, res) => {
    res.json(listUsers());
  });

  app.post('/api/admin/users', requireAdmin, async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username dan password diperlukan' });
    }
    if (!isValidUsername(username)) {
      return res.status(400).json({ error: 'Username 2-20 aksara, huruf/nombor/_/- sahaja' });
    }
    if (password.length < 4) {
      return res.status(400).json({ error: 'Password minimum 4 aksara' });
    }
    try {
      await createUser(username, password);
      res.json({ success: true, username });
    } catch (err) {
      res.status(409).json({ error: err.message });
    }
  });

  app.patch('/api/admin/users/:username', requireAdmin, async (req, res) => {
    const { password } = req.body;
    if (!password || password.length < 4) {
      return res.status(400).json({ error: 'Password minimum 4 aksara' });
    }
    try {
      await updateUserPassword(req.params.username, password);
      res.json({ success: true });
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  app.delete('/api/admin/users/:username', requireAdmin, (req, res) => {
    try {
      deleteUser(req.params.username);
      res.json({ success: true });
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });
}

module.exports = {
  getAuth,
  requireAuth,
  requireAdmin,
  registerAuthRoutes,
  verifyAdminPassword,
  ADMIN_PASSWORD
};
