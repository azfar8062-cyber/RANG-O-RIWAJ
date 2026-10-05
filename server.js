// RANG O RIWAJ — storefront + admin CMS. Zero dependencies, Node 22.5+.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const PORT=process.env.PORT||3000, PROD=process.env.NODE_ENV==='production';
const ROOT=__dirname, PUB=path.join(ROOT,'public'), UP=path.join(ROOT,'uploads');
fs.mkdirSync(path.join(ROOT,'data'),{recursive:true});fs.mkdirSync(UP,{recursive:true});
const db=new DatabaseSync(path.join(ROOT,'data','store.db'));
db.exec(`CREATE TABLE IF NOT EXISTS admin(id INTEGER PRIMARY KEY,email TEXT UNIQUE,salt TEXT,hash TEXT);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,exp INTEGER);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY AUTOINCREMENT,slug TEXT UNIQUE,name TEXT,description TEXT,price REAL,sale_price REAL,category TEXT,sku TEXT,status TEXT DEFAULT 'active',availability TEXT DEFAULT 'in_stock',images TEXT DEFAULT '[]',created_at TEXT,updated_at TEXT);`);

const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const hashPw=(pw,salt)=>crypto.scryptSync(pw,salt,64).toString('hex');
const now=()=>new Date().toISOString();
const slugify=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'product';

// first-run admin: credentials come from environment variables, never from code
if(!db.prepare('SELECT 1 FROM admin').get()){
  const e=process.env.ADMIN_EMAIL,p=process.env.ADMIN_PASSWORD;
  if(!e||!p||p.length<8){console.error('First run: set ADMIN_EMAIL and ADMIN_PASSWORD (8+ chars). Example:\n  ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=choose-a-password node server.js');process.exit(1)}
  const salt=crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT INTO admin(email,salt,hash) VALUES(?,?,?)').run(e.trim().toLowerCase(),salt,hashPw(p,salt));
  const set=db.prepare('INSERT OR IGNORE INTO settings VALUES(?,?)');
  Object.entries({email:'',whatsapp:'923421630437',phone:'+92 342 1630437',instagram:'',facebook:''}).forEach(([k,v])=>set.run(k,v));
  const ins=db.prepare('INSERT INTO products(slug,name,description,price,category,sku,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)');
  [['Heritage Jhumka Earrings','Jewelry',2400],['Layered Kundan Necklace','Jewelry',5800],['Hand-Block Print Tote','Bags',3200],['Embroidered Market Tote','Bags',4500],['Girls Embroidered Cap','Caps',1500],['Boys Block Print Cap','Caps',1400]]
   .forEach(([n,c,pr],i)=>ins.run(slugify(n),n,'Sample description. Replace with the real product details.',pr,c,'SAMPLE-'+(i+1),now(),now()));
  console.log('Admin account created for',e);
}

