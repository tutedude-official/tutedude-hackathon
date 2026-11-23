/* ============================================================
   TuteDude Buildathon: Team Board
   Students bring their own team: the leader registers the team (adding teammates by name + email, if
   they like) and gets a team link; teammates can open the link to take their spot and see the team page.
   2 to 5 people, any mix of skills.
   Everyone watches the TuteDude Sessions video and agrees to it while registering.
   No team yet? Join a team whose leader opened it to new members (picked from a list), or come to a
   daily Team Building Session on TuteDude (config.teamBuilding).

   Two backends with the same interface:
   - demo (config.supabase = null): sample teams, data stays in this browser. After you create a
          team, sample teammates join it with your link so you can watch it fill up.
   - live (config.supabase set): Supabase. Every rule is checked in the database
          functions in supabase.sql; this file only calls them.
   ============================================================ */
(function () {
  "use strict";
  const C = window.BUILDATHON || {};
  const DOMAINS = C.domains || [];
  const DOM = Object.fromEntries(DOMAINS.map((d) => [d.key, d]));
  const MAX = C.maxTeamSize || 4, MIN = C.minTeamSize || 2;
  // known straight from config, so the page can react before the backend has loaded
  const LIVE = !!(C.supabase && C.supabase.url);
  const LOGIN = LIVE ? (C.login === "anonymous" ? "anonymous" : "google") : "demo";
  const DEADLINE = Date.parse(C.teamDeadline);
  const locked = () => !isNaN(DEADLINE) && Date.now() > DEADLINE;
  // the problem statement appears on team pages at REVEAL
  const REVEAL = Date.parse(C.buildDay);
  const revealed = () => !isNaN(REVEAL) && Date.now() >= REVEAL;
  const SUBMIT_BY = Date.parse(C.submitBy);
  const SUBMIT_FROM = Date.parse(C.submitFrom);
  const submitEarly = () => !revealed() || (!isNaN(SUBMIT_FROM) && Date.now() < SUBMIT_FROM);   // the window has not opened yet
  const submitOpen = () => !submitEarly() && (isNaN(SUBMIT_BY) || Date.now() <= SUBMIT_BY);
  const urlOk = (u) => /^https?:\/\/[^\s<>"']+\.[^\s<>"']+$/i.test(u || "") && u.length <= 300;
  const TB = C.teamBuilding || {};

  /* ---------- helpers ---------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const first = (n) => clean(n).split(" ")[0] || "there";
  const label = (k) => (DOM[k] ? DOM[k].label : "Other skill");
  const LEAVE_MS = (Number(C.leaveHours) > 0 ? Number(C.leaveHours) : 24) * 36e5;   // "Leave team" is open this long after joining
  const MATES_AT_SIGNUP = C.matesAtSignup !== false;                       // false: only the leader registers, teammates join by link
  const ASK_SKILL = C.askSkill !== false;                                   // false: open to everyone, no skill question
  const hasSkill = (k) => ASK_SKILL || (!!k && k !== "other");              // someone who never picked a skill shows none
  const skillTag = (k) => (hasSkill(k) ? ` (${label(k)})` : "");
  // Lucide icons from the SVG sprite at the top of index.html
  const ic = (n, cls) => `<svg class="ic${cls ? " " + cls : ""}" aria-hidden="true" focusable="false"><use href="#i-${n}"/></svg>`;
  const icon = (k) => ic((DOM[k] && DOM[k].ic) || "sparkles");
  // "{{bell}}" in a text → that icon; "{{m1}}" → the medal for 1st place
  const withIcons = (t) => String(t).replace(/\{\{([a-z0-9-]+)\}\}/g, (_, n) => (/^m[123]$/.test(n) ? ic("award", "medal-ic " + n) : ic(n)));
  const initials = (n) => clean(n).split(" ").filter((w) => /\p{L}/u.test(w)).map((w) => Array.from(w)[0]).slice(0, 2).join("").toUpperCase() || "?";
  const safeUrl = (u) => (/^https?:\/\/\S+$/i.test(u || "") ? u : "#");
  const avHtml = (p, cls) => (p.avatar && /^https:\/\//.test(p.avatar)
    ? `<img class="av ${cls || ""}" src="${esc(p.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : `<i class="av av-${esc(p.domain)} ${cls || ""}" aria-hidden="true">${esc(initials(p.name))}</i>`);
  const plink = (id, name) => `<button class="plink" type="button" data-act="profile" data-person="${esc(id)}">${esc(name)}</button>`;
  const dchip = (k) => !hasSkill(k) ? "" : `<span class="dchip d-${esc(k)}">${icon(k)} ${esc(label(k))}</span>`;
  // same rules as bd_phone / bd_phone_ok / bd_team_name_ok in supabase.sql
  const normPhone = (p) => { const d = String(p || "").replace(/\D/g, "").replace(/^0+/, ""); return d.length === 10 ? "91" + d : /^910[6-9]\d{9}$/.test(d) ? "91" + d.slice(3) : d; };
  // Indian numbers need no country code; any other number must start with + (or 00), so a typo isn't taken for a foreign number
  const phoneTypedOk = (raw) => { const ph = normPhone(raw); return phoneOk(ph) && (/^91/.test(ph) || /^\s*(\+|00)/.test(String(raw || ""))); };
  const showPhone = (ph) => (/^91\d{10}$/.test(ph || "") ? ph.slice(2) : ph ? "+" + ph : "");   // 919876543210 → 9876543210
  // same as bd_email_ok in supabase.sql: no spaces, ? & = or other characters that could sneak into a mailto: link
  const emailOk = (e) => /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(e) && e.length <= 120;
  const phoneOk = (ph) => /^[0-9]{11,13}$/.test(ph) && (!/^91/.test(ph) || /^91[6-9][0-9]{9}$/.test(ph));
  // "Tute Dude", "Tut3-dud3" … squashed and de-leeted, to catch disguised names
  const squash = (s) => String(s).toLowerCase().replace(/[^a-z0-9@$]/g, "").replace(/[0134578@$]/g, (c) => ({ 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", 8: "b", "@": "a", $: "s" }[c]));
  const teamNameOk = (nm) => /^[A-Za-z0-9\u0900-\u097F .,'&!?()+_#@:\/-]+$/.test(nm) &&
    !/\b(official|admin|administrators?|organi[sz]ers?|moderators?)\b/i.test(nm) && !/(tutedude|official)/.test(squash(nm)) &&
    !/\b(fuck|shit|bitch|chutiy|chutia|madarchod|bhenchod|behenchod|bsdk|randi|gandu|lund|lauda|loda|harami)/i.test(nm);
  // team codes: 8 characters with no I, O, 0 or 1 (same as bd_new_code), shown as ABCD-EFGH.
  // cleanCode also accepts a whole pasted team link.
  const CODE_ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const cleanCode = (s) => { const m = String(s || "").match(/[#?&]join=([A-Za-z0-9-]+)/); return (m ? m[1] : String(s || "")).toUpperCase().replace(/[^A-Z0-9]/g, ""); };
  const showCode = (c) => (c && c.length === 8 ? c.slice(0, 4) + "-" + c.slice(4) : c || "");
  const teamLink = (c) => location.origin + location.pathname + "#join=" + showCode(c);
  const waLink = (phone, text) => { const d = normPhone(phone); return d ? "https://wa.me/" + d + (text ? "?text=" + encodeURIComponent(text) : "") : ""; };
  const debounce = (fn, ms) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };
  const fail = (msg) => { throw new Error(msg); };
  const linkify = (s) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener nofollow">$1</a>');
  const store = (kind) => ({
    get(k) { try { return window[kind].getItem(k); } catch (_) { return null; } },
    set(k, v) { try { window[kind].setItem(k, v); } catch (_) {} },
    del(k) { try { window[kind].removeItem(k); } catch (_) {} }
  });
  const ls = store("localStorage"), ss = store("sessionStorage");

  /* ============================================================
     DEMO BACKEND: same rules as supabase.sql, kept in this browser
     ============================================================ */
  function demoBackend() {
    const KEY = "tdb-demo-v7", ME = KEY + ":me";
    let db = null;
    try { db = JSON.parse(ls.get(KEY)); } catch (_) {}
    if (!db || !db.v7) db = seed();
    const save = () => ls.set(KEY, JSON.stringify(db));
    save();

    const listeners = new Set(), noteListeners = new Set();
    let queued = false;
    function changed() {
      save();
      if (queued) return;
      queued = true;
      setTimeout(() => { queued = false; listeners.forEach((f) => f()); bots(); }, 0);
    }
    const myId = () => ls.get(ME);
    const teamOf = (pid) => (db.members[pid] ? db.members[pid].teamId : null);
    const membersOf = (tid) => Object.keys(db.members).filter((p) => db.members[p].teamId === tid).sort((a, b) => db.members[a].joinedAt - db.members[b].joinedAt);
    const listedOf = (tid) => (db.teams[tid] && db.teams[tid].listed) || [];
    const sizeOf = (tid) => membersOf(tid).length + listedOf(tid).length;   // like teams.size: members + added teammates
    // "Team is full": the leader closed the team (it opens again under MIN people) or it reached the size they picked
    const capT = (t) => Math.min(MAX, Number(t.cap) || MAX);
    const closedT = (t) => !!t.closed && sizeOf(t.id) >= MIN;
    const fullT = (t) => closedT(t) || sizeOf(t.id) >= capT(t);
    const listedTeam = (email) => Object.values(db.teams).find((t) => (t.listed || []).some((l) => l.email === email)) || null;
    const leaderTeam = (uid) => Object.values(db.teams).find((t) => t.leaderId === uid);
    const open = () => { if (locked()) fail("Teams are locked now."); };
    const say = (tid, body) => db.messages.push({ id: ++db.msgSeq, teamId: tid, personId: null, kind: "system", body, at: Date.now() });
    const notify = (pid, title, body, tag) => {
      if (pid !== myId()) return; // only the demo user has a "phone"
      const n = { title, body: body.slice(0, 140), tag };
      setTimeout(() => noteListeners.forEach((f) => f(n)), 0);
    };
    const notifyTeam = (tid, except, title, body, tag) => membersOf(tid).forEach((p) => { if (p !== except) notify(p, title, body, tag); });
    let clock = 0;
    const now = () => Math.max(Date.now(), ++clock); // strictly increasing, keeps join order exact
    function newCode() {
      let c;
      do { c = Array.from({ length: 8 }, () => CODE_ABC[Math.floor(Math.random() * 32)]).join(""); } while (Object.values(db.teams).some((t) => t.code === c));
      return c;
    }
    const byCode = (code) => { const c = cleanCode(code); return c.length === 8 ? Object.values(db.teams).find((t) => t.code === c) || null : null; };
    // same as bd_take_out: out of the team, the next member leads, an empty team is deleted
    function takeOut(pid) {
      const tid = teamOf(pid);
      if (!tid) return null;
      delete db.members[pid];
      const rest = membersOf(tid);
      if (!rest.length) { delete db.teams[tid]; db.messages = db.messages.filter((m) => m.teamId !== tid); return null; }
      if (db.teams[tid].leaderId === pid) db.teams[tid].leaderId = rest[0];
      return tid;
    }

    const ops = {
      // same as switch_team in supabase.sql: after the lock, leave + join another team with room in one step
      switchTeam(uid, code) {
        const p = db.people[uid], t = byCode(code);
        if (!p) fail("Register first.");
        if (!t) fail("That team link doesn't work. Ask that team's leader to send it again.");
        const old = teamOf(uid);
        if (old === t.id) fail(`You're already in ${t.name}.`);
        if (old && db.teams[old].submission) fail("Your team already submitted its project, so the team is final.");
        if (t.submission) fail(`${t.name} already submitted its project, so it can't take new members.`);
        const claim = listedOf(t.id).some((l) => l.email === p.email);
        if (fullT(t) && !claim) fail(`${t.name} is full. Ask for the link of another team.`);
        if (old) {
          const oldName = db.teams[old].name, left = takeOut(uid);
          if (left) {
            say(left, `${p.name} left the team and joined another team.`);
            notifyTeam(left, null, "Team update", `${p.name} left ${oldName} and joined another team.`, "team-" + left);
          }
        }
        if (claim) t.listed = listedOf(t.id).filter((l) => l.email !== p.email);
        db.members[uid] = { teamId: t.id, joinedAt: now() };
        say(t.id, `${p.name}${skillTag(p.domain)} joined the team`);
        notifyTeam(t.id, uid, `${t.name}: new teammate`, `${p.name}${skillTag(p.domain)} joined your team. Say hi!`, "team-" + t.id);
        return { team: t.name, left: old ? true : null };
      },
      // same as save_profile in supabase.sql
      saveProfile(uid, p) {
        open();
        const old = db.people[uid];
        const phone = normPhone(p.phone), email = String(p.email || "").trim().toLowerCase(), name = clean(p.name);
        if (name.length < 2 || name.length > 40) fail("Please write your name.");
        if (!DOM[p.domain]) fail("Pick what you do.");
        if (!phoneTypedOk(p.phone)) fail("Please write your 10-digit WhatsApp number (or the full number with + and the country code).");
        if (!emailOk(email)) fail("Please write a valid email address.");
        if ((p.skill || "").length > 80) fail("Keep the line about you under 80 characters.");
        if (p.link && (!/^https?:\/\/\S+$/i.test(p.link) || p.link.length > 200)) fail("Paste the full link, starting with https://");
        if (!old && !p.consent) fail("Please confirm you're a TuteDude student.");
        // demo stand-in for TuteDude's API: an email containing "notstudent" isn't on TuteDude
        const notStudent = (e) => /notstudent/.test(e);
        const badMates = clean(p.teamName) && Array.isArray(p.members) ? p.members.filter((m) => notStudent(String(m.email || "").toLowerCase())) : [];
        const bad = ((!old || old.email !== email) && notStudent(email) ? [email] : []).concat(badMates.map((m) => String(m.email).toLowerCase()));
        if (bad.length) {
          const msg = bad.length > 1 ? `${bad.length} emails aren't on TuteDude (marked in red): ${bad.join(", ")}. Use the emails from your TuteDude accounts.`
            : bad[0] === email ? "This email isn't on TuteDude. Use the email you use for your TuteDude courses."
            : `${clean(badMates[0].name)} (${bad[0]}) isn't on TuteDude. Use the email your teammate uses for TuteDude.`;
          if (p.dryRun) return { ok: false, error: msg, badEmails: bad };
          fail(msg);
        }
        const others = Object.values(db.people).filter((x) => x.id !== uid);
        if (others.some((x) => x.phone === phone || (x.email || "").toLowerCase() === email)) {
          fail(old ? "That WhatsApp number or email is already used by another registration."
            : 'This WhatsApp number or email is already registered. Open the site on the phone or browser you registered with, or tap "Get back to your team".');
        }
        let tid = teamOf(uid), created = null, target = null, claim = false;
        const agreed = !!(old && old.sessionOkAt) || !!p.sessionOk, tn = clean(p.teamName), listedIn = listedTeam(email);
        const mates = Array.isArray(p.members) ? p.members.map((m) => ({ name: clean(m.name), email: String(m.email || "").trim().toLowerCase(), raw: m.phone, phone: normPhone(m.phone) })) : [];
        if (listedIn && tid) fail("That email was added to a team as a teammate. Use your own email.");
        const wantsTeam = !old || !!cleanCode(p.code) || !!p.teamId || !!tn;   // registered without a team + no team = profile edit
        if (!tid && wantsTeam) {
          if (!agreed && !p.dryRun) fail("Watch the TuteDude Sessions video and agree to it first.");
          if (cleanCode(p.code)) {
            target = byCode(p.code);
            if (!target) fail("That team link doesn't work. Ask your team leader to send it again.");
            claim = !!listedIn && listedIn.id === target.id;
            if (fullT(target) && !claim) fail(`${target.name} is full and isn't taking new members. Ask your leader, or create your own team.`);
            created = false;
          } else if (p.teamId) {
            target = db.teams[p.teamId];
            if (!target || !target.open) fail("That team isn't taking new members any more. Pick another team.");
            claim = !!listedIn && listedIn.id === target.id;
            if (fullT(target) && !claim) fail(`${target.name} filled up a moment ago. Pick another team.`);
            created = false;
          } else if (tn) {
            if (tn.length < 2 || tn.length > 40) fail("Give your team a name (2 to 40 letters).");
            if (!teamNameOk(tn)) fail("Please pick a different team name.");
            if (Object.values(db.teams).some((x) => x.name.toLowerCase() === tn.toLowerCase())) fail("That team name is taken. Try another one.");
            created = true;
          } else fail("Create a team, or join your team with the link your leader sent.");
          // (an email's owner decides: a team that added them but which they don't join loses the spot — below)
          if (created) {
            if (mates.length > MAX - 1) fail(`A team has at most ${MAX} people, including you.`);
            mates.forEach((m) => {
              if (m.name.length < 2 || m.name.length > 40) fail("Write each teammate's name (2 to 40 letters).");
              if (!emailOk(m.email)) fail(`Check the email address for ${m.name}.`);
              if (m.email === email) fail("Add your teammates' emails, not your own.");
              if (mates.filter((x) => x.email === m.email).length > 1) fail(`${m.email} is added twice.`);
              if (Object.values(db.people).some((x) => (x.email || "").toLowerCase() === m.email)) fail(`${m.name} (${m.email}) is already registered on the site. Create the team without them and send them your team link.`);
              if (listedTeam(m.email)) fail(`${m.name} (${m.email}) is already in another team.`);
              if (!m.phone) return;   // WhatsApp is optional for added teammates
              if (!phoneTypedOk(m.raw)) fail(`Check the WhatsApp number of ${m.name} (10 digits).`);
              if (m.phone === phone) fail("Add your teammates' WhatsApp numbers, not your own.");
              if (mates.filter((x) => x.phone === m.phone).length > 1) fail("The same WhatsApp number is added twice.");
              if (Object.values(db.people).some((x) => x.phone === m.phone) || Object.values(db.teams).some((t) => (t.listed || []).some((l) => l.phone === m.phone)))
                fail(`${m.name} (WhatsApp +${m.phone}) is already registered or in a team. Create the team without them and send them your team link.`);
            });
          }
        }
        if (p.dryRun) return { ok: true };
        if (!tid && wantsTeam && listedIn && (!target || listedIn.id !== target.id)) {
          const gone = listedIn.listed.find((l) => l.email === email);
          listedIn.listed = listedIn.listed.filter((l) => l.email !== email);
          say(listedIn.id, `${gone.name} registered with another team, so they were taken off this one.`);
          notify(listedIn.leaderId, "Team update", `${gone.name} registered with another team, so they were taken off ${listedIn.name}.`, "team-" + listedIn.id);
        }
        db.people[uid] = { id: uid, name, domain: p.domain, skill: p.skill || "", link: p.link || "", phone, email, avatar: "",
          createdAt: old ? old.createdAt : now(), sessionOkAt: (old && old.sessionOkAt) || (agreed ? now() : null) };
        if (created) {
          tid = "t_" + rid();
          db.teams[tid] = { id: tid, name: tn, leaderId: uid, code: newCode(), open: !!p.open, createdAt: now(),
            listed: mates.map((m) => ({ id: "l_" + rid(), name: m.name, email: m.email, phone: m.phone, at: now() })) };
          db.members[uid] = { teamId: tid, joinedAt: now() };
          say(tid, `${name}${skillTag(p.domain)} created the team.`);
        } else if (created === false) {
          tid = target.id;
          if (claim) target.listed = target.listed.filter((l) => l.email !== email);
          db.members[uid] = { teamId: tid, joinedAt: now() };
          say(tid, `${name}${skillTag(p.domain)} joined the team`);
          notifyTeam(tid, uid, `${target.name}: new teammate`, `${name}${skillTag(p.domain)} joined your team. Say hi on WhatsApp!`, "team-" + tid);
        }
        return { team: db.teams[tid].name, code: db.teams[tid].code, created };
      },
      // same as get_team_by_code
      teamByCode(code) {
        const t = byCode(code);
        if (!t) return null;
        const n = sizeOf(t.id);
        return { name: t.name, size: n, max: capT(t), full: fullT(t), closed: closedT(t), reserved: listedOf(t.id).length, leader: first(db.people[t.leaderId].name), locked: false, lateOpen: locked() };
      },
      // same as get_open_teams: teams missing your skill first, then the fullest
      openTeams(domain) {
        if (locked()) return [];
        const skillsOf = (t) => membersOf(t.id).map((m) => db.people[m].domain);
        return Object.values(db.teams).filter((t) => t.open && !fullT(t))
          .map((t) => ({ id: t.id, name: t.name, size: sizeOf(t.id), max: MAX, skills: skillsOf(t), leader: first(db.people[t.leaderId].name), at: t.createdAt }))
          .sort((a, b) => (+(!!domain && a.skills.includes(domain)) - +(!!domain && b.skills.includes(domain))) || b.size - a.size || a.at - b.at)
          .slice(0, 30);
      },
      submitProject(uid, p) {
        const t = leaderTeam(uid), title = clean(p.title), summary = clean(p.summary);
        if (!t) fail("Only the team leader can submit the project.");
        if (submitEarly()) fail("Submissions open on " + submitDayText() + ".");
        if (!submitOpen()) fail("Submissions are closed.");
        if (sizeOf(t.id) < MIN) fail(`A team needs at least ${MIN} people to take part.`);
        if (t.submission) fail("Your team has already submitted. It can't be changed.");
        if (title.length < 2 || title.length > 80) fail("Give your project a name (2 to 80 characters).");
        if (summary.length < 20 || summary.length > 500) fail("Describe your project in 2 to 3 lines (20 to 500 characters).");
        if (!urlOk(p.product)) fail("Paste the full link to your project (it starts with https://).");
        if (p.site && !urlOk(p.site)) fail("The website link doesn't look right. Paste the full link, or leave it empty.");
        if (p.video && !urlOk(p.video)) fail("The video link doesn't look right. Paste the full link, or leave it empty.");
        t.submission = { title, summary, product: p.product, site: p.site || "", video: p.video || "", at: now() };
        say(t.id, `Your leader submitted the project: ${title}`);
        return { ok: true };
      },
      addTeammate(uid, nm, em, ph) {
        open();
        const t = leaderTeam(uid), name = clean(nm), email = String(em || "").trim().toLowerCase(), phone = normPhone(ph);
        if (!t) fail("Only the team leader can add teammates.");
        if (name.length < 2 || name.length > 40) fail("Write your teammate's name (2 to 40 letters).");
        if (!emailOk(email)) fail("Please write a valid email address.");
        if (phone && !phoneTypedOk(ph)) fail("Check your teammate's WhatsApp number (10 digits).");
        if (phone && phone === db.people[uid].phone) fail("That's your own WhatsApp number. Add your teammate's.");
        if (phone && (Object.values(db.people).some((x) => x.phone === phone) || Object.values(db.teams).some((x) => (x.listed || []).some((l) => l.phone === phone)))) fail("That WhatsApp number is already registered or in a team. Send them your team link instead.");
        if (/notstudent/.test(email)) fail("That email isn't on TuteDude. Use the email your teammate uses for TuteDude.");
        if (sizeOf(t.id) >= MAX) fail(`Your team already has ${MAX} people.`);
        if (sizeOf(t.id) >= capT(t)) fail(`You set your team size to ${capT(t)} people. Pick a bigger team size first.`);
        if (email === (db.people[uid].email || "").toLowerCase()) fail("That's your own email. Add your teammate's email.");
        if (Object.values(db.people).some((x) => (x.email || "").toLowerCase() === email) || listedTeam(email)) fail("That email is already registered or in a team. Send them your team link instead.");
        t.listed = (t.listed || []).concat({ id: "l_" + rid(), name, email, phone, at: now() });
        say(t.id, `The leader added ${name} to the team.`);
      },
      removeTeammate(uid, lid) {
        open();
        const t = leaderTeam(uid);
        if (!t) fail("Only the team leader can remove teammates.");
        const l = (t.listed || []).find((x) => x.id === lid);
        if (!l) fail("They already joined your team themselves. To take them out, use Remove next to their name in the member list.");
        t.listed = t.listed.filter((x) => x.id !== lid);
        say(t.id, `The leader removed ${l.name} from the team.`);
      },
      setOpen(uid, on) {
        open();
        const t = leaderTeam(uid);
        if (!t) fail("Only the team leader can change this.");
        if (!!t.open === !!on) return;
        t.open = !!on;
        say(t.id, on ? "The leader opened the team to students without a team." : "The leader closed the team to new members (the team link still works).");
      },
      setClosed(uid, on) {
        open();
        const t = leaderTeam(uid);
        if (!t) fail("Only the team leader can change this.");
        if (on && sizeOf(t.id) < MIN) fail(`A team needs at least ${MIN} people to take part. Close it once your teammates have joined.`);
        if (closedT(t) === !!on) return;
        t.closed = !!on;
        say(t.id, on ? 'The leader closed the team. The team link now says "Team is full" and nobody new can join.' : "The leader opened the team again. New members can join with the team link.");
      },
      setCap(uid, cap) {
        open();
        const t = leaderTeam(uid), k = Number(cap);
        if (!t) fail("Only the team leader can change this.");
        if (!(k >= MIN && k <= MAX)) fail(`Pick a team size from ${MIN} to ${MAX}.`);
        if (k < sizeOf(t.id)) fail(`Your team already has ${sizeOf(t.id)} people. Pick ${sizeOf(t.id)} or more.`);
        if (capT(t) === k) return;
        t.cap = k === MAX ? null : k;
        say(t.id, `The leader set the team size to ${k} people. At ${k} the team link says "Team is full".`);
      },
      rename(uid, name) {
        open();
        const t = leaderTeam(uid);
        if (!t) fail("Only the team leader can rename the team.");
        if (name.length < 2 || name.length > 40) fail("Give your team a name (2 to 40 letters).");
        if (!teamNameOk(name)) fail("Please pick a different team name.");
        if (Object.values(db.teams).some((x) => x.id !== t.id && x.name.toLowerCase() === name.toLowerCase())) fail("That team name is taken. Try another one.");
        t.name = name;
        say(t.id, `The team is now called ${name}.`);
      },
      leave(uid) {
        open();
        const p = db.people[uid], tid = teamOf(uid);
        if (!p || !tid) return;
        if (sizeOf(tid) > 1 && Date.now() > db.members[uid].joinedAt + LEAVE_MS) fail(`You can leave a team only in the first ${LEAVE_MS / 36e5} hours after joining. Need help? Message the organisers on the TuteDude Community.`);
        const wasLead = db.teams[tid].leaderId === uid;
        const left = takeOut(uid);
        if (!left) return;
        const lead = db.people[db.teams[left].leaderId];
        say(left, `${p.name} left the team.` + (wasLead ? ` ${lead.name} is the leader now.` : ""));
        notifyTeam(left, null, "Team update", `${p.name} left your team.` + (wasLead ? ` ${first(lead.name)} is the leader now.` : ""), "team-" + left);
      },
      remove(uid, pid) {
        const t = leaderTeam(uid);   // the leader can remove a teammate after the lock too
        if (!t) fail("Only the team leader can remove people.");
        if (pid === uid) fail('You can\'t remove yourself. Use "Leave team" instead.');
        if (teamOf(pid) !== t.id) return;
        takeOut(pid);
        say(t.id, `${db.people[pid].name} was removed by the leader.`);
        notify(pid, "Team update", `You were removed from ${t.name}. Join your team again with its link, or create a new team.`, "team-none");
      },
      resetCode(uid) {
        open();
        const t = leaderTeam(uid);
        if (!t) fail("Only the team leader can make a new link.");
        t.code = newCode();
        say(t.id, "The leader made a new team link. The old one no longer works.");
        return t.code;
      },
      // same WhatsApp number + email moves the registration to this device (reclaim_profile in supabase.sql)
      reclaim(uid, phone, email) {
        if (db.people[uid]) fail("You are already registered on this device.");
        const ph = normPhone(phone), em = String(email || "").trim().toLowerCase();
        const old = Object.values(db.people).find((x) => x.phone && x.phone.slice(-10) === ph.slice(-10) && (x.email || "").toLowerCase() === em && em);
        if (!old) fail("No registration found with that WhatsApp number and email. Check both, or register as new.");
        db.people[uid] = Object.assign({}, old, { id: uid });
        if (db.members[old.id]) { db.members[uid] = db.members[old.id]; delete db.members[old.id]; }
        Object.values(db.teams).forEach((t) => { if (t.leaderId === old.id) t.leaderId = uid; });
        delete db.people[old.id];
        const tid = teamOf(uid);
        return { team: tid ? db.teams[tid].name : null };
      }
    };

    const pub = (p) => ({ id: p.id, name: p.name, domain: p.domain, skill: p.skill, link: p.link, avatar: p.avatar || "" });
    function board() {
      const dayAgo = Date.now() - 864e5;
      const listed = Object.values(db.teams).flatMap((t) => t.listed || []);
      return { stats: { people: Object.keys(db.people).length + listed.length,
        today: Object.values(db.people).filter((p) => p.createdAt > dayAgo).length + listed.filter((l) => l.at > dayAgo).length } };
    }
    function meState(uid) {
      const p = uid && db.people[uid];
      if (!p) return { me: null, team: null };
      const tid = teamOf(uid), t = tid && db.teams[tid];
      const ms = t ? membersOf(t.id) : [];
      return {
        me: { id: uid, name: p.name, domain: p.domain, skill: p.skill, link: p.link, avatar: "", phone: p.phone, email: p.email || "", sessionOk: !!p.sessionOkAt, waOk: !!p.waOkAt },
        team: t ? {
          id: t.id, name: t.name, leaderId: t.leaderId, code: t.code, open: !!t.open, closed: closedT(t), cap: capT(t), lateOpen: locked(),   // every team stays open after the lock (like live)
          submission: t.submission || null,
          problem: sizeOf(t.id) >= MIN && revealed() ? { text: "Demo problem statement: students lose track of what to revise before exams. Build a novel solution (the product, its website and a 60-second promo video).", link: "" } : null,
          members: ms.map((m) => Object.assign(pub(db.people[m]), { phone: db.people[m].phone || "", joinedAt: db.members[m].joinedAt })),
          listed: (t.listed || []).map((l) => ({ id: l.id, name: l.name, phone: l.phone || "", email: t.leaderId === uid ? l.email : "" }))
        } : null
      };
    }
    /* bots: when you lead a team, a sample teammate joins it with your link every few seconds
       (up to 3 people, so there's still a spot open) */
    let arrivalTimer = 0;
    function bots() {
      const t = leaderTeam(myId());
      if (!t || arrivalTimer || !db.arrivals.length || locked() || sizeOf(t.id) >= MAX - 1 || fullT(t)) { save(); return; }
      arrivalTimer = setTimeout(() => {
        arrivalTimer = 0;
        const t2 = leaderTeam(myId());
        if (!t2 || sizeOf(t2.id) >= MAX - 1 || fullT(t2) || !db.arrivals.length) return;
        const [id, name, domain, skill] = db.arrivals.shift();
        db.people[id] = { id, name, domain, skill, link: "", phone: "90000" + String(10000 + Math.floor(Math.random() * 89999)), email: id + "@example.com", avatar: "", createdAt: now(), sessionOkAt: now() };
        db.members[id] = { teamId: t2.id, joinedAt: now() };
        say(t2.id, `${name}${skillTag(domain)} joined the team`);
        notifyTeam(t2.id, id, `${t2.name}: new teammate`, `${name}${skillTag(domain)} joined your team. Say hi on WhatsApp!`, "team-" + t2.id);
        changed();
      }, 6000);
    }
    const copy = (x) => JSON.parse(JSON.stringify(x === undefined ? null : x));
    const run = async (fn) => { const r = fn(); changed(); return r; };
    setTimeout(bots, 0);
    return {
      mode: "demo",
      login: "demo",
      onAuth(cb) { const u = myId(); cb(u ? { id: u, email: "", name: "" } : null); },
      async ensureUser() { let u = myId(); if (!u) { u = "me_" + rid(); ls.set(ME, u); } return { id: u, email: "", name: "" }; },
      async signIn() {},
      async signOut() {},
      async board() { return copy(board()); },
      async me() { return copy(meState(myId())); },
      async teamByCode(code) { return copy(ops.teamByCode(code)); },
      async openTeams(domain) { return copy(ops.openTeams(domain)); },
      setOpen: (on) => run(() => ops.setOpen(myId(), on)),
      setClosed: (on) => run(() => ops.setClosed(myId(), on)),
      setCap: (k) => run(() => ops.setCap(myId(), k)),
      addTeammate: (name, email, phone) => run(() => ops.addTeammate(myId(), name, email, phone)),
      checkStudent: async (email) => !/notstudent/.test(String(email)),   // demo stand-in for TuteDude's API
      submitProject: (p) => run(() => ops.submitProject(myId(), p)),
      removeTeammate: (lid) => run(() => ops.removeTeammate(myId(), lid)),
      saveProfile: (p) => run(() => ops.saveProfile(myId(), p)),
      reclaim: (phone, email) => run(() => ops.reclaim(myId(), phone, email)),
      rename: (name) => run(() => ops.rename(myId(), name)),
      leave: () => run(() => ops.leave(myId())),
      switchTeam: (code) => run(() => ops.switchTeam(myId(), code)),
      remove: (pid) => run(() => ops.remove(myId(), pid)),
      resetCode: () => run(() => ops.resetCode(myId())),
      async savePush() {},
      async agreeWhatsapp() {},   // the demo remembers it in this browser only
      async namesTaken(names) { const have = new Set(Object.values(db.teams).map((t) => t.name.toLowerCase())); return names.filter((n) => have.has(n.toLowerCase())); },
      live(_me, onNote) {
        noteListeners.add(onNote);
        return () => { noteListeners.delete(onNote); };
      },
      liveOk: () => true,
      onChange(f) { listeners.add(f); },
      reset() { ls.del(KEY); ls.del(ME); location.href = location.pathname; }
    };
  }

  // sample teams. "Night Owls" can be joined with its demo link: #join=NGHT-WL22
  function seed() {
    const t0 = Date.now() - 6 * 3600e3, min = 6e4;
    const P = {
      bot_1: ["Aditya Rao", "design", "Branding, UI kits", "https://dribbble.com/"],
      bot_2: ["Manav Joshi", "dev", "Full stack MERN", "https://github.com/"],
      bot_3: ["Tanvi Kulkarni", "marketing", "Performance marketing", ""],
      bot_4: ["Farhan Ali", "video", "YouTube editing, thumbnails", "https://www.youtube.com/"],
      bot_5: ["Arjun Mehta", "dev", "React + Node, 2 side projects live", "https://github.com/"],
      bot_6: ["Riya Sharma", "design", "Figma, redesigned 3 apps", "https://www.behance.net/"],
      bot_7: ["Neha Gupta", "dev", "Python, Django, APIs", "https://github.com/"]
    };
    const db = { v7: true, people: {}, teams: {}, members: {}, messages: [], msgSeq: 0, arrivals: [] };
    Object.entries(P).forEach(([id, [name, domain, skill, link]], i) => {
      db.people[id] = { id, name, domain, skill, link, phone: "90000" + String(10001 + i), email: id + "@example.com", avatar: "", createdAt: t0 + i * 20 * min, sessionOkAt: t0 + i * 20 * min };
    });
    [
      ["t_1", "Launchpad", "LNCHPD24", ["bot_1", "bot_2", "bot_3", "bot_4"]],
      ["t_2", "Night Owls", "NGHTWL22", ["bot_5", "bot_6"]],
      ["t_3", "Pixel Pushers", "PXLPSH33", ["bot_7"]]
    ].forEach(([id, name, code, uids], i) => {
      const at = t0 + i * 30 * min;
      db.teams[id] = { id, name, code, leaderId: uids[0], open: id !== "t_1", createdAt: at };
      uids.forEach((u, j) => { db.members[u] = { teamId: id, joinedAt: at + j * min }; });
      db.messages.push({ id: ++db.msgSeq, teamId: id, personId: null, kind: "system", body: db.people[uids[0]].name + " created the team.", at });
    });
    // sample teammates who join your team with your link, one every few seconds
    db.arrivals = [
      ["bot_10", "Karan Patel", "video", "Premiere Pro, reels"],
      ["bot_11", "Sana Khan", "marketing", "Instagram growth, ad copy"],
      ["bot_12", "Ananya Iyer", "design", "UX research, wireframes"],
      ["bot_13", "Yash Agarwal", "dev", "Next.js, Supabase"],
      ["bot_14", "Ishita Das", "video", "After Effects, motion graphics"],
      ["bot_15", "Priya Nair", "marketing", "Copywriting, SEO"]
    ];
    return db;
  }

  /* ============================================================
     LIVE BACKEND: Supabase (functions defined in supabase.sql)
     ============================================================ */
  async function supabaseBackend(cfg, login) {
    // vendor/supabase.js ships with the site (loaded in index.html). No CDN: the page's security policy allows only its own scripts.
    if (!(window.supabase && window.supabase.createClient)) fail("Couldn't load the page. Refresh it.");
    const sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" } });
    // a one-time sign-in link an organiser made for a test account (…/#session=<refresh token>): sign in with it,
    // then drop it from the address bar. The part after # never reaches any server.
    const linkToken = (location.hash.match(/[#&]session=([A-Za-z0-9_-]{8,500})/) || [])[1];
    const ready = !linkToken ? Promise.resolve()
      : sb.auth.refreshSession({ refresh_token: linkToken }).catch(() => null).then(() => history.replaceState(null, "", location.pathname + "#board"));
    // network blips, timeouts and lock waits under heavy load are retried once, then explained in plain words
    const transient = (m) => /timeout|timed out|deadlock|could not serialize|fetch|network|load failed|503|502|504/i.test(m || "");
    const rpc = async (fn, args, tries = 2) => {
      let res;
      await ready;
      try { res = await sb.rpc(fn, args || {}); }
      catch (e) { res = { error: { message: (e && e.message) || "network error" } }; }
      if (!res.error) return res.data;
      const msg = res.error.message || "";
      if (transient(msg) && tries > 1) { await new Promise((r) => setTimeout(r, 1200)); return rpc(fn, args, tries - 1); }
      if (transient(msg)) fail("The site is busy or your connection dropped. Please try again in a moment.");
      fail(msg || "Something went wrong. Try again.");
    };
    const friendlyAuth = (m) => (/rate limit|too many/i.test(m || "")
      ? "Too many sign-ups from your network right now. Please try again in a minute (or switch between Wi-Fi and mobile data)."
      : m || "Couldn't start. Please try again.");
    const toUser = (u) => (u ? { id: u.id, email: u.email || "", name: (u.user_metadata && (u.user_metadata.full_name || u.user_metadata.name)) || "" } : null);
    // This browser's saved sign-in belongs to an account that was deleted (an organiser removed it, or the
    // data was reset). Start a new anonymous sign-in and try once more, so the student never sees the error.
    const withLiveAccount = async (go) => {
      try { return await go(); }
      catch (e) {
        if (login !== "anonymous" || !/sign-in has expired/i.test((e && e.message) || "")) throw e;
        try { await sb.auth.signOut({ scope: "local" }); } catch (_) { /* already signed out */ }
        let r;
        try { r = await sb.auth.signInAnonymously(); } catch (_) { fail("Your connection dropped. Please try again."); }
        if (r.error) fail(friendlyAuth(r.error.message));
        return go();
      }
    };
    return {
      mode: "live",
      login,
      onAuth(cb) {
        let last;
        sb.auth.onAuthStateChange((_event, session) => {
          const u = toUser(session && session.user);
          const id = u ? u.id : null;
          if (id === last) return;
          last = id;
          if (u && /[?&]code=/.test(location.search)) history.replaceState(null, "", location.pathname + location.hash);
          setTimeout(() => cb(u), 0); // don't call Supabase inside this callback
        });
      },
      async ensureUser() {
        await ready;
        const { data } = await sb.auth.getSession();
        if (data && data.session) return toUser(data.session.user);
        if (login !== "anonymous") fail("Please sign in first.");
        let r;
        try { r = await sb.auth.signInAnonymously(); } catch (e) { fail("Your connection dropped. Please try again."); }
        if (r.error) fail(friendlyAuth(r.error.message));
        return toUser(r.data.user);
      },
      async signIn() {
        const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
        if (error) fail(error.message);
      },
      async signOut() { await sb.auth.signOut(); },
      board: () => rpc("get_board"),
      me: () => rpc("get_me"),
      teamByCode: (code) => rpc("get_team_by_code", { p_code: code }),
      openTeams: (domain) => rpc("get_open_teams", { p_domain: domain || "" }),
      setOpen: (on) => rpc("set_team_open", { p_open: !!on }),
      setClosed: (on) => rpc("set_team_closed", { p_closed: !!on }),
      setCap: (k) => rpc("set_team_cap", { p_cap: Number(k) }),
      addTeammate: (name, email, phone) => rpc("add_teammate", { p_name: name, p_email: email, p_phone: phone || "" }),
      checkStudent: async (email) => { const r = await rpc("check_student", { p_email: email }); return r ? r.student : null; },
      submitProject: (p) => rpc("submit_project", { p_title: p.title, p_summary: p.summary, p_product: p.product, p_site: p.site || "", p_video: p.video || "" }),
      removeTeammate: (lid) => rpc("remove_teammate", { p_id: lid }),
      saveProfile: (p) => withLiveAccount(() => rpc("save_profile", { p_name: p.name, p_domain: p.domain, p_phone: p.phone, p_email: p.email, p_skill: p.skill, p_link: p.link,
        p_team_name: p.teamName || "", p_code: p.code || "", p_team: p.teamId || null, p_open: !!p.open, p_consent: !!p.consent, p_session_ok: !!p.sessionOk,
        p_members: Array.isArray(p.members) ? p.members : [], p_dry_run: !!p.dryRun })),
      reclaim: (phone, email) => withLiveAccount(() => rpc("reclaim_profile", { p_phone: phone, p_email: email })),
      rename: (name) => rpc("rename_team", { p_name: name }),
      leave: () => rpc("leave_team"),
      switchTeam: (code) => rpc("switch_team", { p_code: code }),
      remove: (pid) => rpc("remove_member", { p_person: pid }),
      resetCode: () => rpc("reset_team_code"),
      savePush: (endpoint, p256dh, auth) => rpc("save_push", { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth }),
      agreeWhatsapp: () => rpc("agree_whatsapp"),
      namesTaken: (names) => rpc("names_taken", { p_names: names }),
      // private Broadcast channel "user:<id>" for my notifications
      live(me, onNote) {
        const chans = [];
        let stopped = false;
        (async () => {
          const { data } = await sb.auth.getSession();
          if (stopped || !data || !data.session) return;
          sb.realtime.setAuth(data.session.access_token);
          const sub = (topic, event, cb) => {
            liveStatus[topic] = "connecting";
            const ch = sb.channel(topic, { config: { private: true } })
              .on("broadcast", { event }, (m) => cb(m.payload || {}))
              .subscribe((status) => { liveStatus[topic] = status; });
            chans.push([topic, ch]);
          };
          if (me) sub("user:" + me, "note", onNote);
        })().catch((e) => console.warn("live", e));
        return () => { stopped = true; chans.forEach(([topic, c]) => { delete liveStatus[topic]; sb.removeChannel(c); }); };
      },
      liveOk: (topic) => liveStatus[topic] === "SUBSCRIBED"
    };
  }
  const liveStatus = {};

  /* ============================================================
     APP STATE + REFRESH
     ============================================================ */
  const S = { be: null, user: null, me: null, team: null, stats: null, loaded: false, loadErr: false };
  const REG_FLAG = "tdb-register-after-login", JOIN_KEY = "tdb-join-code";
  const amLeader = () => !!(S.team && S.me && S.team.leaderId === S.me.id);
  // buttons work right away; anything that needs the backend waits here until it has loaded
  let readyResolve;
  const ready = new Promise((r) => { readyResolve = r; });
  async function whenReady() {
    if (S.be) return;
    const slow = setTimeout(() => toast("Connecting… one moment."), 1500);
    try {
      await Promise.race([ready, new Promise((_, rej) => setTimeout(() => rej(new Error("Couldn't connect. Check your internet and refresh the page.")), 20000))]);
    } finally { clearTimeout(slow); }
  }

  let busy = null, again = null;
  async function refresh(opts) {
    opts = Object.assign({ board: true }, opts);
    if (busy) { again = { board: !!((again && again.board) || opts.board) }; return busy; }
    busy = (async () => {
      try {
        const [b, m] = await Promise.all([opts.board ? S.be.board() : null, S.user ? S.be.me() : null]);
        if (b) { S.stats = b.stats; S.loaded = true; }
        S.loadErr = false;
        applyMe(m);
      } catch (e) {
        console.warn(e);
        S.loadErr = true;
      }
      render();
      if (Date.now() > pushHold) pushGate();   // registered students: the required notifications pop-up
    })();
    await busy;
    busy = null;
    if (again) { const o = again; again = null; return refresh(o); }
  }

  function applyMe(m) {
    S.me = (m && m.me) || null;
    S.team = (m && m.team) || null;
    syncLive();
  }

  // the team link (…/#join=ABCD-EFGH): handled once we know who is visiting
  let pendingJoin = readJoin(), started = false;
  function readJoin() {
    const m = (location.hash + "&" + location.search).match(/[#?&]join=([A-Za-z0-9-]+)/);
    return m ? cleanCode(m[1]) : "";
  }
  function clearJoin() { if (/join=/.test(location.hash + location.search)) history.replaceState(null, "", location.pathname); }
  async function openJoin(code) {
    clearJoin();
    if (S.me && locked()) {
      if (S.team && cleanCode(S.team.code) === code) { toast(`You're already in ${S.team.name}.`); return; }
      if (S.team && S.team.submission) { toast(`${S.team.name} already submitted its project, so your team is final.`, true); return; }
      openSwitch(code);
      return;
    }
    if (S.team) {
      if (cleanCode(S.team.code) === code) toast(`You're already in ${S.team.name}.`);
      else toast(`You're already in ${S.team.name}. To join another team, leave ${S.team.name} first (at the bottom of your team page).`, true);
      $("#board").scrollIntoView({ behavior: "smooth" });
      return;
    }
    reg.late = false;
    // after the lock: only a team the organisers opened again (supabase.sql: teams.late_open) takes new members
    if (locked()) {
      let info = null;
      try { await whenReady(); info = await S.be.teamByCode(code); } catch (e) { console.warn(e); }
      if (!info || !info.lateOpen) { toast("Teams are locked. Registration is closed.", true); return; }
      reg.late = true;
    }
    openRegister("join", code);
  }

  async function onUser(u) {
    S.user = u;
    if (!u) Object.assign(S, { me: null, team: null });
    await refresh();
    if (u && ss.get(REG_FLAG)) {
      ss.del(REG_FLAG);
      if (S.me) toast(`Welcome back, ${first(S.me.name)}!`);
      else { const c = ss.get(JOIN_KEY) || ""; openRegister(c ? "join" : "create", c); }
    }
    if (!started) {
      started = true;
      if (pendingJoin) { const c = pendingJoin; pendingJoin = ""; openJoin(c); }
    }
    if (S.me && LIVE && pushState() === "on") subscribePush().catch((e) => console.warn("push", e));
  }

  /* live updates: my notifications */
  let liveOff = null, liveKey = "";
  function syncLive() {
    const key = S.me ? S.me.id : "";
    if (key === liveKey) return;
    liveKey = key;
    if (liveOff) { liveOff(); liveOff = null; }
    if (S.me) liveOff = S.be.live(S.me.id, onNote);
  }

  // a short two-note chime when a notification arrives while the site is open
  let chimeCtx = null;
  function chime() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      chimeCtx = chimeCtx || new AC();
      if (chimeCtx.state === "suspended") chimeCtx.resume();
      const t0 = chimeCtx.currentTime + 0.02;
      [[880, 0], [1318.5, 0.16]].forEach(([freq, at]) => {
        const o = chimeCtx.createOscillator(), g = chimeCtx.createGain();
        o.type = "sine"; o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t0 + at);
        g.gain.exponentialRampToValueAtTime(0.25, t0 + at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.45);
        o.connect(g); g.connect(chimeCtx.destination);
        o.start(t0 + at); o.stop(t0 + at + 0.5);
      });
      if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
    } catch (e) { /* no sound is fine */ }
  }
  function onNote(n) {
    refresh();
    if (document.visibilityState === "visible") { chime(); toast(n.body ? `${n.title} · ${n.body}` : n.title); }
    else if (!LIVE) localNotify(n); // live mode: the service worker shows it
  }

  /* ============================================================
     NOTIFICATIONS (phone + laptop)
     ============================================================ */
  const PUSH_KEY = "tdb-push";
  let swReg = null;
  const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  function pushState() {
    if (isIOS() && !isStandalone()) return "ios-install";
    if (!("serviceWorker" in navigator) || !("Notification" in window) || !/^https?:$/.test(location.protocol)) return "unsupported";
    if (LIVE && (!("PushManager" in window) || !C.vapidPublicKey)) return "unsupported";
    if (Notification.permission === "denied") return "denied";
    if (Notification.permission === "granted" && ls.get(PUSH_KEY) === "on") return "on";
    return "off";
  }
  function b64ToBytes(b64) {
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }
  async function subscribePush() {
    const reg = swReg || (await navigator.serviceWorker.ready);
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(C.vapidPublicKey) });
    const j = sub.toJSON();
    await S.be.savePush(j.endpoint, j.keys.p256dh, j.keys.auth);
  }
  async function enablePush() {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { render(); fail("Notifications are blocked. Allow them for this site in your browser settings."); }
    if (LIVE) await subscribePush();
    ls.set(PUSH_KEY, "on");
  }
  async function localNotify(n) {
    if (pushState() !== "on") return;
    try {
      const reg = swReg || (await navigator.serviceWorker.getRegistration());
      if (reg) reg.showNotification(n.title, { body: n.body || "", tag: n.tag || undefined, renotify: !!n.tag, icon: "icon-192.png", data: { url: "#board" } });
    } catch (e) { console.warn(e); }
  }
  /* The required "turn on notifications" pop-up (registered students only). It has no close button and no
     "Not now". Only when the browser itself is in the way (blocked, or iPhone without the home-screen app)
     does it offer "Continue for now", and then it returns on the next visit. */
  const PUSH_SKIP = "tdb-push-skip";
  const PUSH_FORCE = C.forceNotifications !== false;   // no way past the pop-up until notifications are allowed
  let pushDlg = null, pushHold = 0, pushFailed = false, pushKey = "";   // pushHold: wait until this time (the confetti right after registering)
  function pushGateHtml(st, failed) {
    const head = `<div class="modal-head"><div><p class="kicker">One last step</p><h2 class="h3" id="pushTitle">Turn on notifications</h2></div></div>`;
    let body;
    if (st === "ios-install") {
      body = `<p>On iPhone, notifications work from the home screen app:</p>
        <ol class="push-steps"><li>Tap <b>Share</b> in Safari</li><li>Tap <b>Add to Home Screen</b></li><li>Open <b>Buildathon</b> from your home screen and turn on notifications</li></ol>
        <button class="link push-skip" type="button" data-act="push-skip">Continue for now</button>`;
    } else if (st === "denied") {
      body = `<p><b>Notifications are blocked in this browser.</b> To allow them:</p>
        <ol class="push-steps"><li>Tap the <b>lock</b> or <b>settings icon</b> next to the address bar</li><li>Open <b>Notifications</b> (or Site settings → Notifications)</li><li>Choose <b>Allow</b>, then press the button below</li></ol>
        <button class="btn btn-full" type="button" data-act="push-gate-on">${ic("bell")} I've allowed it, turn on</button>
        ${PUSH_FORCE ? `<p class="push-hint">Notifications are required to take part. This page opens once they are allowed.</p>` : `<button class="link push-skip" type="button" data-act="push-skip">Continue for now</button>`}`;
    } else {
      body = `<p>All Buildathon updates come as notifications: when a teammate joins, when the <b>problem statement</b> is out, and the <b>submission reminder</b>. Turn them on to take part.</p>
        <button class="btn btn-full" type="button" data-act="push-gate-on">${ic("bell")} Turn on notifications</button>
        <p class="push-hint">Your browser will ask. Tap <b>Allow</b>.</p>${!failed ? "" : PUSH_FORCE
          ? `<p class="push-hint"><b>Didn't get the question?</b> Tap the lock or settings icon next to the address bar → Notifications → Allow, then press the button again. Notifications are required to take part.</p>`
          : `<button class="link push-skip" type="button" data-act="push-skip">Continue for now</button>`}`;
    }
    return head + `<div class="modal-body"><div class="form push-gate">${body}</div></div>`;
  }
  function pushGate(failed) {
    const st = S.me ? pushState() : "";
    const need = st === "off" || st === "denied" || st === "ios-install";
    if (!need || (ss.get(PUSH_SKIP) && (!PUSH_FORCE || st === "ios-install"))) { if (pushDlg && pushDlg.open) pushDlg.close(); return; }
    if ($$("dialog[open]").some((d) => d !== pushDlg)) return;   // never on top of the registration form
    if (!pushDlg) {
      pushDlg = document.createElement("dialog");
      pushDlg.className = "modal modal-full push-dlg"; pushDlg.id = "pushDlg";
      pushDlg.setAttribute("aria-labelledby", "pushTitle");
      pushDlg.addEventListener("cancel", (e) => e.preventDefault());   // Esc does not close it
      document.body.appendChild(pushDlg);
    }
    if (failed) pushFailed = true;
    const key = st + (pushFailed ? "!" : "");
    if (pushDlg.open && key === pushKey) return;   // already showing this: leave it alone
    pushKey = key;
    const tEl = $("#toast");
    if (tEl && pushDlg.contains(tEl)) document.body.appendChild(tEl);   // keep the toast: the pop-up is about to be redrawn
    pushDlg.innerHTML = pushGateHtml(st, pushFailed);
    if (!pushDlg.open) pushDlg.showModal();
  }
  async function pushGateOn(btn) {
    btn.disabled = true;
    try { await whenReady(); await enablePush(); toast("Notifications are on"); }
    catch (e) { console.warn(e); toast((e && e.message) || "Couldn't turn on notifications. Try again.", true); }
    await refresh();
    pushGate(true);
  }

  /* WhatsApp rules: before the first WhatsApp button opens (the community, a teammate, the team link,
     "Copy all numbers"), the student ticks the conduct box once. It is remembered in this browser and,
     for registered students, saved on their profile (agree_whatsapp in supabase.sql). */
  const WA_OK = "tdb-wa-ok";
  const waAgreed = () => !!ls.get(WA_OK) || !!(S.me && S.me.waOk);
  let waDlg = null, waThen = null;
  function waSave() {   // agreed in this browser: put it on the profile too
    if (!S.me || S.me.waOk || !S.be || !S.be.agreeWhatsapp) return;
    S.me.waOk = true;
    Promise.resolve().then(() => S.be.agreeWhatsapp()).catch((e) => { console.warn(e); if (S.me) S.me.waOk = false; });
  }
  function waGate(then) {
    if (waAgreed()) { if (ls.get(WA_OK)) waSave(); return true; }
    waThen = then;
    if (!waDlg) {
      waDlg = document.createElement("dialog");
      waDlg.className = "modal modal-full push-dlg"; waDlg.id = "waDlg";
      waDlg.setAttribute("aria-labelledby", "waTitle");
      waDlg.addEventListener("click", (e) => {
        const b = e.target.closest("[data-wa]");
        if (!b) return;
        if (b.dataset.wa === "cancel") { waThen = null; waDlg.close(); return; }
        if (!$("#waOk").checked) return showErr("#waErr", "Tick the box to agree to the WhatsApp rules.");
        ls.set(WA_OK, String(Date.now()));
        waSave();
        waDlg.close();
        const go = waThen; waThen = null;
        if (go) go();
      });
      document.body.appendChild(waDlg);
    }
    waDlg.innerHTML = `<div class="modal-head"><div><p class="kicker">WhatsApp rules</p><h2 class="h3" id="waTitle">Before you message on WhatsApp</h2></div></div>
      <div class="modal-body"><div class="form push-gate wa-gate">
        <p>Message other students <b>only about the Buildathon</b>, and be respectful.</p>
        <ul class="wa-rules"><li>No spam, forwards or promotions</li><li>No personal, unwanted or repeated messages or calls</li><li>No abuse or misbehaviour of any kind</li></ul>
        <p>If anyone reports you, <b>TuteDude can remove you from the Buildathon and take further action.</b></p>
        <label class="consent"><input type="checkbox" id="waOk"> <span>I agree. I will not misbehave or trouble anyone with unwanted messages.</span></label>
        <p class="form-error" id="waErr" role="alert" hidden></p>
        <button class="btn btn-full" type="button" data-wa="agree">${WA_ICON} Continue to WhatsApp</button>
        <button class="link push-skip" type="button" data-wa="cancel">Cancel</button>
        <p class="push-hint">Is someone troubling you with messages? Tell the organisers on <a href="${esc(safeUrl(C.speakUp))}" target="_blank" rel="noopener">TuteDude Community</a>.</p>
      </div></div>`;
    if (!waDlg.open) waDlg.showModal();
    return false;
  }
  // every WhatsApp link on the page (and "Copy all numbers") goes through the rules box first
  document.addEventListener("click", (e) => {
    const el = e.target.closest && e.target.closest('a[href^="https://wa.me/"], a[href^="https://chat.whatsapp.com/"], [data-act="copy-numbers"]');
    if (!el) return;
    const href = el.tagName === "A" ? el.href : "";
    const go = () => {
      if (!href) { const b = $('[data-act="copy-numbers"]'); if (b) b.click(); return; }
      const a = document.createElement("a");
      a.href = href; a.target = "_blank"; a.rel = "noopener";
      document.body.appendChild(a); a.click(); a.remove();
    };
    if (waGate(go)) return;
    e.preventDefault(); e.stopPropagation();
  }, true);

  function notifyBarHtml() {
    if (!S.me) return "";
    const st = pushState();
    if (st !== "off" && ss.get("tdb-notify-later")) return "";
    if (st === "off") return `<div class="notify-bar"><span>${ic("bell")} <b>Turn on notifications</b> so you know when someone joins your team and when the problem statement is out.</span>
      <span class="row-btns"><button class="btn btn-sm" type="button" data-act="push-on">Turn on</button></span></div>`;
    if (st === "ios-install") return `<div class="notify-bar"><span>${ic("bell")} <b>Notifications on iPhone:</b> tap <b>Share</b> → <b>Add to Home Screen</b>, then open Buildathon from your home screen and turn them on.</span>
      <span class="row-btns"><button class="link" type="button" data-act="push-later">Got it</button></span></div>`;
    if (st === "denied") return `<div class="notify-bar notify-off"><span>${ic("bell-off")} Notifications are blocked. To get them, allow notifications for this site in your browser settings.</span>
      <span class="row-btns"><button class="link" type="button" data-act="push-later">OK</button></span></div>`;
    return "";
  }

  /* ============================================================
     RENDER
     ============================================================ */
  const cache = {};
  function put(id, html) {
    if (cache[id] === html) return;
    cache[id] = html;
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }
  let raf = 0;
  function render() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; draw(); });
  }
  function draw() {
    const lk = locked();
    $("#lockBar").hidden = !lk;
    $("#lockBar").innerHTML = revealed() ? "<b>Registration is closed.</b> The problem statement is out: it's on your team page."
      : `<b>Registration is closed.</b> The session starts at <b>7 PM</b>, and the problem is revealed on <b>${esc(revealText())}</b>.`;
    $$("[data-reg-label]").forEach((b) => { b.textContent = S.me ? "My team" : lk ? "Closed" : "Register"; });
    $$(".cta-reg").forEach((b) => { b.textContent = S.team ? "Go to my team" : S.me ? (lk ? "Go to my page" : "Create or join a team") : lk ? "Registration closed" : "Register your team"; });
    $$(".cta-find").forEach((b) => { b.hidden = !!S.team || lk; });
    $$(".cta-watch").forEach((b) => { b.hidden = !FV || lk || !!(S.team && teamSize(S.team) >= MIN); });
    const nf = $("#navFind");
    if (nf) nf.hidden = !GROUP || lk;
    const eb = $("#heroEyebrow");
    if (eb) eb.textContent = lk ? "TuteDude Buildathon 2026 · Registrations closed" : "TuteDude Buildathon 2026 · Registrations open";
    $("#boardTitle").textContent = S.team ? "Your team" : S.me ? "You're not in a team yet" : lk ? "Registration closed" : "Register your team";
    const ld = $("#heroLede");
    if (ld && lk) ld.innerHTML = `Registration is closed. ${revealed() ? "The problem statement is out: build your solution with your team and" : `The problem statement comes out on <b>${esc(revealText())}</b>. Then build it and`} submit by <b>${esc(submitByText())}</b>.`;
    const st = S.stats;
    put("stats", st ? `<b>${Number(st.people) || 0}</b> registered${st.today ? ` · <b class="hot">+${Number(st.today) || 0}</b> in the last 24\u00a0h` : ""}` : "");
    put("notifyBar", notifyBarHtml());
    put("mePanel", meHtml());
    renderTicker();
    updateSticky();
  }

  // sticky bottom bar, shown once the hero has scrolled away (hidden next to the team panel and while a
  // pop-up is open): "Register your team" for visitors, "Invite your teammates" while a team is too small
  const seen = { hero: true, panel: false };
  const STICKY = {
    register: ["register", "Register your team"],
    team: ["goto-board", "Create or join a team"],
    invite: ["goto-invite", "Invite your teammates"]
  };
  function stickyMode() {
    if (locked()) return "";
    if (!S.me) return "register";
    if (!S.team) return "team";
    return teamSize(S.team) < MIN ? "invite" : "";
  }
  function updateSticky() {
    const bar = $("#stickyCta");
    if (!bar) return;
    const mode = stickyMode();
    if ((bar.dataset.mode || "") !== mode) {
      bar.dataset.mode = mode;
      const btn = $(".sticky-btn", bar), [act, text] = STICKY[mode] || STICKY.register;
      btn.dataset.act = act;
      btn.textContent = text;
    }
    const show = !!mode && !seen.hero && !seen.panel && !$("dialog[open]");
    bar.classList.toggle("show", show);
    bar.setAttribute("aria-hidden", String(!show));
    $(".sticky-btn", bar).tabIndex = show ? 0 : -1;
    document.body.classList.toggle("has-sticky", show);
  }

  // live ticker under the hero: public numbers + what to do (no names)
  // It stays invisible (its height is reserved) until the numbers arrive, then fades in: no jump on refresh.
  let tickerFallback = false;
  function renderTicker() {
    const st = S.stats;
    if (!st && !tickerFallback) return;
    const P = Array.isArray(C.prizes) && C.prizes.length >= 3 ? C.prizes : [C.prize || "₹5,000", "₹3,000", "₹2,000"];
    const items = [`{{trophy}} Prizes: {{m1}} <b>${esc(P[0])}</b> · {{m2}} <b>${esc(P[1])}</b> · {{m3}} <b>${esc(P[2])}</b>`, "{{cap}} Exclusive for TuteDude students"];
    if (st) {
      items.push(`{{users}} <b>${Number(st.people) || 0}</b> registered`);
      if (st.today) items.push(`{{flame}} <b>+${Number(st.today) || 0}</b> joined in the last 24 hours`);
    }
    if (!locked()) items.push(`{{handshake}} Register your team of ${MIN} to ${MAX} in 1 minute`, "{{calendar}} No team yet? Daily Team Building Sessions on TuteDude", `{{clock}} Teams lock ${esc(lockText())}`);
    else items.push("{{lock}} Teams are locked");
    items.push("{{bulb}} A real problem. Your novel solution.", `{{megaphone}} Problem statement: ${esc(revealText())}`, "{{timer}} Then 1 week to build", "{{award}} Certificate for every participant", "{{briefcase}} A real project for your portfolio", "{{gift}} Free · Fully online");
    const one = `<span class="tk">${items.map((x) => `<em>${withIcons(x)}</em>`).join("<i>✦</i>")}<i>✦</i></span>`;
    put("marqTrack", one + one); // two copies, so the loop is seamless
    put("marqTrack2", one + one); // the same ticker inside the hero copy on phones
    $$("#marqTrack, #marqTrack2").forEach((el) => el.classList.add("ready"));
  }
  function lockText() {
    const d = new Date(DEADLINE);
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }) + ", " +
      d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).replace(/\s?(am|pm)$/i, (x) => " " + x.trim().toUpperCase());
  }

  // "₹10,000": the prizes in config.js added up
  const prizeTotal = () => { const n = (Array.isArray(C.prizes) ? C.prizes : []).reduce((a, p) => a + (parseInt(String(p).replace(/[^0-9]/g, ""), 10) || 0), 0); return n ? "₹" + n.toLocaleString("en-IN") : ""; };
  const slotsHtml = (n, cap = MAX) => `<span class="slots">${Array.from({ length: Math.max(cap, n) }, (_, i) => `<i${i < n ? ` class="on"` : ""}></i>`).join("")} ${n}/${Math.max(cap, n)}</span>`;   // a team registered under an older, bigger limit shows as full, not "7/5"
  // "contact the organiser": the TuteDude Community (SpeakUp) link
  const orgBtns = () => `<a class="btn btn-sm" href="${esc(safeUrl(C.speakUp))}" target="_blank" rel="noopener">TuteDude Community (SpeakUp) ↗</a>`
    + (/^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+$/.test(C.findTeamGroup || "") ? `<a class="btn btn-sm btn-wa" href="${esc(C.findTeamGroup)}" target="_blank" rel="noopener">WhatsApp community ↗</a>` : "");
  const WA_ICON = `<svg viewBox="0 0 32 32" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M16.04 3C9.4 3 4 8.38 4 15c0 2.11.56 4.17 1.62 5.98L4 29l8.24-1.58A12.060 12.060 0 0 0 16.04 27C22.66 27 28 21.62 28 15S22.66 3 16.04 3zm0 21.8c-1.86 0-3.68-.5-5.27-1.450l-.38-.22-4.890.94.97-4.75-.25-.4A9.74 9.74 0 0 1 6.200 15c0-5.400 4.42-9.800 9.84-9.800 5.42 0 9.76 4.400 9.760 9.800 0 5.400-4.34 9.800-9.760 9.800zm5.38-7.330c-.29-.15-1.74-.86-2.010-.95-.27-.1-.47-.15-.67.15-.2.29-.77.95-.94 1.150-.17.2-.35.22-.64.07-.29-.15-1.24-.46-2.360-1.460-.87-.78-1.460-1.740-1.630-2.030-.17-.29-.02-.45.13-.6.13-.13.29-.34.44-.51.15-.17.2-.29.29-.49.1-.2.05-.37-.02-.51-.07-.15-.67-1.600-.91-2.200-.24-.57-.49-.5-.67-.5h-.57c-.2 0-.51.07-.78.37-.27.29-1.020 1-1.020 2.440s1.050 2.830 1.200 3.030c.15.2 2.060 3.150 4.990 4.420.7.3 1.240.48 1.670.61.7.22 1.340.19 1.840.12.56-.08 1.740-.71 1.980-1.400.25-.69.25-1.280.17-1.400-.07-.12-.27-.2-.56-.34z"/></svg>`;
  const waButton = (m) => `<a class="wa-btn" href="${esc(waLink(m.phone, `Hi ${first(m.name)}! I'm ${first(S.me.name)} from ${S.team.name} (TuteDude Buildathon) 👋`))}" target="_blank" rel="noopener" aria-label="Message ${esc(m.name)} on WhatsApp">${WA_ICON}<span>WhatsApp</span></a>`;
  const fullNumber = (phone) => "+" + normPhone(phone);

  function timeLeft(target) {
    const ms = Math.max(0, (target || DEADLINE) - Date.now());
    const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60;
    if (d) return `${d} day${d > 1 ? "s" : ""} ${h} hour${h === 1 ? "" : "s"}`;
    if (h) return `${h} hour${h > 1 ? "s" : ""} ${m} min`;
    return `${m} min`;
  }
  // "Sat, 21 Nov, 7 PM" (IST)
  function istText(t, fallback) {
    if (isNaN(t)) return fallback;
    const d = new Date(t);
    return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" }) + ", " +
      d.toLocaleTimeString("en-IN", { hour: "numeric", minute: d.getMinutes() ? "2-digit" : undefined, timeZone: "Asia/Kolkata" }).replace(/\s?(am|pm)$/i, (x) => " " + x.trim().toUpperCase());
  }
  const revealText = () => istText(REVEAL, "Buildathon day");

  // how to create a TuteDude session room (steps follow the how-to video)
  const AGREE_TEXT = "Yes, my team will create or join our TuteDude session and do our product discussion there.";
  const stepsHtml = (team) => `<ol class="gate-steps">
      <li>Open TuteDude: any lecture → <b>Community</b> → <b>Sessions</b>.</li>
      <li>Create a room and pick <b>Doubt or study</b>.</li>
      <li>In “What you're working on”, write <b>${esc(team)} · Buildathon</b>.</li>
      <li>Set the audience to <b>Everyone</b> (your teammates may be from other courses), then tap <b>Create room</b>.</li>
      <li>Teammates find the room in Sessions by your team name. Do your product discussion there.</li>
    </ol>`;
  function sessionHtml(t) {
    const V = C.session || {};
    return `<div class="session-card" id="sessionGate">
      <div><h4>${ic("video")} Meet your team on TuteDude Sessions</h4>
        <p>Create a room for <b>${esc(t.name)}</b> or join a teammate's room${revealed() ? " and build there." : `. Problem statement: <b>${esc(revealText())}</b>.`}</p></div>
      <span class="row-btns"><a class="btn btn-sm" href="${esc(safeUrl(V.link || C.speakUp))}" target="_blank" rel="noopener">Open TuteDude ↗</a>
        <button class="btn btn-sm btn-ghost" type="button" data-act="session">▶ How to create a room</button></span>
    </div>`;
  }
  // no team yet: join a team that welcomes new members, or meet people at a Team Building Session
  function noTeamYetHtml() {
    return groupHtml(true) + findVideoHtml() + teamBuildingHtml();   // visitors without a team: the WhatsApp community first
  }
  // daily Team Building Sessions in a permanent TuteDude room
  function teamBuildingHtml() {
    const link = TB.link || (C.session || {}).link || C.speakUp;
    return `<div class="tb-card">
      <div><h4>${ic("calendar")} No team yet? Join a Team Building Session</h4>
        <p><b>${esc(TB.when || "Every morning and evening")}</b> on TuteDude Sessions. Meet learners, form your team, then register.</p></div>
      <span class="row-btns"><a class="btn btn-sm btn-ghost" href="${esc(safeUrl(link))}" target="_blank" rel="noopener">Open TuteDude ↗</a></span>
    </div>`;
  }

  // the problem statement: from REVEAL, for teams of MIN+ people (get_me sends it only then)
  function problemHtml(t) {
    if (!revealed() || teamSize(t) < MIN) return "";
    const P = t.problem || {};
    return `<div class="problem-card"><p class="kicker">${ic("megaphone")} Problem statement</p>
      ${P.text ? `<div class="problem-text">${linkify(P.text).replace(/\n/g, "<br>")}</div>` : `<p>It's being published right now. This page updates on its own, or refresh in a minute.</p>`}
      ${P.link ? `<span class="row-btns"><a class="btn btn-sm" href="${esc(safeUrl(P.link))}" target="_blank" rel="noopener">Open the full problem statement ↗</a></span>` : ""}</div>`;
  }

  // the project: the leader submits it here once, between the problem statement and the deadline
  const submitByText = () => istText(SUBMIT_BY, "the deadline");
  const submitDayText = () => { const t = isNaN(SUBMIT_FROM) ? SUBMIT_BY : SUBMIT_FROM; return isNaN(t) ? "submission day" : istText(t, "").split(", ").slice(0, 2).join(", "); };
  const submitTimeText = () => (isNaN(SUBMIT_BY) ? "the deadline" : istText(SUBMIT_BY, "").split(", ").pop());
  function submissionHtml(t, lead) {
    if (!revealed() || teamSize(t) < MIN) return "";
    const s = t.submission, leader = (t.members.find((m) => m.id === t.leaderId) || {}).name || "Your leader";
    if (s) {
      const link = (u, label) => (u ? `<a class="btn btn-sm btn-ghost" href="${esc(safeUrl(u))}" target="_blank" rel="noopener">${label} ↗</a>` : "");
      return `<div class="submit-card done"><p class="kicker">${ic("check")} Project submitted</p>
        <h4>${esc(s.title)}</h4><p class="sub-sum">${esc(s.summary)}</p>
        <span class="row-btns">${link(s.product, "Project")}${link(s.site, "Website")}${link(s.video, "Promo video")}</span>
        <p class="small muted">Submitted ${esc(istText(s.at, ""))}. A submission can't be changed.</p></div>`;
    }
    if (submitEarly()) return `<div class="submit-card soon"><p class="kicker">${ic("calendar")} Submission day: ${esc(submitDayText())}</p>
      <p>Build your project this week. On <b>${esc(submitDayText())}</b> ${lead ? "you submit it here" : `${esc(first(leader))}, your leader, submits it here`}: project link, website, promo video and a short description.
        Submissions are open on that day only, until <b>${esc(submitTimeText())}</b>.</p></div>`;
    if (!submitOpen()) return `<div class="submit-card closed"><p class="kicker">${ic("lock")} Submissions are closed</p><p>Your team didn't submit a project before ${esc(submitByText())}.</p></div>`;
    return `<div class="submit-card"><p class="kicker">${ic("rocket")} Submit your project</p>
      <p>${lead ? "Submissions are open. Submit your project here as soon as it's ready: project link, website, promo video and a short description." : `Submissions are open. ${esc(first(leader))}, your leader, submits the project here as soon as it's ready.`}
        You don't have to wait for the last day: it closes at <b>${esc(submitByText())}</b>. Only one submission, and it can't be changed.</p>
      ${lead ? `<span class="row-btns"><button class="btn btn-sm" type="button" data-act="submit-open">Submit project</button></span>` : ""}</div>`;
  }

  function meHtml() {
    if (!S.me) {
      if (locked()) return `<div class="me me-empty"><div><h3>Registration is closed</h3>
        <p>Registered already, but on another phone or browser? Get back to your team with your WhatsApp number and email.</p></div>
        <span class="row-btns"><button class="btn" type="button" data-act="reclaim-open">Get back to your team</button></span></div>`;
      if (S.loadErr && !S.be) return `<p class="empty">Couldn't connect. Check your internet and refresh the page.</p>`;
      return `<div class="me me-empty">
        <div><h3>Register your team in 1 minute</h3>
        <p>The leader registers and shares the team link. Got a team link? Open it to join. ${ic("hourglass")} Teams lock in ${esc(timeLeft())}.</p></div>
        <span class="row-btns"><button class="btn" type="button" data-act="register-create">Register our team</button>
          <button class="btn btn-ghost" type="button" data-act="register-join">I have a team link</button></span>
      </div>${noTeamYetHtml()}`;
    }
    const canSignOut = LOGIN === "google";
    const top = `<div class="me-top">
      <div class="me-who">${avHtml(S.me)}<div><b>${plink(S.me.id, S.me.name)}</b> ${dchip(S.me.domain)}</div></div>
      <div class="me-links">${locked() ? "" : `<button class="link" type="button" data-act="edit-profile">Edit profile</button>`}${canSignOut ? `<button class="link" type="button" data-act="sign-out">Sign out</button>` : ""}</div>
    </div>`;
    return `<div class="me">${top}${S.team ? myTeamHtml() : noTeamHtml()}</div>`;
  }

  // registered, but not in a team (they left, or the leader removed them)
  function noTeamHtml() {
    if (locked()) {
      return `<div class="session-card warn"><div><h4>You're not in a team</h4><p>You can still join a team that has room: ask its leader for the team link, then open it or paste it here. You need a team to take part.</p></div>
        <span class="row-btns"><button class="btn btn-sm" type="button" data-act="switch-team">Join with a team link</button>${orgBtns()}</span></div>`;
    }
    return `<div class="team-box">
      <div class="team-title"><p class="kicker">Your team</p><h3>You're not in a team yet</h3>
        <p class="me-hint">Create a team, or join your team with the link your leader sent. ${ic("hourglass")} Teams lock in ${esc(timeLeft())}.</p></div>
      <span class="row-btns"><button class="btn btn-sm" type="button" data-act="register-create">Register a team</button>
        <button class="btn btn-sm btn-ghost" type="button" data-act="register-join">Join with a team link</button></span>
      ${groupHtml(true)}
      ${findVideoHtml()}
      ${teamBuildingHtml()}
    </div>`;
  }

  // registered students find teammates in the WhatsApp group (only shown after registering)
  const GROUP = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+$/.test(C.findTeamGroup || "") ? C.findTeamGroup : "";
  function groupHtml(alone) {
    if (!GROUP || locked()) return "";
    return `<div class="group-card"><div><h4>${WA_ICON} ${alone ? "No team yet? Find one here" : "Need more teammates?"}</h4>
      <p>Join the Buildathon WhatsApp community. Students ${alone ? "without a team" : "looking for a team"} meet there, so you can connect and team up.</p></div>
      <span class="row-btns"><a class="btn btn-sm btn-wa" href="${esc(GROUP)}" target="_blank" rel="noopener">${WA_ICON} Join the WhatsApp community</a></span></div>`;
  }
  // the "Find your team on TuteDude" video (the Buildathon tab): a card with the thumbnail; it plays in a pop-up,
  // because the team board redraws itself and would stop a video playing inside it
  const FV = C.findVideo && C.findVideo.video ? C.findVideo : null;
  function findVideoHtml() {
    if (!FV || locked()) return "";
    return `<div class="fv-card">
      <button class="fv-thumb" type="button" data-act="find-video" aria-label="Play the video: find your team on TuteDude">
        ${FV.poster ? `<img src="${esc(FV.poster)}" alt="" width="320" height="180" loading="lazy">` : ""}<span class="fv-play" aria-hidden="true">▶</span></button>
      <div><h4>${ic("users")} Find teammates on TuteDude</h4>
        <p>New: the <b>Buildathon tab</b> in TuteDude Sessions. Find builders from every course, message them, or start a team. See how in 1 minute.</p>
        <span class="row-btns"><button class="btn btn-sm" type="button" data-act="find-video">▶ Watch the video</button>
          ${FV.link ? `<a class="btn btn-sm btn-ghost" href="${esc(safeUrl(FV.link))}" target="_blank" rel="noopener">Open the Buildathon tab ↗</a>` : ""}</span></div>
    </div>`;
  }
  function openFindVideo() {
    if (!FV) return;
    const frame = $("#findVideo");
    let v = $("video", frame);
    if (!v) {
      v = document.createElement("video");
      v.controls = true; v.playsInline = true; v.preload = "auto";
      v.src = FV.videoSmall && matchMedia("(max-width: 820px)").matches ? FV.videoSmall : FV.video;   // phones: the smaller file
      if (FV.poster) v.poster = FV.poster;
      v.setAttribute("controlsList", "nodownload");
      frame.appendChild(v);
    }
    $("#findActions").innerHTML = (FV.link ? `<a class="btn btn-full" href="${esc(safeUrl(FV.link))}" target="_blank" rel="noopener">Open the Buildathon tab on TuteDude ↗</a>` : "")
      + (!S.me && !locked() ? `<button class="link" type="button" data-act="find-register">Found your teammates? Register your team</button>` : "");
    $$("dialog[open]").forEach((d) => { if (d !== findDlg) closeDlg(d); });
    openDlg(findDlg);
    if (v.ended) v.currentTime = 0;
    if (v.paused) v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });   // muted if the browser insists: the video has captions
  }

  // "Find your team" in the menu: opens the WhatsApp community (the rules box comes first, like every WhatsApp link)
  // and scrolls the page to the "No team yet? Find one here" card, or to the team board when the card isn't shown
  const navFind = $("#navFind");
  if (navFind && GROUP) {
    navFind.href = GROUP; navFind.target = "_blank"; navFind.rel = "noopener";
    navFind.innerHTML = WA_ICON + "<span>Find your team</span>";
    document.addEventListener("click", (e) => {
      if (!e.target.closest || !e.target.closest("#navFind")) return;
      const nav = $("#nav");
      if (nav && nav.classList.contains("open")) $("#navToggle").click();   // the WhatsApp rules box can stop the menu's own close
      const card = $("#mePanel .group-card");
      (card || $("#board")).scrollIntoView({ behavior: "smooth", block: card ? "center" : "start" });
      if (card) { card.classList.remove("flash"); void card.offsetWidth; card.classList.add("flash"); }
    }, true);
  }

  // the team link, with copy + WhatsApp buttons (and, for the leader, "Team is full" + the team size)
  function inviteHtml(t, lead) {
    const link = teamLink(t.code), full = teamFull(t);
    const msg = `Join my team ${t.name} for the TuteDude Buildathon 🚀 ${prizeTotal() ? prizeTotal() + " in prizes for the top 3 teams. " : ""}Open this link and register in 1 minute: ${link}`;
    return `<div class="invite" id="invite">
      <div><h4>${ic("link")} Your team link</h4>
        <p>${full ? `Your team is full, so the link says <b>“Team is full”</b> and nobody new can join.${(t.listed || []).length ? " Teammates the leader added still get their spot." : ""}`
          : `Send it to your teammates. They open it and land in <b>${esc(t.name)}</b>.`}</p></div>
      <div class="invite-link"><input type="text" id="inviteLink" readonly value="${esc(link)}" aria-label="Your team link"><button class="btn btn-sm" type="button" data-act="copy-link">Copy</button></div>
      <span class="row-btns">${full ? "" : `<a class="btn btn-sm btn-wa" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">${WA_ICON} Send on WhatsApp</a>`}
        <span class="muted small">Team code: <b class="mono">${esc(showCode(t.code))}</b></span></span>
      ${joinCtlHtml(t, lead)}
      ${false ? `<label class="open-toggle"><input type="checkbox" data-act="toggle-open"${t.open ? " checked" : ""}>
          <span><b>Welcome students without a team</b><small>${t.open ? `On: students without a team can pick ${esc(t.name)} from a list and join.` : "Off: only people with your link can join. Turn it on if you need more teammates."}</small></span></label>`
        : ""}
      ${lead && !locked() ? `<p class="small muted">Shared the link with the wrong people? <button class="link small" type="button" data-act="reset-code">Make a new link</button> (the old one stops working).</p>` : ""}
    </div>`;
  }

  // "What to do now": the whole journey in one list, with the current step highlighted
  const teamSize = (t) => t.members.length + (t.listed || []).length;
  // "Team is full": the leader closed the team, or it has the number of people the leader picked (supabase.sql: set_team_closed, set_team_cap)
  const capOf = (t) => Math.min(MAX, Number(t.cap) || MAX);
  const teamFull = (t) => !!t.closed || teamSize(t) >= capOf(t);
  function joinCtlHtml(t, lead) {
    if (!lead || t.submission) return "";   // after the lock too: people can still move into a team with room
    const n = teamSize(t), cap = capOf(t), sizes = [];
    for (let k = Math.max(MIN, n); k <= MAX; k++) sizes.push(k);
    return `<div class="join-ctl">
      <label class="open-toggle"><input type="checkbox" data-act="toggle-closed"${t.closed ? " checked" : ""}${n < MIN && !t.closed ? " disabled" : ""}>
        <span><b>Team is full: stop new members</b><small>${t.closed ? "On: the link says “Team is full” and nobody new can join. Turn it off to let people join again."
          : n < MIN ? `You can turn this on once your team has ${MIN} people.` : "Turn it on when your team is complete. The link then says “Team is full” and nobody new can join."}</small></span></label>
      <div class="cap-row"><span><b>Team size</b><small>At ${cap} people the team closes by itself.</small></span>
        <span class="cap-pick" role="group" aria-label="Team size">${sizes.map((k) => `<button type="button" class="cap-btn${k === cap ? " on" : ""}" data-act="set-cap" data-cap="${k}" aria-pressed="${k === cap}">${k}</button>`).join("")}</span></div>
    </div>`;
  }
  function nextStepsHtml(t, lead) {
    const n = teamSize(t);
    const steps = [
      { ok: true, text: `You're in <b>${esc(t.name)}</b>${lead ? " as the leader" : ""}` },
      { ok: !!S.me.sessionOk, text: "You agreed to do your product discussion on TuteDude Sessions" },
      { ok: n >= MIN, text: n >= MIN ? `Your team has ${n} people${!teamFull(t) && (!locked() || t.lateOpen) ? ` (room for ${capOf(t) - n} more)` : ""}` : `Get your teammates in: send them the team link (at least ${MIN} people, up to ${capOf(t)})` },
      { ok: revealed(), text: `The problem statement appears here on <b>${esc(revealText())}</b>. Then you have 1 week to build` },
      { ok: !!t.submission, text: `Your leader submits the project here on <b>${esc(submitDayText())}</b>, before ${esc(submitTimeText())}` }
    ];
    const current = steps.findIndex((s) => !s.ok);
    return `<div class="next-steps"><h4>What to do now</h4><ol>${steps.map((s, i) =>
      `<li class="${s.ok ? "done" : i === current ? "now" : ""}">${s.text}</li>`).join("")}</ol></div>`;
  }

  /* ---------- a little fun: team name ideas, a line about the team, confetti ---------- */
  const FUN_NAMES = ["Ctrl Alt Elite", "404 Sleep Not Found", "Bug Busters", "Null Pointers", "Git Happens", "Code Blooded", "Runtime Terrors", "Caffeine Overflow",
    "Pixel Pirates", "Works On My Machine", "Hello World Domination", "Semicolon Squad", "Merge Conflict", "Two Brains One Laptop", "Deadline Dodgers", "Brain Not Found",
    "Ship It Squad", "Low Battery High Hopes", "Copy Paste Kings", "Infinite Loopers", "Last Minute Legends", "Commit and Pray", "Keyboard Warriors", "Idea Machines",
    "Wi-Fi Warriors", "The Stack Overflowers", "Tab Hoarders", "Sleep Is Optional", "Plan B Builders", "It Compiled Once"];
  // "Surprise me" never offers a name another team already has: the classics first, then word pairs
  // ("Turbo Pandas"), each batch checked against the teams that exist (names_taken in supabase.sql).
  const FUN_A = ["Turbo", "Midnight", "Cosmic", "Sneaky", "Mighty", "Lazy", "Hungry", "Fearless", "Sleepy", "Caffeinated", "Quantum", "Pixel",
    "Rogue", "Electric", "Curious", "Savage", "Golden", "Wired", "Bold", "Chaotic", "Clever", "Rapid", "Neon", "Fuzzy"];
  const FUN_B = ["Coders", "Builders", "Hackers", "Ninjas", "Wizards", "Pandas", "Debuggers", "Rockets", "Dreamers", "Makers", "Owls", "Titans",
    "Foxes", "Legends", "Pirates", "Brains", "Mavericks", "Sparks", "Falcons", "Geeks", "Crew", "Squad", "Tigers", "Shippers"];
  const shuffled = (a) => { const x = a.slice(); for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };
  let funPool = [], funLeft = [], funBusy = false;
  async function funName() {
    const inp = $("#rTeamName"), btn = $("[data-act=name-gen]");
    if (funBusy) return;
    funBusy = true;
    if (btn) { btn.classList.remove("roll"); void btn.offsetWidth; btn.classList.add("roll"); }
    try {
      for (let tries = 0; !funLeft.length && tries < 6; tries++) {
        if (!funPool.length) funPool = shuffled(FUN_A.flatMap((a) => FUN_B.map((b) => a + " " + b))).concat(shuffled(FUN_NAMES));   // popped from the end: classics first
        const batch = funPool.splice(-40).reverse();
        let taken = [];
        try { taken = (await S.be.namesTaken(batch)) || []; } catch (e) { console.warn(e); }   // offline: still suggest something
        const have = new Set(taken.map((n) => String(n).toLowerCase()));
        funLeft = batch.filter((n) => !have.has(n.toLowerCase()) && n !== inp.value).reverse();
      }
      if (funLeft.length) { inp.value = funLeft.pop(); inp.dispatchEvent(new Event("input", { bubbles: true })); }
    } finally { funBusy = false; }
  }
  const teamVibe = (n, cap = MAX) => n >= cap ? "Full squad. Now go win it." : n === 1 ? "Solo mode. Every hero needs a squad, so send that link."
    : n === 2 ? "Dynamic duo. Two brains, one mission." : n === 3 ? "Trio locked in. Three heads are better than one."
    : n === cap - 1 ? `${n} strong. One seat left for a legend.` : `${n} strong and growing. Room for ${cap - n} more.`;
  function confetti() {
    if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const box = document.createElement("div");
    box.className = "confetti"; box.setAttribute("aria-hidden", "true");
    const colors = ["#800080", "#f7c873", "#e0457b", "#2a0828", "#3fa66b", "#ffffff"];
    for (let i = 0; i < 90; i++) {
      const c = document.createElement("i");
      c.style.setProperty("--x", (Math.random() * 100).toFixed(1) + "vw");
      c.style.setProperty("--dx", (Math.random() * 30 - 15).toFixed(1) + "vw");
      c.style.setProperty("--r", Math.round(Math.random() * 900 - 450) + "deg");
      c.style.setProperty("--d", (1.8 + Math.random() * 1.6).toFixed(2) + "s");
      c.style.setProperty("--w", (0.3 * Math.random()).toFixed(2) + "s");
      c.style.background = colors[i % colors.length];
      if (i % 3 === 0) c.style.borderRadius = "50%";
      box.appendChild(c);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 4200);
  }

  function myTeamHtml() {
    const t = S.team, me = S.me.id, lead = amLeader(), lockedNow = locked(), listed = t.listed || [], n = t.members.length + listed.length, ok = n >= MIN;
    const addOpen = !lockedNow || !!t.lateOpen;   // reopened by the organisers after the lock: the link and "Add a teammate" work again
    const need = MIN - n, cap = capOf(t), full = teamFull(t);
    const status = (ok ? `<span class="ok">✓ Ready</span>` : `<span class="warn-chip">Needs ${need} more ${need === 1 ? "person" : "people"}</span>`)
      + (ok && full && addOpen ? ` <span class="full-chip">${ic("lock")} Team is full</span>` : "");
    let h = `<div class="team-box">
      <div class="team-title"><p class="kicker">Your team</p>
        <h3>${esc(t.name)}${lead && !lockedNow ? ` <button class="link small" type="button" data-act="rename">Rename</button>` : ""}</h3>
        <p class="team-meta">${slotsHtml(n, cap)} ${status}</p>${lockedNow && !ok ? "" : `<p class="team-vibe">${ic("sparkles")} ${teamVibe(n, cap)}</p>`}</div>`;

    if (!ok && !lockedNow) {
      const link = teamLink(t.code);
      const msg = `Join my team ${t.name} for the TuteDude Buildathon 🚀 ${prizeTotal() ? prizeTotal() + " in prizes for the top 3 teams. " : ""}Open this link and register in 1 minute: ${link}`;
      h += `<div class="solo-card"><div><h4>${ic("users")} ${n <= 1 ? "Now bring in your teammates" : "Your team isn't complete yet"}</h4>
        <p>${n <= 1 ? "Right now it's only you." : ""} A team needs at least <b>${MIN} people</b> to take part. Share your team link: your teammates open it and join <b>${esc(t.name)}</b>.</p></div>
        <span class="row-btns"><a class="btn btn-sm btn-wa" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">${WA_ICON} Share link on WhatsApp</a>
          <button class="btn btn-sm btn-ghost" type="button" data-act="copy-link">Copy link</button></span></div>`;
      h += inviteHtml(t, lead);
      h += groupHtml(n <= 1) + findVideoHtml();
    }
    h += problemHtml(t);
    h += submissionHtml(t, lead);
    if (lockedNow && !ok) {
      h += `<div class="session-card warn"><div><h4>Only you are in ${esc(t.name)}</h4><p>Teams are locked, and a team needs at least ${MIN} people to take part. Message the organisers on the TuteDude Community.</p></div>
        <span class="row-btns">${orgBtns()}</span></div>`;
    }
    if (t.lateOpen && !full) h += `<div class="session-card"><div><h4>${ic("sparkles")} Your team is open</h4><p>You can still add teammates (up to ${cap} people). ${lead ? "Share your team link, or tap <b>Add a teammate</b> below." : "Share your team link with anyone who wants to join."} New teammates see the problem statement here as soon as they join.</p></div></div>`;
    if (ok && addOpen && (n < MAX || listed.length)) h += inviteHtml(t, lead);
    if (ok && !full) h += groupHtml(false);
    if (ok || !lockedNow) h += sessionHtml(t);
    h += nextStepsHtml(t, lead);

    h += `<ul class="mlist">${t.members.map((m) => `<li>${avHtml(m)}<span class="m-name"><b>${plink(m.id, m.name + (m.id === me ? " (you)" : ""))}</b>${m.id === t.leaderId ? ` <span class="lead">Leader</span>` : ""}${hasSkill(m.domain) ? `<small>${esc(label(m.domain))}</small>` : ""}</span>
          ${m.id !== me && m.phone ? waButton(m) : ""}
          ${lead && m.id !== me && (!lockedNow || !t.submission) ? `<button class="x" type="button" data-act="remove" data-person="${esc(m.id)}" aria-label="Remove ${esc(m.name)} from your team">Remove</button>` : ""}
          ${m.id === me && lockedNow && !t.submission && t.members.length > 1 ? `<button class="x" type="button" data-act="switch-team" aria-label="Remove yourself from this team">Remove</button>` : ""}</li>`).join("")}${listed.map((l) => `<li class="m-listed"><i class="av av-listed" aria-hidden="true">${esc(initials(l.name))}</i><span class="m-name"><b>${esc(l.name)}</b><small>${lead && l.email ? esc(l.email) + " · " : ""}added by the leader</small></span>
          ${l.phone ? waButton(l) : ""}
          ${lead && addOpen ? `<button class="x" type="button" data-act="remove-mate" data-id="${esc(l.id)}" data-name="${esc(l.name)}" aria-label="Remove ${esc(l.name)} from your team">Remove</button>` : ""}</li>`).join("")}${!addOpen ? "" : Array.from({ length: t.closed ? (lead && n < cap ? 1 : 0) : Math.max(0, cap - n) }, (_, i) => lead && i === 0
            ? `<li class="m-empty m-add"><button class="add-mate" type="button" data-act="add-mate"><i class="av av-empty" aria-hidden="true">+</i><span>Add a teammate</span></button></li>`
            : `<li class="m-empty"><i class="av av-empty" aria-hidden="true">+</i><span>Open spot</span></li>`).join("")}</ul>`;

    h += n <= 1 ? `<p class="me-hint">Your teammates show up here as soon as they join with your team link${lead ? " or you add them" : ""}.</p>`
      : t.members.length > 1 || listed.some((l) => l.phone) ? `<p class="me-hint wa-hint">${WA_ICON} <span>Talk to your team on WhatsApp. Make a WhatsApp group and add everyone: <button class="link" type="button" data-act="copy-numbers">Copy all numbers</button></span></p>`
      : listed.length ? `<p class="me-hint">Teammates you added hold their spot. When they open the team link and register with that email, they see this page too.</p>` : "";

    if (!lockedNow) {
      if (!ok) h += `<div class="urgent-note">${ic("hourglass")} <b>${esc(timeLeft())}</b> left until teams lock. A team needs at least <b>${MIN} people</b> to take part, so send your team link now.</div>`;
      if (!full) h += `<p class="me-hint">${pushState() === "on" ? "We'll notify you when someone joins." : "Turn on notifications to know when someone joins."}</p>`;
      // leaving: open for the first 24 hours after joining (someone alone in the team can always leave)
      const mine = t.members.find((m) => m.id === me) || {}, leaveLeft = Number(mine.joinedAt) + LEAVE_MS - Date.now();
      if (n <= 1 || !(Number(mine.joinedAt) > 0)) h += `<p class="leave-row"><button class="link small danger" type="button" data-act="leave">Leave team</button></p>`;
      else if (leaveLeft > 0) {
        const hrs = Math.floor(leaveLeft / 36e5), mins = Math.max(1, Math.floor(leaveLeft / 6e4) % 60);
        h += `<p class="leave-row"><span class="leave-note">${ic("hourglass")} <span>Not the right team? You can leave for the next <b>${hrs ? hrs + (hrs === 1 ? " hour" : " hours") : mins + (mins === 1 ? " minute" : " minutes")}</b>.</span></span>
          <button class="link small danger" type="button" data-act="leave">Leave team</button></p>`;
      } else h += `<p class="leave-row"><span class="leave-note">${ic("lock")} <span>You joined this team more than ${LEAVE_MS / 36e5} hours ago, so it is final. Need help? Ask on the TuteDude Community.</span></span></p>`;
    } else if (!t.submission) {
      // after the lock: move to another team with room, with its team link (leave + join in one step, supabase.sql switch_team)
      h += `<p class="leave-row"><span class="leave-note">${ic("users")} <span>Want to change your team? Tap <b>Leave team</b> (or <b>Remove</b> next to your name) and paste the team link of your new team: you move there in one step.${lead ? " As the leader you can also remove a teammate." : ""}</span></span>
        <button class="link small danger" type="button" data-act="switch-team">Leave team</button></p>`;
    }
    return h + `</div>`;
  }

  /* ============================================================
     DIALOGS
     ============================================================ */
  const regDlg = $("#regDlg"), nameDlg = $("#nameDlg"), profDlg = $("#profDlg"), sessionDlg = $("#sessionDlg"), findDlg = $("#findDlg"), reclaimDlg = $("#reclaimDlg"), mateDlg = $("#mateDlg"), subDlg = $("#subDlg"), switchDlg = $("#switchDlg");
  function openDlg(d) { if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute("open", ""); } document.documentElement.classList.add("modal-open"); updateSticky(); }
  function closeDlg(d) { if (d.open) { if (d.close) d.close(); else d.removeAttribute("open"); } if (!$("dialog[open]")) document.documentElement.classList.remove("modal-open"); updateSticky(); }
  [regDlg, nameDlg, profDlg, sessionDlg, findDlg, reclaimDlg, mateDlg, subDlg, switchDlg].forEach((d) => {
    d.addEventListener("click", (e) => {
      if (e.target === d && d === regDlg && Date.now() - (reg.stepAt || 0) < 800) return;
      if (e.target === d || e.target.closest("[data-close]")) closeDlg(d);
    });
    d.addEventListener("close", () => { if (!$("dialog[open]")) document.documentElement.classList.remove("modal-open"); updateSticky(); });
  });
  sessionDlg.addEventListener("close", () => { const v = $("#sessionVideo video"); if (v) v.pause(); });
  findDlg.addEventListener("close", () => { const v = $("#findVideo video"); if (v) v.pause(); });
  regDlg.addEventListener("close", () => { const v = $("#regVideo video"); if (v) v.pause(); });
  /* move to another team after the lock (supabase.sql switch_team): check the team first, then leave + join in one step */
  const sw = { code: "", info: null };
  function resetSwitch() {
    sw.code = ""; sw.info = null;
    $("#switchInfo").hidden = true;
    $("#switchSubmit").textContent = "Check the team";
  }
  function openSwitch(code) {
    resetSwitch();
    showErr("#switchErr", "");
    const t = S.team;
    $("#switchTitle").textContent = t ? "Want to change your team?" : "Join a team";
    $("#switchNote").textContent = t ? `Paste the team link of your new team (ask its leader for it) and we'll put you in that team. You leave ${t.name} and join the new team in one step, so you stay in the Buildathon.`
      : "Ask the leader of the team you want to join for their team link, and paste it here.";
    $("#swCode").value = code ? showCode(code) : "";
    openDlg(switchDlg);
    if (code) checkSwitch(); else setTimeout(() => $("#swCode").focus(), 50);
  }
  async function checkSwitch() {
    const raw = $("#swCode").value.trim(), code = cleanCode((raw.match(/join=([A-Za-z0-9-]+)/) || [])[1] || raw), t = S.team;
    showErr("#switchErr", "");
    if (code.length !== 8) return showErr("#switchErr", "Paste the full team link (it ends with #join=…), or the 8-letter team code.");
    if (t && cleanCode(t.code) === code) return showErr("#switchErr", `That's the link of your own team, ${t.name}.`);
    const btn = $("#switchSubmit");
    btn.disabled = true;
    let info = null;
    try { await whenReady(); info = await S.be.teamByCode(code); } catch (e) { console.warn(e); }
    btn.disabled = false;
    if (!info) return showErr("#switchErr", "That team link doesn't work. Ask the leader to send it again.");
    if (info.full) return showErr("#switchErr", `${info.name} is full. Ask for the link of another team.`);
    sw.code = code; sw.info = info;
    const alone = t && t.members.length <= 1;
    $("#switchInfo").innerHTML = `<b>${esc(info.name)}</b>, led by ${esc(info.leader)}: ${Number(info.size) || 0} of ${Number(info.max) || MAX} people.`
      + (t ? ` You leave <b>${esc(t.name)}</b>${alone ? " (you're its only member, so it is deleted)" : amLeader() ? " and its next member becomes the leader" : ""}. Both teams are told.` : "");
    $("#switchInfo").hidden = false;
    btn.textContent = t ? `Leave ${t.name} and join ${info.name}` : `Join ${info.name}`;
  }
  async function submitSwitch(e) {
    e.preventDefault();
    if (!sw.info) return checkSwitch();
    const btn = $("#switchSubmit"), name = sw.info.name;
    btn.disabled = true;
    try {
      await whenReady();
      await S.be.switchTeam(sw.code);
      closeDlg(switchDlg);
      await refresh();
      toast(`You're in ${name} now. Say hi to your new team!`);
      $("#board").scrollIntoView({ behavior: "smooth" });
    } catch (err) {
      console.warn(err);
      showErr("#switchErr", (err && err.message) || "Something went wrong. Try again.");
    } finally { btn.disabled = false; }
  }
  function showErr(id, msg) {
    const el = $(id); el.textContent = msg || ""; el.hidden = !msg;
    if (msg && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }

  /* ---------- register (create or join a team) / edit profile ----------
     reg.mode: "create" | "join" (team link/code) | "find" (pick an open team) — for a new registration, or
     someone registered without a team — or "edit" (profile only).
     Step 1: team + details. Step 2 (only if they haven't agreed yet): the TuteDude Sessions video + consent. */
  const reg = { mode: "create", step: 1, info: null, seq: 0, late: false };   // late: joining a team reopened after the lock
  const needsVideo = () => reg.mode !== "edit" && !(S.me && S.me.sessionOk);

  function openRegister(mode, code) {
    if (S.me && S.team && mode !== "edit") { $("#board").scrollIntoView({ behavior: "smooth" }); return; }
    if (mode !== "join") reg.late = false;
    if (locked() && mode !== "edit" && !(mode === "join" && reg.late)) { toast("Teams are locked. Registration is closed.", true); return; }
    mode = ["edit", "join"].includes(mode) ? mode : "create";   // "Find a team" was removed
    const needGoogle = LOGIN === "google" && !S.user;
    $("#googleStep").hidden = !needGoogle;
    $("#regForm").hidden = needGoogle;
    $("#anonNote").hidden = !(LOGIN === "anonymous" && !S.me);
    showErr("#googleErr", "");
    $("#rTeamBox").hidden = mode === "edit";
    $("#reclaimLink").hidden = !!S.me;
    $("#rConsentRow").hidden = !!S.me;          // already confirmed when they registered
    $("#rTbNote").hidden = !!S.me || mode === "edit";
    if (code) { $("#rCode").value = showCode(code); ss.set(JOIN_KEY, code); }
    setTeamMode(mode === "edit" ? "create" : mode);
    reg.mode = mode;
    reg.part = "you"; reg.soloOk = false; reg.autoTry = 0; reg.autoFun = "";
    $("#rMates").classList.remove("nudge");
    if (!needGoogle) {
      if (S.me) {
        $("#rName").value = S.me.name;
        $("#rPhone").value = showPhone(S.me.phone);
        $("#rEmail").value = S.me.email || "";
        $("#rSkill").value = S.me.skill || "";
        $("#rLink").value = S.me.link || "";
        $("#rConsent").checked = true;
        $$("input[name=domain]", regDlg).forEach((i) => { i.checked = i.value === S.me.domain; });
        $("#rMore").open = mode === "edit" || !!(S.me.skill || S.me.link);
      } else {
        if (S.user && S.user.name && !$("#rName").value) $("#rName").value = S.user.name;
        if (S.user && S.user.email && !$("#rEmail").value) $("#rEmail").value = S.user.email;
      }
    }
    clearBad();
    $$("#rEmail, #rMates [data-mate=email]").forEach((i) => { i.dataset.checked = ""; });
    showStep(1);
    reg.stepAt = 0;   // the double-click guard is only for moving between steps
    openDlg(regDlg);
    if (!needGoogle) setTimeout(() => {
      const f = S.me && mode === "join" ? null : $("#rName");
      if (f) f.focus();
    }, 50);
  }
  // Step 1 has two short screens when a team is created: "you" (your details), then "team" (team name +
  // teammates, or the team link when joining). Editing a profile has only the first one. Nothing needs scrolling.
  const twoParts = () => reg.mode === "create" || reg.mode === "join";
  function syncPart() {
    if (!twoParts()) reg.part = "you";
    const team = reg.part === "team";
    $("#rPartYou").hidden = team;
    $("#rPartTeam").hidden = !team;
    // the optional line about you + the "I'm a TuteDude student" tick go on the last screen of step 1
    const slot = twoParts() ? $("#rSlotTeam") : $("#rSlotYou");
    slot.after($("#rMore"), $("#rConsentRow"));
    $("#reclaimLink").hidden = !!S.me || team || reg.step === 2;
    $("#regBack").hidden = !(reg.step === 2 || team);
    syncMateRows();
  }
  function showPart(p) {
    reg.part = p;
    reg.stepAt = Date.now();
    showErr("#regErr", "");
    syncPart();
    updateRegText();
    const body = $(".modal-body", regDlg);
    if (body) body.scrollTop = 0;
    setTimeout(() => { const f = reg.part !== "team" ? $("#rName") : reg.mode === "join" ? $("#rCode") : $("#rTeamName"); if (f && regDlg.open) f.focus({ preventScroll: true }); }, 30);
  }
  // the team screen lists all four: the leader (from the first screen) and three teammate rows
  function syncMateRows() {
    $("#rMateYou").textContent = clean($("#rName").value) || "You";
  }
  function setTeamMode(m) {
    reg.mode = m;
    $$("input[name=tmode]", regDlg).forEach((i) => { i.checked = i.value === m; });
    $("#rCreate").hidden = m !== "create";
    syncPart();
    $("#rJoin").hidden = m !== "join";
    $("#rFind").hidden = m !== "find";
    if (m === "join") lookupCode();
    else if (m === "find") loadOpenTeams();
    else updateRegText();
  }
  const pickedTeam = () => { const i = $$("input[name=team]:checked", regDlg)[0]; return i ? { id: i.value, name: i.dataset.name } : null; };
  // teams that welcome students without a team (names and skills only); missing your skill first
  let findSeq = 0;
  async function loadOpenTeams() {
    const box = $("#rTeams"), seq = ++findSeq, keep = (pickedTeam() || {}).id;
    const d = ($$("input[name=domain]:checked", regDlg)[0] || {}).value || "";
    updateRegText();
    if (!box.children.length) box.innerHTML = `<p class="muted small">Finding teams with room…</p>`;
    try {
      await whenReady();
      const list = await S.be.openTeams(d);
      if (seq !== findSeq) return;
      if (!list.length) {
        box.innerHTML = `<p class="pick-none">No team is looking for members right now. Check again later, come to a <a href="${esc(safeUrl(TB.link || (C.session || {}).link || C.speakUp))}" target="_blank" rel="noopener">Team Building Session</a> to meet teammates, or create your own team.</p>`;
        updateRegText();
        return;
      }
      box.innerHTML = list.map((t) => {
        const has = new Set(t.skills || []), needs = DOMAINS.filter((x) => x.key !== "other" && !has.has(x.key));
        return `<label class="pick"><input type="radio" name="team" value="${esc(t.id)}" data-name="${esc(t.name)}"${t.id === keep ? " checked" : ""}>
          <span class="pick-main"><b>${esc(t.name)}</b><small>${Number(t.size) || 0}/${Number(t.max) || MAX} · leader ${esc(t.leader)} · has ${(t.skills || []).map((k) => icon(k)).join(" ") || "–"}${needs.length ? ` · needs ${needs.map((x) => esc(x.short.toLowerCase())).join(", ")}` : ""}</small></span></label>`;
      }).join("");
      updateRegText();
    } catch (e) {
      console.warn(e);
      if (seq === findSeq) box.innerHTML = `<p class="muted small">Couldn't load the teams. Check your internet and try again.</p>`;
    }
  }
  function updateRegText() {
    const m = reg.mode, info = reg.info, pick = m === "find" ? pickedTeam() : null;
    const joinName = m === "find" ? (pick ? pick.name : "") : info && info.name && (!info.full || Number(info.reserved) > 0) ? info.name : "";
    const teamIsFull = !!(info && info.full && !(Number(info.reserved) > 0));   // "Team is full" on the title and the Join button
    const total = (twoParts() ? 2 : 1) + (needsVideo() ? 1 : 0), cur = reg.step === 2 ? total : reg.part === "team" ? 2 : 1;
    regDlg.style.setProperty("--prog", Math.round((cur / total) * 100) + "%");
    $("#regKicker").textContent = m === "edit" ? "Your profile" : total > 1 ? `Step ${cur} of ${total}`
      : S.me ? "Your team" : "Register · 1 minute";
    $("#regTitle").textContent = m === "edit" ? "Edit profile" : reg.step === 2 ? "Agree to TuteDude Sessions" : m === "create" && reg.part === "team" ? "Your team"
      : m === "join" ? (joinName ? `Join ${joinName}` : teamIsFull ? "Team is full" : "Join your team") : m === "find" ? (joinName ? `Join ${joinName}` : "Find a team") : "Register your team";
    $("#regSubmit").textContent = m === "edit" ? "Save" : m === "join" && teamIsFull ? "Team is full" : reg.step === 1 && (needsVideo() || (twoParts() && reg.part !== "team")) ? "Continue"
      : m === "join" || m === "find" ? (joinName ? `Register and join ${joinName}` : "Register and join the team") : "Register our team";
  }
  // checks the team code as it's typed / pasted (names only, nothing private)
  async function lookupCode() {
    const code = cleanCode($("#rCode").value), box = $("#rJoinInfo"), seq = ++reg.seq;
    reg.info = null;
    updateRegText();
    box.className = "join-info";
    if (code.length !== 8) { box.textContent = code ? "A team code has 8 letters and numbers, like ABCD-EFGH. Pasting the whole link works too." : "Paste the team link or code your leader sent you."; return; }
    box.textContent = "Checking the code…";
    try {
      await whenReady();
      const info = await S.be.teamByCode(code);
      if (seq !== reg.seq) return;
      if (!info) { box.className = "join-info bad"; box.textContent = "No team has this code. Check it, or ask your leader to send the link again."; return; }
      reg.info = info;
      const size = Number(info.size) || 0, max = Number(info.max) || MAX, held = Number(info.reserved) || 0;
      box.className = "join-info " + (info.full && !held ? "bad" : "good");
      box.innerHTML = !info.full ? `✓ <b>${esc(info.name)}</b> · leader ${esc(info.leader)} · ${size}/${max} people`
        : held ? `✓ <b>${esc(info.name)}</b> · leader ${esc(info.leader)} · ${size}/${max}. Your leader added you? Use the email they added and your spot is waiting.`
        : `<b>Team is full.</b> ${esc(info.name)} ${info.closed ? "isn't taking new members" : `has ${size}/${max} people`}. Ask your leader, or create your own team.`;
      updateRegText();
    } catch (e) {
      console.warn(e);
      if (seq === reg.seq) box.textContent = "Couldn't check the code right now. You can still continue.";
    }
  }
  function showStep(n) {
    reg.step = n;
    regDlg.dataset.step = String(n);
    regDlg.classList.toggle("no-steps", !needsVideo());
    reg.stepAt = Date.now();   // a fast double click must not submit step 2 or hit the backdrop
    $("#regStep1").hidden = n !== 1;
    $("#regStep2").hidden = n !== 2;
    syncPart();
    showErr("#regErr", "");
    if (n === 2) { $("#rSession").checked = false; mountVideo($("#regVideo"), VIDEO_REQUIRED); syncConsent(); }
    else { const v = $("#regVideo video"); if (v) v.pause(); $("#regSubmit").disabled = false; }
    updateRegText();
    const body = $(".modal-body", regDlg);
    if (body) body.scrollTop = 0;
    if (regDlg.open) setTimeout(() => { const f = n === 2 ? $("#regStep2 .step2-text") : reg.part === "team" ? $("#rTeamName") : $("#rName"); if (f) f.focus({ preventScroll: true }); }, 30);
  }

  // emails TuteDude doesn't know: the box turns red with a note under it (cleared as soon as it's edited)
  function clearBad(root) {
    $$(".is-bad, .is-ok", root || regDlg).forEach((i) => { i.classList.remove("is-bad", "is-ok"); i.removeAttribute("aria-invalid"); });
    $$(".live-note", root || regDlg).forEach((n) => n.remove());
  }
  // one email box: "bad" = not on TuteDude (red), "ok" = on TuteDude (green), "wait" = checking, "" = nothing
  function setMark(i, state) {
    const host = i.closest(".mate-row") || i, old = host.nextElementSibling;
    if (old && old.classList.contains("live-note")) old.remove();
    i.classList.toggle("is-bad", state === "bad");
    i.classList.toggle("is-ok", state === "ok");
    if (state === "bad") i.setAttribute("aria-invalid", "true"); else i.removeAttribute("aria-invalid");
    if (!state) return;
    const own = i.id === "rEmail";
    const note = document.createElement("small");
    note.className = "live-note " + (state === "bad" ? "bad-note" : state === "ok" ? "ok-note" : "wait-note");
    note.setAttribute("role", "status");
    note.textContent = state === "wait" ? "Checking with TuteDude…" : state === "ok" ? "✓ On TuteDude"
      : own ? "✗ Not on TuteDude: use the email of your TuteDude account" : "✗ Not on TuteDude: use the email of their TuteDude account";
    host.insertAdjacentElement("afterend", note);
  }
  // live check while the form is filled: as soon as an email is complete, ask whether it's on TuteDude
  const liveSeen = new Map(), liveTimers = new WeakMap();   // email → { r, at }
  async function liveCheck(i) {
    clearTimeout(liveTimers.get(i));
    const em = clean(i.value).toLowerCase();
    if (!emailOk(em) || i.dataset.checked === em || i.dataset.checking === em) return;
    if (i.id === "rEmail" && S.me && (S.me.email || "").toLowerCase() === em) return;   // my own saved email
    const hit = liveSeen.get(em);
    let r = hit && (hit.r || Date.now() - hit.at < 60000) ? hit.r : undefined;   // a "no" is asked again after a minute
    if (r === undefined) {
      setMark(i, "wait");
      i.dataset.checking = em;
      try {
        await whenReady();
        if (!S.user) S.user = await S.be.ensureUser();
        r = await S.be.checkStudent(em);
      } catch (_) { r = null; }
      if (i.dataset.checking === em) i.dataset.checking = "";
      if (typeof r === "boolean") liveSeen.set(em, { r, at: Date.now() });
    }
    if (clean(i.value).toLowerCase() !== em) return;   // edited meanwhile
    i.dataset.checked = typeof r === "boolean" ? em : "";
    setMark(i, r === true ? "ok" : r === false ? "bad" : "");
  }
  function liveWatch(form) {
    const isEmail = (t) => t && t.matches && t.matches("#rEmail, #mEmail, [data-mate=email]");
    form.addEventListener("input", (e) => {
      const i = e.target;
      if (!isEmail(i)) return;
      i.dataset.checked = "";
      setMark(i, "");
      clearTimeout(liveTimers.get(i));
      if (emailOk(clean(i.value).toLowerCase())) liveTimers.set(i, setTimeout(() => liveCheck(i), 1200));   // a pause in typing
    });
    const left = (e) => { if (isEmail(e.target)) liveCheck(e.target); };   // leaving the box
    form.addEventListener("focusout", left);
    form.addEventListener("change", left);
  }
  function markBad(list) {
    clearBad();
    const bad = new Set((list || []).map((e) => String(e).toLowerCase()));
    if (!bad.size) return;
    let firstBad = null;
    [$("#rEmail"), ...$$("#rMates [data-mate=email]")].forEach((i) => {
      if (!bad.has(clean(i.value).toLowerCase())) return;
      setMark(i, "bad");
      if (!firstBad) firstBad = i;
    });
    if (firstBad) firstBad.focus();
  }
  function readForm() {
    const phone = $("#rPhone").value.replace(/[^\d+]/g, "");
    let link = clean($("#rLink").value);
    if (link && !/^https?:\/\//i.test(link) && /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(link)) link = "https://" + link;
    return {
      name: clean($("#rName").value), phone, digits: phone.replace(/\D/g, ""), email: clean($("#rEmail").value).toLowerCase(),
      domain: ($$("input[name=domain]:checked", regDlg)[0] || {}).value || (ASK_SKILL ? undefined : "other"), skill: clean($("#rSkill").value), link,
      teamName: clean($("#rTeamName").value), code: cleanCode($("#rCode").value),
      members: $$("#rMates .mate-row").map((r) => ({ name: clean($("[data-mate=name]", r).value), phone: clean($("[data-mate=phone]", r).value), email: clean($("[data-mate=email]", r).value).toLowerCase() }))
        .filter((m) => MATES_AT_SIGNUP && (m.name || m.email || m.phone))
    };
  }
  function checkStep1(f, only) {
    if (only !== "you" && reg.mode === "join" && f.code.length !== 8) return "Paste the team link or code your leader sent you.";
    if (only !== "you" && reg.mode === "join" && reg.info && reg.info.full && !(Number(reg.info.reserved) > 0)) return `Team is full: ${reg.info.name} isn't taking new members. Ask your leader, or create your own team.`;
    if (reg.mode === "find" && !pickedTeam()) return "Pick a team to join.";
    if (f.name.length < 2) return "Please write your name.";
    if (!phoneTypedOk(f.phone)) return "Please write your 10-digit WhatsApp number (or the full number with + and the country code).";
    if (!emailOk(f.email)) return "Please write a valid email address.";
    if (!f.domain) return "Pick what you do.";
    if (locked() && reg.mode !== "edit" && !(reg.mode === "join" && reg.late)) return "Teams are locked now.";
    if (only === "you") return "";
    if (f.link && (!/^https?:\/\/\S+$/i.test(f.link) || f.link.length > 200)) return "That link doesn't look right. Paste the full link (max 200 characters), or leave it empty.";
    if (reg.mode === "create" && (f.teamName.length < 2 || f.teamName.length > 40)) return "Give your team a name (2 to 40 letters).";
    if (reg.mode === "create" && !teamNameOk(f.teamName)) return "Please pick a different team name (letters, numbers and simple punctuation only).";
    if (reg.mode === "create") {
      for (const m of f.members) {
        if (!m.name || !m.email || !m.phone) return "For each teammate, add the name, WhatsApp number and email (or leave the row empty).";
        if (m.name.length < 2) return "Write each teammate's full name.";
        if (!phoneTypedOk(m.phone)) return `Check the WhatsApp number for ${m.name} (10 digits).`;
        if (normPhone(m.phone) === normPhone(f.phone)) return "Add your teammates' WhatsApp numbers, not your own.";
        if (f.members.filter((x) => normPhone(x.phone) === normPhone(m.phone)).length > 1) return "The same WhatsApp number is added twice.";
        if (!emailOk(m.email)) return `Check the email address for ${m.name}.`;
        if (m.email === f.email) return "Add your teammates' emails, not your own.";
        if (f.members.filter((x) => x.email === m.email).length > 1) return `${m.email} is added twice.`;
      }
    }
    if (!S.me && !$("#rConsent").checked) return "Please confirm you're a TuteDude student.";
    return "";
  }
  // no team name given: "<First name>'s Team", then with a number if that one is taken
  function autoTeamName(name, t) {
    const fn = (first(name) || "").replace(/[^A-Za-z\u0900-\u097F]/g, "");
    let base = fn.length >= 2 ? fn.charAt(0).toUpperCase() + fn.slice(1) + "'s Team" : "";
    if (!base || !teamNameOk(base)) base = reg.autoFun || (reg.autoFun = FUN_NAMES[Math.floor(Math.random() * FUN_NAMES.length)]);
    return (base + (!t ? "" : t < 3 ? " " + (t + 1) : " " + (10 + Math.floor(Math.random() * 89)))).slice(0, 40);
  }
  async function submitProfile(e) {
    e.preventDefault();
    showErr("#regErr", "");
    const f = readForm();
    if (Date.now() - (reg.stepAt || 0) < 700) return;   // double click on "Continue"
    const autoName = reg.mode === "create" && !f.teamName;   // the team name is optional
    if (autoName) f.teamName = autoTeamName(f.name, reg.autoTry || 0);
    const taken = (m) => autoName && /team name is taken/i.test(m || "");
    // save (or dry-run); if our own made-up name is taken, try the next one
    const save = async (extra) => {
      for (let i = 0; ; i++) {
        try {
          const r = await S.be.saveProfile(Object.assign(payload(), extra || {}));
          if (r && r.ok === false && taken(r.error) && i < 8) { reg.autoTry = (reg.autoTry || 0) + 1; f.teamName = autoTeamName(f.name, reg.autoTry); continue; }
          return r;
        } catch (err) {
          if (taken(err && err.message) && i < 8) { reg.autoTry = (reg.autoTry || 0) + 1; f.teamName = autoTeamName(f.name, reg.autoTry); continue; }
          throw err;
        }
      }
    };
    const payload = () => ({ name: f.name, domain: f.domain, phone: f.phone, email: f.email, skill: f.skill, link: f.link,
      teamName: reg.mode === "create" ? f.teamName : "", code: reg.mode === "join" ? f.code : "", teamId: reg.mode === "find" ? (pickedTeam() || {}).id : null,
      open: reg.mode === "create" && $("#rOpen").checked, members: reg.mode === "create" ? f.members : [], consent: true, sessionOk: reg.step === 2 });
    if (reg.step === 1 && twoParts() && reg.part !== "team") {   // first screen → the team screen
      const err = checkStep1(f, "you");
      if (err) return showErr("#regErr", err);
      return showPart("team");
    }
    if (reg.step === 1) {
      const err = checkStep1(f);
      if (err) { if (twoParts() && checkStep1(f, "you")) showPart("you"); return showErr("#regErr", err); }
      if (MATES_AT_SIGNUP && reg.mode === "create" && !f.members.length && !reg.soloOk) {   // alone: say it once, then let them go on
        reg.soloOk = true;
        const m1 = $("#rMates .mate-row [data-mate=name]");
        $("#rMates").classList.add("nudge");
        if (m1) m1.focus({ preventScroll: true });
        return showErr("#regErr", `A team needs at least ${MIN} people. Add a teammate, or press Continue again to add them later.`);
      }
      if (needsVideo()) {
        // check everything with the server first (team name taken, wrong code, number already used…) so
        // nobody watches the whole video only to hear about a typo
        const btn1 = $("#regSubmit");
        btn1.disabled = true;
        try {
          await whenReady();
          if (!S.user) S.user = await S.be.ensureUser();
          const chk = await save({ dryRun: true });
          if (chk && chk.ok === false) {
            btn1.disabled = false;
            if (twoParts() && (chk.badEmails || []).includes(f.email)) showPart("you");   // my own email is the problem: show that screen
            markBad(chk.badEmails);
            return showErr("#regErr", chk.error || "Please check your details.");
          }
        } catch (err2) {
          btn1.disabled = false;
          const msg = (err2 && err2.message) || "Couldn't check the details. Try again.";
          if (reg.mode === "join" && /full|doesn't work/i.test(msg)) lookupCode();
          if (reg.mode === "find" && /filled up|isn't taking/i.test(msg)) loadOpenTeams();
          return showErr("#regErr", msg);
        }
        btn1.disabled = false;
        showStep(2);
        return;
      }
    } else {
      if (!videoWatched()) return showErr("#regErr", "Watch the video till the end first.");
      if (!$("#rSession").checked) return showErr("#regErr", "Tick the box to agree to TuteDude Sessions.");
    }
    const btn = $("#regSubmit");
    btn.disabled = true;
    const hadTeam = !!S.team, mode = reg.mode, step = reg.step;
    try {
      await whenReady();
      if (!S.user) S.user = await S.be.ensureUser(); // demo + "anonymous" login; Google users are signed in already
      const res = await save() || {};
      pushHold = Date.now() + 5200;   // let the confetti and the "is official" message show before the notifications pop-up
      closeDlg(regDlg);
      ss.del(JOIN_KEY);
      $("#rTeamName").value = ""; $("#rCode").value = ""; $("#rOpen").checked = false; $("#rTeams").innerHTML = "";
      $$("#rMates input").forEach((i) => { i.value = ""; });
      await refresh();
      if (mode === "edit" || hadTeam) toast("Profile saved.");
      else {
        confetti();
        pushHold = Date.now() + 5200;
        setTimeout(pushGate, 5300);   // after the confetti and the "is official" message
        toast(res.created ? (f.members.length ? `${res.team} is official! ${f.members.length + 1} of you are in. Snacks are on the leader.` : `${res.team} is official! Now share your team link with your teammates.`)
          : `You're in ${res.team}! Say hi to your team on WhatsApp.`);
        $("#board").scrollIntoView({ behavior: "smooth" });
      }
    } catch (err) {
      console.warn(err);
      const msg = (err && err.message) || "Couldn't save. Check your connection and try again.";
      // a problem with the team or the details: back to step 1 so they can fix it
      if (step === 2 && !/video|agree|connection|busy|internet|sign-in|try again in a minute/i.test(msg)) showStep(1);
      if (mode === "find" && /filled up|isn't taking/i.test(msg)) loadOpenTeams();
      if (mode === "join" && /full|doesn't work/i.test(msg)) lookupCode();
      showErr("#regErr", msg);
    }
    btn.disabled = false;
  }

  /* ---------- the TuteDude Sessions video ----------
     While registering it must be watched in full: no skipping ahead, and the consent box unlocks only
     when it has played to the end. (If the video can't play and the Drive backup shows, the consent
     unlocks after a minute.) */
  let watchedNow = false;   // kept in memory only: each registration on this phone watches it again
  const VIDEO_REQUIRED = !!(C.session && C.session.videoRequired);
  const videoWatched = () => !VIDEO_REQUIRED || watchedNow || !!(S.me && S.me.sessionOk);
  const mmss = (x) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, "0")}`;
  function watchNote(t, dur) {
    const el = $("#watchNote");
    if (!el) return;
    el.textContent = !VIDEO_REQUIRED ? "The video is optional. Tick the box to agree." : videoWatched() ? "✓ Video watched. Tick the box to agree."
      : dur ? `▶ Watch the full video to continue (${mmss(t || 0)} of ${mmss(dur)})` : "▶ Watch the full video to continue";
  }
  function syncConsent() {
    const ok = videoWatched();
    $("#rSession").disabled = !ok;
    if (reg.step === 2) $("#regSubmit").disabled = !ok;   // looks inactive until the video is done
    $("#regConsentWrap").classList.toggle("locked", !ok);
    watchNote();
  }
  function markWatched() {
    if (watchedNow) return;
    watchedNow = true;
    syncConsent();
  }
  function mountVideo(frame, forced) {
    const V = C.session || {};
    let v = $("video", frame);
    if (!frame.dataset.ready) {
      frame.dataset.ready = "1";
      const driveId = ((V.videoBackup || "").match(/\/d\/([^/]+)/) || [])[1];
      const backup = () => {
        frame.innerHTML = driveId
          ? `<iframe src="https://drive.google.com/file/d/${esc(driveId)}/preview" allow="autoplay; fullscreen" allowfullscreen title="How TuteDude sessions work"></iframe>`
          : `<a class="video-link" href="${esc(safeUrl(V.videoBackup))}" target="_blank" rel="noopener"><span>▶ Watch the video</span></a>`;
        if (forced) setTimeout(markWatched, 60000); // can't follow progress inside the backup player
      };
      if (V.video) {
        v = document.createElement("video");
        v.controls = true; v.playsInline = true; v.preload = "auto"; v.src = V.video;
        v.setAttribute("controlsList", "nodownload noplaybackrate");
        v.disablePictureInPicture = true;
        if (forced) {
          let maxT = 0; // furthest point watched without skipping
          v.addEventListener("timeupdate", () => {
            if (!v.seeking && v.currentTime > maxT && v.currentTime - maxT < 8) maxT = v.currentTime;
            if (v.duration && maxT >= v.duration - 1) markWatched();
            else watchNote(maxT, v.duration);
          });
          v.addEventListener("seeking", () => { if (!videoWatched() && v.currentTime > maxT + 1) v.currentTime = maxT; }); // no skipping ahead
          v.addEventListener("ended", () => { if (maxT >= (v.duration || 0) - 2) markWatched(); });
        }
        v.addEventListener("error", backup);
        frame.appendChild(v);
      } else backup();
    }
    // start playing right away (with sound if the browser allows, else muted: the video has captions)
    if (v && forced && !videoWatched() && v.paused) v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
    return v;
  }
  // "How to create a room": the video again + the steps
  function openSession() {
    const V = C.session || {}, team = S.team ? S.team.name : "your team";
    $("#sessionTitle").textContent = "Meet your team on TuteDude Sessions";
    $("#sessionText").innerHTML = `Create a room for <b>${esc(team)}</b> (or join the one a teammate made) and do your product discussion there.` +
      (revealed() ? " The problem statement is on your team page." : ` The problem statement drops on <b>${esc(revealText())}</b>.`);
    $("#sessionActions").innerHTML = stepsHtml(team) + `<a class="btn btn-full" href="${esc(safeUrl(V.link || C.speakUp))}" target="_blank" rel="noopener">Open TuteDude →</a>`;
    mountVideo($("#sessionVideo"), false);
    $$("dialog[open]").forEach((d) => { if (d !== sessionDlg) closeDlg(d); });
    openDlg(sessionDlg);
  }

  /* ---------- get back to your team on a new phone / home-screen app / cleared browser ---------- */
  function openReclaim() {
    closeDlg(regDlg);
    showErr("#reclaimErr", "");
    $("#cPhone").value = $("#rPhone").value || "";
    $("#cEmail").value = $("#rEmail").value || "";
    openDlg(reclaimDlg);
    setTimeout(() => $("#cPhone").focus(), 50);
  }
  async function submitReclaim(e) {
    e.preventDefault();
    showErr("#reclaimErr", "");
    const phone = $("#cPhone").value, email = clean($("#cEmail").value).toLowerCase();
    if (!phoneOk(normPhone(phone))) return showErr("#reclaimErr", "Please write your WhatsApp number (10 digits).");
    if (!emailOk(email)) return showErr("#reclaimErr", "Please write a valid email address.");
    const btn = $("#reclaimSubmit");
    btn.disabled = true;
    try {
      await whenReady();
      if (!S.user) S.user = await S.be.ensureUser();
      const res = await S.be.reclaim(phone, email) || {};
      closeDlg(reclaimDlg);
      await refresh();
      toast(res.team ? `Welcome back! You're in ${res.team}.` : "Welcome back!");
      $("#board").scrollIntoView({ behavior: "smooth" });
    } catch (err) {
      showErr("#reclaimErr", (err && err.message) || "Couldn't find your registration. Try again.");
    }
    btn.disabled = false;
  }

  /* ---------- rename team ---------- */
  function openRename() {
    if (!amLeader()) return;
    $("#nName").value = S.team.name;
    showErr("#nameErr", "");
    openDlg(nameDlg);
    setTimeout(() => $("#nName").focus(), 50);
  }
  async function submitRename(e) {
    e.preventDefault();
    const name = clean($("#nName").value);
    if (name.length < 2) return showErr("#nameErr", "Give your team a name (2 to 40 letters).");
    const btn = $("button[type=submit]", nameDlg);
    btn.disabled = true;
    try {
      await whenReady();
      await S.be.rename(name);
      closeDlg(nameDlg);
      toast(`Your team is now ${name}.`);
      await refresh();
    } catch (err) {
      showErr("#nameErr", (err && err.message) || "Couldn't rename. Try again.");
    }
    btn.disabled = false;
  }

  /* ---------- the leader submits the project (once) ---------- */
  function openSubmit() {
    if (!amLeader() || !S.team || S.team.submission) return;
    if (submitEarly()) { toast("Submissions open on " + submitDayText() + ".", true); return; }
    if (!submitOpen()) { toast("Submissions are closed.", true); return; }
    $("#subKicker").textContent = "Submit by " + submitByText();
    $("#subUntil").textContent = submitByText();
    $("#sSure").checked = false;
    showErr("#subErr", "");
    openDlg(subDlg);
    setTimeout(() => $("#sTitle").focus(), 50);
  }
  async function submitProjectForm(e) {
    e.preventDefault();
    const fix = (v) => { v = clean(v); return v && !/^https?:\/\//i.test(v) && /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v) ? "https://" + v : v; };
    const p = { title: clean($("#sTitle").value), summary: clean($("#sSummary").value), product: fix($("#sProduct").value), site: fix($("#sSite").value), video: fix($("#sVideo").value) };
    if (p.title.length < 2) return showErr("#subErr", "Give your project a name.");
    if (p.summary.length < 20) return showErr("#subErr", "Describe your project in 2 to 3 lines.");
    if (!urlOk(p.product)) return showErr("#subErr", "Paste the full link to your project (it starts with https://).");
    if (p.site && !urlOk(p.site)) return showErr("#subErr", "The website link doesn't look right. Paste the full link, or leave it empty.");
    if (p.video && !urlOk(p.video)) return showErr("#subErr", "The video link doesn't look right. Paste the full link, or leave it empty.");
    if (!$("#sSure").checked) return showErr("#subErr", "Tick the box: a submission can't be changed.");
    // one last check: a submission is final, and there is time until the deadline
    const missing = [!p.site && "website link", !p.video && "promo video link"].filter(Boolean);
    if (!confirm(`Are you sure you've finished building your app or website?\n\nYou can submit only once, and it can't be changed afterwards. You still have time until ${submitByText()}.`
      + (missing.length ? `\n\nYou haven't added the ${missing.join(" or the ")}, and you can't add it later.` : "") + "\n\nSubmit now?")) return;
    const btn = $("#subSubmit");
    btn.disabled = true;
    try {
      await whenReady();
      await S.be.submitProject(p);
      closeDlg(subDlg);
      toast("Project submitted. All the best!");
      await refresh();
    } catch (err) {
      showErr("#subErr", (err && err.message) || "Couldn't submit. Try again.");
    }
    btn.disabled = false;
  }

  /* ---------- the leader adds a teammate by name + email ---------- */
  function openMate() {
    if (!amLeader()) return;
    $("#mName").value = ""; $("#mPhone").value = ""; $("#mEmail").value = ""; $("#mEmail").dataset.checked = "";
    clearBad(mateDlg);
    showErr("#mateErr", "");
    openDlg(mateDlg);
    setTimeout(() => $("#mName").focus(), 50);
  }
  async function submitMate(e) {
    e.preventDefault();
    const name = clean($("#mName").value), email = clean($("#mEmail").value).toLowerCase(), phone = clean($("#mPhone").value);
    if (name.length < 2) return showErr("#mateErr", "Write your teammate's name.");
    if (!phoneTypedOk(phone)) return showErr("#mateErr", "Write your teammate's WhatsApp number (10 digits).");
    if (!emailOk(email)) return showErr("#mateErr", "Please write a valid email address.");
    const btn = $("button[type=submit]", mateDlg);
    btn.disabled = true;
    try {
      await whenReady();
      await S.be.addTeammate(name, email, phone);
      closeDlg(mateDlg);
      toast(`${name} is in your team.`);
      await refresh();
    } catch (err) {
      const msg = (err && err.message) || "Couldn't add them. Try again.";
      if (/isn't on TuteDude/.test(msg)) { setMark($("#mEmail"), "bad"); $("#mEmail").focus(); }
      showErr("#mateErr", msg);
    }
    btn.disabled = false;
  }

  /* ---------- profile (yourself and your teammates only) ---------- */
  function findPerson(id) {
    if (S.me && S.me.id === id) return Object.assign({}, S.me, { status: S.team ? `In ${S.team.name}` : "", self: true });
    if (S.team) { const m = S.team.members.find((x) => x.id === id); if (m) return Object.assign({}, m, { status: "In your team" }); }
    return null;
  }
  function openProfile(id) {
    const p = findPerson(id);
    if (!p) return;
    $("#profBody").innerHTML = `<div class="prof">
      ${avHtml(p, "av-xl")}
      <h2 class="h3" id="profName">${esc(p.name)}</h2>
      <p>${dchip(p.domain)}</p>
      ${p.status ? `<p class="prof-status">${esc(p.status)}</p>` : ""}
      ${p.skill ? `<p class="prof-skill">“${esc(p.skill)}”</p>` : ""}
      <div class="row-btns">
        ${!p.self && p.phone ? waButton(p) : ""}
        ${p.link ? `<a class="btn btn-sm btn-ghost" href="${esc(safeUrl(p.link))}" target="_blank" rel="noopener nofollow">View their work ↗</a>` : ""}
      </div>
      ${p.self && !locked() ? `<button class="link" type="button" data-act="edit-profile">Edit my profile</button>` : ""}
    </div>`;
    openDlg(profDlg);
  }

  /* ---------- toast ---------- */
  let toastTimer = 0;
  function toast(msg, bad) {
    const el = $("#toast");
    const host = $("dialog[open]") || document.body;   // dialogs sit in the top layer: put the toast inside the open one
    if (el.parentNode !== host) host.appendChild(el);
    el.textContent = msg;
    el.classList.toggle("bad", !!bad);
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add("show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.classList.remove("show"); setTimeout(() => { el.hidden = true; }, 250); }, 4500);
  }
  function copyText(text, okMsg) {
    const done = () => toast(okMsg);
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => prompt("Copy this:", text));
    else prompt("Copy this:", text);
  }

  /* ============================================================
     ACTIONS + EVENTS
     ============================================================ */
  async function act(btn, fn, okMsg) {
    if (btn) btn.disabled = true;
    try {
      await whenReady();
      const r = await fn();
      const msg = typeof okMsg === "function" ? okMsg(r) : okMsg;
      if (msg) toast(msg);
    } catch (e) {
      console.warn(e);
      toast((e && e.message) || "Something went wrong. Try again.", true);
    }
    if (btn && btn.isConnected) btn.disabled = false;
    await refresh();
  }
  function scrollTo(sel, focusSel) {
    $$("dialog[open]").forEach((d) => closeDlg(d));
    const el = $(sel) || $("#board");
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    if (focusSel) setTimeout(() => { const f = $(focusSel); if (f) f.focus({ preventScroll: true }); }, 600);
  }

  function bindUI() {
    if ("IntersectionObserver" in window) {
      // ignore the strip hidden under the sticky header: something only counts as "on screen" below it
      const below = `-${Math.round(($(".header") || { offsetHeight: 100 }).offsetHeight)}px 0px 0px 0px`;
      new IntersectionObserver((en) => { en.forEach((e) => { seen.hero = e.isIntersecting; }); updateSticky(); }, { threshold: 0, rootMargin: below })
        .observe($(".hero"));
      new IntersectionObserver((en) => { en.forEach((e) => { seen.panel = e.isIntersecting && (e.intersectionRatio >= 0.2 || e.intersectionRect.height > innerHeight * 0.3); }); updateSticky(); },
        { threshold: [0, 0.05, 0.1, 0.2, 0.3], rootMargin: below })
        .observe($("#mePanel"));
    }
    $("#rDomains").innerHTML = DOMAINS.map((d) => `<label class="chip"><input type="radio" name="domain" value="${d.key}"> ${ic(d.ic || "sparkles")} ${esc(d.short || d.label)}</label>`).join("");
    $("#rDomains").closest(".field").hidden = !ASK_SKILL;
    $("#rMates").hidden = !MATES_AT_SIGNUP; $("#rLinkHow").hidden = MATES_AT_SIGNUP;
    $("#rConsentText").textContent = AGREE_TEXT;
    if (VIDEO_REQUIRED) $("#step2Hint").textContent = "Watch this 1-minute video till the end, then tick the box.";
    $("#rSteps").innerHTML = stepsHtml("your team name");
    $("#rTeamBox").addEventListener("change", (e) => {
      if (e.target.name === "tmode") setTeamMode(e.target.value);
      if (e.target.name === "team") updateRegText();
    });
    $("#rDomains").addEventListener("change", () => { if (reg.mode === "find") loadOpenTeams(); });
    const lookupSoon = debounce(lookupCode, 350);
    $("#rCode").addEventListener("input", lookupSoon);
    $("#rCode").addEventListener("blur", () => { const c = cleanCode($("#rCode").value); if (c.length === 8) $("#rCode").value = showCode(c); });
    $("#regForm").addEventListener("submit", submitProfile);
    $("#nameForm").addEventListener("submit", submitRename);
    $("#mateForm").addEventListener("submit", submitMate);
    $("#subForm").addEventListener("submit", submitProjectForm);
    $("#subForm").addEventListener("input", () => showErr("#subErr", ""));
    $("#mateForm").addEventListener("input", () => showErr("#mateErr", ""));
    liveWatch($("#mateForm"));
    liveWatch($("#regForm"));
    $("#reclaimForm").addEventListener("submit", submitReclaim);
    $("#switchForm").addEventListener("submit", submitSwitch);
    $("#swCode").addEventListener("input", () => { showErr("#switchErr", ""); if (sw.info) resetSwitch(); });
    $("#reclaimForm").addEventListener("input", () => showErr("#reclaimErr", ""));
    $("#regForm").addEventListener("input", () => showErr("#regErr", ""));
    $("#nameForm").addEventListener("input", () => showErr("#nameErr", ""));
    $("#googleBtn").addEventListener("click", async () => {
      showErr("#googleErr", "");
      ss.set(REG_FLAG, "1");
      try { await whenReady(); await S.be.signIn(); } // leaves the page; we come back signed in
      catch (e) { console.warn(e); ss.del(REG_FLAG); showErr("#googleErr", "Google sign-in didn't start. Try again."); }
    });
    // a team link opened while the page is already open
    window.addEventListener("hashchange", () => {
      const c = readJoin();
      if (!c) return;
      if (started) openJoin(c); else pendingJoin = c;
    });

    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      const a = b.dataset.act, person = b.dataset.person, be = S.be;
      if (b.closest("#profDlg") && a !== "profile") closeDlg(profDlg);
      switch (a) {
        case "switch-team": return openSwitch("");
        case "register": return openRegister();
        case "name-gen": return funName();
        case "register-create": return openRegister("create");
        case "register-join": return openRegister("join");
        case "register-find": return openRegister("find");
        case "add-mate": return openMate();
        case "submit-open": return openSubmit();
        case "remove-mate":
          if (confirm(`Remove ${b.dataset.name} from your team?`)) act(b, () => be.removeTeammate(b.dataset.id), `${b.dataset.name} was removed from your team.`);
          return;
        case "toggle-open": {
          const on = b.checked;
          if (on && !confirm(`Let students without a team join? They'll see your team's name, size, skills and your first name in a list, and can join until you have ${MAX} people.`)) { b.checked = false; return; }
          return act(b, () => S.be.setOpen(on), on ? "Your team is open: students without a team can join it." : "Your team is closed to new members. Your team link still works.");
        }
        case "toggle-closed": {
          const on = b.checked;
          if (on && !confirm("Close your team? The team link will say “Team is full” and nobody new can join. You can open it again any time before teams lock.")) { b.checked = false; return; }
          return act(b, () => S.be.setClosed(on), on ? "Team closed. Your team link now says “Team is full”." : "Team open again. New members can join with your team link.");
        }
        case "set-cap": {
          const k = Number(b.dataset.cap);
          if (!S.team || k === capOf(S.team)) return;
          return act(b, () => S.be.setCap(k), `Team size: ${k}. At ${k} people your team link says “Team is full”.`);
        }
        case "edit-profile": return openRegister("edit");
        case "reg-back": return reg.step === 2 ? showStep(1) : showPart("you");
        case "reclaim-open": return openReclaim();
        case "profile": return openProfile(person);
        case "rename": return openRename();
        case "sign-out": return act(b, () => be.signOut());
        case "reset-demo": return be && be.reset && be.reset();
        case "session": return openSession();
        case "find-video": return openFindVideo();
        case "find-register": closeDlg(findDlg); return openRegister("create");
        case "goto-board": return scrollTo("#mePanel", "#mePanel [data-act=register-create]");
        case "goto-invite": return scrollTo("#invite", "#invite [data-act=copy-link]");
        case "copy-link": return S.team && copyText(teamLink(S.team.code), "Team link copied. Send it to your teammates on WhatsApp.");
        case "copy-numbers": {
          const lines = S.team.members.filter((m) => m.id !== S.me.id && m.phone).concat((S.team.listed || []).filter((l) => l.phone))
            .map((m) => `${m.name}: ${fullNumber(m.phone)}`).join("\n");
          if (lines) copyText(lines, "Numbers copied. Create a WhatsApp group and add them.");
          return;
        }
        case "push-on": return act(b, enablePush, "Notifications are on");
        case "push-gate-on": return pushGateOn(b);
        case "push-skip": ss.set(PUSH_SKIP, "1"); if (pushDlg) pushDlg.close(); return;
        case "push-later": ss.set("tdb-notify-later", "1"); render(); return;
        case "reset-code":
          if (confirm("Make a new team link? The old link and code stop working. People already in your team stay.")) act(b, () => be.resetCode(), "New team link ready. Send it to the teammates who haven't joined yet.");
          return;
        case "leave": {
          const t = S.team;
          if (!t) return;
          const n = t.members.length, next = t.members.find((m) => m.id !== S.me.id);
          const q = n === 1 ? `Leave ${t.name}? You're the only one registered in it, so the team${(t.listed || []).length ? " (and the teammates you added)" : ""} will be deleted.`
            : amLeader() ? `Leave ${t.name}? ${next.name} becomes the leader.` : `Leave ${t.name}?`;
          if (confirm(q + (locked() ? " You stay registered and can join another team that's still open, with its team link." : " You stay registered and can create or join another team before teams lock."))) act(b, () => be.leave(), `You left ${t.name}.`);
          return;
        }
        case "remove": {
          const m = S.team && S.team.members.find((x) => x.id === person);
          if (!m) return;
          const t = S.team, n = t.members.length + (t.listed || []).length, canAdd = !locked() || !!t.lateOpen;
          const msg = `Remove ${m.name} from your team? They stay registered and can join another team${locked() ? " with room, with its team link" : ""}.`
            + (canAdd ? " Then you can add someone new." : " Teams are locked, so you can't add someone new in their place.")
            + (n - 1 < MIN ? ` Your team will have only ${n - 1} ${n - 1 === 1 ? "person" : "people"}, and teams need at least ${MIN} to take part.` : "");
          if (confirm(msg)) act(b, () => be.remove(person), `${first(m.name)} was removed.${canAdd ? " If they still have your team link, make a new one." : ""}`);
          return;
        }
      }
    });
  }

  /* ============================================================
     START
     ============================================================ */
  async function init() {
    bindUI();
    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register("sw.js").then((r) => { swReg = r; }).catch((e) => console.warn("sw", e));
      navigator.serviceWorker.addEventListener("message", (e) => {
        const d = e.data || {};
        if (d.type === "push") refresh();
        if (d.type === "open") $("#board").scrollIntoView({ behavior: "smooth" });
      });
    }
    try {
      S.be = LIVE ? await supabaseBackend(C.supabase, LOGIN) : demoBackend();
    } catch (e) {
      // never fall back to the demo on the live site: people would "register" into a fake board
      console.error(e);
      S.loadErr = true;
      tickerFallback = true;
      render();
      toast("Couldn't connect. Check your internet and refresh the page.", true);
      return;
    }
    readyResolve();
    if (S.be.mode === "demo") {
      $("#demoBar").hidden = false;
      S.be.onChange(debounce(() => refresh(), 60));
    } else {
      // Live updates come over Broadcast. This timer is the backup (e.g. when the free plan's
      // live-connection limit is reached): it checks more often only while live updates are down.
      const visible = () => document.visibilityState === "visible";
      let tick = 0;
      setInterval(() => {
        if (!visible()) return;
        tick++;
        const live = S.me && S.be.liveOk("user:" + S.me.id);
        if (!live || tick % 4 === 0) refresh({ board: tick % 8 === 0 }); // me: 15 s without live, 60 s with; numbers: every 2 min
      }, 15000);
      document.addEventListener("visibilitychange", () => { if (visible()) refresh(); });
    }
    // show the public numbers straight away; my own team loads as soon as sign-in is known
    refresh();
    setTimeout(() => { tickerFallback = true; renderTicker(); }, 2500); // slow network: show the ticker without numbers
    S.be.onAuth(onUser);
    // redraw when the teams lock, and fetch the problem statement when it drops
    [[DEADLINE, render], [REVEAL, () => refresh()]].forEach(([at, fn]) => {
      if (!isNaN(at) && at > Date.now() && at - Date.now() < 2147483000) setTimeout(fn, at - Date.now() + 1000);
    });
  }
  init();
})();
