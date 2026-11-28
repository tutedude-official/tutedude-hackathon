/* ============================================================
   TuteDude Buildathon: organiser panel (admin.html)
   Sign in with email + password. Every admin_* function in supabase.sql checks that the signed-in
   account is on the organiser list (bd_admins), so nothing here is trusted on its own.
   ============================================================ */
(function () {
  "use strict";
  // the organiser panel never runs inside a frame (clickjacking)
  if (window.top !== window.self) { document.documentElement.style.display = "none"; return; }
  document.querySelectorAll("link[data-fonts]").forEach((l) => { l.media = "all"; });
  const C = window.BUILDATHON || {};
  const DOM = Object.fromEntries((C.domains || []).map((d) => [d.key, d]));
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const label = (k) => (DOM[k] ? DOM[k].label : "Other skill");
  const icon = (k) => (DOM[k] ? DOM[k].icon : "✨");
  const safeUrl = (u) => (/^https?:\/\/\S+$/i.test(u || "") ? u : "#");
  const linkify = (s) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener nofollow">$1</a>');
  const fmt = (t) => new Date(t).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).replace(/\b(am|pm)\b/, (x) => x.toUpperCase());
  const num = (n) => Number(n || 0).toLocaleString("en-IN");
  const waNum = (p) => String(p || "").replace(/\D/g, "");
  const MAX = C.maxTeamSize || 4, MIN = C.minTeamSize || 2;
  const mailto = (e) => "mailto:" + encodeURIComponent(String(e || "")).replace(/%40/g, "@");

  let sb = null;
  const S = { tab: "overview", filter: "all", search: "", offset: 0, teams: [], total: 0, notifyTeam: null, moving: null };

  /* ---------- helpers ---------- */
  let toastTimer = 0;
  function toast(msg, bad) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.toggle("bad", !!bad);
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add("show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.classList.remove("show"); setTimeout(() => { el.hidden = true; }, 250); }, 4500);
  }
  function showErr(id, msg) { const el = $(id); el.textContent = msg || ""; el.hidden = !msg; }
  async function rpc(fn, args) {
    const { data, error } = await sb.rpc(fn, args || {});
    if (error) {
      if (/JWT|expired|not authenticated/i.test(error.message)) { signOut().then(() => showErr("#loginErr", "Your sign-in expired. Sign in again.")); throw new Error("Your sign-in expired. Sign in again."); }
      throw new Error(error.message);
    }
    return data;
  }
  async function busy(btn, fn) {
    if (btn) btn.disabled = true;
    try { return await fn(); }
    catch (e) { console.warn(e); toast(e.message || "Something went wrong.", true); }
    finally { if (btn && btn.isConnected) btn.disabled = false; }
  }
  function view(which) {
    ["#admLoading", "#admLogin", "#admDenied", "#admApp"].forEach((s) => { $(s).hidden = s !== which; });
  }

  /* ---------- sign in ---------- */
  async function start() {
    if (!(C.supabase && C.supabase.url) || !(window.supabase && window.supabase.createClient)) {
      $("#admLoading").textContent = "The organiser panel needs the live Supabase settings in config.js.";
      return;
    }
    // own storage key: signing in here never touches a student registration in the same browser
    sb = window.supabase.createClient(C.supabase.url, C.supabase.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "tdb-organiser-auth", storage: window.sessionStorage }
    });
    const { data } = await sb.auth.getSession();
    if (data && data.session) await enter(); else view("#admLogin");
  }
  async function enter() {
    let who;
    try { who = await rpc("admin_whoami"); }
    catch (e) { await sb.auth.signOut(); view("#admLogin"); showErr("#loginErr", e.message); return; }
    if (!who.admin) { $("#deniedEmail").textContent = who.email || "this account"; view("#admDenied"); return; }
    $("#admEmail").textContent = who.email;
    $("#admWho").hidden = false;
    view("#admApp");
    showTab(S.tab);
    if (S.tab !== "wa") loadWa();   // keeps the WhatsApp tab's count of chats waiting for an answer up to date
  }
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    showErr("#loginErr", "");
    const email = $("#lEmail").value.trim(), password = $("#lPass").value;
    if (!email || !password) { showErr("#loginErr", "Enter your email and password."); return; }
    await busy($("#loginBtn"), async () => {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) {
        showErr("#loginErr", /invalid login/i.test(error.message) ? "Wrong email or password."
          : /rate|too many/i.test(error.message) ? "Too many tries. Wait a minute and try again." : error.message);
        return;
      }
      $("#lPass").value = "";
      await enter();
    });
  });
  async function signOut() {
    try { await sb.auth.signOut(); } catch (_) {}
    // drop every phone number and email that was on the page
    clearTimeout(waListTimer); clearTimeout(waChatTimer);
    if (waDlg.open) waDlg.close();
    WA.list = []; WA.seen = 0;
    ["#teamList", "#ovBody", "#actList", "#moveList", "#probPreview", "#teamCount", "#nCount", "#waList", "#waChat", "#waCount"].forEach((s) => { const el = $(s); if (el) el.innerHTML = ""; });
    ["#teamSearch", "#pText", "#pLink", "#nTitle", "#nBody", "#lPass", "#moveSearch", "#waSearch", "#waText"].forEach((s) => { const el = $(s); if (el) el.value = ""; });
    Object.assign(S, { teams: [], total: 0, offset: 0, notifyTeam: null, moving: null, search: "" });
    $("#admEmail").textContent = "";
    $("#admWho").hidden = true;
    view("#admLogin");
  }
  $("#admOut").addEventListener("click", signOut);

  /* ---------- change password (so it never has to be shared) ---------- */
  const pwDlg = $("#pwDlg");
  pwDlg.addEventListener("click", (e) => { if (e.target === pwDlg || e.target.closest("[data-close]")) pwDlg.close(); });
  $("#pwForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    showErr("#pwErr", "");
    const a = $("#pw1").value, b = $("#pw2").value;
    if (a.length < 10) { showErr("#pwErr", "Use at least 10 characters."); return; }
    if (a !== b) { showErr("#pwErr", "The two passwords don't match."); return; }
    const btn = $("#pwForm button[type=submit]");
    btn.disabled = true;
    const { error } = await sb.auth.updateUser({ password: a });
    btn.disabled = false;
    if (error) { showErr("#pwErr", /different from the old/i.test(error.message) ? "That's your current password. Pick a new one." : error.message); return; }
    $("#pw1").value = ""; $("#pw2").value = "";
    pwDlg.close();
    toast("Password changed. Use the new one next time you sign in.");
  });

  /* ---------- tabs ---------- */
  function showTab(tab) {
    S.tab = tab;
    $$(".adm-tabs .tab").forEach((b) => { const on = b.dataset.tab === tab; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); });
    $$(".adm-pane").forEach((p) => { p.hidden = p.id !== "pane-" + tab; });
    ({ overview: loadOverview, teams: () => { loadTeams(true); loadLate(); }, problem: loadProblem, notify: () => { countAudience(); loadWhatsapp(); loadMerge(); }, subs: loadSubs, activity: loadActivity, wa: loadWa }[tab] || (() => {}))();
  }

  /* ---------- overview ---------- */
  function bars(title, rows) {
    const max = Math.max(1, ...rows.map((r) => r[1]));
    return `<div class="adm-card adm-bars"><h3>${esc(title)}</h3>${rows.length ? rows.map(([k, n]) =>
      `<div class="bar"><span>${k}</span><i style="width:${Math.round((Number(n) / max) * 100) || 0}%"></i><b>${num(n)}</b></div>`).join("") : `<p class="muted">Nothing yet.</p>`}</div>`;
  }
  async function loadOverview() {
    const o = await busy(null, () => rpc("admin_overview"));
    if (!o) return;
    const stat = (n, t, warn) => `<div class="adm-stat${warn ? " warn" : ""}"><b>${num(n)}</b><span>${t}</span></div>`;
    const skills = Object.keys(DOM).map((k) => [`${icon(k)} ${esc(label(k))}`, (o.bySkill || {})[k] || 0]);
    const sizes = Object.entries(o.bySize || {}).sort((a, b) => a[0] - b[0]).map(([s, n]) => [`${Number(s) || 0} ${s === "1" ? "person" : "people"}`, n]);
    const daily = (o.daily || []).map((d) => [new Date(d.day + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" }), d.n]);
    $("#ovBody").innerHTML = `
      <div class="adm-stats">
        ${stat(o.people, "registered")}${stat(o.today, "in the last 24 h")}${stat(o.teams, "teams")}
        ${stat(o.ready, `teams ready (${Number(o.min) || MIN}+ people)`)}${stat(o.short, `teams under ${Number(o.min) || MIN} people`, o.short > 0)}
        ${stat(o.full, `full teams (${Number(o.max) || MAX})`)}${stat(o.open, "teams open to new members")}
        ${stat(o.teamless, "registered but not in a team", o.teamless > 0)}
        ${stat(o.notChecked, "emails not checked with TuteDude yet", o.notChecked > 0)}${o.notStudent ? stat(o.notStudent, "emails not on TuteDude", true) : ""}
      </div>
      <div class="adm-status">
        <span class="${o.locked ? "warn-chip" : "ok"}">${o.locked ? "🔒 Teams are locked" : "Teams lock " + esc(fmt(o.deadline))}</span>
        <span class="${o.problemSet ? "ok" : "warn-chip"}">${o.problemSet ? "✓ Problem statement saved" : "Problem statement not saved yet"} · shows ${esc(fmt(o.reveal))}</span>
      </div>
      <div class="adm-grid2">
        ${bars("People by skill", skills)}
        ${bars("Teams by size", sizes)}
        ${bars("Registrations per day (14 days)", daily)}
      </div>
      <h3 class="adm-sub">Messages sent</h3>
      <ol class="adm-sent" id="sentList"><li class="muted">Loading…</li></ol>`;
    loadSent();
  }

  // every message sent to many people: WhatsApp (with WATI's answer) and site + phone notifications
  async function loadSent() {
    let list;
    try { list = await rpc("admin_sent_log"); }
    catch (e) { $("#sentList").innerHTML = `<li class="muted">${esc(e.message)}</li>`; return; }
    const wa = (s) => !s.done ? (s.lost ? "WATI's answer is no longer stored" : "waiting for WATI…")
      : `<span class="${s.failed ? "warn" : "yes"}">✓ WATI accepted ${num(s.accepted)}${s.failed ? `, failed ${num(s.failed)}` : ", failed 0"}</span>`;
    $("#sentList").innerHTML = (list || []).length ? list.map((s) => `<li>
        <span class="when">${esc(fmt(s.at))}</span>
        <span class="ch ${s.channel === "whatsapp" ? "ch-wa" : "ch-site"}">${s.channel === "whatsapp" ? "WhatsApp" : "Site + phone"}</span>
        <span class="what"><b>${esc(s.what)}</b>${s.body ? `<small>${esc(s.body)}</small>` : ""}
          <small>${num(s.people)} ${s.people === 1 ? "person" : "people"}${s.channel === "whatsapp" ? " · " + wa(s) : ""}</small></span></li>`).join("")
      : `<li class="muted">Nothing sent yet.</li>`;
  }

  /* ---------- teams ---------- */
  const showCode = (c) => (c && c.length === 8 ? c.slice(0, 4) + "-" + c.slice(4) : c || "");
  const teamLink = (c) => new URL("./#join=" + showCode(c), location.href).href;
  // TuteDude's API: true = a TuteDude account, false = not on TuteDude, null = couldn't be checked yet
  const studentChip = (v) => (v === true ? `<span class="yes">✓ TuteDude account</span>` : v === false ? `<span class="no">✗ Not on TuteDude</span>` : `<span class="muted">? TuteDude not checked yet</span>`);
  function memberHtml(m, inTeam, t) {
    return `<div class="adm-mem">
        <div class="who"><b>${esc(m.name)}</b>${m.leader ? ` <span class="lead">Leader</span>` : ""}<small>${icon(m.domain)} ${esc(label(m.domain))}${m.skill ? " · " + esc(m.skill) : ""}</small></div>
        <div class="contact"><a href="https://wa.me/${esc(waNum(m.phone))}" target="_blank" rel="noopener">📱 +${esc(waNum(m.phone))}</a>
          <a href="${esc(mailto(m.email))}">✉️ ${esc(m.email)}</a>
          ${studentChip(m.student)}
          <span class="${m.agreed ? "yes" : "no"}">${m.agreed ? "✓ Agreed to TuteDude Sessions" : "✗ Not agreed"}</span>${m.link ? ` <a href="${esc(safeUrl(m.link))}" target="_blank" rel="noopener nofollow">work ↗</a>` : ""}</div>
        <div class="acts"><button type="button" data-act="move" data-person="${esc(m.id)}" data-name="${esc(m.name)}">${inTeam ? "Move" : "Add to a team"}</button>
          ${inTeam ? `<button type="button" data-act="take-out" data-person="${esc(m.id)}" data-name="${esc(m.name)}" data-team-name="${esc(t.name)}" data-alone="${(t.members || []).length <= 1 ? "1" : ""}">Remove from team</button>` : ""}
          <button type="button" class="danger" data-act="remove" data-person="${esc(m.id)}" data-name="${esc(m.name)}">Delete registration</button></div>
      </div>`;
  }
  function teamHtml(t) {
    const members = t.members || [], size = Number(t.size) || 0, ready = size >= MIN;
    return `<article class="adm-team" data-team="${esc(t.id)}">
      <div class="adm-team-head"><h3>${esc(t.name)}</h3>
        <span class="meta"><span class="${ready ? "ok" : "warn-chip"}">${ready ? "✓ Ready" : `Under ${MIN} people`}</span> <b>${size}/${Number(t.cap) || MAX}</b>${t.open ? ` <span class="ok">Open</span>` : ""}${t.closed ? ` <span class="warn-chip">Team is full (closed)</span>` : ""}
          <span class="muted">· code <b class="mono">${esc(showCode(t.code))}</b> <button class="link small" type="button" data-act="copy-link" data-code="${esc(t.code)}">Copy link</button></span>
          <span class="muted">· started ${esc(fmt(t.createdAt))}</span>
          ${size < MAX ? `<button class="link small" type="button" data-act="add-member" data-team="${esc(t.id)}" data-name="${esc(t.name)}">+ Add member</button>` : ""}
          <button class="link small" type="button" data-act="rename" data-team="${esc(t.id)}" data-name="${esc(t.name)}">Rename</button>
          <button class="link small" type="button" data-act="notify-team" data-team="${esc(t.id)}" data-name="${esc(t.name)}">Notify team</button></span></div>
      ${members.map((m) => memberHtml(m, true, t)).join("")}
      ${(t.listed || []).map((l) => `<div class="adm-mem adm-listed">
        <div class="who"><b>${esc(l.name)}</b><small>Added by the leader · hasn't signed up</small></div>
        <div class="contact">${l.phone ? `<a href="https://wa.me/${esc(waNum(l.phone))}" target="_blank" rel="noopener">📱 +${esc(waNum(l.phone))}</a>` : ""}<a href="${esc(mailto(l.email))}">✉️ ${esc(l.email)}</a>${studentChip(l.student)}</div>
        <div class="acts"><button type="button" class="danger" data-act="remove-listed" data-id="${esc(l.id)}" data-name="${esc(l.name)}">Remove</button></div>
      </div>`).join("")}
    </article>`;
  }
  let teamsSeq = 0;
  async function loadTeams(reset) {
    const seq = ++teamsSeq;   // only the newest request may draw (filters/search clicked quickly)
    if (reset) { S.offset = 0; S.teams = []; }
    const more = $("#teamMore");
    more.disabled = true;
    const r = await busy(null, () => rpc("admin_teams", { p_filter: S.filter, p_search: S.search, p_offset: reset ? 0 : S.offset }));
    if (seq !== teamsSeq) return;
    more.disabled = false;
    if (!r) return;
    S.total = r.total;
    const people = S.filter === "teamless";
    S.teams = S.teams.concat((people ? r.people : r.teams) || []);
    S.offset = S.teams.length;
    $("#teamCount").textContent = `${num(r.total)} ${people ? (r.total === 1 ? "person" : "people") + " not in a team" : r.total === 1 ? "team" : "teams"}${S.search ? ` matching “${S.search}”` : ""}`;
    $("#teamList").innerHTML = !S.teams.length ? `<p class="empty">${people ? "Everyone registered is in a team." : "No teams here."}</p>`
      : people ? `<article class="adm-team"><div class="adm-team-head"><h3>Not in a team</h3><span class="meta muted">They left or were removed. Add them to a team with room, or ask them to create or join one.</span></div>${S.teams.map((m) => memberHtml(m, false)).join("")}</article>`
      : S.teams.map(teamHtml).join("");
    $("#teamMore").hidden = S.teams.length >= S.total;
  }
  let searchTimer = 0;
  $("#teamSearch").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { S.search = $("#teamSearch").value.trim(); loadTeams(true); }, 350);
  });
  $("#teamFilters").addEventListener("click", (e) => {
    const b = e.target.closest("[data-filter]");
    if (!b) return;
    S.filter = b.dataset.filter;
    $$("#teamFilters .chip").forEach((c) => c.classList.toggle("on", c === b));
    loadTeams(true);
  });

  /* move dialog */
  const moveDlg = $("#moveDlg");
  moveDlg.addEventListener("click", (e) => { if (e.target === moveDlg || e.target.closest("[data-close]")) moveDlg.close(); });
  async function loadMoveOptions() {
    const list = await busy(null, () => rpc("admin_team_options", { p_person: S.moving.id, p_search: $("#moveSearch").value.trim() }));
    if (!list) return;
    $("#moveList").innerHTML = list.length ? list.map((t) => `<li><button type="button" data-act="move-to" data-team="${esc(t.id)}" data-name="${esc(t.name)}"><span>${esc(t.name)}</span><span>${Number(t.size) || 0}/${MAX}</span></button></li>`).join("")
      : `<li class="muted">No team has room${$("#moveSearch").value ? " with that name or code" : ""}.</li>`;
  }
  let moveTimer = 0;
  $("#moveSearch").addEventListener("input", () => { clearTimeout(moveTimer); moveTimer = setTimeout(loadMoveOptions, 300); });
  async function doMove(btn, teamId, teamName) {
    const p = S.moving;
    if (!confirm(`Put ${p.name} in ${teamName}? They and the teams get a notification.`)) return;
    await busy(btn, async () => {
      const name = await rpc("admin_move", { p_person: p.id, p_team: teamId });
      moveDlg.close();
      toast(`${p.name} moved to ${name}.`);
      loadTeams(true);
    });
  }

  /* add-member dialog: search anyone registered and put them in this team (moving them out of their old one) */
  const addDlg = $("#addDlg");
  addDlg.addEventListener("click", (e) => { if (e.target === addDlg || e.target.closest("[data-close]")) addDlg.close(); });
  let addSeq = 0;
  async function loadAddOptions() {
    const seq = ++addSeq, q = $("#addSearch").value.trim();
    const list = await busy(null, () => rpc("admin_people_options", { p_team: S.adding.id, p_search: q }));
    if (!list || seq !== addSeq) return;
    S.addList = list;
    $("#addList").innerHTML = list.length ? list.map((p, i) => `<li><button type="button" data-act="add-pick" data-i="${i}">
        <span>${esc(p.name)}<small>${esc(p.email)} · +${esc(waNum(p.phone))}</small></span>
        <span>${p.team ? `In ${esc(p.team)}${p.leader ? " (leader)" : ""}` : "No team"}</span></button></li>`).join("")
      : `<li class="muted">${q ? "Nobody matches that name, email or number." : "Everyone registered is in a team. Search a name, email or number to move someone here."}</li>`;
  }
  let addTimer = 0;
  $("#addSearch").addEventListener("input", () => { clearTimeout(addTimer); addTimer = setTimeout(loadAddOptions, 300); });
  async function doAdd(btn, p) {
    const t = S.adding;
    if (p.team && p.submitted && p.teamMembers <= 1) {
      alert(`${p.name} is the only member of ${p.team}, which already submitted its project. Moving them would delete that team and its submission.`);
      return;
    }
    const msg = p.team
      ? `${p.name} is in ${p.team} now. Move them to ${t.name}?`
        + (p.teamMembers <= 1 ? ` They are the only member, so ${p.team} will be deleted.` : p.leader ? ` The next member of ${p.team} becomes its leader.` : "")
        + (p.submitted && p.teamMembers > 1 ? ` (${p.team} has already submitted; the submission stays with ${p.team}.)` : "")
        + " Everyone involved gets a notification."
      : `Add ${p.name} to ${t.name}? They and the team get a notification.`;
    if (!confirm(msg)) return;
    await busy(btn, async () => {
      await rpc("admin_move", { p_person: p.id, p_team: t.id });
      addDlg.close();
      toast(`${p.name} added to ${t.name}.`);
      loadTeams(true);
    });
  }

  /* CSV */
  async function exportCsv(btn) {
    await busy(btn, async () => {
      const rows = await rpc("admin_export");
      const cols = ["team", "teamCode", "teamSize", "teamReady", "teamOpen", "leader", "name", "skill", "whatsapp", "email", "bio", "link", "signedUp", "tutedudeStudent", "agreedToSession", "agreedToWhatsappRules", "registeredAt"];
      // a cell starting with = + - @ would run as a formula in Excel / Google Sheets: prefix it with '
      const cell = (v) => { let s = v == null ? "" : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const csv = "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      a.download = `buildathon-teams-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast(`Exported ${num(rows.length)} people.`);
    });
  }

  /* ---------- problem statement ---------- */
  function previewProblem() {
    const tx = $("#pText").value.trim(), lk = $("#pLink").value.trim();
    $("#probPreview").innerHTML = `<div class="problem-card"><p class="kicker">📢 Problem statement</p>
      ${tx ? `<div class="problem-text">${linkify(tx).replace(/\n/g, "<br>")}</div>` : `<p class="muted">Nothing written yet.</p>`}
      ${lk ? `<span class="row-btns"><a class="btn btn-sm" href="${esc(safeUrl(lk))}" target="_blank" rel="noopener">Open the full problem statement ↗</a></span>` : ""}</div>`;
  }
  async function loadProblem() {
    const p = await busy(null, () => rpc("admin_get_problem"));
    if (!p) return;
    $("#pText").value = p.text || "";
    $("#pLink").value = p.link || "";
    $("#probWhen").innerHTML = p.live ? `<b>It's live:</b> students in teams of 2+ see it now.`
      : `Students see it on their team page from <b>${esc(fmt(p.reveal))}</b> (teams of 2+). It's never on the public page.`;
    previewProblem();
    loadProblemWa();
  }

  // the problem statement on WhatsApp: who gets it, the exact message, and what WATI said
  let probWaTimer = null;
  async function loadProblemWa() {
    clearTimeout(probWaTimer);
    try {
      const [r, st] = await Promise.all([rpc("admin_whatsapp_problem", { p_dry_run: true }), rpc("admin_whatsapp_problem_status")]);
      $("#probWaCount").textContent = `${num(r.count)} ${r.count === 1 ? "person is" : "people are"} in teams of 2 or more and ${r.count === 1 ? "gets" : "get"} it.`
        + (r.live ? "" : ` It can go out from ${fmt(r.reveal)}.`);
      $("#probWaMsg").hidden = !r.message;
      $("#probWaMsg").textContent = r.message ? `Hi (first name), an update on your TuteDude Buildathon registration: ${r.message} Your team link: (their team link). Team TuteDude` : "";
      $("#probWaSend").disabled = !r.count || !r.live || !r.message || !st.ready;
      $("#probWaSend").textContent = st.at ? "Send it on WhatsApp again" : "Send it on WhatsApp now";
      const when = st.at ? new Date(st.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
      $("#probWaStatus").textContent = !st.ready ? "WhatsApp is not set up yet: see “WhatsApp reminder (WATI)” in README.md."
        : !r.message ? "Save the problem statement first."
        : !st.at ? "Not sent on WhatsApp yet."
        : !st.done ? `Sent ${when} to ${num(st.count)} people: waiting for WATI…`
        : `Sent ${when}: WATI accepted ${num(st.accepted)}${st.failed ? `, refused ${num(st.failed)}` : ""}.${st.error ? " " + st.error : ""}`;
      if (st.at && !st.done && S.tab === "problem") probWaTimer = setTimeout(loadProblemWa, 4000);
    } catch (e) { $("#probWaStatus").textContent = e.message; }
  }
  $("#probWaSend").addEventListener("click", async () => {
    showErr("#probWaErr", "");
    const btn = $("#probWaSend");
    btn.disabled = true;
    try {
      const r = await rpc("admin_whatsapp_problem", { p_dry_run: true });
      const again = !!r.sent;
      if (!confirm(`${again ? "It already went out once. Send it again" : "Send the problem statement"} on WhatsApp to ${num(r.count)} ${r.count === 1 ? "person" : "people"}?`)) return;
      const sent = await rpc("admin_whatsapp_problem", { p_dry_run: false, p_again: again });
      toast(`Sending the problem statement to ${num(sent.count)} ${sent.count === 1 ? "person" : "people"} on WhatsApp.`);
    } catch (err) { showErr("#probWaErr", err.message); }
    finally { btn.disabled = false; loadProblemWa(); }
  });
  $("#pText").addEventListener("input", previewProblem);
  $("#pLink").addEventListener("input", previewProblem);
  $("#probForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    showErr("#probErr", "");
    const btn = $("#probForm button[type=submit]");
    btn.disabled = true;
    try { await rpc("admin_set_problem", { p_text: $("#pText").value, p_link: $("#pLink").value }); toast("Problem statement saved."); loadProblemWa(); }
    catch (err) { showErr("#probErr", err.message); }
    btn.disabled = false;
  });

  /* ---------- after the lock: teams of 2 open to new members ---------- */
  async function loadLate() {
    try {
      const r = await rpc("admin_late_teams", { p_dry_run: true });
      $("#lateCount").textContent = `${num(r.open)} ${r.open === 1 ? "team is" : "teams are"} open now` + (r.teamsOf2 ? ` · ${num(r.teamsOf2)} more ${r.teamsOf2 === 1 ? "team has" : "teams have"} 2 people` : "");
      $("#lateOpenBtn").disabled = !r.teamsOf2;
      $("#lateCloseBtn").disabled = !r.open;
    } catch (e) { $("#lateCount").textContent = e.message; }
  }
  async function setLate(open) {
    showErr("#lateErr", "");
    const btn = $(open ? "#lateOpenBtn" : "#lateCloseBtn");
    if (!confirm(open ? "Open every team of 2 people again? New students can join them with the team link, and leaders can add teammates (up to 5)."
      : "Close all reopened teams? Nobody new can join them after this.")) return;
    btn.disabled = true;
    try {
      const r = await rpc("admin_late_teams", { p_open: open });
      toast(open ? `${num(r.changed)} ${r.changed === 1 ? "team is" : "teams are"} open to new members.` : `${num(r.changed)} ${r.changed === 1 ? "team" : "teams"} closed to new members.`);
    } catch (e) { showErr("#lateErr", e.message); }
    loadLate();
  }
  $("#lateOpenBtn").addEventListener("click", () => setLate(true));
  $("#lateCloseBtn").addEventListener("click", () => setLate(false));

  /* ---------- notify ---------- */
  async function countAudience() {
    const aud = $("#nAudience").value;
    $("#nCount").textContent = "Counting…";
    try {
      const n = await rpc("admin_notify", { p_audience: aud, p_title: "", p_body: "", p_team: aud === "team" ? S.notifyTeam && S.notifyTeam.id : null, p_dry_run: true });
      $("#nCount").textContent = `${num(n)} ${n === 1 ? "person" : "people"} will get it.`;
      return n;
    } catch (e) { $("#nCount").textContent = e.message; return -1; }
  }
  $("#nAudience").addEventListener("change", countAudience);
  $("#notifyForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    showErr("#notifyErr", "");
    const aud = $("#nAudience").value, title = $("#nTitle").value.trim(), body = $("#nBody").value.trim();
    if (title.length < 2) { showErr("#notifyErr", "Write a title."); return; }
    const n = await countAudience();
    if (n < 0) { showErr("#notifyErr", $("#nCount").textContent || "Couldn't count the group. Try again."); return; }
    if (!n) { showErr("#notifyErr", "Nobody is in that group."); return; }
    if (!confirm(`Send “${title}” to ${num(n)} ${n === 1 ? "person" : "people"}?`)) return;
    const btn = $("#notifyForm button[type=submit]");
    btn.disabled = true;
    try {
      const sent = await rpc("admin_notify", { p_audience: aud, p_title: title, p_body: body, p_team: aud === "team" ? S.notifyTeam.id : null, p_dry_run: false });
      toast(`Sent to ${num(sent)} ${sent === 1 ? "person" : "people"}.`);
      $("#nTitle").value = ""; $("#nBody").value = "";
    } catch (err) { showErr("#notifyErr", err.message); }
    btn.disabled = false;
  });

  /* ---------- WhatsApp reminder (WATI) to people alone in their team ---------- */
  let waTimer = 0;
  async function loadWhatsapp() {
    clearTimeout(waTimer);
    try {
      const [n, st] = await Promise.all([rpc("admin_whatsapp", { p_dry_run: true }), rpc("admin_whatsapp_status")]);
      $("#waCount").textContent = `${num(n)} ${n === 1 ? "person is" : "people are"} alone in their team right now.`;
      $("#waSend").disabled = !n || !st.ready;
      const when = st.at ? new Date(st.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
      $("#waStatus").textContent = !st.ready ? "WhatsApp is not set up yet: see “WhatsApp reminder (WATI)” in README.md."
        : !st.at ? "No WhatsApp reminder sent yet."
        : !st.done ? `Last WhatsApp send (${when}, ${num(st.count)} people): waiting for WATI…`
        : st.ok ? `Last WhatsApp send (${when}): WATI accepted ${num(st.accepted)}${st.failed ? `, refused ${num(st.failed)}` : ""}.${st.error ? " " + st.error : ""}`
        : `Last WhatsApp send (${when}) failed: ${st.error || "no answer"}`;
      if (st.at && !st.done && S.tab === "notify") waTimer = setTimeout(loadWhatsapp, 4000);
    } catch (e) { $("#waStatus").textContent = e.message; }
  }
  $("#waSend").addEventListener("click", async () => {
    showErr("#waErr", "");
    const btn = $("#waSend");
    btn.disabled = true;
    try {
      const n = await rpc("admin_whatsapp", { p_dry_run: true });
      if (!n) { showErr("#waErr", "Nobody is alone in a team."); return; }
      if (!confirm(`Send the WhatsApp reminder to ${num(n)} ${n === 1 ? "person" : "people"}?`)) return;
      const sent = await rpc("admin_whatsapp", { p_dry_run: false });
      toast(`Sending to ${num(sent)} ${sent === 1 ? "person" : "people"} on WhatsApp.`);
    } catch (err) { showErr("#waErr", err.message); }
    finally { btn.disabled = false; loadWhatsapp(); }
  });

  /* ---------- teams of one → teams of 5 (and a WhatsApp message with the new teammates) ---------- */
  async function loadMerge(show) {
    try {
      const r = await rpc("admin_merge_solos", { p_dry_run: true });
      $("#mergeCount").textContent = r.people < 2
        ? (r.people ? "Only 1 person is alone in a team: nobody to put them with." : "Nobody is alone in a team.")
        : `${num(r.people)} people are alone in their team → ${num(r.teams)} ${r.teams === 1 ? "team" : "teams"} of ${[...new Set(r.groups.map((g) => g.people.length))].sort((a, b) => b - a).join(" or ")}.`;
      $("#mergeRun").disabled = $("#mergePreview").disabled = r.people < 2;
      const list = $("#mergeList");
      if (show) list.innerHTML = r.groups.map((g) => `<li><b>${esc(g.team)}</b>: ${g.people.map(esc).join(", ")}</li>`).join("");
      list.hidden = !show || !r.groups.length;
      return r;
    } catch (e) { $("#mergeCount").textContent = e.message; return null; }
  }
  $("#mergePreview").addEventListener("click", () => loadMerge(true));
  $("#mergeRun").addEventListener("click", async () => {
    showErr("#mergeErr", "");
    const btn = $("#mergeRun");
    btn.disabled = true;
    try {
      const p = await loadMerge(true);
      if (!p || p.people < 2) return;
      if (!confirm(`Put ${num(p.people)} people who are alone into ${num(p.teams)} teams (listed below), and message each of them on the site, phone and WhatsApp?\n\nPeople move between teams. This can't be undone in one click.`)) return;
      const r = await rpc("admin_merge_solos", { p_dry_run: false });
      toast(`Done: ${num(r.people)} people are now in ${num(r.teams)} teams.${r.whatsapp ? ` WhatsApp is going to ${num(r.whatsapp)}.` : ""}`);
      if (r.note) showErr("#mergeErr", r.note);
      await loadMerge(false);
      loadWhatsapp();
    } catch (err) { showErr("#mergeErr", err.message); }
    finally { btn.disabled = $("#mergePreview").disabled; }
  });

  /* ---------- submissions ---------- */
  const link = (u, label) => (/^https?:\/\/\S+$/i.test(u || "") ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${label} ↗</a>` : "");
  async function loadSubs() {
    const list = await busy(null, () => rpc("admin_submissions"));
    if (!list) return;
    S.subs = list;
    $("#subCount").textContent = `(${num(list.length)})`;
    $("#subList").innerHTML = list.length ? list.map((s) => `<div class="adm-card adm-sub">
        <div class="adm-sub-head"><div><h3>${esc(s.title)}</h3><p class="muted small">${esc(s.team)} · ${num(s.teamSize)} people · leader ${esc(s.leader || "–")}${s.submittedBy && s.submittedBy !== s.leader ? ` · submitted by ${esc(s.submittedBy)}` : ""} · ${esc(fmt(s.submittedAt))}${s.driveLink ? "" : ' · <b class="no">old form: no Drive folder yet</b>'}</p></div>
          <button class="btn btn-sm btn-ghost" type="button" data-act="sub-delete" data-id="${esc(s.teamId)}" data-name="${esc(s.team)}">Reopen</button></div>
        <p>${esc(s.summary)}</p>
        <p class="adm-sub-links">${link(s.projectLink, s.driveLink ? "Live product" : "Project")}${link(s.websiteLink, s.driveLink ? "Landing page" : "Website")}${link(s.videoLink, s.driveLink ? "Explainer video" : "Promo video")}${link(s.driveLink, "Drive folder")}${link(s.githubLink, "GitHub")}${link(s.instagramLink, "Instagram")}${link(s.xLink, "X")}</p>
        ${s.postLinks ? `<p class="adm-sub-links">${s.postLinks.split("\n").filter(Boolean).map((u, i) => link(u, "Post " + (i + 1))).join("")}</p>` : ""}
      </div>`).join("") : `<p class="muted">No submissions yet.</p>`;
  }
  async function exportSubs(btn) {
    await busy(btn, async () => {
      const rows = await rpc("admin_submissions");
      const cols = ["team", "teamCode", "teamSize", "leader", "leaderWhatsapp", "leaderEmail", "submittedBy", "submittedByWhatsapp", "submittedByEmail", "title", "summary", "projectLink", "websiteLink", "videoLink", "driveLink", "githubLink", "instagramLink", "xLink", "postLinks", "submittedAt"];
      const cell = (v) => { let s = v == null ? "" : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const csv = "\ufeff" + [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      a.download = `buildathon-submissions-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast(`Exported ${num(rows.length)} submissions.`);
    });
  }

  /* ---------- activity ---------- */
  async function loadActivity() {
    const list = await busy(null, () => rpc("admin_activity", { p_limit: 150 }));
    if (!list) return;
    $("#actList").innerHTML = list.length ? list.map((a) => `<li><time>${esc(fmt(a.at))}</time><span class="tm">${esc(a.team)}</span><span>${esc(a.text)}</span></li>`).join("")
      : `<li class="muted">Nothing yet.</li>`;
  }

  /* ---------- WhatsApp replies (live) ----------
     WATI sends every message people write to the Buildathon number to the notify server, which saves it
     (wa_inbox in supabase.sql). The list comes from the database; one chat in full, and answers, go through
     the notify server (push-server/api/wa-admin.js), which checks that this is an organiser. */
  const NOTIFY = "https://buildathon-notify.vercel.app";
  const waDlg = $("#waDlg");
  const WA = { list: [], filter: "all", open: null, seen: 0 };
  let waListTimer = 0, waChatTimer = 0;
  const ago = (t) => {
    const s = Math.max(0, (Date.now() - Date.parse(t)) / 1000);
    return s < 60 ? "just now" : s < 3600 ? Math.floor(s / 60) + " min ago" : s < 86400 ? Math.floor(s / 3600) + " h ago" : fmt(t);
  };
  const waWaiting = (c) => !c.lastMine;
  const waName = (c) => c.name || c.waName || "+" + c.phone;
  const waText = (body, kind) => body ? body : `[${kind && kind !== "text" ? kind : "message"}]`;
  async function waApi(body) {
    const { data } = await sb.auth.getSession();
    const tok = data && data.session && data.session.access_token;
    if (!tok) throw new Error("Your sign-in expired. Sign in again.");
    const r = await fetch(NOTIFY + "/api/wa-admin", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || `The WhatsApp server answered ${r.status}.`);
    return j;
  }
  async function loadWa() {
    clearTimeout(waListTimer);
    if ($("#admApp").hidden) return;
    try {
      const list = await rpc("admin_wa_inbox", { p_limit: 300 });
      const newest = Math.max(0, ...list.filter((c) => c.lastIn).map((c) => Date.parse(c.lastIn)));
      if (WA.seen && newest > WA.seen) {
        const c = list.find((x) => x.lastIn && Date.parse(x.lastIn) === newest);
        if (c) toast(`New WhatsApp message from ${waName(c)}: ${waText(c.last, c.lastKind).slice(0, 80)}`);
      }
      WA.seen = Math.max(WA.seen, newest);
      WA.list = list;
      $("#waLive").classList.remove("off");
      $("#waLive").textContent = "Live";
      drawWa();
    } catch (e) {
      $("#waLive").classList.add("off");
      $("#waLive").textContent = "Offline";
      if (!WA.list.length) $("#waList").innerHTML = `<li class="muted">${esc(e.message)}</li>`;
    }
    waListTimer = setTimeout(loadWa, S.tab === "wa" && !document.hidden ? 10000 : 30000);
  }
  function drawWa() {
    const all = WA.list || [];
    const waiting = all.filter(waWaiting).length;
    $("#waBadge").textContent = waiting;
    $("#waBadge").hidden = !waiting;
    const q = $("#waSearch").value.trim().toLowerCase(), qd = q.replace(/\D/g, "");
    const rows = all.map((c, i) => ({ c, i })).filter(({ c }) => (WA.filter !== "open" || waWaiting(c))
      && (!q || [c.name, c.waName, c.team, c.last, c.email].some((v) => String(v || "").toLowerCase().includes(q)) || (qd.length >= 4 && c.phone.includes(qd))));
    $("#waCount").textContent = all.length ? `${num(all.length)} ${all.length === 1 ? "person" : "people"} wrote · ${num(waiting)} waiting for an answer`
      + (rows.length !== all.length ? ` · showing ${num(rows.length)}` : "") : "";
    $("#waList").innerHTML = rows.length ? rows.map(({ c, i }) => `<li><button type="button" class="adm-chat-row${waWaiting(c) ? " waiting" : ""}" data-act="wa-open" data-i="${i}">
        <span class="top"><b>${esc(waName(c))}</b>${c.team ? `<span class="tm">${esc(c.team)}</span>` : `<span class="tm none">${c.name ? "No team" : "Not registered"}</span>`}<time datetime="${esc(c.lastAt)}">${esc(ago(c.lastAt))}</time></span>
        <span class="msg">${c.lastMine ? "<i>You:</i> " : ""}${esc(waText(c.last, c.lastKind))}</span>
        <span class="sub">+${esc(c.phone)} · ${num(c.incoming)} message${Number(c.incoming) === 1 ? "" : "s"} from them${waWaiting(c) ? ' · <b class="wait">Waiting for an answer</b>' : ""}</span>
      </button></li>`).join("")
      : `<li class="muted">${all.length ? "No chat matches." : "No replies yet. New WhatsApp messages show up here by themselves."}</li>`;
  }
  $("#waSearch").addEventListener("input", drawWa);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && S.tab === "wa" && !$("#admApp").hidden) loadWa(); });

  function openWa(c) {
    WA.open = c;
    $("#waTitle").textContent = waName(c);
    $("#waMeta").innerHTML = ["+" + esc(c.phone) + (c.waName && c.name && c.waName !== c.name ? ` (on WhatsApp: ${esc(c.waName)})` : ""),
      c.team ? `Team <b>${esc(c.team)}</b>, ${num(c.teamSize)} ${Number(c.teamSize) === 1 ? "person" : "people"}${c.submitted ? ", submitted" : ""}` : (c.name ? "Not in a team" : "Not registered on the site"),
      esc(c.email || "")].filter(Boolean).join(" · ");
    $("#waOpenWa").href = "https://wa.me/" + waNum(c.phone);
    $("#waText").value = "";
    showErr("#waErr", "");
    $("#waWindow").textContent = "";
    $("#waChat").innerHTML = `<p class="muted">Loading the chat…</p>`;
    if (!waDlg.open) waDlg.showModal();
    loadChat(true);
  }
  async function loadChat(first) {
    clearTimeout(waChatTimer);
    const c = WA.open;
    if (!c || !waDlg.open) return;
    let msgs, full = true;
    try { msgs = (await waApi({ action: "history", phone: c.phone })).messages || []; }
    catch (e) { full = false; try { msgs = await rpc("admin_wa_chat", { p_phone: c.phone }); } catch (_) { msgs = []; } }
    if (WA.open !== c || !waDlg.open) return;
    drawChat(msgs, full, first);
    waChatTimer = setTimeout(() => loadChat(false), 10000);
  }
  function drawChat(msgs, full, first) {
    const box = $("#waChat");
    const atEnd = first || box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
    box.innerHTML = (full ? "" : `<p class="form-note">WATI didn't answer, so this shows only what was saved here.</p>`)
      + (msgs.length ? msgs.map((m) => `<div class="bub ${m.mine ? "bub-out" : "bub-in"}${m.kind === "broadcast" ? " bub-bc" : ""}">`
        + (m.kind === "broadcast" ? `<small class="bub-tag">Message to everyone</small>` : "")
        + `<p>${m.text ? linkify(m.text) : `<i>${esc(waText("", m.kind))}</i>`}</p>`
        + `<time>${esc(fmt(m.at))}${m.mine && m.who ? " · " + esc(m.who) : ""}</time></div>`).join("")
        : `<p class="muted">No messages yet.</p>`);
    if (atEnd) box.scrollTop = box.scrollHeight;
    // WhatsApp delivers a typed answer only within 24 hours of their last message
    const lastIn = Math.max(0, ...msgs.filter((m) => !m.mine).map((m) => Date.parse(m.at) || 0));
    const until = lastIn + 24 * 3600e3, open = lastIn > 0 && Date.now() < until;
    $("#waSendBtn").disabled = !open;
    $("#waWindow").textContent = open ? `You can answer here until ${fmt(until)}. WhatsApp allows typed answers for 24 hours after their last message.`
      : "WhatsApp won't deliver a typed answer: their last message is more than 24 hours old. Use Open in WhatsApp instead.";
  }
  waDlg.addEventListener("click", (e) => { if (e.target === waDlg || e.target.closest("[data-close]")) waDlg.close(); });
  waDlg.addEventListener("close", () => { WA.open = null; clearTimeout(waChatTimer); });
  $("#waText").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $("#waForm").requestSubmit(); } });
  $("#waForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const c = WA.open, text = $("#waText").value.trim();
    if (!c) return;
    if (!text) { showErr("#waErr", "Type a message first."); return; }
    showErr("#waErr", "");
    busy($("#waSendBtn"), async () => {
      try { await waApi({ action: "send", phone: c.phone, text }); }
      catch (err) { showErr("#waErr", err.message); return; }
      $("#waText").value = "";
      toast(`Sent to ${waName(c)} on WhatsApp.`);
      loadChat(false);
      loadWa();
    });
  });

  /* ---------- clicks ---------- */
  document.addEventListener("click", (e) => {
    const tab = e.target.closest(".adm-tabs [data-tab]");
    if (tab) { showTab(tab.dataset.tab); return; }
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const d = b.dataset;
    switch (d.act) {
      case "sign-out": return signOut();
      case "change-pw": showErr("#pwErr", ""); pwDlg.showModal(); $("#pw1").focus(); return;
      case "reload": return showTab(S.tab);
      case "more": return loadTeams(false);
      case "wa-filter":
        WA.filter = d.f;
        $$("[data-act=wa-filter]").forEach((x) => x.classList.toggle("on", x === b));
        return drawWa();
      case "wa-open": { const c = WA.list[Number(d.i)]; if (c) openWa(c); return; }
      case "export": return exportCsv(b);
      case "sub-export": return exportSubs(b);
      case "sub-delete":
        if (!confirm(`Remove the submission of ${d.name}? Anyone in their team can then submit again.`)) return;
        return busy(b, async () => { await rpc("admin_delete_submission", { p_team: d.id }); toast("Submission removed. The team was told."); loadSubs(); });
      case "recheck":
        return busy(b, async () => {
          const r = await rpc("admin_recheck_students", { p_limit: 20 });
          toast(`Checked ${num(r.checked)}: ${num(r.students)} on TuteDude, ${num(r.notStudents)} not, ${num(r.unknown)} still unknown. ${num(r.left)} left to check.`);
          showTab(S.tab);
        });
      case "copy-link": {
        const link = teamLink(d.code);
        if (navigator.clipboard) navigator.clipboard.writeText(link).then(() => toast("Team link copied."), () => prompt("Team link:", link));
        else prompt("Team link:", link);
        return;
      }
      case "rename": {
        const nm = prompt("New team name:", d.name);
        if (nm && nm.trim() !== d.name) busy(b, async () => { await rpc("admin_rename_team", { p_team: d.team, p_name: nm }); toast("Team renamed."); loadTeams(true); });
        return;
      }
      case "notify-team":
        S.notifyTeam = { id: d.team, name: d.name };
        $("#nTeamOpt").hidden = false;
        $("#nTeamOpt").textContent = `One team: ${d.name}`;
        $("#nAudience").value = "team";
        showTab("notify");
        return;
      case "move":
        S.moving = { id: d.person, name: d.name };
        $("#moveTitle").textContent = `${b.textContent.trim() === "Move" ? "Move" : "Add"} ${d.name}`;
        $("#moveSearch").value = "";
        $("#moveList").innerHTML = `<li class="muted">Loading…</li>`;
        moveDlg.showModal();
        loadMoveOptions();
        return;
      case "move-to": return doMove(b, d.team, d.name);
      case "add-member":
        S.adding = { id: d.team, name: d.name };
        $("#addTitle").textContent = `Add someone to ${d.name}`;
        $("#addSearch").value = "";
        $("#addList").innerHTML = `<li class="muted">Loading…</li>`;
        addDlg.showModal();
        $("#addSearch").focus();
        loadAddOptions();
        return;
      case "add-pick": {
        const p = S.addList && S.addList[Number(d.i)];
        if (p) doAdd(b, p);
        return;
      }
      case "take-out":
        if (confirm(`Take ${d.name} out of ${d.teamName}? They stay registered: you can add them to another team, or they can join one that's still open with its team link.`
          + (d.alone ? ` They are the only member, so ${d.teamName} will be deleted.` : "") + " They and the team get a notification.")) {
          busy(b, async () => { const tn = await rpc("admin_take_out", { p_person: d.person }); toast(`${d.name} was taken out of ${tn}.`); loadTeams(true); });
        }
        return;
      case "remove-listed":
        if (confirm(`Take ${d.name} off their team? (They were added by the leader and haven't signed up.)`)) {
          busy(b, async () => { const nm = await rpc("admin_remove_listed", { p_id: d.id }); toast(`${nm} was removed.`); loadTeams(true); });
        }
        return;
      case "remove":
        if (confirm(`Delete ${d.name}'s registration completely? Use this for fake or outsider registrations. It can't be undone.`)) {
          busy(b, async () => { const nm = await rpc("admin_remove_person", { p_person: d.person }); toast(`${nm} was removed.`); loadTeams(true); });
        }
        return;
    }
  });

  start().catch((e) => { console.error(e); $("#admLoading").textContent = "Couldn't load. Check your internet and refresh."; });
})();
