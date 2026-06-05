const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');

const app = express();

app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'], credentials: false }));
app.options('*', cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const META_APP_ID = process.env.META_APP_ID;
const META_APP_SECRET = process.env.META_APP_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

let partners = [];
let settings = {
  brand_tag: '@seakebab',
  silver:   { posts_month:4,  reposts_month:2, republish_month:1, quality_min:60 },
  gold:     { posts_month:8,  reposts_month:4, republish_month:2, quality_min:70 },
  platinum: { posts_month:12, reposts_month:6, republish_month:3, quality_min:80 },
};

let users = [
  { id:1, username:'admin',    password:'seakebab@2026', role:'admin',   partnerId:null },
  { id:2, username:'overview', password:'overview@2026', role:'viewer',  partnerId:null },
];

const sessions = {};

function generateToken() { return crypto.randomBytes(32).toString('hex'); }
function createSession(user) {
  const token = generateToken();
  sessions[token] = { userId:user.id, role:user.role, partnerId:user.partnerId, expires:Date.now()+24*60*60*1000 };
  return token;
}
function getSession(token) {
  const s = sessions[token];
  if (!s) return null;
  if (Date.now() > s.expires) { delete sessions[token]; return null; }
  return s;
}

function requireAuth(req, res, next) {
  const token = (req.headers['authorization']||'').replace('Bearer ','');
  if (!token) return res.status(401).json({ error:'Non autorisé' });
  const session = getSession(token);
  if (!session) return res.status(401).json({ error:'Session expirée' });
  req.session = session;
  next();
}
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.session.role !== 'admin') return res.status(403).json({ error:'Accès refusé' });
    next();
  });
}

app.get('/', (req, res) => res.json({ status:'SEA•KEBAB API running', version:'2.0.0' }));

app.post('/api/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error:'Identifiants manquants' });
    const user = users.find(u => u.username === username && u.password === password);
    if (!user) return res.status(401).json({ error:'Identifiant ou mot de passe incorrect' });
    const token = createSession(user);
    res.json({ token, role:user.role, partnerId:user.partnerId, username:user.username });
  } catch(e) {
    res.status(500).json({ error:'Erreur serveur: '+e.message });
  }
});

app.post('/api/logout', (req, res) => {
  const token = (req.headers['authorization']||'').replace('Bearer ','');
  if (token) delete sessions[token];
  res.json({ success:true });
});

app.get('/api/me', requireAuth, (req, res) => {
  const user = users.find(u => u.id === req.session.userId);
  res.json({ role:req.session.role, partnerId:req.session.partnerId, username:user?.username });
});

app.get('/api/users', requireAdmin, (req, res) => {
  res.json(users.map(u => ({ id:u.id, username:u.username, role:u.role, partnerId:u.partnerId })));
});

app.post('/api/users', requireAdmin, (req, res) => {
  const { username, password, role, partnerId } = req.body;
  if (!username || !password) return res.status(400).json({ error:'Données manquantes' });
  if (users.find(u => u.username === username)) return res.status(400).json({ error:'Nom déjà utilisé' });
  const user = { id:Date.now(), username, password, role:role||'viewer', partnerId:partnerId||null };
  users.push(user);
  res.json({ id:user.id, username:user.username, role:user.role, partnerId:user.partnerId });
});

app.put('/api/users/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const { role, password, partnerId } = req.body;
  users = users.map(u => {
    if (u.id !== id) return u;
    return { ...u, role:role||u.role, password:password||u.password, partnerId:partnerId!==undefined?partnerId:u.partnerId };
  });
  const u = users.find(u => u.id === id);
  res.json({ id:u.id, username:u.username, role:u.role, partnerId:u.partnerId });
});

app.delete('/api/users/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (id === 1) return res.status(400).json({ error:'Impossible de supprimer l\'admin principal' });
  users = users.filter(u => u.id !== id);
  res.json({ success:true });
});

app.get('/api/partners', requireAuth, (req, res) => {
  if (req.session.role === 'partner') return res.json(partners.filter(p => p.id === req.session.partnerId));
  res.json(partners);
});

app.post('/api/partners', requireAdmin, (req, res) => {
  const partner = { ...req.body, id:Date.now() };
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
  res.json({ success:true });
});

app.get('/api/settings', requireAuth, (req, res) => res.json(settings));
app.put('/api/settings', requireAdmin, (req, res) => { settings = { ...settings, ...req.body }; res.json(settings); });

app.get('/api/auth/instagram', requireAuth, (req, res) => {
  const partnerId = req.query.partnerId;
  const scope = 'instagram_basic,pages_read_engagement,pages_show_list';
  const redirectUri = (process.env.BACKEND_URL||'') + '/api/auth/callback';
  const url = 'https://www.facebook.com/v18.0/dialog/oauth?client_id='+META_APP_ID+'&redirect_uri='+encodeURIComponent(redirectUri)+'&scope='+scope+'&state='+partnerId;
  res.redirect(url);
});

app.get('/api/auth/callback', async (req, res) => {
  const { code, state:partnerId } = req.query;
  try {
    const redirectUri = (process.env.BACKEND_URL||'')+'/api/auth/callback';
    const t1 = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token',{params:{client_id:META_APP_ID,client_secret:META_APP_SECRET,redirect_uri:redirectUri,code}});
    const t2 = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token',{params:{grant_type:'fb_exchange_token',client_id:META_APP_ID,client_secret:META_APP_SECRET,fb_exchange_token:t1.data.access_token}});
    partners = partners.map(p => p.id===parseInt(partnerId)?{...p,meta_token:t2.data.access_token}:p);
    res.redirect(FRONTEND_URL+'?connected=true&partner='+partnerId);
  } catch(e) { res.redirect(FRONTEND_URL+'?error=auth_failed'); }
});

app.listen(PORT, () => console.log('SEA•KEBAB API v2 running on port '+PORT));
