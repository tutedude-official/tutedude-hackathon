/* TuteDude Buildathon: page bits (countdowns, dates, menu, FAQ). The Team Board lives in board.js. */
(function () {
  "use strict";
  const C = window.BUILDATHON || {};
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  /* ---------- safety ---------- */
  // Don't work inside someone else's frame (clickjacking). TuteDude's own sites may embed the page.
  if (window.top !== window.self) {
    let ok = false;
    const okOrigin = (o) => /^https:\/\/([a-z0-9-]+\.)*tutedude\.com$/.test(o);
    try {
      const a = location.ancestorOrigins;
      if (a && a.length) ok = Array.from(a).every(okOrigin);
      else if (!a && document.referrer) ok = window.parent === window.top && okOrigin(new URL(document.referrer).origin);  // Firefox
    } catch (_) {}
    if (!ok) { document.documentElement.style.display = "none"; return; }
  }
  // web fonts load in the background (no inline handler, so the page's security policy can block inline scripts)
  $$("link[data-fonts]").forEach((l) => { l.media = "all"; });
  const pad = (n) => String(n).padStart(2, "0");

  /* ---------- text from config ---------- */
  if (C.prize) $$("[data-prize]").forEach((el) => { el.textContent = C.prize; });
  if (Array.isArray(C.prizes)) $$("[data-prize-n]").forEach((el) => { const v = C.prizes[+el.dataset.prizeN]; if (v) el.textContent = v; });
  if (Array.isArray(C.prizes)) {
    // "₹10,000": the three prizes added up
    const total = C.prizes.reduce((n, p) => n + (parseInt(String(p).replace(/[^0-9]/g, ""), 10) || 0), 0);
    if (total) $$("[data-prize-total]").forEach((el) => { el.textContent = "₹" + total.toLocaleString("en-IN"); });
  }
  if (C.speakUp) $$("[data-speakup]").forEach((el) => { el.href = C.speakUp; });
  $$("[data-group]").forEach((el) => { if (/^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+$/.test(C.findTeamGroup || "")) el.href = C.findTeamGroup; else el.hidden = true; });
  const TB = C.teamBuilding || {};
  const tbLink = TB.link || (C.session && C.session.link) || C.speakUp;
  if (tbLink) $$("[data-tb-link]").forEach((el) => { el.href = tbLink; });
  if (TB.when) $$("[data-tb-when]").forEach((el) => { el.textContent = TB.when.charAt(0).toLowerCase() + TB.when.slice(1); });
  const reveal = Date.parse(C.buildDay);
  if (!isNaN(reveal)) {
    const d = new Date(reveal);
    const day = d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
    const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: d.getMinutes() ? "2-digit" : undefined, timeZone: "Asia/Kolkata" }).replace(/\s?(am|pm)$/i, (m) => " " + m.trim().toUpperCase());
    $$("[data-build-day]").forEach((el) => { el.textContent = `${day}, ${time}`; });
  }
  const submitBy = Date.parse(C.submitBy);
  if (!isNaN(submitBy)) {
    const d = new Date(submitBy);
    const day = d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
    const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: d.getMinutes() ? "2-digit" : undefined, timeZone: "Asia/Kolkata" }).replace(/\s?(am|pm)$/i, (m) => " " + m.trim().toUpperCase());
    $$("[data-submit-day]").forEach((el) => { el.textContent = el.hasAttribute("data-short") ? day : `${day}, ${time}`; });
  }

  /* ---------- countdowns: teams lock → problem statement → live ---------- */
  const lock = Date.parse(C.teamDeadline);
  const units = { d: $('[data-u="d"]'), h: $('[data-u="h"]'), m: $('[data-u="m"]'), s: $('[data-u="s"]') };
  const fmt = (ms) => {
    const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60, s = Math.floor(ms / 1e3) % 60;
    return (d ? d + "d " : "") + `${pad(h)}:${pad(m)}:${pad(s)}`;
  };
  // calendar-style flip: the new number drops in from the top, the old one falls away below
  const motionOk = !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  function setUnit(el, val) {
    if (el.dataset.v === val) return;
    const first = el.dataset.v == null;
    el.dataset.v = val;
    if (first || !motionOk || document.hidden) { el.innerHTML = `<i class="fl">${val}</i>`; return; }
    el.querySelectorAll(".fl.out").forEach((x) => x.remove());
    const old = el.querySelector(".fl");
    if (old) { old.classList.add("out"); setTimeout(() => old.remove(), 600); }
    const nu = document.createElement("i");
    nu.className = "fl in";
    nu.textContent = val;
    el.appendChild(nu);
  }
  function tick() {
    const now = Date.now();
    const sc = $("#sCountdown"), sl = $("#sLabel");
    let target, label;
    if (now < lock) { target = lock; label = "Teams lock in"; }
    else if (!isNaN(reveal) && now < reveal) { target = reveal; label = "Problem statement in"; }
    else {
      // build week → submission day → over
      const from = Date.parse(C.submitFrom), by = Date.parse(C.submitBy), ur2 = $(".u-reveal");
      const live = !isNaN(from) && now < from ? ["Build week is on! Submissions open in", from] : !isNaN(by) && now <= by ? ["Submissions are open! Last day to submit in", by]
        : [isNaN(by) ? "The Buildathon is live!" : "Submissions are closed. Winners coming soon.", NaN];
      if (ur2) ur2.hidden = true;
      $("#cdLabel").textContent = "The Buildathon is live!";
      $("#uLabel").textContent = live[0];
      $("#uCountdown").textContent = isNaN(live[1]) ? "" : fmt(Math.max(0, live[1] - now));
      if (sc) { sc.textContent = isNaN(live[1]) ? "" : fmt(Math.max(0, live[1] - now)); sl.textContent = isNaN(live[1]) ? live[0] : now < from ? "Submissions open in" : "Submissions close in"; }
      $("#countdown").hidden = true;
      if ($("#hurry")) $("#hurry").hidden = true;
      document.body.classList.remove("urgent", "very-urgent");
      return;
    }
    const diff = Math.max(0, target - now);
    const d = Math.floor(diff / 864e5), h = Math.floor(diff / 36e5) % 24, m = Math.floor(diff / 6e4) % 60, s = Math.floor(diff / 1e3) % 60;
    $("#cdLabel").textContent = label;
    // "hurry up": calm at first, louder in the last 2 days, loudest in the last hours
    const open = target === lock;
    let strip = label, left = "";
    if (open) {
      const hrs = Math.floor(diff / 36e5), mins = Math.max(1, Math.floor(diff / 6e4));
      left = d >= 1 ? (d === 1 ? "1 day" : d + " days") : hrs >= 1 ? (hrs === 1 ? "1 hour" : hrs + " hours") : (mins === 1 ? "1 minute" : mins + " minutes");
      strip = diff < 6 * 36e5 ? "Last few hours! Register now, closes in"
        : diff < 864e5 ? "Last day! Register now, closes in"
        : diff < 2 * 864e5 ? "Last 2 days! Register now, closes in"
        : "Hurry up! Registration closes in";
    }
    $("#uLabel").textContent = strip;
    const hu = $("#hurry");
    if (hu) {
      hu.hidden = !open;
      if (open) { const t = "Hurry up, only " + left + " left to register"; if ($("#hurryText").textContent !== t) $("#hurryText").textContent = t; }
    }
    const ur = $(".u-reveal");
    if (ur) ur.hidden = target !== lock;   // once teams lock, the strip already counts down to the problem statement
    if (units.d) { setUnit(units.d, pad(d)); setUnit(units.h, pad(h)); setUnit(units.m, pad(m)); setUnit(units.s, pad(s)); }
    const short = fmt(diff);
    $("#uCountdown").textContent = short;
    if (sc) { sc.textContent = short; sl.textContent = label; }
    // the last 2 days before teams lock turn orange, the last 6 hours red
    document.body.classList.toggle("urgent", target === lock && diff < 2 * 864e5);
    document.body.classList.toggle("very-urgent", target === lock && diff < 6 * 36e5);
  }
  if (!isNaN(lock)) { tick(); setInterval(tick, 1000); }

  /* ---------- mobile menu ---------- */
  const toggle = $("#navToggle"), nav = $("#nav");
  if (toggle && nav) {
    const set = (open) => {
      nav.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    };
    toggle.addEventListener("click", () => set(!nav.classList.contains("open")));
    nav.addEventListener("click", (e) => { if (e.target.closest("a, button")) set(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && nav.classList.contains("open")) { set(false); toggle.focus(); } });
    document.addEventListener("click", (e) => { if (nav.classList.contains("open") && !e.target.closest("#nav, #navToggle")) set(false); });
  }

  /* ---------- the hourglass icon stays still for visitors who asked for less motion ---------- */
  if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) {
    $$("#i-hourglass animate, #i-hourglass animateTransform").forEach((el) => el.remove());
    $$("#i-hourglass .sand").forEach((el, i) => { if (i) el.remove(); });   // keep the sand in the top half
  }

  /* ---------- hero headline: the word types itself and changes ---------- */
  const rot = $("#rotWord");
  if (rot && !(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches)) {
    const words = (rot.dataset.words || "").split("|").filter(Boolean);
    let w = 0, n = words[0].length, del = true;
    rot.classList.add("typing");
    const step = () => {
      if (document.hidden) return setTimeout(step, 600);
      n += del ? -1 : 1;
      rot.textContent = words[w].slice(0, n);
      let wait = del ? 45 : 95;
      if (del && n === 0) { del = false; w = (w + 1) % words.length; wait = 260; }
      else if (!del && n === words[w].length) { del = true; wait = 1700; }
      setTimeout(step, wait);
    };
    if (words.length > 1) setTimeout(step, 1700);
  }

  /* ---------- sections appear as you scroll (skipped when the visitor asked for less motion) ---------- */
  if ("IntersectionObserver" in window && !(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches)) {
    const groups = [".prize-copy", ".podium", ".steps .step", ".board-head", ".tl-item", ".rule-list li", "#faq .h2, #faq .kicker, #faq .note", ".why-card", ".faq-list details"];
    const io = new IntersectionObserver((list) => list.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    groups.forEach((sel) => $$(sel).forEach((el, i) => { el.classList.add("rv"); el.style.setProperty("--rv-i", String(Math.min(i, 8))); io.observe(el); }));
    setTimeout(() => $$(".rv").forEach((el) => el.classList.add("in")), 6000);   // never leave anything hidden
  }

  /* ---------- FAQ: one open at a time ---------- */
  const faqs = $$(".faq-list details");
  faqs.forEach((d) => d.addEventListener("toggle", () => {
    if (d.open) faqs.forEach((o) => { if (o !== d) o.open = false; });
  }));
})();
