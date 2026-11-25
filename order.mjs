import { getStore } from "@netlify/blobs";

// ===== SETTINGS: change the PIN here. Keep your GitHub repository PRIVATE. =====
const STAFF_PIN = process.env.STAFF_PIN || "1111";
const NTFY_SECRET = process.env.NTFY_SECRET || "nyatapa-ff9d9127f50aa17e2625";
// ===========================================================================

const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
const TABLES = Array.from({ length: 16 }, (_, i) => "T" + (i + 1)).concat(["C1", "C2", "C3", "G1"]);
const lab = t => t[0] === "T" ? "Table " + t.slice(1) : t[0] === "C" ? "Cabin " + t.slice(1) : "Ground floor G1";
// Nyatapa location. Override with SHOP_LAT, SHOP_LNG, RADIUS_M in Netlify settings.
const LAT = +process.env.SHOP_LAT || 27.6748264, LNG = +process.env.SHOP_LNG || 85.4271225, RADIUS = +process.env.RADIUS_M || 120;
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
const rad = x => x * Math.PI / 180;
const dist = (a, b, c, d) => { const h = Math.sin(rad(c - a) / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(rad(d - b) / 2) ** 2; return 12742000 * Math.asin(Math.sqrt(h)); };

export default async (req) => {
  if (req.method !== "POST") return J({ error: "POST only" }, 405);
  let b; try { b = await req.json(); } catch { return J({ error: "Bad request" }, 400); }

  // Staff page asks for the private channel name after entering the staff PIN
  if (b.kind === "staffkey") {
    const e = await badPin(req, "s", b.pin === STAFF_PIN);
    if (e) return e;
    return J({ key: NTFY_SECRET });
  }

  const secret = NTFY_SECRET;
  const kind = b.kind, table = String(b.table || "");
  if ((kind !== "order" && kind !== "call") || !TABLES.includes(table)) return J({ error: "Choose your table first." }, 400);

  // Must be physically at Nyatapa
  const lat = Number(b.lat), lng = Number(b.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return J({ error: "We couldn't read your location." }, 400);
  const slack = Math.min(Math.max(Number(b.acc) || 0, 0), 100);
  if (dist(lat, lng, LAT, LNG) > RADIUS + slack)
    return J({ error: "You seem to be away from Nyatapa. Orders and waiter calls only work inside the restaurant." }, 403);

  // Simple spam limit per table
  const rs = getStore("rate"), key = kind + "-" + table, now = Date.now();
  const prev = Number(await rs.get(key)) || 0;
  if (now - prev < (kind === "call" ? 30000 : 10000)) return J({ error: "Please wait a moment and try again." }, 429);
  await rs.set(key, String(now));

  const id = String(b.id || "").replace(/[^a-z0-9]/gi, "").slice(0, 16) || now.toString(36);
  const total = Math.max(0, Math.min(100000, Number(b.total) || 0));
  const body = kind === "call"
    ? { topic: secret + "-waiter", title: lab(table) + " needs a waiter", message: "Please come to " + lab(table), tags: ["kcal", table, id, "bell"], priority: 5 }
    : { topic: secret + "-orders", title: lab(table) + " · Rs. " + total, message: String(b.msg || "").slice(0, 1500), tags: ["kord", table, id], priority: 4 };
  const r = await fetch("https://ntfy.sh", { method: "POST", body: JSON.stringify(body) });
  if (!r.ok) return J({ error: "Couldn't reach the kitchen. Please call a waiter." }, 502);
  return J({ ok: 1 });
};

export const config = { path: "/api/order" };
