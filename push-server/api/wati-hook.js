// WATI → here, for every WhatsApp message someone sends the Buildathon number (WATI webhook, event "message").
// It saves the message in the database (wa_inbox) so Organiser panel → WhatsApp shows replies as they come in.
// The webhook address carries a key made from NOTIFY_SECRET (?k=…), so nobody else can add messages.
const { saveInbox, hookKey, same, timeOf, textOf } = require("./_sb");

module.exports = async (req, res) => {
  if (!same(req.query && req.query.k, hookKey())) return res.status(403).send("forbidden");
  if (req.method !== "POST") return res.status(200).send("ok");   // WATI may check the address first
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const list = Array.isArray(body) ? body : [body];
  const items = list
    .filter((m) => m && (m.eventType || m.event_type) === "message" && m.owner !== true && (m.waId || m.wa_id))
    .map((m) => {
      const t = timeOf(m) || Date.now();
      const phone = String(m.waId || m.wa_id).replace(/\D/g, "");
      return { id: String(m.id || m.whatsappMessageId || `${phone}-${t}`).slice(0, 100), phone, name: String(m.senderName || m.sender_name || "").slice(0, 80),
        body: textOf(m).slice(0, 4000), kind: String(m.type || "text").slice(0, 30), at: new Date(t).toISOString() };
    });
  try { await saveInbox(items); }
  catch (e) { console.error("wati-hook: could not save", String(e && e.message).slice(0, 200)); }
  // always 200: WATI marks a webhook "Defective" after many failed calls
  return res.status(200).json({ ok: true, saved: items.length });
};
