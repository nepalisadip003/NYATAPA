import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

// ===== SETTINGS: PIN for the members page (admin.html). Keep your GitHub repository PRIVATE. =====
const ADMIN_PIN = process.env.ADMIN_PIN || "121212";
const PIN_SALT = process.env.PIN_SALT || "db463caf7516f253a5bc614c";
// ===================================================================================================

const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
const norm = p => String(p || "").replace(/\D/g, "").slice(-10);
const hash = (p, pin) => createHash("sha256").update(PIN_SALT + p + pin).digest("hex");
async function badPin(req, tag, ok) {
  const au = getStore("auth"), now = Date.now();
  const key = tag + (req.headers.get("x-nf-client-connection-ip") || "x").replace(/[^a-z0-9]/gi, "");
  const r = (await au.get(key, { type: "json" })) || { n: 0, t: 0 };
  const n = now - r.t > 900000 ? 0 : r.n;
  if (n >= 8) return J({ error: "Too many tries. Please wait 15 minutes." }, 429);
  if (ok) { if (n) await au.delete(key); return null; }
  await au.setJSON(key, { n: n + 1, t: now });
  return J({ error: "Wrong PIN" }, 401);
}
const pub = m => ({ name: m.name, visits: m.visits, points: m.points });

export default async (req) => {
  if (req.method !== "POST") return J({ error: "POST only" }, 405);
  let b; try { b = await req.json(); } catch { return J({ error: "Bad request" }, 400); }
  const store = getStore("members"), cfg = getStore("settings");
  const a = b.action;

  if (a === "offer") {
    const o = await cfg.get("offer", { type: "json" });
    return J({ offer: o || { text: "" } });
  }
  if (a === "admin") {
    const e = await badPin(req, "a", b.admin === ADMIN_PIN);
    if (e) return e;
    if (b.op === "list") {
      const { blobs } = await store.list(); const out = [];
      for (const x of blobs) { const m = await store.get(x.key, { type: "json" }); if (m) { delete m.hash; out.push(m); } }
      return J({ members: out });
    }
    if (b.op === "setoffer") { await cfg.setJSON("offer", { text: String(b.text || "").slice(0, 200) }); return J({ ok: 1 }); }
    if (b.op === "delete") { await store.delete(norm(b.phone)); return J({ ok: 1 }); }
    return J({ error: "Unknown" }, 400);
  }

  const p = norm(b.phone);
  if (p.length < 10) return J({ error: "Enter a valid 10-digit phone number" }, 400);
  const pin = String(b.pin || "");
  if (!/^\d{4}$/.test(pin)) return J({ error: "PIN must be 4 digits" }, 400);
  const m = await store.get(p, { type: "json" });

  if (a === "join") {
    if (m) return J({ error: "This number is already a member. Please log in." }, 409);
    if (!b.consent) return J({ error: "Please tick the box to agree" }, 400);
    const name = String(b.name || "").trim().slice(0, 40);
    if (!name) return J({ error: "Enter your name" }, 400);
    const nm = { name, phone: p, hash: hash(p, pin), joined: Date.now(), visits: 0, spend: 0, points: 0, last: 0 };
    await store.setJSON(p, nm);
    return J({ member: pub(nm) });
  }
  if (!m || m.hash !== hash(p, pin)) return J({ error: "Phone number or PIN is wrong" }, 401);
  if (a === "login") return J({ member: pub(m) });
  if (a === "visit") {
    const t = Math.max(0, Math.min(100000, Number(b.total) || 0));
    m.visits++; m.spend += t; m.points += Math.floor(t / 10); m.last = Date.now();
    await store.setJSON(p, m);
    return J({ member: pub(m) });
  }
  return J({ error: "Unknown" }, 400);
};

export const config = { path: "/api/club" };
