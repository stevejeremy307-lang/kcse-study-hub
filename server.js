require("dotenv").config();
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const Database = require("better-sqlite3");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const db = new Database("studyhub.sqlite");
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 email TEXT UNIQUE NOT NULL,
 phone TEXT NOT NULL,
 is_vip INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS papers (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL,
 subject TEXT NOT NULL,
 year INTEGER NOT NULL,
 category TEXT NOT NULL DEFAULT 'past-paper',
 file_name TEXT NOT NULL,
 original_name TEXT NOT NULL,
 is_vip INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS payments (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 checkout_request_id TEXT UNIQUE,
 merchant_request_id TEXT,
 amount INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 receipt_number TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  name: "kcsehub.sid",
  secret: process.env.SESSION_SECRET || "development-only-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 1000 * 60 * 60 * 8 }
}));
app.use(express.static(path.join(__dirname, "public")));

const uploadDir = path.join(__dirname, "uploads");
fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
 destination: (_, __, cb) => cb(null, uploadDir),
 filename: (_, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase())
});
const upload = multer({
 storage,
 limits: { fileSize: 20 * 1024 * 1024 },
 fileFilter: (_, file, cb) => {
   const ok = [".pdf"].includes(path.extname(file.originalname).toLowerCase()) && file.mimetype === "application/pdf";
   cb(ok ? null : new Error("Only PDF files are accepted."), ok);
 }
});

const vipPrice = Number(process.env.VIP_PRICE_KES || 500);
function currentUser(req) {
 if (!req.session.userId) return null;
 return db.prepare("SELECT id,email,phone,is_vip,created_at FROM users WHERE id=?").get(req.session.userId) || null;
}
function requireLogin(req,res,next) {
 if (!currentUser(req)) return res.status(401).json({error:"Please sign in first."});
 next();
}
function requireAdmin(req,res,next) {
 if (!req.session.isAdmin) return res.status(401).json({error:"Admin sign-in required."});
 next();
}
function validEmail(v) { return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length < 255; }
function normalisePhone(v) {
 const digits = String(v || "").replace(/\D/g, "");
 if (digits.length === 10 && digits.startsWith("0")) return "254" + digits.slice(1);
 if (digits.length === 12 && digits.startsWith("254")) return digits;
 if (digits.length === 9) return "254" + digits;
 return null;
}

// Demo-friendly email + phone sign-in. Before public launch, add OTP verification,
// rate limiting, CSRF protection, a persistent session store, and privacy notices.
app.post("/api/login", (req,res) => {
 const email = String(req.body.email || "").trim().toLowerCase();
 const phone = normalisePhone(req.body.phone);
 if (!validEmail(email) || !phone) return res.status(400).json({error:"Enter a valid email address and Kenyan phone number."});
 let user = db.prepare("SELECT * FROM users WHERE email=?").get(email);
 if (user && user.phone !== phone) return res.status(403).json({error:"That email is already registered with a different phone number. Contact support."});
 if (!user) {
   try {
     const info = db.prepare("INSERT INTO users(email,phone) VALUES(?,?)").run(email, phone);
     user = db.prepare("SELECT * FROM users WHERE id=?").get(info.lastInsertRowid);
   } catch {
     return res.status(409).json({error:"Could not create account. Please try again."});
   }
 }
 req.session.userId = user.id;
 res.json({user:{id:user.id,email:user.email,phone:user.phone,isVip:!!user.is_vip}});
});
app.post("/api/logout", (req,res) => req.session.destroy(() => res.json({ok:true})));
app.get("/api/me", (req,res) => res.json({user:currentUser(req), vipPrice}));

app.get("/api/papers", (req,res) => {
 const user = currentUser(req);
 const rows = db.prepare("SELECT id,title,subject,year,category,is_vip,created_at FROM papers WHERE is_vip=0 OR ?=1 ORDER BY year DESC, subject ASC").all(user && user.is_vip ? 1 : 0);
 res.json({papers:rows});
});
app.get("/api/papers/:id/download", requireLogin, (req,res) => {
 const paper = db.prepare("SELECT * FROM papers WHERE id=?").get(Number(req.params.id));
 if (!paper) return res.status(404).send("Resource not found.");
 const user = currentUser(req);
 if (paper.is_vip && !user.is_vip) return res.status(403).send("VIP membership required.");
 res.download(path.join(uploadDir, paper.file_name), paper.original_name);
});

