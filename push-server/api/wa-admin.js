// Organiser panel → WhatsApp: read one person's WhatsApp chat from WATI, and answer it.
// Only for signed-in organisers: the panel sends its Supabase sign-in token and admin_whoami() must say admin.
// The WATI token never leaves this server.
// POST { action: "history", phone }        → { messages: [{ at, text, mine, kind, who }] }
// POST { action: "send", phone, text }     → { ok: true } (WhatsApp allows a free-form answer only within
//                                             24 hours of the person's last message)
const crypto = require("crypto");
const { rpc, saveInbox, timeOf, textOf } = require("./_sb");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");   // the token below is the only credential
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Max-Age", "600");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const jwt = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  let who = null;
  try { if (jwt) who = await rpc("admin_whoami", {}, jwt); } catch (_) {}
  if (!who || who.admin !== true) return res.status(403).json({ error: "Organisers only. Sign in again." });

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const phone = String(body.phone || "").replace(/\D/g, "");
  if (!/^[0-9]{10,15}$/.test(phone)) return res.status(400).json({ error: "No WhatsApp number." });
  const token = String(process.env.WATI_TOKEN || "").trim().replace(/^Bearer\s+/i, "");
  if (!token) return res.status(200).json({ error: "WATI_TOKEN is not set on the notify server." });
  const host = String(process.env.WATI_API_HOST || "https://live-mt-server.wati.io").trim().replace(/\/+$/, "");
  const auth = { Authorization: "Bearer " + token };

  try {
    if (body.action === "history") {
      const r = await fetch(`${host}/api/ext/v3/conversations/${phone}/messages?page_number=1&page_size=60`, { headers: auth });
      if (r.status === 404) return res.status(200).json({ messages: [] });
      if (!r.ok) return res.status(200).json({ error: `WATI answered ${r.status}.` });
      const j = await r.json().catch(() => null);
      const items = j && Array.isArray(j.message_list) ? j.message_list : Array.isArray(j) ? j : [];
      const messages = items
        .filter((m) => m && (!m.event_type || m.event_type === "message" || m.event_type === "broadcastMessage"))
        .map((m) => ({ at: timeOf(m) ? new Date(timeOf(m)).toISOString() : null, text: textOf(m).slice(0, 4000),
          mine: m.owner === true, kind: m.event_type === "broadcastMessage" ? "broadcast" : String(m.type || "text"),
          who: m.owner === true ? String(m.operator_name || m.operatorName || "").slice(0, 60) : "" }))
        .filter((m) => m.at)
        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      return res.status(200).json({ messages });
    }

    if (body.action === "send") {
      const text = String(body.text || "").trim().slice(0, 1000);
      if (!text) return res.status(400).json({ error: "Type a message." });
      const r = await fetch(`${host}/api/ext/v3/conversations/messages/text`, { method: "POST",
        headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ target: phone, text }) });
      const t = await r.text();
      let k = null;
      try { k = JSON.parse(t); } catch (_) {}
      if (!r.ok || (k && k.result === false)) {
        const why = String((k && (k.info || k.message || k.error)) || t || r.status).slice(0, 160);
        return res.status(200).json({ error: `WhatsApp didn't take it (${why}). A free-form answer works only within 24 hours of their last message.` });
      }
      await saveInbox([{ id: "out-" + crypto.randomUUID(), phone, body: text, kind: "text", mine: true, sentBy: String(who.email || ""), at: new Date().toISOString() }])
        .catch((e) => console.error("wa-admin: could not save the answer", String(e && e.message).slice(0, 200)));
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: "Unknown action." });
  } catch (e) {
    return res.status(200).json({ error: String((e && e.message) || "Something went wrong.").slice(0, 160) });
  }
};