const json=(res,code,obj,h={})=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store',...h});res.end(JSON.stringify(obj))};
const redirect=(res,to)=>{res.writeHead(302,{Location:to});res.end()};
const cookie=req=>Object.fromEntries((req.headers.cookie||'').split(';').map(c=>c.trim().split('=')).filter(a=>a[0]));
const authed=req=>{const t=cookie(req).ror_sid;if(!t)return false;const r=db.prepare('SELECT exp FROM sessions WHERE token=?').get(sha(t));return !!r&&r.exp>Date.now()};
const body=(req,max)=>new Promise((ok,no)=>{const c=[];let n=0;req.on('data',d=>{n+=d.length;if(n>max){no(new Error('too large'));req.destroy()}else c.push(d)});req.on('end',()=>ok(Buffer.concat(c)));req.on('error',no)});
const readJson=async req=>{try{return JSON.parse((await body(req,1e6)).toString()||'{}')}catch{return null}};
const attempts=new Map();
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp'};
const sendFile=(res,f,extra={})=>fs.readFile(f,(e,d)=>{if(e){res.writeHead(404);return res.end('Not found')}
  res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream','X-Content-Type-Options':'nosniff',...extra});res.end(d)});
const row=r=>r&&{...r,images:JSON.parse(r.images||'[]')};

function clean(b){
  const name=String(b.name||'').trim(),price=Number(b.price);
  if(!name||!(price>=0))return null;
  const sale=b.sale_price===''||b.sale_price==null?null:Number(b.sale_price);
  if(sale!==null&&!(sale>=0&&sale<price))return null;
  const imgs=(Array.isArray(b.images)?b.images:[]).filter(u=>/^\/uploads\/[a-f0-9]+\.(jpg|png|webp)$/.test(u)||/^https:\/\//.test(u)).slice(0,10);
  return {name,description:String(b.description||'').slice(0,5000),price,sale_price:sale,category:String(b.category||'').slice(0,60),sku:String(b.sku||'').slice(0,60),
    status:b.status==='inactive'?'inactive':'active',availability:b.availability==='out_of_stock'?'out_of_stock':'in_stock',images:JSON.stringify(imgs)};
}
function uniqueSlug(name,id){let s=slugify(name),i=1,t=s;while(true){const r=db.prepare('SELECT id FROM products WHERE slug=?').get(t);if(!r||r.id===id)return t;t=s+'-'+(++i)}}

const server=http.createServer(async(req,res)=>{
  try{
  const u=new URL(req.url,'http://x'),p=u.pathname,m=req.method;
  res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');
  // ---- public API
  if(p==='/api/settings'&&m==='GET')return json(res,200,Object.fromEntries(db.prepare('SELECT * FROM settings').all().map(r=>[r.key,r.value])));
  if(p==='/api/products'&&m==='GET')return json(res,200,db.prepare("SELECT * FROM products WHERE status='active' ORDER BY id DESC").all().map(row));
  let mm=p.match(/^\/api\/products\/([a-z0-9-]+)$/);
  if(mm&&m==='GET'){const r=db.prepare("SELECT * FROM products WHERE slug=? AND status='active'").get(mm[1]);return r?json(res,200,row(r)):json(res,404,{error:'Not found'})}
  // ---- login
  if(p==='/api/admin/login'&&m==='POST'){
    const ip=req.socket.remoteAddress,a=attempts.get(ip)||{n:0,t:Date.now()};
    if(Date.now()-a.t>9e5){a.n=0;a.t=Date.now()}
    if(a.n>=5)return json(res,429,{error:'Too many attempts. Try again in 15 minutes.'});
    const b=await readJson(req);
    const r=b&&db.prepare('SELECT * FROM admin WHERE email=?').get(String(b.email||'').trim().toLowerCase());
    const ok=r&&crypto.timingSafeEqual(Buffer.from(hashPw(String(b.password||''),r.salt),'hex'),Buffer.from(r.hash,'hex'));
    if(!ok){a.n++;attempts.set(ip,a);return json(res,401,{error:'Email or password is incorrect.'})}
    attempts.delete(ip);const t=crypto.randomBytes(32).toString('hex');
    db.prepare('DELETE FROM sessions WHERE exp<?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES(?,?)').run(sha(t),Date.now()+8*36e5);
    return json(res,200,{ok:true},{'Set-Cookie':`ror_sid=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${PROD?'; Secure':''}`});
  }
  // ---- admin pages
  if(p==='/admin'||p==='/admin/')return redirect(res,authed(req)?'/admin/dashboard':'/admin/login');
  if(p==='/admin/login')return authed(req)?redirect(res,'/admin/dashboard'):sendFile(res,path.join(PUB,'admin.html'),{'Cache-Control':'no-store'});
  if(p==='/admin/dashboard')return authed(req)?sendFile(res,path.join(PUB,'admin.html'),{'Cache-Control':'no-store'}):redirect(res,'/admin/login');
  // ---- protected admin API
  if(p.startsWith('/api/admin/')){
    if(!authed(req))return json(res,401,{error:'Not signed in.'});
    if(m!=='GET'&&req.headers['x-requested-with']!=='ror')return json(res,403,{error:'Forbidden'});
    if(p==='/api/admin/logout'&&m==='POST'){const t=cookie(req).ror_sid;db.prepare('DELETE FROM sessions WHERE token=?').run(sha(t));return json(res,200,{ok:true},{'Set-Cookie':'ror_sid=; HttpOnly; Path=/; Max-Age=0'})}
    if(p==='/api/admin/products'&&m==='GET')return json(res,200,db.prepare('SELECT * FROM products ORDER BY id DESC').all().map(row));
    if(p==='/api/admin/products'&&m==='POST'){const c=clean(await readJson(req)||{});if(!c)return json(res,400,{error:'Enter a name, a valid price, and a sale price lower than the price.'});
      const i=db.prepare('INSERT INTO products(slug,name,description,price,sale_price,category,sku,status,availability,images,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(uniqueSlug(c.name),c.name,c.description,c.price,c.sale_price,c.category,c.sku,c.status,c.availability,c.images,now(),now());
      return json(res,201,{id:Number(i.lastInsertRowid)})}
    mm=p.match(/^\/api\/admin\/products\/(\d+)$/);
    if(mm&&m==='PUT'){const id=+mm[1],c=clean(await readJson(req)||{});if(!c)return json(res,400,{error:'Enter a name, a valid price, and a sale price lower than the price.'});
      db.prepare('UPDATE products SET slug=?,name=?,description=?,price=?,sale_price=?,category=?,sku=?,status=?,availability=?,images=?,updated_at=? WHERE id=?').run(uniqueSlug(c.name,id),c.name,c.description,c.price,c.sale_price,c.category,c.sku,c.status,c.availability,c.images,now(),id);return json(res,200,{ok:true})}
    if(mm&&m==='DELETE'){db.prepare('DELETE FROM products WHERE id=?').run(+mm[1]);return json(res,200,{ok:true})}
    if(p==='/api/admin/settings'&&m==='PUT'){const b=await readJson(req)||{},s=db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)');
      for(const k of ['email','whatsapp','phone','instagram','facebook']){let v=String(b[k]??'').trim().slice(0,200);if(k==='whatsapp')v=v.replace(/\D/g,'');
        if((k==='instagram'||k==='facebook')&&v&&!/^https:\/\//.test(v))return json(res,400,{error:k+' link must start with https://'});s.run(k,v)}
      return json(res,200,{ok:true})}
    if(p==='/api/admin/password'&&m==='PUT'){const b=await readJson(req)||{},r=db.prepare('SELECT * FROM admin').get();
      const ok=crypto.timingSafeEqual(Buffer.from(hashPw(String(b.current||''),r.salt),'hex'),Buffer.from(r.hash,'hex'));
      if(!ok)return json(res,400,{error:'Current password is incorrect.'});if(String(b.next||'').length<8)return json(res,400,{error:'New password must be 8+ characters.'});
      const salt=crypto.randomBytes(16).toString('hex');db.prepare('UPDATE admin SET salt=?,hash=? WHERE id=?').run(salt,hashPw(b.next,salt),r.id);return json(res,200,{ok:true})}
    if(p==='/api/admin/upload'&&m==='POST'){const d=await body(req,5e6);let ext=null;
      if(d[0]===0xFF&&d[1]===0xD8)ext='jpg';else if(d.slice(0,4).toString('hex')==='89504e47')ext='png';else if(d.slice(0,4).toString()==='RIFF'&&d.slice(8,12).toString()==='WEBP')ext='webp';
      if(!ext)return json(res,400,{error:'Only JPG, PNG or WebP images up to 5 MB.'});
      const f=crypto.randomBytes(12).toString('hex')+'.'+ext;fs.writeFileSync(path.join(UP,f),d);return json(res,201,{url:'/uploads/'+f})}
    return json(res,404,{error:'Not found'});
  }
  // ---- storefront
  if(p.startsWith('/uploads/')){const f=path.join(UP,path.basename(p));return sendFile(res,f,{'Cache-Control':'public, max-age=604800'})}
  if(p==='/'||p.startsWith('/product/'))return sendFile(res,path.join(PUB,'index.html'));
  return sendFile(res,path.join(PUB,path.basename(p)));
  }catch(e){console.error(e);json(res,500,{error:'Server error'})}
});
server.listen(PORT,()=>console.log('Running on http://localhost:'+PORT));
