// Is a submitted link open to everyone? The submit form asks before a project is submitted, so judges never get
// a private Google Doc / Drive file, a private GitHub repo or a private YouTube video.
// POST { links: ["https://…", …] } (up to 5) → { results: [{ url, kind, status }] }
//   kind:   "google" | "github" | "youtube" | "other" (other links aren't checked)
//   status: "public" | "private" | "missing" | "unknown" (unknown = Google/GitHub/YouTube didn't give a clear answer;
//           the form lets those through, so a slow or busy service never blocks a submission)
// Only these hosts are ever fetched, so this can't be used to reach anything else.
const UA = "Mozilla/5.0 (compatible; TuteDudeBuildathonLinkCheck/1.0; +https://buildathon.tutedude.com)";

const kindOf = (u) => {
  const h = u.hostname.toLowerCase();
  if (/^(docs|drive|sites)\.google\.com$/.test(h) || h === "forms.gle") return "google";
  if (h === "github.com" || h === "www.github.com" || h === "gist.github.com") return "github";
  if (/^(www\.|m\.)?youtube\.com$/.test(h) || h === "youtu.be") return "youtube";
  return "other";
};

async function get(url, trace) {
  const r = await fetch(url, { redirect: "manual", headers: { "User-Agent": UA, "Accept-Language": "en" }, signal: AbortSignal.timeout(7000) });
  const loc = r.headers.get("location") || "";
  if (trace) trace.push(`${r.status} ${url.slice(0, 90)}${loc ? " → " + loc.slice(0, 90) : ""}`);
  try { await r.body?.cancel(); } catch (_) {}
  return { status: r.status, loc: loc ? new URL(loc, url) : null };
}

// Google: anyone with the link gets the file (200); a private file sends people without access to the sign-in page
async function google(u, trace) {
  let url = u.href.replace(/\/u\/\d+\//, "/");   // …/u/1/… only means "the second signed-in account"
  for (let hop = 0; hop < 5; hop++) {
    const { status, loc } = await get(url, trace);
    if (status >= 300 && status < 400 && loc) {
      if (loc.hostname === "accounts.google.com" || /ServiceLogin|\/signin/i.test(loc.pathname)) return "private";
      if (/^\/sorry\//.test(loc.pathname)) return "unknown";                     // Google asked for a captcha
      if (!/(^|\.)google\.com$/.test(loc.hostname) && loc.hostname !== "forms.gle") return "unknown";
      url = loc.href;
      continue;
    }
    if (status === 200) return "public";
    if (status === 401 || status === 403) return "private";
    if (status === 404 || status === 410) return "missing";
    return "unknown";
  }
  return "unknown";
}

// GitHub: a public repo opens (200); a private one looks exactly like a missing one (404)
async function github(u, trace) {
  const parts = u.pathname.split("/").filter(Boolean);
  let url;
  if (u.hostname === "gist.github.com") url = u.href;
  else if (parts.length >= 2) url = `https://github.com/${parts[0]}/${parts[1].replace(/\.git$/i, "")}`;
  else if (parts.length === 1) url = `https://github.com/${parts[0]}`;
  else return "unknown";
  for (let hop = 0; hop < 3; hop++) {
    const { status, loc } = await get(url, trace);
    if (status >= 300 && status < 400 && loc) {
      if (/^\/login/.test(loc.pathname)) return "private";
      if (!/(^|\.)github\.com$/.test(loc.hostname)) return "unknown";
      url = loc.href;   // a renamed repo moves
      continue;
    }
    if (status === 200) return "public";
    if (status === 404) return "private";   // private, or the link is wrong
    return "unknown";
  }
  return "unknown";
}

// YouTube: oEmbed answers for public and unlisted videos, and refuses private ones
async function youtube(u, trace) {
  const { status } = await get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u.href)}`, trace);
  if (status === 200) return "public";
  if (status === 401 || status === 403) return "private";
  if (status === 404) return "missing";
  if (status === 400) return /\/(channel|c|user|@|playlist)/.test(u.pathname) || u.pathname.startsWith("/@") ? "unknown" : "missing";
  return "unknown";
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Max-Age", "600");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const links = (Array.isArray(body.links) ? body.links : []).slice(0, 5).map((x) => String(x || "").trim().slice(0, 300));
  const debug = req.query && req.query.debug === "1";
  const results = await Promise.all(links.map(async (raw) => {
    const trace = debug ? [] : null;
    let u;
    try { u = new URL(raw); } catch (_) { return { url: raw, kind: "other", status: "unknown" }; }
    if (!/^https?:$/.test(u.protocol)) return { url: raw, kind: "other", status: "unknown" };
    const kind = kindOf(u);
    let status = "unknown";
    try {
      if (kind === "google") status = await google(u, trace);
      else if (kind === "github") status = await github(u, trace);
      else if (kind === "youtube") status = await youtube(u, trace);
    } catch (_) { status = "unknown"; }
    return debug ? { url: raw, kind, status, trace } : { url: raw, kind, status };
  }));
  return res.status(200).json({ results });
};
