// Who wrote back on WhatsApp (WATI) after a message we sent, and (optionally) one reply to each of them.
// POST with header x-notify-secret, body:
//   { phones: ["91…", …] (up to 40), since: ISO time, reply: "text" (optional), store: true (optional), probe: true (optional) }
// Answers { replies: [{ phone, at, text }], replied: [phones that got the reply], errors: [...] }.
// A reply is a free-form WhatsApp message, allowed only within 24 hours of the person's last message to us.
// The WATI token stays on this server and is never part of an answer.
// store: true also saves what they wrote in the inbox (Organiser panel → WhatsApp), e.g. to catch up on replies
// that came before the WATI webhook was set. hooks: true lists WATI's webhooks; hooks + create adds ours.
const { saveInbox, hookKey, same, timeOf, textOf } = require("./_sb");
const HOOK_BASE = "https://buildathon-notify.vercel.app/api/wati-hook";
// the WATI account id, read from the token (WATI's v1 addresses start with it)
const tenantOf = (token) => {
  try {
    const p = JSON.parse(Buffer.from(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    const k = Object.keys(p).find((x) => /tenant/i.test(x));
    return k ? String(p[k]) : "";
  } catch (_) { return ""; }
};
const itemsOf = (j) => {
  if (Array.isArray(j)) return j;
  if (j && Array.isArray(j.message_list)) return j.message_list;   // WATI v3
  const m = j && (j.data && (j.data.items || j.data.messages || j.data) || j.messages && (j.messages.items || j.messages) || j.items || j.result && j.result.items);
  return Array.isArray(m) ? m : [];
};
// a message the person sent us (WATI marks ours with owner = true, or a direction)
const incoming = (m) => m && (m.owner === false || m.isOwner === false || /^(in|inbound|incoming|received|customer)$/i.test(String(m.direction || m.sender_type || m.senderType || "")))
  && (!m.eventType || m.eventType === "message");
const ours = (m) => m && (m.owner === true || m.isOwner === true || /^(out|outbound|outgoing|sent|operator|agent|business)$/i.test(String(m.direction || m.sender_type || m.senderType || "")));

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("POST only");
  if (!same(req.headers["x-notify-secret"], process.env.NOTIFY_SECRET)) return res.status(403).send("forbidden");
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const token = String(process.env.WATI_TOKEN || "").trim().replace(/^Bearer\s+/i, "");
  if (!token) return res.status(200).json({ error: "WATI_TOKEN is not set on the Vercel project." });
  const host = String(process.env.WATI_API_HOST || "https://live-mt-server.wati.io").trim().replace(/\/+$/, "");
  const tenant = tenantOf(token);
  const auth = { Authorization: "Bearer " + token };
  const since = Date.parse(body.since || "") || Date.now() - 864e5;
  const phones = [...new Set((Array.isArray(body.phones) ? body.phones : []).map((p) => String(p).replace(/\D/g, ""))
    .filter((p) => /^[0-9]{10,15}$/.test(p)))].slice(0, 40);
  const reply = String(body.reply || "").trim().slice(0, 1000);

  // WATI v3 (the tenant comes from the token): a chat's latest messages
  const getMessages = async (phone) => {
    const r = await fetch(`${host}/api/ext/v3/conversations/${phone}/messages?page_number=1&page_size=50`, { headers: auth });
    const raw = await r.text();
    let j = null;
    try { j = JSON.parse(raw); } catch (_) {}
    return { status: r.status, j, raw };
  };

  // one number: which WATI address answers, and the shape of its messages (no message text, no token)
  // the WhatsApp templates on WATI: name, category (UTILITY / MARKETING) and status, nothing else
  if (body.templates) {
    const out = [];
    for (const path of ["/api/ext/v3/messageTemplates?page_number=1&page_size=100", "/api/ext/v3/messageTemplates"]) {
      try {
        const r = await fetch(host + path, { headers: auth });
        const raw = await r.text();
        let j = null;
        try { j = JSON.parse(raw); } catch (_) {}
        const list = j && (j.message_templates || j.messageTemplates || j.templates || j.data || j.items || (Array.isArray(j) ? j : null));
        out.push({ path, status: r.status, top: j && !Array.isArray(j) ? Object.keys(j) : null,
          templates: Array.isArray(list) ? list.map((t) => ({ name: t.elementName || t.element_name || t.name, category: t.category, status: t.status, language: t.language && (t.language.value || t.language.key || t.language) || t.lang,
            categoryHistory: t.previous_category || t.previousCategory || t.category_history || undefined })) : null });
        if (Array.isArray(list)) break;
      } catch (e) { out.push({ path, error: String(e && e.message).slice(0, 100) }); }
    }
    return res.status(200).json({ out });
  }
  // several numbers: how many messages of each kind (event_type + status), so replies can be told from ours (no text)
  if (body.survey) {
    const kinds = {};
    await Promise.all(phones.map(async (p) => {
      try {
        const { j } = await getMessages(p);
        itemsOf(j).forEach((m) => { const k = `${m.event_type}|${m.status_string}|${m.final_text ? "text" : "no-text"}|${m.failed_detail ? "failed" : ""}`; kinds[k] = (kinds[k] || 0) + 1; });
      } catch (_) {}
    }));
    // field names of a "message" item and a "ticket" item, with non-text values only
    let msgKeys = null, ticketKeys = null, msgSample = [];
    for (const p of phones) {
      try {
        const { j } = await getMessages(p);
        for (const m of itemsOf(j)) {
          if (m.event_type === "message") {
            if (!msgKeys) msgKeys = Object.keys(m);
            if (msgSample.length < 8) msgSample.push(Object.fromEntries(Object.entries(m).filter(([k, v]) => typeof v !== "string" || /^(owner|type|direction|status|event_type|created|operator|sender|from|is|whatsapp_message_type|message_type)/i.test(k)).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 40) : v && typeof v === "object" ? Object.keys(v) : v])));
          }
          if (m.event_type === "ticket" && !ticketKeys) ticketKeys = Object.keys(m);
        }
      } catch (_) {}
      if (msgSample.length >= 8 && ticketKeys) break;
    }
    return res.status(200).json({ kinds, msgKeys, ticketKeys, msgSample });
  }
  // WATI's webhooks (list), and with create: add ours for incoming messages (legacy v2 create, the only one WATI has)
  if (body.hooks) {
    const hide = (x) => JSON.parse(JSON.stringify(x === undefined ? null : x).replace(/k=[0-9a-f]{32}/g, "k=…"));
    const get = async (path) => {
      const r = await fetch(host + path, { headers: auth });
      const t = await r.text();
      let j = null;
      try { j = JSON.parse(t); } catch (_) {}
      return { status: r.status, body: hide(j === null ? t.slice(0, 300) : j) };
    };
    let claims = {};
    try {
      const p = JSON.parse(Buffer.from(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
      claims = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, /tenant|tid|db|workspace|org|channel/i.test(k) ? v : typeof v]));
    } catch (_) {}
    const out = { claims, list: await get("/api/ext/v3/webhooks"), types: await get("/api/ext/v3/webhooks/event-types") };
    if (phones[0]) {
      const { j } = await getMessages(phones[0]);
      const m = itemsOf(j)[0] || {};
      out.channelFields = Object.fromEntries(Object.entries(m).filter(([k]) => /channel|tenant|business/i.test(k)));
    }
    if (body.create) {
      const entry = { phoneNumber: String(body.channel || "").replace(/\D/g, ""), status: 1, url: `${HOOK_BASE}?k=${hookKey()}`, eventTypes: ["message"] };
      const t = String(body.tenant || tenant || "").replace(/[^0-9A-Za-z_-]/g, "");
      out.create = [];
      for (const path of [t && `/${t}/api/v2/webhookEndpoints`, "/api/v2/webhookEndpoints", "/api/ext/v3/webhooks"].filter(Boolean)) {
        const r = await fetch(host + path, { method: "POST", headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify(path.includes("v3") ? { ...entry, status: "Enabled" } : [entry]) });
        const txt = await r.text();
        out.create.push({ path: path.replace(t || "\u0000", "{tenant}"), status: r.status, body: hide(txt.slice(0, 400)) });
        if (r.ok && !/"ok"\s*:\s*false/.test(txt)) break;
      }
    }
    return res.status(200).json(out);
  }
  if (body.probe) {
    try {
      const { status, j, raw } = await getMessages(phones[0]);
      const items = itemsOf(j);
      const shape = (o) => o && typeof o === "object" && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? `array(${v.length})` : v && typeof v === "object" ? "object" : typeof v])) : typeof o;
      return res.status(200).json({ tenantFound: !!tenant, status, top: j ? shape(j) : raw.slice(0, 120), data: j && j.data ? shape(j.data) : null,
        itemKeys: items[0] ? Object.keys(items[0]) : null,
        sample: items.slice(0, 6).map((m) => ({ owner: m.owner, isOwner: m.isOwner, direction: m.direction, senderType: m.sender_type || m.senderType, type: m.type, eventType: m.eventType, at: timeOf(m) ? new Date(timeOf(m)).toISOString() : null, hasText: !!textOf(m) })) });
    } catch (e) { return res.status(200).json({ error: String(e && e.message).slice(0, 120) }); }
  }

  const replies = [], replied = [], errors = [], toSave = [];
  let next = 0;
  const work = async () => {
    while (next < phones.length) {
      const phone = phones[next++];
      try {
        const { status, j } = await getMessages(phone);
        if (status !== 200) { errors.push(`${phone}: ${status}`); continue; }
        const items = itemsOf(j);
        const mine = items.filter((m) => incoming(m) && timeOf(m) > since).sort((a, b) => timeOf(a) - timeOf(b));
        if (!mine.length) continue;
        if (body.store) mine.forEach((m) => toSave.push({ id: String(m.id || m.whatsapp_message_id || `${phone}-${timeOf(m)}`).slice(0, 100), phone,
          name: String(m.sender_name || m.senderName || "").slice(0, 80), body: textOf(m).slice(0, 4000), kind: String(m.type || "text").slice(0, 30),
          at: new Date(timeOf(m)).toISOString() }));
        replies.push({ phone, at: new Date(timeOf(mine[mine.length - 1])).toISOString(), text: mine.map((m) => textOf(m) || `[${m.type || "message"}]`).join(" | ").slice(0, 500) });
        // reply once: only if we haven't already sent this exact text after their message
        const last = timeOf(mine[mine.length - 1]);
        const answered = items.some((m) => ours(m) && timeOf(m) >= last && textOf(m).trim() === reply);
        if (reply && !answered) {
          const r = await fetch(`${host}/api/ext/v3/conversations/messages/text`, { method: "POST",
            headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ target: phone, text: reply }) });
          const t = await r.text();
          let ok = r.ok;
          try { const k = JSON.parse(t); if (k && k.result === false) ok = false; } catch (_) {}
          if (ok) replied.push(phone); else errors.push(`${phone}: reply ${r.status} ${t.slice(0, 80)}`);
        }
      } catch (e) { errors.push(`${phone}: ${String(e && e.message).slice(0, 80)}`); }
    }
  };
  await Promise.all(Array.from({ length: 5 }, work));
  let saved = null;
  if (body.store) { try { saved = await saveInbox(toSave); } catch (e) { errors.push(`save: ${String(e && e.message).slice(0, 80)}`); } }
  return res.status(200).json({ checked: phones.length, replies, replied, saved, errors: errors.slice(0, 20) });
};
