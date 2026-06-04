const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const META_APP_ID = process.env.META_APP_ID;
const META_APP_SECRET = process.env.META_APP_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// ── IN-MEMORY STORAGE (remplacer par DB en production) ────────────────────────
let partners = [];
let settings = {
  brand_tag: '@seakebab',
  silver:   { posts_month: 4,  reposts_month: 2, republish_month: 1, quality_min: 60 },
  gold:     { posts_month: 8,  reposts_month: 4, republish_month: 2, quality_min: 70 },
  platinum: { posts_month: 12, reposts_month: 6, republish_month: 3, quality_min: 80 },
};

// ── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'SEA•KEBAB API running', version: '1.0.0' });
});

// ── PARTNERS CRUD ─────────────────────────────────────────────────────────────
app.get('/api/partners', (req, res) => {
  res.json(partners);
});

app.post('/api/partners', (req, res) => {
  const partner = { ...req.body, id: Date.now() };
  partners.push(partner);
  res.json(partner);
});

app.put('/api/partners/:id', (req, res) => {
  const id = parseInt(req.params.id);
  partners = partners.map(p => p.id === id ? { ...p, ...req.body } : p);
  res.json(partners.find(p => p.id === id));
});

app.delete('/api/partners/:id', (req, res) => {
  const id = parseInt(req.params.id);
  partners = partners.filter(p => p.id !== id);
  res.json({ success: true });
});

// ── SETTINGS ──────────────────────────────────────────────────────────────────
app.get('/api/settings', (req, res) => {
  res.json(settings);
});

app.put('/api/settings', (req, res) => {
  settings = { ...settings, ...req.body };
  res.json(settings);
});

