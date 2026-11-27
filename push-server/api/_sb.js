// Shared by the WhatsApp inbox endpoints (files starting with "_" are not endpoints on Vercel).
// SB_ANON is the site's public (publishable) key from config.js: it only reaches the database functions
// that check a secret or a signed-in organiser themselves.
const crypto = require("crypto");

const SB_URL = String(process.env.SUPABASE_URL || "https://zbcldrkowkpvkxepltrt.supabase.co").replace(/\/+$/, "");
const SB_ANON = process.env.SUPABASE_ANON_KEY || "sb_publishable_pxjkI132d0nDIrv85y4apA_GiYEKopY";

// a database function; jwt = the signed-in person's Supabase token (organiser panel), or none
async function rpc(fn, args, jwt) {
  const headers = { apikey: SB_ANON, "Content-Type": "application/json" };
  if (jwt) headers.Authorization = "Bearer " + jwt;
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(args || {}) });
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch (_) {}
  if (!r.ok) throw new Error((j && (j.message || j.error)) || `database ${r.status}`);
  return j;
}

// save WhatsApp messages in the inbox (wa_inbox); items: [{ id, phone, name, body, kind, mine, sentBy, at }]
const saveInbox = (items) => (items.length ? rpc("bd_wa_inbox_add", { p_secret: process.env.NOTIFY_SECRET || "", p_items: items }) : Promise.resolve(0));

// the key in the WATI webhook address (…/api/wati-hook?k=KEY): made from NOTIFY_SECRET, so the secret itself
// never sits in WATI's settings
const hookKey = () => crypto.createHmac("sha256", String(process.env.NOTIFY_SECRET || "")).update("wati-hook").digest("hex").slice(0, 32);

const same = (a, b) => {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};

// WATI message fields → plain values
const timeOf = (m) => {
  const v = m.created || m.createdAt || m.created_at || m.timestamp || m.createdDate || m.time || "";
  const n = Number(v);
  if (v !== "" && Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;   // Unix seconds (webhooks) or ms
  return Date.parse(v) || 0;
};
const textOf = (m) => String(m.final_text || m.finalText || m.text || m.body || (m.message && (m.message.text || m.message.body))
  || (m.buttonReply && (m.buttonReply.text || m.buttonReply.title)) || (m.listReply && (m.listReply.title || m.listReply.text))
  || (m.interactiveButtonReply && m.interactiveButtonReply.title) || m.content || "");

module.exports = { SB_URL, SB_ANON, rpc, saveInbox, hookKey, same, timeOf, textOf };
