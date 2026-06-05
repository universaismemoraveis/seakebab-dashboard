const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
app.use(cors({ origin:'*', methods:['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders:['Content-Type','Authorization'], credentials:false }));
app.options('*', cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const META_APP_ID = process.env.META_APP_ID;
const META_APP_SECRET = process.env.META_APP_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// ── DEMO PARTNERS (chargés au démarrage, persistent en mémoire) ───────────────
let partners = [
  { id:1,  name:'Le Bosphore',        city:'Paris 11e',     grade:'platinum', avatar:'LB', joined:'2024-01', accounts:{Instagram:'@lebosphore_paris',TikTok:'@lebosphore',Facebook:'Le Bosphore Paris'},      metrics:{Instagram:{posts:11,reposts:6,republish:3,tagged:10,quality:84},TikTok:{posts:9,reposts:5,republish:2,tagged:9,quality:78},Facebook:{posts:12,reposts:7,republish:3,tagged:12,quality:88}} },
  { id:2,  name:'Topkapi Kebab',       city:'Strasbourg',    grade:'platinum', avatar:'TK', joined:'2023-09', accounts:{Instagram:'@topkapi_stras',TikTok:'@topkapi',Facebook:'Topkapi Kebab Strasbourg'},      metrics:{Instagram:{posts:13,reposts:7,republish:3,tagged:12,quality:91},TikTok:{posts:10,reposts:6,republish:3,tagged:9,quality:86},Facebook:{posts:12,reposts:6,republish:3,tagged:11,quality:88}} },
  { id:3,  name:'Gaziantep Express',   city:'Toulouse',      grade:'platinum', avatar:'GE', joined:'2023-11', accounts:{Instagram:'@gaziantep_tlse',TikTok:'@gaziantepexpress',Facebook:'Gaziantep Express'},    metrics:{Instagram:{posts:12,reposts:6,republish:3,tagged:11,quality:89},TikTok:{posts:11,reposts:6,republish:3,tagged:10,quality:84},Facebook:{posts:13,reposts:7,republish:3,tagged:12,quality:91}} },
  { id:4,  name:'Sultane Grillhouse',  city:'Lyon 6e',       grade:'gold',     avatar:'SG', joined:'2024-03', accounts:{Instagram:'@sultane_grill',TikTok:'@sultanegrill',Facebook:'Sultane Grillhouse Lyon'},   metrics:{Instagram:{posts:8,reposts:3,republish:2,tagged:7,quality:72},TikTok:{posts:5,reposts:2,republish:1,tagged:5,quality:65},Facebook:{posts:7,reposts:4,republish:2,tagged:7,quality:74}} },
  { id:5,  name:'Mardin Grill',        city:'Nantes',        grade:'gold',     avatar:'MG', joined:'2024-05', accounts:{Instagram:'@mardingrill',TikTok:'@mardingrill',Facebook:'Mardin Grill Nantes'},          metrics:{Instagram:{posts:9,reposts:4,republish:2,tagged:8,quality:79},TikTok:{posts:7,reposts:3,republish:2,tagged:6,quality:73},Facebook:{posts:8,reposts:4,republish:2,tagged:7,quality:77}} },
  { id:6,  name:'Istanbul Delice',     city:'Montpellier',   grade:'gold',     avatar:'ID', joined:'2024-01', accounts:{Instagram:'@istanbuldelice',TikTok:'@istanbuldelice',Facebook:'Istanbul Delice Montpellier'}, metrics:{Instagram:{posts:8,reposts:4,republish:2,tagged:7,quality:76},TikTok:{posts:7,reposts:3,republish:2,tagged:6,quality:71},Facebook:{posts:9,reposts:4,republish:2,tagged:8,quality:78}} },
  { id:7,  name:'Le Comptoir Goya',    city:'Paris 9e',      grade:'gold',     avatar:'CG', joined:'2024-02', accounts:{Instagram:'@comptoirgoya',TikTok:'@comptoirgoya',Facebook:'Le Comptoir Goya'},            metrics:{Instagram:{posts:7,reposts:3,republish:2,tagged:6,quality:74},TikTok:{posts:6,reposts:3,republish:1,tagged:5,quality:70},Facebook:{posts:8,reposts:4,republish:2,tagged:7,quality:76}} },
  { id:8,  name:'Anatolie Express',    city:'Marseille 5e',  grade:'silver',   avatar:'AE', joined:'2024-06', accounts:{Instagram:'@anatolie_mrs',TikTok:'',Facebook:'Anatolie Express Marseille'},               metrics:{Instagram:{posts:3,reposts:1,republish:0,tagged:2,quality:55},TikTok:{posts:2,reposts:1,republish:0,tagged:2,quality:50},Facebook:{posts:4,reposts:2,republish:1,tagged:4,quality:62}} },
  { id:9,  name:'Kebab Palace',        city:'Nice',          grade:'silver',   avatar:'KP', joined:'2025-03', accounts:{Instagram:'@kebabpalace_nice',TikTok:'',Facebook:''},                                      metrics:{Instagram:{posts:4,reposts:2,republish:1,tagged:3,quality:63},TikTok:{posts:2,reposts:1,republish:0,tagged:2,quality:55},Facebook:{posts:3,reposts:1,republish:0,tagged:2,quality:58}} },
  { id:10, name:'Ankara Fast',         city:'Grenoble',      grade:'silver',   avatar:'AF', joined:'2025-04', accounts:{Instagram:'@ankarafast',TikTok:'',Facebook:'Ankara Fast Grenoble'},                        metrics:{Instagram:{posts:2,reposts:1,republish:0,tagged:1,quality:48},TikTok:{posts:1,reposts:0,republish:0,tagged:1,quality:42},Facebook:{posts:3,reposts:1,republish:0,tagged:2,quality:55}} },
];

let settings = {
  brand_tag:'@seakebab',
  silver:   {posts_month:4,  reposts_month:2, republish_month:1, quality_min:60},
  gold:     {posts_month:8,  reposts_month:4, republish_month:2, quality_min:70},
  platinum: {posts_month:12, reposts_month:6, republish_month:3, quality_min:80},
};

// ── UTILISATEURS (admin + viewer + 1 compte par partenaire) ───────────────────
let users = [
  {id:1,  username:'admin',       password:'seakebab@2026', role:'admin',   partnerId:null},
  {id:2,  username:'overview',    password:'overview@2026', role:'viewer',  partnerId:null},
  {id:3,  username:'bosphore',    password:'bosphore1',     role:'partner', partnerId:1},
  {id:4,  username:'topkapi',     password:'topkapi1',      role:'partner', partnerId:2},
  {id:5,  username:'gaziantep',   password:'gaziantep1',    role:'partner', partnerId:3},
  {id:6,  username:'sultane',     password:'sultane1',      role:'partner', partnerId:4},
  {id:7,  username:'mardin',      password:'mardin1',       role:'partner', partnerId:5},
  {id:8,  username:'istanbul',    password:'istanbul1',     role:'partner', partnerId:6},
  {id:9,  username:'goya',        password:'goya1',         role:'partner', partnerId:7},
  {id:10, username:'anatolie',    password:'anatolie1',     role:'partner', partnerId:8},
  {id:11, username:'kebabpalace', password:'kebabpalace1',  role:'partner', partnerId:9},
  {id:12, username:'ankara',      password:'ankara1',       role:'partner', partnerId:10},
];

const sessions = {};
function generateToken(){return crypto.randomBytes(32).toString('hex');}
function createSession(user){const t=generateToken();sessions[t]={userId:user.id,role:user.role,partnerId:user.partnerId,expires:Date.now()+24*60*60*1000};return t;}
function getSession(token){const s=sessions[token];if(!s)return null;if(Date.now()>s.expires){delete sessions[token];return null;}return s;}

function requireAuth(req,res,next){
  const token=(req.headers['authorization']||'').replace('Bearer ','');
  if(!token)return res.status(401).json({error:'Non autorisé'});
  const s=getSession(token);if(!s)return res.status(401).json({error:'Session expirée'});
  req.session=s;next();
}
function requireAdmin(req,res,next){
  requireAuth(req,res,()=>{if(req.session.role!=='admin')return res.status(403).json({error:'Accès refusé'});next();});
}

app.get('/',(req,res)=>res.json({status:'SEA•KEBAB API running',version:'2.1.0',partners:partners.length}));

app.post('/api/login',(req,res)=>{
  try{
    const{username,password}=req.body;
    if(!username||!password)return res.status(400).json({error:'Identifiants manquants'});
    const user=users.find(u=>u.username===username&&u.password===password);
    if(!user)return res.status(401).json({error:'Identifiant ou mot de passe incorrect'});
    const token=createSession(user);
    res.json({token,role:user.role,partnerId:user.partnerId,username:user.username});
  }catch(e){res.status(500).json({error:'Erreur serveur'});}
});

app.post('/api/logout',(req,res)=>{const t=(req.headers['authorization']||'').replace('Bearer ','');if(t)delete sessions[t];res.json({success:true});});
app.get('/api/me',requireAuth,(req,res)=>{const u=users.find(u=>u.id===req.session.userId);res.json({role:req.session.role,partnerId:req.session.partnerId,username:u?.username});});

app.get('/api/users',requireAdmin,(req,res)=>res.json(users.map(u=>({id:u.id,username:u.username,role:u.role,partnerId:u.partnerId}))));

app.post('/api/users',requireAdmin,(req,res)=>{
  const{username,password,role,partnerId}=req.body;
  if(!username||!password)return res.status(400).json({error:'Données manquantes'});
  if(users.find(u=>u.username===username))return res.status(400).json({error:'Identifiant déjà utilisé'});
  const user={id:Date.now(),username,password,role:role||'viewer',partnerId:partnerId||null};
  users.push(user);
  res.json({id:user.id,username:user.username,role:user.role,partnerId:user.partnerId});
});

app.put('/api/users/:id',requireAdmin,(req,res)=>{
  const id=parseInt(req.params.id);const{role,password,partnerId}=req.body;
  users=users.map(u=>{if(u.id!==id)return u;return{...u,role:role||u.role,password:password||u.password,partnerId:partnerId!==undefined?partnerId:u.partnerId};});
  const u=users.find(u=>u.id===id);
  res.json({id:u.id,username:u.username,role:u.role,partnerId:u.partnerId});
});

app.delete('/api/users/:id',requireAdmin,(req,res)=>{
  const id=parseInt(req.params.id);
  if(id===1)return res.status(400).json({error:'Impossible de supprimer le compte admin principal'});
  users=users.filter(u=>u.id!==id);res.json({success:true});
});

app.get('/api/partners',requireAuth,(req,res)=>{
  if(req.session.role==='partner')return res.json(partners.filter(p=>p.id===req.session.partnerId));
  res.json(partners);
});
app.post('/api/partners',requireAdmin,(req,res)=>{const p={...req.body,id:Date.now()};partners.push(p);res.json(p);});
app.put('/api/partners/:id',requireAdmin,(req,res)=>{const id=parseInt(req.params.id);partners=partners.map(p=>p.id===id?{...p,...req.body}:p);res.json(partners.find(p=>p.id===id));});
app.delete('/api/partners/:id',requireAdmin,(req,res)=>{partners=partners.filter(p=>p.id!==parseInt(req.params.id));res.json({success:true});});

app.get('/api/settings',requireAuth,(req,res)=>res.json(settings));
app.put('/api/settings',requireAdmin,(req,res)=>{settings={...settings,...req.body};res.json(settings);});

app.get('/api/auth/instagram',requireAuth,(req,res)=>{
  const partnerId=req.query.partnerId;
  const scope='instagram_basic,pages_read_engagement,pages_show_list';
  const redirectUri=(process.env.BACKEND_URL||'')+'/api/auth/callback';
  res.redirect('https://www.facebook.com/v18.0/dialog/oauth?client_id='+META_APP_ID+'&redirect_uri='+encodeURIComponent(redirectUri)+'&scope='+scope+'&state='+partnerId);
});

app.get('/api/auth/callback',async(req,res)=>{
  const{code,state:partnerId}=req.query;
  try{
    const redirectUri=(process.env.BACKEND_URL||'')+'/api/auth/callback';
    const t1=await axios.get('https://graph.facebook.com/v18.0/oauth/access_token',{params:{client_id:META_APP_ID,client_secret:META_APP_SECRET,redirect_uri:redirectUri,code}});
    const t2=await axios.get('https://graph.facebook.com/v18.0/oauth/access_token',{params:{grant_type:'fb_exchange_token',client_id:META_APP_ID,client_secret:META_APP_SECRET,fb_exchange_token:t1.data.access_token}});
    partners=partners.map(p=>p.id===parseInt(partnerId)?{...p,meta_token:t2.data.access_token}:p);
    res.redirect(FRONTEND_URL+'?connected=true&partner='+partnerId);
  }catch(e){res.redirect(FRONTEND_URL+'?error=auth_failed');}
});

app.listen(PORT,()=>console.log('SEA•KEBAB API v2.1 running on port '+PORT+' — '+partners.length+' partenaires chargés'));