// ── META OAUTH ────────────────────────────────────────────────────────────────
app.get('/api/auth/instagram', (req, res) => {
  const partnerId = req.query.partnerId;
  const scope = 'instagram_basic,instagram_content_publish,pages_read_engagement,pages_show_list';
  const redirectUri = `${process.env.BACKEND_URL}/api/auth/callback`;
  const url = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${partnerId}`;
  res.redirect(url);
});

app.get('/api/auth/callback', async (req, res) => {
  const { code, state: partnerId } = req.query;
  try {
    const redirectUri = `${process.env.BACKEND_URL}/api/auth/callback`;
    const tokenRes = await axios.get(`https://graph.facebook.com/v18.0/oauth/access_token`, {
      params: {
        client_id: META_APP_ID,
        client_secret: META_APP_SECRET,
        redirect_uri: redirectUri,
        code,
      }
    });

    const accessToken = tokenRes.data.access_token;

    // Token longue durée
    const longTokenRes = await axios.get(`https://graph.facebook.com/v18.0/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: META_APP_ID,
        client_secret: META_APP_SECRET,
        fb_exchange_token: accessToken,
      }
    });

    const longToken = longTokenRes.data.access_token;

    // Sauvegarder le token dans le partenaire
    partners = partners.map(p =>
      p.id === parseInt(partnerId) ? { ...p, meta_token: longToken } : p
    );

    res.redirect(`${FRONTEND_URL}?connected=true&partner=${partnerId}`);
  } catch (err) {
    console.error('OAuth error:', err.message);
    res.redirect(`${FRONTEND_URL}?error=auth_failed`);
  }
});

// ── FETCH INSTAGRAM METRICS ───────────────────────────────────────────────────
app.get('/api/metrics/instagram/:partnerId', async (req, res) => {
  const partnerId = parseInt(req.params.partnerId);
  const partner = partners.find(p => p.id === partnerId);

  if (!partner || !partner.meta_token) {
    return res.status(400).json({ error: 'Partenaire non connecté à Instagram' });
  }

  try {
    // Récupérer les pages Facebook
    const pagesRes = await axios.get('https://graph.facebook.com/v18.0/me/accounts', {
      params: { access_token: partner.meta_token }
    });

    const pages = pagesRes.data.data;
    if (!pages || pages.length === 0) {
      return res.status(400).json({ error: 'Aucune page Facebook trouvée' });
    }

    const pageToken = pages[0].access_token;
    const pageId = pages[0].id;

    // Récupérer le compte Instagram lié
    const igRes = await axios.get(`https://graph.facebook.com/v18.0/${pageId}`, {
      params: {
        fields: 'instagram_business_account',
        access_token: pageToken
      }
    });

    const igAccountId = igRes.data.instagram_business_account?.id;
    if (!igAccountId) {
      return res.status(400).json({ error: 'Aucun compte Instagram Pro lié' });
    }

    // Récupérer les posts du mois
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const since = Math.floor(firstOfMonth.getTime() / 1000);

    const mediaRes = await axios.get(`https://graph.facebook.com/v18.0/${igAccountId}/media`, {
      params: {
        fields: 'id,caption,timestamp,like_count,comments_count',
        since,
        access_token: pageToken,
        limit: 50
      }
    });

    const posts = mediaRes.data.data || [];
    const brandTag = settings.brand_tag.toLowerCase();

    const postsWithTag = posts.filter(p =>
      p.caption && p.caption.toLowerCase().includes(brandTag)
    );

    const qualityScore = posts.length > 0
      ? Math.round(posts.reduce((sum, p) => sum + (p.like_count || 0) + (p.comments_count || 0), 0) / posts.length)
      : 0;

    const metrics = {
      posts: posts.length,
      tagged: postsWithTag.length,
      reposts: 0,
      republish: 0,
      quality: Math.min(qualityScore, 100),
    };

    // Mettre à jour les métriques du partenaire
    partners = partners.map(p =>
      p.id === partnerId ? {
        ...p,
        metrics: { ...p.metrics, Instagram: metrics }
      } : p
    );

    res.json({ success: true, metrics, posts_count: posts.length });
  } catch (err) {
    console.error('Instagram API error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── FETCH FACEBOOK METRICS ────────────────────────────────────────────────────
app.get('/api/metrics/facebook/:partnerId', async (req, res) => {
  const partnerId = parseInt(req.params.partnerId);
  const partner = partners.find(p => p.id === partnerId);

  if (!partner || !partner.meta_token) {
    return res.status(400).json({ error: 'Partenaire non connecté' });
  }

  try {
    const pagesRes = await axios.get('https://graph.facebook.com/v18.0/me/accounts', {
      params: { access_token: partner.meta_token }
    });

    const pages = pagesRes.data.data;
    if (!pages || pages.length === 0) {
      return res.status(400).json({ error: 'Aucune page Facebook trouvée' });
    }

    const pageToken = pages[0].access_token;
    const pageId = pages[0].id;

    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const since = Math.floor(firstOfMonth.getTime() / 1000);

    const postsRes = await axios.get(`https://graph.facebook.com/v18.0/${pageId}/posts`, {
      params: {
        fields: 'id,message,created_time,likes.summary(true),comments.summary(true)',
        since,
        access_token: pageToken,
        limit: 50
      }
    });

    const posts = postsRes.data.data || [];
    const brandTag = settings.brand_tag.toLowerCase();

    const postsWithTag = posts.filter(p =>
      p.message && p.message.toLowerCase().includes(brandTag)
    );

    const qualityScore = posts.length > 0
      ? Math.round(posts.reduce((sum, p) => {
          const likes = p.likes?.summary?.total_count || 0;
          const comments = p.comments?.summary?.total_count || 0;
          return sum + likes + comments;
        }, 0) / posts.length)
      : 0;

    const metrics = {
      posts: posts.length,
      tagged: postsWithTag.length,
      reposts: 0,
      republish: 0,
      quality: Math.min(qualityScore, 100),
    };

    partners = partners.map(p =>
      p.id === partnerId ? {
        ...p,
        metrics: { ...p.metrics, Facebook: metrics }
      } : p
    );

    res.json({ success: true, metrics, posts_count: posts.length });
  } catch (err) {
    console.error('Facebook API error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── SYNC ALL METRICS ──────────────────────────────────────────────────────────
app.post('/api/sync/:partnerId', async (req, res) => {
  const partnerId = parseInt(req.params.partnerId);
  const results = {};

  try {
    const igRes = await axios.get(`http://localhost:${PORT}/api/metrics/instagram/${partnerId}`);
    results.instagram = igRes.data;
  } catch (e) { results.instagram = { error: e.message }; }

  try {
    const fbRes = await axios.get(`http://localhost:${PORT}/api/metrics/facebook/${partnerId}`);
    results.facebook = fbRes.data;
  } catch (e) { results.facebook = { error: e.message }; }

  res.json(results);
});

app.listen(PORT, () => {
  console.log('SEA•KEBAB API running on port ' + PORT);
});
