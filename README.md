# TuteDude Buildathon: website + Team Board

- **Site:** https://buildathon.tutedude.com/ (the official address; also at https://rajnishpark03.github.io/tutedude-hackathon/). GitHub Pages serves the `main` branch root.
- **Backend:** Supabase project `zbcldrkowkpvkxepltrt` (Mumbai).

## How it works for students
Students bring their own team (2 to 5 people, any mix of skills). Exclusive for TuteDude students.

1. **Register our team (leader, 1 minute).**
   - Team name, the leader's name, WhatsApp, email and skill (UI/UX Designer, Developer, Marketing, Video Editor, Other). Optional: a one-line bio and a work link.
   - Teammates: up to 3, each with **name, WhatsApp number and email (the one they use on TuteDude)**. The numbers are shown only inside the team, so teammates can message each other right after registering. Each email is checked with TuteDude while the form is filled: green "✓ On TuteDude", or red "✗ Not on TuteDude". They don't need to do anything: the whole team is registered in one go. Still looking for people? Leave them empty and add them later.
   - Every email is checked with TuteDude when they tap **Continue**; any email that isn't on TuteDude is marked **in red** in the form, all at once.
   - Optional tick: *"We need more people: let students without a team find and join us"* (an **open** team).
   - Then a 1-minute **TuteDude Sessions video** that must play to the end (skipping ahead jumps back), and a consent tick: *"my team will create or join our TuteDude session and do our product discussion there"*.
   - The leader gets a **team link** (`…/#join=ABCD-EFGH`, an 8-character secret code) to share.
