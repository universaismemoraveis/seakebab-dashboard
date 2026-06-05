const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const META_APP_ID = process.env.META_APP_ID;
const META_APP_SECRET = process.env.META_APP_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

let partners = [];
let settings = {
  brand_tag: '@seakebab',
  silver:   { posts_month: 4,  reposts_month: 2, republish_month: 1, quality_min: 60 },
  gold:     { posts_month: 8,  reposts_month: 4, republish_month: 2, quality_min: 70 },
  platinum: { posts_month: 12, reposts_month: 6, republish_month: 3, quality_min: 80 },
};

let users = [
  { id: 1, username: 'admin',    password: 'seakebab@2026', role: 'admin',   partnerId: null },
  { id: 2, username: 'overview', password: 'overview@2026', role: 'viewer',  partnerId: null },
];

const sessions = {};

function generateToken() { return crypto.randomBytes(32).toString('hex'); }

function createSession(user) {
  const token = generateToken();
  sessions[token] = { userId: user.id, role: user.role, partnerId: user.partnerId, expires: Date.now() + 24*60*60*1000 };
  return token;
}

function getSession(token) {
  const s = sessions[token];
  if (!s) return null;
  if (Date.now() > s.expires) { delete sessions[token]; return null; }
  return s;
}

function requireAuth(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Non autorisé' });
  const session = getSession(token);
  if (!session) return res.status(401).json({ error: 'Session expirée' });
  req.session = session;
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
    next();
  });
}

app.get('/', (req, res) => res.json({ status: 'SEA•KEBAB API running', version: '3.0.0' }));

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username && u.password === password);
  if (!user) return res.status(401).json({ error: 'Identifiants incorrects' });
  const token = createSession(user);
  res.json({ token, role: user.role, partnerId: user.partnerId, username: user.username });
});

app.post('/api/logout', (req, res) => {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (token) delete sessions[token];
  res.json({ success: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  const user = users.find(u => u.id === req.session.userId);
  res.json({ role: req.session.role, partnerId: req.session.partnerId, username: user?.username });
});

// USERS
app.get('/api/users', requireAdmin, (req, res) => {
  res.json(users.map(u => ({ id: u.id, username: u.username, role: u.role, partnerId: u.partnerId })));
});

app.post('/api/users', requireAdmin, (req, res) => {
  const { username, password, role, partnerId } = req.body;
  if (users.find(u => u.username === username)) return res.status(400).json({ error: 'Nom déjà utilisé' });
  const user = { id: Date.now(), username, password, role: role || 'viewer', partnerId: partnerId || null };
  users.push(user);
  res.json({ id: user.id, username: user.username, role: user.role, partnerId: user.partnerId });
});

app.put('/api/users/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (id === 1 && req.body.role && req.body.role !== 'admin') return res.status(400).json({ error: 'Impossible de changer le rôle de l\'admin principal' });
  const { role, partnerId, password } = req.body;
  users = users.map(u => {
    if (u.id !== id) return u;
    const updated = { ...u };
    if (role) updated.role = role;
    if (partnerId !== undefined) updated.partnerId = partnerId;
    if (password) updated.password = password;
    return updated;
  });
  const user = users.find(u => u.id === id);
  // Update active sessions
  Object.keys(sessions).forEach(token => {
    if (sessions[token].userId === id) {
      if (role) sessions[token].role = role;
      if (partnerId !== undefined) sessions[token].partnerId = partnerId;
    }
  });
  res.json({ id: user.id, username: user.username, role: user.role, partnerId: user.partnerId });
});

app.delete('/api/users/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (id === 1) return res.status(400).json({ error: 'Impossible de supprimer l\'admin principal' });
  users = users.filter(u => u.id !== id);
  res.json({ success: true });
});

// PARTNERS
app.get('/api/partners', requireAuth, (req, res) => {
  if (req.session.role === 'partner') return res.json(partners.filter(p => p.id === req.session.partnerId));
  res.json(partners);
});

app.post('/api/partners', requireAdmin, (req, res) => {
  const partner = { ...req.body, id: Date.now() };
  partners.push(partner);
  res.json(partner);
});

app.put('/api/partners/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  partners = partners.map(p => p.id === id ? { ...p, ...req.body } : p);
  res.json(partners.find(p => p.id === id));
});

app.delete('/api/partners/:id', requireAdmin, (req, res) => {
  partners = partners.filter(p => p.id !== parseInt(req.params.id));
  res.json({ success: true });
});

// SETTINGS
app.get('/api/settings', requireAuth, (req, res) => res.json(settings));
app.put('/api/settings', requireAdmin, (req, res) => { settings = { ...settings, ...req.body }; res.json(settings); });

// EXPORT CSV
app.get('/api/export/csv', requireAuth, (req, res) => {
  const PLATFORMS = ['Instagram', 'TikTok', 'Facebook'];
  let csv = 'Nom,Ville,Grade,Plateforme,Posts,Reposts,Republications,Taggés,Qualité\n';
  const visiblePartners = req.session.role === 'partner' ? partners.filter(p => p.id === req.session.partnerId) : partners;
  visiblePartners.forEach(p => {
    PLATFORMS.forEach(pl => {
      const m = p.metrics[pl];
      csv += `"${p.name}","${p.city}","${p.grade}","${pl}",${m.posts},${m.reposts},${m.republish},${m.tagged},${m.quality}\n`;
    });
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="seakebab-compliance.csv"');
  res.send('\uFEFF' + csv);
});

// META OAUTH
app.get('/api/auth/instagram', requireAuth, (req, res) => {
  const partnerId = req.query.partnerId;
  const scope = 'instagram_basic,instagram_content_publish,pages_read_engagement,pages_show_list';
  const redirectUri = process.env.BACKEND_URL + '/api/auth/callback';
  const url = 'https://www.facebook.com/v18.0/dialog/oauth?client_id=' + META_APP_ID + '&redirect_uri=' + encodeURIComponent(redirectUri) + '&scope=' + scope + '&state=' + partnerId;
  res.redirect(url);
});

app.get('/api/auth/callback', async (req, res) => {
  const { code, state: partnerId } = req.query;
  try {
    const redirectUri = process.env.BACKEND_URL + '/api/auth/callback';
    const tokenRes = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
      params: { client_id: META_APP_ID, client_secret: META_APP_SECRET, redirect_uri: redirectUri, code }
    });
    const longTokenRes = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
      params: { grant_type: 'fb_exchange_token', client_id: META_APP_ID, client_secret: META_APP_SECRET, fb_exchange_token: tokenRes.data.access_token }
    });
    partners = partners.map(p => p.id === parseInt(partnerId) ? { ...p, meta_token: longTokenRes.data.access_token } : p);
    res.redirect(FRONTEND_URL + '?connected=true&partner=' + partnerId);
  } catch (err) { res.redirect(FRONTEND_URL + '?error=auth_failed'); }
});

app.listen(PORT, () => console.log('SEA•KEBAB API v3 running on port ' + PORT));
