import express from "express";
import session from "express-session";
import bcrypt from "bcryptjs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const ABR_GUID = process.env.ABR_GUID || "";

const abnData = JSON.parse(
  readFileSync(join(__dirname, "..", "data", "abn.json"), "utf8")
);

// Calls the official ABR ABN Lookup JSON web service. The public service
// returns only state + postcode (no street address) for privacy reasons.
async function abrLookup(abn) {
  const url = `https://abr.business.gov.au/json/AbnDetails.aspx?abn=${abn}&guid=${ABR_GUID}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`ABR service returned ${r.status}`);
  const text = await r.text();
  const m = text.match(/^[^({]*\((.*)\)[\s;]*$/s); // unwrap JSONP if present
  const j = JSON.parse(m ? m[1] : text);
  if (j.Message) throw new Error(j.Message);
  if (!j.Abn) throw new Error("ABN not found");
  return {
    abn: String(j.Abn).replace(/\s+/g, ""),
    entityName: j.EntityName || "",
    tradingName: (Array.isArray(j.BusinessName) && j.BusinessName[0]) || j.EntityName || "",
    entityType: j.EntityTypeName || "",
    status: j.AbnStatus || "",
    gstRegistered: Boolean(j.Gst),
    stateCode: j.AddressState || "",
    postcode: j.AddressPostcode || "",
    address: [j.AddressState, j.AddressPostcode].filter(Boolean).join(" "),
  };
}

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(
  session({
    name: "namer.sid",
    secret: process.env.SESSION_SECRET || "dev-only-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", maxAge: 1000 * 60 * 60 * 24 * 7 },
  })
);

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
  next();
}

function publicUser(u) {
  return { id: u.id, username: u.username, company: u.company };
}

// --- Auth ---
app.post("/api/register", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: "Username and password required" });
  if (String(password).length < 6)
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  if (db.findUserByUsername(username))
    return res.status(409).json({ error: "Username already taken" });
  const passwordHash = await bcrypt.hash(String(password), 10);
  const user = db.createUser({ username, passwordHash });
  req.session.userId = user.id;
  res.json({ user: publicUser(user) });
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body || {};
  const user = db.findUserByUsername(username || "");
  if (!user) return res.status(401).json({ error: "Invalid credentials" });
  const ok = await bcrypt.compare(String(password || ""), user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });
  req.session.userId = user.id;
  res.json({ user: publicUser(user) });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", requireAuth, (req, res) => {
  const u = db.getUserById(req.session.userId);
  if (!u) return res.status(401).json({ error: "Not authenticated" });
  res.json({ user: publicUser(u) });
});

// --- Mock ABN lookup ---
app.get("/api/abn/:abn", requireAuth, async (req, res) => {
  const raw = String(req.params.abn || "").replace(/\s+/g, "");
  if (!/^\d{11}$/.test(raw))
    return res.status(400).json({ error: "ABN must be 11 digits" });
  if (ABR_GUID) {
    try {
      const business = await abrLookup(raw);
      return res.json({ business, source: "abr" });
    } catch (err) {
      return res.status(502).json({ error: `ABR lookup failed: ${err.message}` });
    }
  }
  const match = abnData.businesses.find((b) => b.abn === raw);
  if (!match)
    return res.status(404).json({
      error: "ABN not found in sample dataset (set ABR_GUID for live lookup)",
    });
  res.json({ business: match, source: "mock" });
});

app.get("/api/abn", requireAuth, (req, res) => {
  res.json({
    businesses: abnData.businesses.map((b) => ({
      abn: b.abn,
      entityName: b.entityName,
      tradingName: b.tradingName,
    })),
  });
});

// --- Drawings ---
app.get("/api/drawings", requireAuth, (req, res) => {
  res.json({ drawings: db.listDrawings(req.session.userId) });
});

app.post("/api/drawings", requireAuth, (req, res) => {
  const { title, payload } = req.body || {};
  const drawing = db.createDrawing(req.session.userId, {
    title: title || "Untitled drawing",
    payload: payload || {},
  });
  res.json({ drawing });
});

app.get("/api/drawings/:id", requireAuth, (req, res) => {
  const drawing = db.getDrawing(req.session.userId, req.params.id);
  if (!drawing) return res.status(404).json({ error: "Not found" });
  res.json({ drawing });
});

app.put("/api/drawings/:id", requireAuth, (req, res) => {
  const { title, payload } = req.body || {};
  const drawing = db.updateDrawing(req.session.userId, req.params.id, {
    ...(title !== undefined ? { title } : {}),
    ...(payload !== undefined ? { payload } : {}),
  });
  if (!drawing) return res.status(404).json({ error: "Not found" });
  res.json({ drawing });
});

app.delete("/api/drawings/:id", requireAuth, (req, res) => {
  const ok = db.deleteDrawing(req.session.userId, req.params.id);
  if (!ok) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

app.use(express.static(join(__dirname, "..", "public")));

app.listen(PORT, () => {
  console.log(`Namer engineering drawing app running on http://localhost:${PORT}`);
});
