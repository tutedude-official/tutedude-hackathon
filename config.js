/* ============================================================
   TuteDude Buildathon — settings. This is the only file you need to edit.
   ============================================================ */
window.BUILDATHON = {
  /* Supabase project. Leave null for DEMO MODE (sample teams, data stays in one browser).
     Fill it in to make the Team Board live for everyone (steps in README.md):
     supabase: { url: "https://xxxx.supabase.co", anonKey: "eyJhbGciOi... or sb_publishable_..." }, */
  supabase: { url: "https://zbcldrkowkpvkxepltrt.supabase.co", anonKey: "sb_publishable_pxjkI132d0nDIrv85y4apA_GiYEKopY" },

  /* How students sign in (live mode only):
     "google"    → "Continue with Google", then the form. Works across phone and laptop. Needs Google set up in Supabase.
     "anonymous" → no sign-in at all, just the form. Easiest, but the profile is tied to that one browser. */
  login: "anonymous",

  /* Phone/laptop notifications. Public key only; the private key stays in Supabase secrets. */
  vapidPublicKey: "BIr4WNq9LMUEREPixBCVzOYTIok82rTRCGy9mQB9kV5revNOAJ8Wg0F0-y0-yqBr7qgZruz1Ln1ZGYwmihaN1Rs",

  /* TuteDude Sessions: where teams create their room ("Open TuteDude"), and the how-to video every
     student must watch to the end while registering, before agreeing to discuss their product there.
     videoBackup is used only if the video file can't play. */
  session: {
    link: "https://upskill.tutedude.com/course/lecture-growthhacking/community?channel=shared--speak-up",
    video: "assets/TuteDude_Buildathon_1080p.mp4",
    /* true = the video must be watched to the end before the agree box unlocks. false = watching is the student's choice. */
    videoRequired: false,
    videoBackup: "https://drive.google.com/file/d/10je3Wv90Svgqn9wSQQ4VAE7AxXZ46vdL/view"
  },

  /* "Find your team on TuteDude" video: the Buildathon tab in TuteDude Sessions (find builders, start a team).
     Shown in the hero and on the team board to students who still need teammates, until teams lock.
     720p is sharp in the pop-up (at most 760px wide) and half the size of 1080p. Optional: videoSmall = a smaller
     file just for phones. link = the Buildathon tab. Leave video "" to hide it all. */
  findVideo: {
    video: "assets/TuteDude__720p.mp4",
    poster: "assets/find-video-poster.jpg",
    link: "https://upskill.tutedude.com/course/lecture-growthhacking/sessions"
  },

  /* Team Building Sessions for students without a team: a permanent room on TuteDude Sessions.
     link = where the room is. when = shown on the site, e.g. "Every day at 11 AM and 7 PM"
     (leave "" to show "Every morning and evening"). */
  teamBuilding: {
    link: "https://upskill.tutedude.com/course/lecture-growthhacking/community?channel=shared--speak-up",
    when: ""
  },

  /* Team formation window (IST). After teamDeadline the board locks and teams are final.
     If you change teamDeadline, change bd_deadline() in supabase.sql too and run it again. */
  boardOpens: "2026-11-12T00:00:00+05:30",
  teamDeadline: "2026-11-20T23:59:59+05:30",

  /* Buildathon starts + problem statement is revealed (IST). Countdowns and reminders use this, and the
     problem statement appears on team pages at this time (must match bd_reveal() in supabase.sql). */
  buildDay: "2026-11-21T19:00:00+05:30",

  /* The submission window (IST): it opens with the problem statement (a team can submit as soon as it's ready)
     and closes at submitBy. Must match bd_submit_from() and bd_submit_by() in supabase.sql. */
  submitFrom: "2026-11-21T19:00:00+05:30",
  submitBy: "2026-11-28T23:59:59+05:30",

  /* prize = the 1st prize (shown in the hero headline); prizes = 1st, 2nd, 3rd (per team) */
  prize: "₹5,000",
  prizes: ["₹5,000", "₹3,000", "₹2,000"],

  /* Team size (must match bd_max / bd_min in supabase.sql). Any mix of skills. A team needs minTeamSize people to take part. */
  maxTeamSize: 5,
  minTeamSize: 2,

  /* false = the Buildathon is open to everyone: registration does not ask "What do you do?" and the site
     shows no skill labels (everyone is saved as "other"). true brings the skill chips below back. */
  askSkill: false,

  /* true = registered students must allow notifications: the pop-up cannot be skipped (except on iPhone
     in Safari, where Apple only allows them from the home-screen app). false = "Continue for now" appears
     when the browser blocks them. */
  forceNotifications: true,

  /* "Leave team" is open for this many hours after joining a team (must match bd_leave_hours() in supabase.sql).
     Someone alone in a team can always leave. */
  leaveHours: 24,

  /* false = while registering, the leader only names the team; teammates join with the team link.
     true brings back the rows where the leader types each teammate's name, WhatsApp number and email. */
  matesAtSignup: false,

  /* Skills people pick when they register. Keys must match bd_domains() in supabase.sql. */
  domains: [
    { key: "design", label: "UI/UX Designer", short: "Designer", icon: "🎨", ic: "palette" },
    { key: "dev", label: "Developer", short: "Developer", icon: "💻", ic: "laptop" },
    { key: "marketing", label: "Marketing", short: "Marketer", icon: "📣", ic: "megaphone" },
    { key: "video", label: "Video Editor", short: "Video Editor", icon: "🎬", ic: "clapper" },
    { key: "other", label: "Other skill", short: "Other", icon: "✨", ic: "sparkles" }
  ],

  /* The Buildathon WhatsApp community: students without a team (or with a short team) find each other
     there. Shown before registering ("No team yet?"), on the team page, in the FAQ and the footer.
     Leave "" to hide it. */
  findTeamGroup: "https://chat.whatsapp.com/FhYOYtRi1fCHaI8ltxmK3O",

  /* TuteDude Community: where students message the organisers (shown as "TuteDude Community" on the site) */
  speakUp: "https://upskill.tutedude.com/course/lecture-growthhacking/community?channel=shared--speak-up"
};