2. **Teammates open the team link (optional, recommended).** They register in a minute (their own WhatsApp, skill, the video + consent). If they use the email the leader added, they take their reserved spot, even in a full team. Then they see the team page, the problem statement and notifications too.
3. **No team? Two ways in.**
   - **Find a team:** a list of open teams that still have room (team name, size, skills, leader's first name), teams missing your skill first. Pick one while registering.
   - **Team Building Sessions:** every morning and evening in a permanent room on TuteDude Sessions. Set the link and times in `config.js` → `teamBuilding`.
   - **"Find your team on TuteDude" video** (the Buildathon tab in Sessions): a "How to find teammates" button in the hero and a video card on the team board, for students who still need teammates, until teams lock. It plays in a pop-up (the 720p file, 5.6 MB). Set the files and the Buildathon tab link in `config.js` → `findVideo`; leave `video` empty to hide it.
4. **Team page.** Members with WhatsApp buttons ("Copy all numbers" for a group), added teammates, the team link (copy / send on WhatsApp), and for the leader: rename, add or remove teammates, remove a member, open or close the team, make a new link (the old one stops working). Anyone can leave until teams lock (a leader who leaves hands over to the next member).
5. **Problem statement.** At **21 Nov, 7:15 PM** it appears on the team page of every team with 2+ people (see "Publish the problem statement").
6. **Lost the team page?** "Already registered on another phone or browser? Get back to your team" brings it back with the same WhatsApp number and email.
7. **Prizes.** For the top 3 teams: 🥇 ₹5,000, 🥈 ₹3,000 and 🥉 ₹2,000 (₹10,000 total, shown on the page). Change them in `config.js` (`prize`, `prizes`).
8. **Dates.** Teams lock **20 Nov, 11:59 PM IST**. The problem statement drops **21 Nov, 7:15 PM IST**. Live countdowns (flip-calendar style).

### Rules the database enforces
- 2 to 5 people per team (registered members + added teammates). A team of 1 can't take part.
- One team per person: each WhatsApp number and email can be used once (including emails a leader added).
- A teammate the leader added can only join that team (or be removed by the leader first).
- Joining needs the team code, or the team must be open. Team names are unique and can't impersonate TuteDude or contain abuse.
- WhatsApp numbers: only teammates and organisers. Emails: only organisers, and the leader sees the emails they added. Team codes: only the team and organisers.
- The public page shows how many students registered. **No team counts**, no names (except open teams in the "Find a team" list).
- Nothing about teams can change after the deadline.

### Tested
- See "Tests" at the bottom.

## Files
| File | What it is |
|---|---|
| `index.html` | the page. A "Register your team" bar sticks to the bottom once the hero scrolls away. It has a Content-Security-Policy and refuses to run inside other sites' frames. |
| `assets/brand/` | the official TuteDude logo (from tutedude.com) |
| `config.js` | **settings**: Supabase URL and publishable key, login type, dates, prizes, TuteDude Sessions link and video, Team Building Sessions link and times, skills |
| `supabase.sql` | the database: tables plus the functions that enforce every rule. Running it again is safe. |
| `admin.html`, `admin.js`, `admin.css` | the organiser panel (sign-in with email + password, organisers only) |
| `board.js` | everything students click: register / join / find a team, the video + consent, team page, notifications |
| `script.js` | countdowns, prize total, menu, FAQ, frame protection |
| `sw.js`, `manifest.webmanifest`, `icon-*.png` | notifications + "Add to Home Screen" |
| `vendor/supabase.js` | Supabase's browser library (v2.45.4), shipped with the site so a blocked CDN can't break it |
| `supabase/functions/notify/index.ts` | optional Edge Function for phone notifications |
| `.env`, `vapid-keys.local.json` | secrets: git-ignored, stay on your computer |

## Settings that must match
| What | `config.js` | `supabase.sql` |
|---|---|---|
| Team lock | `teamDeadline` | `bd_deadline()` |
| Problem statement time | `buildDay` | `bd_reveal()` |
| Team size | `maxTeamSize` | `bd_max()` |
| Minimum to take part | `minTeamSize` | `bd_min()` |
| Skills | `domains` | `bd_domains()`, `bd_label()` |
| Reminder times | (none) | pg_cron schedule at the bottom |

After editing `supabase.sql`, run it again in **Supabase → SQL Editor**.

## Sign-in
- **`login: "anonymous"` (current).** No sign-in; just the form. The team is tied to that phone or browser. Organisers still have each student's WhatsApp and email.
  - Turn it on in **Authentication → Sign In / Providers → Allow anonymous sign-ins**.
  - Raise **Authentication → Rate limits → anonymous sign-ins**, because a whole college on one Wi-Fi shares one IP.
- **`login: "google"`.** Students can open their team from any device. This needs a Google OAuth client added under **Authentication → Providers → Google**.

## Leaving a team
A student can leave their team only in the first **24 hours** after joining it (`leaveHours` in config.js, `bd_leave_hours()` in supabase.sql). After that the team page shows "it is final". Someone who is alone in a team can always leave. The leader can still remove a member, in any team and after the lock too, until the team submits its project (after the lock, only a team the organisers reopened can add someone new). Organisers can move people from the panel.

**Changing team after the lock** (`switch_team` in supabase.sql). Anyone registered can move to another team with its team link: the team page has **Leave and join another team** (paste the link), and opening another team's link offers the move too. Leaving and joining happen in one step, so nobody drops out of the Buildathon by leaving. Someone without a team (e.g. the leader removed them) joins a team the same way. The new team needs room and "Team is full" off; leaders of every team can turn "Team is full" on, or pick the team size, after the lock too. A team that submitted its project is final: its members can't move out and nobody can move in. At most 6 team changes an hour per person. Brand-new registrations after the lock still work only with the link of a team the organisers reopened.

On 23 Nov every team was opened (`update teams set late_open = true`): the site still says "Registration closed", but on every team page the link shows (copy / share), the leader can add and remove teammates, and a member's **Remove** (next to their own name) or **Leave team** opens "Want to change your team?", where they paste the new team's link. The organiser panel's **Close the reopened teams** closes them all again.

## Team is full (the leader closes the team)
In the team link card the leader has two controls, until teams lock:
- **Team is full: stop new members** (`set_team_closed`). On: the team link and its Join button say "Team is full" and the database refuses new members. It can be turned on from 2 people, and back off any time. A closed team that drops under 2 people (someone left or was removed) opens again by itself.
- **Team size** 2 to 5 (`set_team_cap`). At that many people the team counts as full in the same way, so it closes by itself. It can't be set below the people already in the team.

Teammates the leader added by email keep their spot in a full team. The leader can still add teammates up to the team size. Full teams get no "anyone else joining?" reminder on lock night. The organiser panel shows "Team is full (closed)".

## Phone notifications
**Set up and running (15 Nov 2026) on Vercel.** The sender is `push-server/api/notify.js`, deployed as its own small Vercel project `buildathon-notify` (https://buildathon-notify.vercel.app/api/notify), separate from the site. Its three settings (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `NOTIFY_SECRET`, from `vapid-keys.local.json`) live in that project's Environment Variables. The database calls it for every new notification (`bd_send_push`, address and secret in `bd_settings`), and forgets devices that unsubscribed (`bd_push_clean`, every 15 minutes).
- To redeploy it: `cd push-server && vercel deploy --prod`.
- Never change the VAPID keys: phones that turned notifications on are tied to them.

The steps below are the other way to run it (a Supabase Edge Function). Use only one of the two.

Without a sender, notifications show only while the site is open. With it, they also reach the phone when the site is closed.
1. **Edge Functions → Deploy a new function → Via editor.** Name it `notify`, paste `supabase/functions/notify/index.ts`, and deploy.
2. In the function's settings, turn **Verify JWT off**.
3. Under **Edge Functions → Secrets**, add these four values. The first three come from `vapid-keys.local.json`:
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `NOTIFY_SECRET`
   - `VAPID_SUBJECT` = `mailto:<your email>`
4. In the SQL Editor, run:
   ```sql
   insert into bd_settings (key, value) values
     ('notify_url', 'https://zbcldrkowkpvkxepltrt.supabase.co/functions/v1/notify'),
     ('notify_secret', '<NOTIFY_SECRET>')
   on conflict (key) do update set value = excluded.value;
   ```

## WhatsApp reminder (WATI)
People who are **alone in their team** get a WhatsApp message through WATI: get your teammates in before teams lock, or the team is out. Nobody else gets it.
- **When:** by itself once a day at **1 PM IST** until teams lock (pg_cron job `buildathon-whatsapp-solo-1pm`). An organiser can also send it right away: panel → **Notify → WhatsApp reminder**. The panel shows how many people get it and what WATI answered.
- **Until when:** from 18 Nov, every day at 1 PM; the last one goes out on 20 Nov at 1 PM. After teams lock (20 Nov, 11:59 PM) nothing is sent, so nothing goes out after the problem statement either.
- **Random message:** the template is `buildathon_team_status` (Utility, approved 17 Nov 2026). Its `{{message}}` is one of the lines in `MESSAGES` at the top of `push-server/api/whatsapp.js`, picked at random for each person: a plain status update (alone in the team, add a teammate, or no prize and no certificate). Keep the lines factual, without a hard sell, or WhatsApp can move the template to Marketing or pause it.
- **How it runs:** the database (`bd_whatsapp_solo()`) calls `push-server/api/whatsapp.js` on Vercel (project `buildathon-notify`, https://buildathon-notify.vercel.app/api/whatsapp), which calls WATI. The WATI token lives only on Vercel.

**The template** (WATI → Template Messages), variables `name`, `message`, `link`:
```
Hi {{name}}, an update on your TuteDude Buildathon registration:

{{message}}

Your team link: {{link}}

Team TuteDude
```

**Settings.**
- Vercel → project `buildathon-notify` → Environment Variables (Production): `WATI_TOKEN` (WATI → API Docs → Access Token). Optional `WATI_API_HOST` if WATI's API Endpoint is not `https://live-mt-server.wati.io`. After a change: `cd push-server && vercel deploy --prod`.
- In `bd_settings`: `whatsapp_url` (the sender's address), `whatsapp_template` (`buildathon_team_status`), `whatsapp_params` (`name,message,link`).
- To switch WhatsApp off: `update bd_settings set value = '' where key = 'whatsapp_url';`

## Teams of one → teams of 5
Puts everyone who is **alone in their team** and is a **confirmed TuteDude student** together, in teams of up to 5. Anyone whose email TuteDude hasn't confirmed is left out, so re-check them first (Teams → re-check TuteDude emails). The teams are as even as possible and never 1 person: 12 people make 4 + 4 + 4, and 103 people make nineteen teams of 5 and two of 4. In each group the oldest team stays, with its name, link and leader. The others join it, and their old empty teams are deleted. People not in any team, and teams of 2 or more, are not touched.
- **Messages:** everyone gets a site and phone notification ("✅ You have been assigned to the team …", with their teammates' names). They also get a WhatsApp message through WATI, using the same `buildathon_team_status` template, where `{{message}}` names the team and lists each teammate's name and WhatsApp number. Its link opens their team page, where every teammate has a WhatsApp button.
- **How to run it:** organiser panel → **Notify → Teams of one → teams of 5**. **Preview the teams** shows who goes with whom, and **Put them in teams and message them** runs it. Or in the SQL Editor: `select bd_merge_solos(true);` (preview), then `select bd_merge_solos();`.
- **Leaving:** everyone in the new team, the one who stayed included, gets the normal 24-hour leave window, until teams lock. It also works after the lock.
- **WhatsApp sender:** `push-server/api/whatsapp-team.js` (the database calls `whatsapp_url` with `/api/whatsapp` changed to `/api/whatsapp-team`). If that isn't deployed, nobody gets a wrong WhatsApp message. The send just fails, and the panel shows the error under the WhatsApp reminder.

## WhatsApp rules
Before the first WhatsApp button opens (the community, a teammate, the team link, "Copy all numbers"), the site shows the WhatsApp rules once and the student ticks **I agree**: only about the Buildathon, no spam, no unwanted messages, or TuteDude can remove them and take action. It is remembered in that browser and saved on the profile (`wa_ok_at`); the CSV export has the column `agreedToWhatsappRules`.

## Project submission
Teams submit on this same site, from their team page.
- **When:** any time in the submission window, from `submitFrom` to `submitBy` in config.js: from the problem statement (Sat, 21 Nov 2026, 7:15 PM IST) to Sat, 28 Nov 2026, 11:59 PM IST. A team submits as soon as its project is ready; it doesn't wait for the last day. If you change either time, change `bd_submit_from()` / `bd_submit_by()` in supabase.sql too and run the file again.
- **Who:** anyone in the team (since 27 Nov 2026; before that only the leader), **once per team**. A submission can't be edited. The team must have at least 2 people. The team page and the organiser panel show who submitted.
- **What:** project name, 2 to 3 lines about it, project link (required), website link and promo video link (asked for, can be left empty after a warning).
- **Organisers:** panel → **Submissions** shows every project with its links, the leader's contact and who submitted it, **Download CSV** exports them, and **Reopen** removes one submission so the team can submit again (the team gets a notification).
- To wipe test submissions: `delete from submissions;`

## TuteDude student check
Every email is checked with TuteDude's API when someone registers (and every teammate email a leader adds): `POST https://baby.tutedude.com/api/auth/check-email` with `{"email": "..."}` → `{"data": {"exists": true|false}}`.
- The check runs inside Supabase (the `http` extension), never in the browser, so it can't be skipped. It runs when the student taps **Continue**, before the video.
- **Live check in the form:** as soon as an email is typed (on leaving the box, or after a 1.2 s pause), the form asks `check_student(email)` and marks the box green or red. Each account gets 30 questions per 10 minutes; past that, or when the API can't answer, the box just stays unmarked and the check at **Continue** decides.
- Not on TuteDude → *"This email isn't on TuteDude. Use the email you use for your TuteDude courses."* and no registration.
- API down, slow (over 1.5 s) or rate-limited → the student still registers, marked **"TuteDude not checked yet"**; the site stops asking for 2–5 minutes. Organisers press **↻ Re-check TuteDude emails** in the panel (20 at a time) once it's back.
- Answers are remembered (yes for 30 days, no for 10 minutes), so one email is asked once.
- **Rate limit:** the API allows only 30 checks per 10 minutes per server. For launch, ask TuteDude's backend team to raise it for our Supabase server (or give us an API key with a higher limit), or most launch-day registrations will be "not checked".
- To change the URL: `update bd_settings set value = 'https://…' where key = 'tutedude_check_url';`

## Start fresh (deletes every registration)
The live data was cleared on 13 Nov 2026. If you test again before launch, run this in the SQL Editor to wipe it. **It cannot be undone.**
```sql
delete from teams;                                                            -- teams first (members and team messages follow)
delete from auth.users where id in (select id from people) or is_anonymous;  -- then people, notifications, push subscriptions
alter sequence team_no_seq restart with 1;                                    -- next new team is "Team 1"
```

## Organiser panel (`admin.html`)
Open `https://rajnishpark03.github.io/tutedude-hackathon/admin.html`. It isn't linked from the site, and search engines are told not to list it.

**Sign in.**
- Supabase → **Authentication → Users → Add user → Create new user**. Enter the organiser's email and a strong password, tick **Auto Confirm User**, then click Create.
- Only emails on the organiser list can open the panel. The list is in the `bd_admins` table and starts with `rajnish@tutedude.com`. To add someone, run:
  ```sql
  insert into bd_admins (email) values ('name@tutedude.com');
  ```
- On the first sign-in the panel pins the account to that email, so an account created later with the same email can't get in.
- **Change password** is at the top right of the panel, so a password never has to be shared.
- The panel's sign-in lasts only while that browser tab is open (it isn't kept with other pages of the site).
- Every admin function checks this on the server, so the page holds no secrets.

**What it does.**
- **Overview:** registrations (total, last 24 h, per skill, per day), teams (ready with 2+, only 1 person, full, open), people not in a team, teammates added by leaders.
- **Teams:** filters (ready, only 1 person, full, open, not in a team) and search by team, team code, name, email or WhatsApp. Every member's WhatsApp, email and agreement, plus the teammates their leader added. Actions:
  - **Copy link** of a team (to resend it to a student who lost it).
  - **Move** a person to another team with room (or **Add to a team** for someone not in one). Everyone involved gets a notification.
  - **+ Add member** on a team (with room): search anyone by name, email or WhatsApp number and put them in that team. Someone already in another team is moved out of it. An empty search lists people without a team.
  - **Remove from team:** takes a person out of their team but keeps their registration, so they can be added to another team or join one that's still open with its link. If they led the team, the next member leads; if they were the only member, the team is deleted.
  - Move, Add member and Remove from team work after the lock too. They refuse to take the last member out of a team that already submitted, because that would delete the team and its submission.
  - **Delete registration** of a fake or outsider completely (their team passes to the next member), or **Remove** a teammate the leader added who hasn't signed up.
  - **Rename** a team, or **Notify team**.
  - **Export CSV:** one row per person, including added teammates (`signedUp` = no). Cells are protected against spreadsheet formulas.
- **Problem statement:** write it, see a preview and save. Students see it at 21 Nov, 7:15 PM, with no SQL needed.
- **Notify:** send a site and phone notification to everyone, people in teams of 2+, people alone in their team, people not in a team, or one team. The panel shows how many people will get it before you send.
- **Activity:** recent creations, joins, leaves, removals, renames and moves.
- **WhatsApp:** what people send to the Buildathon WhatsApp number, newest first, refreshed every 10 seconds (a toast shows each new message, and the tab shows how many chats are waiting for an answer). Each chat shows the person's registration and team. Tap one to read the whole chat from WATI (our messages to everyone, the WATI bot, their messages) and answer it. WhatsApp delivers a typed answer only within 24 hours of the person's last message; after that, use **Open in WhatsApp**.

**How the WhatsApp tab works.**
- WATI sends every incoming message to `https://buildathon-notify.vercel.app/api/wati-hook?k=KEY` (`push-server/api/wati-hook.js`), which saves it in `wa_inbox` (supabase.sql). `KEY` is made from `NOTIFY_SECRET`: the first 32 characters of HMAC-SHA256(`NOTIFY_SECRET`, `"wati-hook"`) in hex.
- **One-time setup in WATI:** Connectors → Webhooks → Add Webhook → paste that address, status **Enabled**, event **Message Received**, Save. (Our WATI API key can't add webhooks itself: it lacks the `webhooks` scope.)
- Reading a chat and answering go through `push-server/api/wa-admin.js`, which checks the organiser's sign-in (`admin_whoami`). The WATI token stays on the notify server.
- To catch up on replies that came before the webhook was set: `whatsapp-replies` with `store: true` (it saves what it finds in `wa_inbox`).
- The notify server deploys with the Vercel CLI: `cd push-server && vercel deploy --prod`.

## Publish the problem statement
Easiest: the **Problem statement** tab in the organiser panel. Or run this in the SQL Editor any time before 7:15 PM on 21 Nov. Students see it on their team page from 7:15 PM, and a notification goes out at 7:15 PM.
```sql
insert into bd_settings (key, value) values
  ('problem_statement', 'Write the problem statement here. Line breaks are kept; links become clickable.'),
  ('problem_link', 'https://link-to-the-full-brief (optional, leave empty for none)')
on conflict (key) do update set value = excluded.value;
```
It is never on the public page. Only teams of 2+ people see it.

**On WhatsApp too.** At **7:16 PM on 21 Nov** everyone in a team of 2+ gets it on WhatsApp through WATI, with the same Utility template as the reminders (`buildathon_team_status`: "Hi {name}, an update on your TuteDude Buildathon registration: {message} Your team link: {link}"). Only when the problem statement is saved by then.
- **The message:** "The problem statement is out: …" with the statement on one line (WhatsApp allows no line breaks in a template variable), the brief link if there is one, and "Read it all on your team page and start building with your team." It's at most 600 characters, so a longer statement is cut with "…".
- **Never before 7:15 PM:** the database refuses to send it earlier, from the schedule or the panel.
- **Once:** the 7:16 PM run sends it once. In the panel (**Problem statement → Send it on WhatsApp**) an organiser sees how many people get it and the exact message, can send it after saving it later, or send it again. The panel shows what WATI answered.

## After 20 Nov: final teams
Easiest: **Export CSV** in the organiser panel. Or run this in the SQL Editor, then click **Export → CSV**:
```sql
select t.name as team, t.code, t.size, p.name, p.domain, p.phone, p.email, (t.leader_id = p.id) as leader, true as signed_up
from teams t join members m on m.team_id = t.id join people p on p.id = m.person_id
union all
select t.name, t.code, t.size, l.name, '', '', l.email, false, false
from teams t join team_listed l on l.team_id = t.id
order by 1;
```

## Cost
- **Free plan:** works, with 200 simultaneous live connections. Above that the page refreshes every 15 s instead of instantly.
- **Pro plan:** $25/month and allows 500. It can be switched on for event week only.

## Run locally
```sh
python3 -m http.server 8000   # then open http://localhost:8000
```
Set `supabase: null` in `config.js` to use the offline demo with sample teams.

## Tests
Run before the bring-your-own-team launch (13 Nov 2026). Six independent QA agents plus the regular suites; every bug they found was fixed and re-tested.
- **Database:** 174 tests (local Postgres 16 with a Supabase stand-in): every function and error path, boundary values, the lock and reveal windows, reminders, the organiser panel, and the security fixes below. Applying `supabase.sql` on top of the old live schema with data, and running it twice, both work.
- **Load:** about 95,000 racing calls at up to 50 connections, including a 77,600-operation soak. No team ever went over 4 people, sizes stayed right, no deadlocks. Every student action takes under 2 ms at 10,000 people; the team lock handles roughly 300 to 750 registrations a second.
- **Security review:** row-level security blocks all direct table access; internal functions can't be called; no SQL injection; no stored XSS anywhere (payloads tried in every field). Fixed after the review: registration takeover limits (reclaim cooldown + the team is told), "email squatting" by leaders, join/leave notification spam (6 team changes an hour), look-alike team names (Cyrillic letters, "Tute Dude", "Tut3"), one message for "number or email already registered", stricter emails (no mail-header tricks in organiser links), CSP without any CDN, frame protection, CSV formula protection, the organiser sign-in kept per browser tab.
- **Browser:** about 440 end-to-end checks of every flow in demo mode, 51 regression checks after the fixes, the organiser panel (82 checks with a mocked backend), and a design/accessibility audit at 13 screen sizes from 320 px to 1920 px, including 40-character names with no spaces.