// Admin authentication is intentionally basic starter code. Deploy only behind HTTPS;
// replace with a stronger admin identity system and add rate limiting.
app.post("/api/admin/login", (req,res) => {
 const email = String(req.body.email || "").trim().toLowerCase();
 const password = String(req.body.password || "");
 const adminEmail = String(process.env.ADMIN_EMAIL || "").toLowerCase();
 const adminPassword = String(process.env.ADMIN_PASSWORD || "");
 if (!adminEmail || !adminPassword || email !== adminEmail || password !== adminPassword) {
   return res.status(401).json({error:"Invalid administrator credentials."});
 }
 req.session.isAdmin = true;
 res.json({ok:true});
});
app.post("/api/admin/logout", requireAdmin, (req,res) => { req.session.isAdmin=false; res.json({ok:true}); });
app.get("/api/admin/papers", requireAdmin, (req,res) => {
 res.json({papers:db.prepare("SELECT * FROM papers ORDER BY created_at DESC").all()});
});
app.post("/api/admin/papers", requireAdmin, upload.single("paper"), (req,res) => {
 if (!req.file) return res.status(400).json({error:"Select a PDF file."});
 const {title,subject,year,category,isVip} = req.body;
 if (!title || !subject || !Number.isInteger(Number(year)) || Number(year)<1960 || Number(year)>2100) {
   fs.unlinkSync(req.file.path);
   return res.status(400).json({error:"Enter a title, subject, and valid year."});
 }
 const info = db.prepare("INSERT INTO papers(title,subject,year,category,file_name,original_name,is_vip) VALUES(?,?,?,?,?,?,?)")
  .run(String(title).slice(0,160),String(subject).slice(0,80),Number(year),String(category||"past-paper").slice(0,40),req.file.filename,path.basename(req.file.originalname),isVip==="on"?1:0);
 res.json({ok:true,id:info.lastInsertRowid});
});
app.delete("/api/admin/papers/:id", requireAdmin, (req,res) => {
 const paper = db.prepare("SELECT * FROM papers WHERE id=?").get(Number(req.params.id));
 if (!paper) return res.status(404).json({error:"Resource not found."});
 db.prepare("DELETE FROM papers WHERE id=?").run(paper.id);
 const file = path.join(uploadDir,paper.file_name);
 if (fs.existsSync(file)) fs.unlinkSync(file);
 res.json({ok:true});
});
app.get("/api/admin/stats", requireAdmin, (req,res) => {
 res.json({
  users:db.prepare("SELECT COUNT(*) n FROM users").get().n,
  vip:db.prepare("SELECT COUNT(*) n FROM users WHERE is_vip=1").get().n,
  papers:db.prepare("SELECT COUNT(*) n FROM papers").get().n,
  pendingPayments:db.prepare("SELECT COUNT(*) n FROM payments WHERE status='pending'").get().n
 });
});

// M-Pesa Daraja STK Push: set environment variables and use a public HTTPS callback.
// The callback is the only place VIP is activated. Never trust a browser "paid" button.
async function mpesaAccessToken() {
 const base = process.env.MPESA_ENV === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";
 const auth = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString("base64");
 const r = await fetch(`${base}/oauth/v1/generate?grant_type=client_credentials`, {headers:{Authorization:`Basic ${auth}`}});
 const data = await r.json();
 if (!r.ok || !data.access_token) throw new Error("Could not obtain M-Pesa access token.");
 return {token:data.access_token,base};
}
function darajaReady() {
 return ["MPESA_CONSUMER_KEY","MPESA_CONSUMER_SECRET","MPESA_SHORTCODE","MPESA_PASSKEY","MPESA_CALLBACK_URL"].every(k=>process.env[k]);
}
app.post("/api/vip/checkout", requireLogin, async (req,res) => {
 if (!darajaReady()) return res.status(503).json({error:"M-Pesa is not configured yet. Ask the site administrator to finish payment setup."});
 const user = currentUser(req);
 const phone = normalisePhone(user.phone);
 if (!phone) return res.status(400).json({error:"Your account phone number is invalid."});
 try {
  const {token,base} = await mpesaAccessToken();
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g,"").slice(0,14);
  const shortcode = process.env.MPESA_SHORTCODE;
  const password = Buffer.from(shortcode + process.env.MPESA_PASSKEY + timestamp).toString("base64");
  const amount = vipPrice;
  const payload = {
   BusinessShortCode:shortcode,Password:password,Timestamp:timestamp,
   TransactionType:process.env.MPESA_TRANSACTION_TYPE || "CustomerPayBillOnline",
   Amount:amount,PartyA:phone,PartyB:shortcode,PhoneNumber:phone,
   CallBackURL:process.env.MPESA_CALLBACK_URL,
   AccountReference:"KCSEHUBVIP",TransactionDesc:"VIP revision membership"
  };
  const r = await fetch(`${base}/mpesa/stkpush/v1/processrequest`, {
   method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(payload)
  });
  const data = await r.json();
  if (!r.ok || !data.CheckoutRequestID) return res.status(502).json({error:data.errorMessage || data.ResponseDescription || "Payment request failed."});
  db.prepare("INSERT INTO payments(user_id,checkout_request_id,merchant_request_id,amount,status) VALUES(?,?,?,?,?)")
   .run(user.id,data.CheckoutRequestID,data.MerchantRequestID,amount,"pending");
  res.json({ok:true,message:"Payment prompt sent to your phone. Enter your M-Pesa PIN only in the official phone prompt.",checkoutRequestId:data.CheckoutRequestID});
 } catch (e) {
  console.error("M-Pesa checkout error:",e.message);
  res.status(502).json({error:"Could not start payment. Please try again later."});
 }
});
app.post("/api/mpesa/callback", (req,res) => {
 try {
  const callback = req.body && req.body.Body && req.body.Body.stkCallback;
  if (!callback) return res.json({ResultCode:0,ResultDesc:"Callback received"});
  const checkoutId = callback.CheckoutRequestID;
  const resultCode = Number(callback.ResultCode);
  const items = callback.CallbackMetadata && callback.CallbackMetadata.Item || [];
  const receipt = items.find(x=>x.Name==="MpesaReceiptNumber")?.Value || null;
  const amount = Number(items.find(x=>x.Name==="Amount")?.Value || 0);
  const phone = String(items.find(x=>x.Name==="PhoneNumber")?.Value || "");
  const payment = db.prepare("SELECT * FROM payments WHERE checkout_request_id=?").get(checkoutId);
  if (payment && resultCode===0 && amount===payment.amount) {
    const user = db.prepare("SELECT * FROM users WHERE id=?").get(payment.user_id);
    if (user && user.phone === phone) {
      db.prepare("UPDATE payments SET status='paid',receipt_number=? WHERE id=?").run(receipt,payment.id);
      db.prepare("UPDATE users SET is_vip=1 WHERE id=?").run(user.id);
    } else {
      db.prepare("UPDATE payments SET status='review' WHERE id=?").run(payment.id);
    }
  } else if (payment) {
    db.prepare("UPDATE payments SET status='failed' WHERE id=?").run(payment.id);
  }
  res.json({ResultCode:0,ResultDesc:"Callback processed"});
 } catch (e) {
  console.error("M-Pesa callback error:",e.message);
  res.status(500).json({ResultCode:1,ResultDesc:"Callback processing failed"});
 }
});
// Manual-payment request: records a pending request for an administrator to reconcile.
app.post("/api/vip/manual-request", requireLogin, (req,res) => {
 const user = currentUser(req);
 const info = db.prepare("INSERT INTO payments(user_id,amount,status) VALUES(?,?,?)")
   .run(user.id, vipPrice, "manual_pending");
 res.json({ok:true,requestId:info.lastInsertRowid,message:"Manual payment request created. Your VIP access stays pending until an administrator verifies the transaction."});
});
app.get("/api/admin/payments", requireAdmin, (req,res) => {
 const rows = db.prepare("SELECT p.id,p.user_id,u.email,u.phone,p.amount,p.status,p.receipt_number,p.created_at FROM payments p JOIN users u ON u.id=p.user_id ORDER BY p.id DESC").all();
 res.json({payments:rows});
});
app.post("/api/admin/payments/:id/verify", requireAdmin, (req,res) => {
 const payment = db.prepare("SELECT * FROM payments WHERE id=?").get(Number(req.params.id));
 if (!payment || !["manual_pending","pending","review"].includes(payment.status)) return res.status(404).json({error:"Pending payment request not found."});
 const receipt = String(req.body.receiptNumber || "").trim().slice(0,40);
 if (!receipt) return res.status(400).json({error:"Enter the receipt/reference after verifying it against your merchant records."});
 db.prepare("UPDATE payments SET status='paid',receipt_number=? WHERE id=?").run(receipt,payment.id);
 db.prepare("UPDATE users SET is_vip=1 WHERE id=?").run(payment.user_id);
 res.json({ok:true});
});
app.get("/api/vip/status", requireLogin, (req,res) => {
 const user=currentUser(req);
 const latest=db.prepare("SELECT status,receipt_number,created_at FROM payments WHERE user_id=? ORDER BY id DESC LIMIT 1").get(user.id)||null;
 res.json({isVip:!!user.is_vip,latestPayment:latest,price:vipPrice});
});

app.use((err,req,res,next) => {
 console.error(err.message);
 res.status(400).json({error:err.message || "Request failed."});
});
app.listen(PORT, () => console.log(`KCSE Study Hub running at http://localhost:${PORT}`));
