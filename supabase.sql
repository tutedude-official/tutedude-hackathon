-- ============================================================
-- TuteDude Buildathon: Team Board database (Supabase)
-- Run once: Supabase dashboard → SQL Editor → New query → paste this whole file → Run.
-- Safe to run again after editing the settings below.
--
-- How teams form (students bring their own team):
--   the leader registers and creates the team, and gets a team link with a secret code.
--   Teammates open that link and register into the team. 2 to 5 people, any mix of skills.
--   A team that already exists registers in one go: the leader adds teammates by name + email. They hold
--   their spot; if they open the team link and register with that email, they take it.
--   No team yet? Join a team whose leader marked it "open to new members" (picked from a list).
--   Nobody registers alone: every registration creates a team or joins one.
--   Everyone watches the TuteDude Sessions video and agrees to it while registering.
--   Every email (the person registering and the teammates a leader adds) is checked with TuteDude's API.
--
-- The website can't write to the tables directly (row level security is on).
-- Everything goes through the functions below, which check every rule.
-- ============================================================

-- ---------- Settings: keep in sync with config.js ----------
create or replace function bd_deadline() returns timestamptz language sql immutable as $$ select timestamptz '2026-11-20 23:59:59+05:30' $$;
create or replace function bd_max() returns int language sql immutable as $$ select 5 $$;         -- people per team
create or replace function bd_min() returns int language sql immutable as $$ select 2 $$;         -- a team needs this many people to take part
create or replace function bd_domains() returns text[] language sql immutable as $$ select array['design','dev','marketing','video','other'] $$;
create or replace function bd_label(d text) returns text language sql immutable as $$
  select case d when 'design' then 'UI/UX Designer' when 'dev' then 'Developer' when 'marketing' then 'Marketing'
                when 'video' then 'Video Editor' else 'Other skill' end $$;
-- ' (Developer)' after a name in team messages; nothing when no skill was picked
create or replace function bd_tag(d text) returns text language sql immutable as $$ select case when d is null or d = 'other' then '' else ' (' || bd_label(d) || ')' end $$;
-- the problem statement appears on team pages at this time (config.js buildDay)
create or replace function bd_reveal() returns timestamptz language sql immutable as $$ select timestamptz '2026-11-21 19:15:00+05:30' $$;
-- last moment to submit the project: one week of building (must match submitBy in config.js)
-- projects are submitted in this window only: it opens with the problem statement (submit as soon as it's ready)
-- and closes at bd_submit_by()
create or replace function bd_submit_from() returns timestamptz language sql immutable as $$ select timestamptz '2026-11-21 19:15:00+05:30' $$;
create or replace function bd_submit_by() returns timestamptz language sql immutable as $$ select timestamptz '2026-11-28 23:59:59+05:30' $$;

do $$ begin create extension if not exists pg_net; exception when others then raise notice 'pg_net not available: phone notifications are off'; end $$;

-- ---------- Tables ----------
create table if not exists people (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 40),
  domain text not null,
  skill text not null default '' check (char_length(skill) <= 80),
  link text not null default '' check (char_length(link) <= 200),
  avatar text not null default '' check (char_length(avatar) <= 500),
  phone text not null default '' check (phone = '' or phone ~ '^\+?[0-9]{10,13}$'),  -- WhatsApp, required by save_profile; organisers only
  email text not null default '',
  created_at timestamptz not null default now()
);

create sequence if not exists team_no_seq;
create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 40),
  leader_id uuid not null references people(id) on delete cascade,
  complete boolean not null default false,  -- no longer used (teams are "ready" at bd_min() people)
  size int not null default 0,              -- kept up to date by a trigger on members
  skills text[] not null default '{}',      -- skills in the team (trigger on members)
  created_at timestamptz not null default clock_timestamp()
);
-- session_link / session_link_at: no longer used (kept so old data still loads)
alter table teams add column if not exists session_link text not null default '' check (char_length(session_link) <= 300);
alter table teams add column if not exists session_link_at timestamptz;
alter table teams add column if not exists removals int not null default 0;  -- no longer used
-- the secret code in the team link (…/#join=CODE). Only members and organisers see it.
alter table teams add column if not exists code text;
create unique index if not exists teams_code_unique on teams (code);
-- open = the leader lets students without a team join (they pick it from a list while registering)
alter table teams add column if not exists open boolean not null default false;
create index if not exists teams_open_list_idx on teams (size desc, created_at) where open;
-- "Team is full": the leader closes the team to new members (closed), and/or picks the team size they want
-- (cap, 2 to bd_max(); null = bd_max()). Then the team link says "Team is full" and nobody new can join.
-- Teammates the leader added keep their spot. A team that drops under bd_min() people opens again by itself.
alter table teams add column if not exists closed boolean not null default false;
alter table teams add column if not exists cap int check (cap is null or cap between 2 and 5);
-- After the team lock: a team the organisers reopened (panel → Teams → "Teams of 2: open to new members").
-- It can still take people with its team link and the leader can add teammates, up to bd_max(); nothing else unlocks.
alter table teams add column if not exists late_open boolean not null default false;
alter table people add column if not exists consent_at timestamptz;          -- when they confirmed they're a TuteDude student
create unique index if not exists teams_name_unique on teams (lower(name));
-- When a student watched the video and agreed to discuss their product with their team on a TuteDude
-- session (required while registering, see save_profile).
alter table people add column if not exists session_ok_at timestamptz;
alter table people add column if not exists wa_ok_at timestamptz;   -- agreed to the WhatsApp rules (asked before the first WhatsApp button opens)
-- (session links were dropped: TuteDude rooms are created inside TuteDude, there is no link to paste)
drop index if exists teams_session_unique;
drop index if exists teams_open_idx;   -- were for automatic placement
drop index if exists teams_done_idx;
create index if not exists teams_leader_idx on teams (leader_id);

-- person_id is the primary key, so a person can only ever be in one team
create table if not exists members (
  person_id uuid primary key references people(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  joined_at timestamptz not null default clock_timestamp()
);
create index if not exists members_team_idx on members (team_id);

-- teammates the leader added by name + email (no account yet). They count towards the team size.
create table if not exists team_listed (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 40),
  email text not null check (email = lower(email) and char_length(email) <= 120),
  created_at timestamptz not null default clock_timestamp()
);
create unique index if not exists team_listed_email_unique on team_listed (email);
create index if not exists team_listed_team_idx on team_listed (team_id);

-- team changes per person (create / join / leave), to stop join-leave loops that spam a team with notifications
create table if not exists bd_moves (
  person_id uuid not null references people(id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists bd_moves_idx on bd_moves (person_id, at);
alter table people add column if not exists reclaimed_at timestamptz;   -- last time the registration moved device
-- TuteDude student check: true = TuteDude's API confirmed the email, false = it said no (found by an organiser
-- re-check), null = it couldn't be checked yet (API down, slow or rate-limited: organisers can re-check later)
alter table people add column if not exists tutedude_ok boolean;
alter table team_listed add column if not exists tutedude_ok boolean;
-- the WhatsApp number the leader gave for an added teammate (teammates see it, like every member's number)
alter table team_listed add column if not exists phone text not null default '';
do $$ begin alter table team_listed add constraint team_listed_phone_ok check (phone = '' or phone ~ '^[0-9]{11,13}$');
exception when duplicate_object then null; end $$;
create index if not exists team_listed_phone_idx on team_listed (phone) where phone <> '';
-- answers from TuteDude's API, so one email isn't asked twice (and the API's rate limit lasts longer)
create table if not exists bd_email_checks (
  email text primary key,
  is_student boolean not null,
  checked_at timestamptz not null default now()
);
-- live "is this email on TuteDude?" checks from the form, per account (a rate limit)
create table if not exists bd_lookups (
  user_id uuid not null,
  at timestamptz not null default now()
);
create index if not exists bd_lookups_idx on bd_lookups (user_id, at);
-- one project per team, submitted once by the leader (an organiser can remove it so the team can submit again)
create table if not exists submissions (
  team_id uuid primary key references teams(id) on delete cascade,
  title text not null,
  summary text not null,
  product_url text not null,
  site_url text not null default '',
  video_url text not null default '',
  submitted_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists people_phone_full_idx on people (phone);
create index if not exists people_created_idx on people (created_at);
create index if not exists team_listed_created_idx on team_listed (created_at);
create index if not exists people_phone_idx on people (right(phone, 10));
create index if not exists people_email_idx on people (lower(email));

-- keep teams.size (registered members + teammates the leader added) and teams.skills in step
create or replace function bd_team_counts() returns trigger
language plpgsql security definer set search_path = public as $$
declare tid uuid := coalesce(new.team_id, old.team_id);
begin
  update teams t set size = x.n + x.l, skills = x.s, closed = t.closed and x.n + x.l >= bd_min()   -- under bd_min(): open again
  from (select count(*)::int as n, coalesce(array_agg(p.domain), '{}') as s,
               (select count(*)::int from team_listed l where l.team_id = tid) as l
        from members m join people p on p.id = m.person_id where m.team_id = tid) x
  where t.id = tid;
  return null;
end $$;
drop trigger if exists bd_members_counts on members;
create trigger bd_members_counts after insert or delete on members for each row execute function bd_team_counts();
drop trigger if exists bd_listed_counts on team_listed;
create trigger bd_listed_counts after insert or delete on team_listed for each row execute function bd_team_counts();
create or replace function bd_person_skill() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update teams t set skills = coalesce((select array_agg(p.domain) from members m join people p on p.id = m.person_id where m.team_id = t.id), '{}')
  where t.id = (select team_id from members where person_id = new.id);
  return null;
end $$;
drop trigger if exists bd_person_skill on people;
create trigger bd_person_skill after update of domain on people for each row when (old.domain is distinct from new.domain) execute function bd_person_skill();

create table if not exists messages (
  id bigint generated always as identity primary key,
  team_id uuid not null references teams(id) on delete cascade,
  person_id uuid references people(id) on delete set null,
  kind text not null default 'text' check (kind in ('text', 'system')),
  body text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now()
);
create index if not exists messages_team_idx on messages (team_id, id);

create table if not exists notifications (
  id bigint generated always as identity primary key,
  person_id uuid not null references people(id) on delete cascade,
  title text not null,
  body text not null default '',
  tag text not null default '',
  url text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists notifications_person_idx on notifications (person_id, id);

create table if not exists push_subs (
  endpoint text primary key,
  person_id uuid not null references people(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subs_person_idx on push_subs (person_id);        -- checked on every notification
create index if not exists messages_person_idx on messages (person_id) where person_id is not null;

-- notify_url / notify_secret for phone notifications (see README)
create table if not exists bd_settings (key text primary key, value text not null default '');

alter table people enable row level security;
alter table teams enable row level security;
alter table members enable row level security;
alter table messages enable row level security;
alter table notifications enable row level security;
alter table push_subs enable row level security;
alter table bd_settings enable row level security;
alter table team_listed enable row level security;
alter table bd_moves enable row level security;
alter table bd_email_checks enable row level security;
alter table bd_lookups enable row level security;
alter table submissions enable row level security;

-- ---------- Internal helpers ----------
create or replace function bd_me() returns uuid
language plpgsql stable as $$
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  return auth.uid();
end $$;

-- The browser keeps its sign-in token for up to an hour after the account is deleted (an organiser
-- removed it, or the data was reset). Saving with that token would fail deep inside with a foreign-key
-- error, so stop early with a message the site recognises: it signs in again and retries once.
create or replace function bd_account_ok(p_uid uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from auth.users where id = p_uid) then
    raise exception 'Your sign-in has expired. Refresh the page and try again.';
  end if;
end $$;

-- ---------- TuteDude student check ----------
-- TuteDude's API: POST {"email": "..."} → {"data": {"exists": true|false}}. The URL lives in bd_settings
-- (key tutedude_check_url), so it can change without touching this file. Needs Supabase's "http" extension.
do $$ begin create extension if not exists http with schema extensions;
exception when others then raise notice 'http extension not available: the TuteDude student check is off (everyone is "not checked")'; end $$;
insert into bd_settings (key, value) values ('tutedude_check_url', 'https://baby.tutedude.com/api/auth/check-email') on conflict (key) do nothing;

-- one web request to TuteDude: true / false, or null when it can't tell (no URL, no extension, slow, down,
-- rate-limited). After a failure it waits a few minutes before trying again, so nobody waits on a dead API.
create or replace function bd_tutedude_api(p_email text) returns boolean
language plpgsql volatile security definer set search_path = public, extensions as $$
declare u text := (select value from bd_settings where key = 'tutedude_check_url'); st int; body text; j jsonb;
begin
  if coalesce(u, '') = '' or not exists (select 1 from pg_extension where extname = 'http') then return null; end if;
  if coalesce((select value from bd_settings where key = 'tutedude_backoff_until'), '') > now()::text then return null; end if;
  begin
    execute 'select extensions.http_set_curlopt(''CURLOPT_TIMEOUT_MS'', ''1500'')';
    execute 'select status, content from extensions.http_post($1, $2, ''application/json'')' into st, body
      using u, json_build_object('email', p_email)::text;
  exception when others then
    st := 0;
  end;
  if st is distinct from 200 then
    -- rate-limited (429), down or too slow: stop asking for a while (5 minutes after a 429, else 2)
    insert into bd_settings (key, value) values ('tutedude_backoff_until', (now() + case when st = 429 then interval '5 minutes' else interval '2 minutes' end)::text)
      on conflict (key) do update set value = excluded.value;
    raise warning 'TuteDude check: HTTP %', st;
    return null;
  end if;
  begin j := body::jsonb; exception when others then return null; end;
  if jsonb_typeof(j #> '{data,exists}') = 'boolean' then return (j #>> '{data,exists}')::boolean; end if;
  return null;
end $$;

-- is this a TuteDude student's email? Cached: "yes" for 30 days, "no" for 10 minutes (they may sign up meanwhile).
create or replace function bd_is_student(p_email text) returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare em text := lower(trim(coalesce(p_email, ''))); c bd_email_checks; r boolean;
begin
  select * into c from bd_email_checks where email = em;
  if found and (c.is_student and c.checked_at > now() - interval '30 days' or not c.is_student and c.checked_at > now() - interval '10 minutes') then
    return c.is_student;
  end if;
  r := bd_tutedude_api(em);
  if r is not null then
    insert into bd_email_checks (email, is_student, checked_at) values (em, r, now())
      on conflict (email) do update set is_student = excluded.is_student, checked_at = excluded.checked_at;
  end if;
  return r;
end $$;

-- The form asks this while an email is being typed: true = on TuteDude, false = not, null = can't tell right
-- now (not a valid email, TuteDude's API is busy, or this account asked too often). It says nothing more than
-- TuteDude's own public API does, and each account gets 30 questions per 10 minutes.
create or replace function check_student(p_email text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := bd_me(); em text := lower(trim(coalesce(p_email, '')));
begin
  if not bd_email_ok(em) then return json_build_object('student', null); end if;
  delete from bd_lookups where at < now() - interval '1 hour';
  if (select count(*) from bd_lookups l where l.user_id = uid and l.at > now() - interval '10 minutes') >= 30 then
    return json_build_object('student', null);
  end if;
  insert into bd_lookups (user_id) values (uid);
  return json_build_object('student', bd_is_student(em));
end $$;

-- at most 6 team changes (create / join / leave) per person per hour
create or replace function bd_move(p_person uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from bd_moves where person_id = p_person and at < now() - interval '1 day';
  if (select count(*) from bd_moves where person_id = p_person and at > now() - interval '1 hour') >= 6 then
    raise exception 'Too many team changes in a short time. Please try again in an hour.';
  end if;
  insert into bd_moves (person_id) values (p_person);
end $$;

create or replace function bd_open() returns void
language plpgsql stable as $$
begin
  if now() > bd_deadline() then raise exception 'Teams are locked now.'; end if;
end $$;
-- the same check for one team: after the lock, a team the organisers reopened (teams.late_open) can still add people
create or replace function bd_open_for(p_team uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if now() > bd_deadline() and not coalesce((select late_open from teams where id = p_team), false) then
    raise exception 'Teams are locked now.';
  end if;
end $$;
revoke all on function bd_open_for(uuid) from public, anon, authenticated;

-- WhatsApp numbers are stored as digits with country code: "09876543210", "+91 98765 43210", "+91 0987…" → "919876543210"
create or replace function bd_phone(p text) returns text
language sql immutable as $$
  select case when d ~ '^[0-9]{10}$' then '91' || d
              when d ~ '^910[6-9][0-9]{9}$' then '91' || substr(d, 4)
              else d end
  from (select ltrim(regexp_replace(left(coalesce(p, ''), 40), '[^0-9]', '', 'g'), '0') as d) x
$$;

-- emails: plain addresses only (no spaces, ?, & or =, so nothing can ride along in a mailto: link)
create or replace function bd_email_ok(em text) returns boolean
language sql immutable as $$
  select coalesce(em, '') ~ '^[A-Za-z0-9._%+''-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$' and char_length(em) <= 120
$$;

-- names and short texts: invisible characters removed (zero-width, direction marks), any kind of
-- whitespace (tabs, newlines, no-break spaces) turned into one space, ends trimmed
create or replace function bd_clean(t text) returns text
language sql immutable as $$
  select btrim(regexp_replace(regexp_replace(left(coalesce(t, ''), 500), '[­​-‏‪-‮⁠-⁤﻿]', '', 'g'),
                              '[\s  - 　]+', ' ', 'g'))
$$;
-- a person's name: 2 to 40 characters, at least one letter, and not pretending to be TuteDude / the organisers
create or replace function bd_person_name_ok(nm text) returns boolean
language sql immutable as $$
  select char_length(nm) between 2 and 40 and nm ~ '[[:alpha:]]'
     and translate(lower(regexp_replace(nm, '[^A-Za-z0-9@$]', '', 'g')), '0134578@$', 'oieastbas') !~ '(tutedude|official|organi[sz]er|moderator)'
$$;
create or replace function bd_phone_ok(ph text) returns boolean
language sql immutable as $$
  select ph ~ '^[0-9]{11,13}$' and (ph !~ '^91' or ph ~ '^91[6-9][0-9]{9}$')
$$;
-- Indian numbers need no country code; any other number must be typed with + (or 00) and its country code,
-- so an 11-digit typo isn't taken for a foreign number
create or replace function bd_phone_typed_ok(raw text, ph text) returns boolean
language sql immutable as $$
  select bd_phone_ok(ph) and (ph ~ '^91' or coalesce(raw, '') ~ '^\s*(\+|00)')
$$;

-- team names: Latin letters, digits, Devanagari and simple punctuation only (no look-alike letters from
-- other alphabets), no impersonation (also spelled with spaces, dashes or 0/1/3 for o/i/e), no abuse
create or replace function bd_team_name_ok(nm text) returns boolean
language sql immutable as $$
  select nm ~ '^[A-Za-z0-9ऀ-ॿ .,''&!?()+_#@:/-]+$'
     and nm !~* '\m(official|admin|administrators?|organi[sz]ers?|moderators?)\M'
     and translate(lower(regexp_replace(nm, '[^A-Za-z0-9@$]', '', 'g')), '0134578@$', 'oieastbas') !~ '(tutedude|official)'
     and nm !~* '\m(fuck|shit|bitch|chutiy|chutia|madarchod|bhenchod|behenchod|bsdk|randi|gandu|lund|lauda|loda|harami)'
$$;

-- the caller's team (used by the read policies below, so it must stay callable)
create or replace function bd_my_team() returns uuid
language sql stable security definer set search_path = public as $$
  select team_id from members where person_id = auth.uid()
$$;

create or replace function bd_notify(p_person uuid, p_title text, p_body text, p_tag text) returns void
language sql security definer set search_path = public as $$
  insert into notifications (person_id, title, body, tag, url) values (p_person, left(p_title, 80), left(p_body, 140), p_tag, '#board');
$$;

create or replace function bd_notify_team(p_team uuid, p_except uuid, p_title text, p_body text, p_tag text) returns void
language sql security definer set search_path = public as $$
  insert into notifications (person_id, title, body, tag, url)
  select m.person_id, left(p_title, 80), left(p_body, 140), p_tag, '#board'
  from members m where m.team_id = p_team and m.person_id is distinct from p_except;
$$;

create or replace function bd_say(p_team uuid, p_text text) returns void
language sql security definer set search_path = public as $$
  insert into messages (team_id, person_id, kind, body) values (p_team, null, 'system', left(p_text, 300));
$$;

-- Team codes: 8 characters from 32 easy-to-read ones (no I, O, 0, 1), from a random UUID, so nobody can guess
-- another team's code (32^8 ≈ a trillion codes). Shown as ABCD-EFGH; typed with or without the dash.
create or replace function bd_new_code() returns text
language plpgsql volatile set search_path = public as $$
declare abc constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; b bytea; c text; i int;
begin
  loop
    b := uuid_send(gen_random_uuid());   -- bytes 0-5 and 9-15 of a v4 UUID are fully random
    c := '';
    foreach i in array array[0, 1, 2, 3, 4, 5, 9, 10] loop
      c := c || substr(abc, (get_byte(b, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from teams where code = c);
  end loop;
  return c;
end $$;
create or replace function bd_code_clean(p text) returns text
language sql immutable as $$
  select upper(regexp_replace(left(coalesce(p, ''), 200), '[^A-Za-z0-9]', '', 'g'))
$$;
-- teams made before codes existed get one
do $$ declare t record; begin
  for t in select id from teams where code is null loop update teams set code = bd_new_code() where id = t.id; end loop;
end $$;
alter table teams alter column code set not null;

-- old automatic placement (students bring their own team now)
drop function if exists admin_place_solos();
drop function if exists ensure_team();
drop function if exists complete_team();
drop function if exists open_teams(text);
drop function if exists bd_assign(uuid, uuid);
drop function if exists bd_join(uuid, uuid);
drop function if exists bd_complete(uuid);
drop function if exists agree_session();

-- sends each new notification to the person's phone/laptop through the push function (push-server/api/notify.js
-- on Vercel, or the "notify" Edge Function): the notification plus that person's devices
create or replace function bd_send_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare u text; s text; subs jsonb;
begin
  select value into u from bd_settings where key = 'notify_url';
  select value into s from bd_settings where key = 'notify_secret';
  if coalesce(u, '') = '' then return new; end if;
  select jsonb_agg(jsonb_build_object('endpoint', endpoint, 'p256dh', p256dh, 'auth', auth)) into subs from push_subs where person_id = new.person_id;
  if subs is null then return new; end if;   -- this person has not turned notifications on
  begin
    perform net.http_post(
      url := u,
      body := jsonb_build_object('record', to_jsonb(new), 'subs', subs),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', coalesce(s, '')),
      timeout_milliseconds := 10000);
  exception when others then
    raise warning 'push not sent: %', sqlerrm;
  end;
  return new;
end $$;

-- the push function answers {"sent": n, "gone": [endpoints]}: forget the devices that unsubscribed (run by pg_cron)
create or replace function bd_push_clean() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  delete from push_subs where endpoint in (
    select jsonb_array_elements_text((r.content::jsonb) -> 'gone') from net._http_response r
    where r.status_code = 200 and r.content like '{"sent":%' and r.content like '%"gone":["%');
  get diagnostics n = row_count;
  return n;
exception when others then
  raise warning 'push clean-up skipped: %', sqlerrm;
  return 0;
end $$;
revoke all on function bd_push_clean() from public, anon, authenticated;
drop trigger if exists bd_push on notifications;
create trigger bd_push after insert on notifications for each row execute function bd_send_push();

-- ---------- Live updates (Supabase Realtime "Broadcast", built for many users) ----------
-- new notification → "user:<id>" channel (only that person can listen)
drop trigger if exists bd_message_live on messages;
drop function if exists bd_broadcast_message();

create or replace function bd_broadcast_note() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform realtime.send(jsonb_build_object('title', new.title, 'body', new.body, 'tag', new.tag), 'note', 'user:' || new.person_id::text, true);
  exception when others then null;
  end;
  return null;
end $$;
drop trigger if exists bd_note_live on notifications;
create trigger bd_note_live after insert on notifications for each row execute function bd_broadcast_note();

-- who may listen to which private channel
do $$ begin
  if exists (select 1 from pg_tables where schemaname = 'realtime' and tablename = 'messages') then
    execute 'drop policy if exists "buildathon: listen to own channels" on realtime.messages';
    execute $p$create policy "buildathon: listen to own channels" on realtime.messages for select to authenticated
      using (realtime.topic() = 'user:' || auth.uid()::text)$p$;
  else
    raise notice 'realtime schema not found: live updates off (the page still refreshes on its own)';
  end if;
end $$;

-- ---------- Read: public numbers only (no names, no phone numbers, no emails) ----------
-- No team counts either (organisers keep those private): just how many people registered.
drop function if exists bd_team_json(teams);
create or replace function get_board() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'stats', json_build_object(
      'people', (select count(*) from people) + (select count(*) from team_listed),
      'today', (select count(*) from people where created_at > now() - interval '24 hours')
             + (select count(*) from team_listed where created_at > now() - interval '24 hours'))
  );
$$;

-- ---------- Read: my profile and my team ----------
create or replace function get_me() returns json
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); tid uuid;
begin
  if uid is null then return json_build_object('me', null); end if;
  select team_id into tid from members where person_id = uid;
  return json_build_object(
    'me', (select json_build_object('id', id, 'name', name, 'domain', domain, 'skill', skill, 'link', link, 'avatar', avatar, 'phone', phone, 'email', email,
                                    'sessionOk', session_ok_at is not null, 'waOk', wa_ok_at is not null) from people where id = uid),
    'team', case when tid is null then null else (
      select json_build_object('id', t.id, 'name', t.name, 'leaderId', t.leader_id, 'code', t.code, 'open', t.open,
        'closed', t.closed, 'cap', coalesce(t.cap, bd_max()), 'lateOpen', t.late_open and now() > bd_deadline(),
        -- the problem statement: from bd_reveal(), for teams of bd_min()+ people (organisers put the
        -- text/link in bd_settings)
        'problem', case when now() >= bd_reveal() and t.size >= bd_min() then json_build_object(
                     'text', coalesce((select value from bd_settings where key = 'problem_statement'), ''),
                     'link', coalesce((select value from bd_settings where key = 'problem_link'), '')) end,
        -- the project the leader submitted (null until then)
        'submission', (select json_build_object('title', s.title, 'summary', s.summary, 'product', s.product_url, 'site', s.site_url, 'video', s.video_url,
                                                'at', (extract(epoch from s.created_at) * 1000)::bigint) from submissions s where s.team_id = t.id),
        -- teammates' WhatsApp numbers: only for members of this same team
        'members', (select json_agg(json_build_object('id', p.id, 'name', p.name, 'domain', p.domain, 'skill', p.skill, 'link', p.link, 'avatar', p.avatar,
                                                      'phone', p.phone, 'joinedAt', (extract(epoch from m.joined_at) * 1000)::bigint) order by m.joined_at)
                      from members m join people p on p.id = m.person_id where m.team_id = t.id),
        -- teammates the leader added who haven't opened the team link yet (emails: leader only)
        'listed', coalesce((select json_agg(json_build_object('id', l.id, 'name', l.name, 'phone', l.phone, 'email', case when t.leader_id = uid then l.email else '' end)
                                            order by l.created_at) from team_listed l where l.team_id = t.id), '[]'::json))
      from teams t where t.id = tid) end
  );
end $$;

-- ---------- Team link: which team a code belongs to (before registering) ----------
-- Only the team name, the leader's first name and how full it is. Unknown code → null.
create or replace function get_team_by_code(p_code text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('name', t.name, 'size', t.size, 'max', coalesce(t.cap, bd_max()),
                           'full', t.closed or t.size >= coalesce(t.cap, bd_max()), 'closed', t.closed,
                           -- spots held for teammates the leader added (they can still join a full team with their email)
                           'reserved', (select count(*) from team_listed l where l.team_id = t.id),
                           'leader', split_part(p.name, ' ', 1), 'locked', now() > bd_deadline() and not t.late_open, 'lateOpen', t.late_open)
  from teams t join people p on p.id = t.leader_id
  where t.code = bd_code_clean(p_code) and char_length(bd_code_clean(p_code)) = 8;
$$;

-- ---------- No team yet: teams that welcome new members (names and skills only) ----------
-- Teams missing the caller's skill come first, the rest in random order (so students spread out instead of
-- all rushing the same team). No counts of all teams.
create or replace function get_open_teams(p_domain text default '') returns json
language sql volatile security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', x.id, 'name', x.name, 'size', x.size, 'max', bd_max(), 'skills', x.skills,
                                             'leader', x.leader) order by x.rk, x.rnd), '[]'::json)
  from (select t.id, t.name, t.size, t.skills, t.created_at, split_part(p.name, ' ', 1) as leader,
               case when coalesce(p_domain, '') <> '' and p_domain = any(t.skills) then 1 else 0 end as rk, random() as rnd
        from teams t join people p on p.id = t.leader_id
        where t.open and not t.closed and t.size < coalesce(t.cap, bd_max()) and now() <= bd_deadline()
        order by rk, rnd limit 50) x;
$$;

-- ---------- Register (create a team, or join one) / edit profile ----------
-- New registration: p_team_name creates a team (you're the leader; p_open = welcome students without a
-- team; p_members = up to 3 teammates [{name, email, phone}]), p_code joins the team with that code, or
-- p_team joins an open team picked from get_open_teams.
-- Someone registered but without a team (they left, or were removed) uses the same call to get one.
-- Already in a team: just saves the profile (team arguments are ignored).
-- p_consent = "I'm a TuteDude student"; p_session_ok = watched the video and agreed to TuteDude Sessions.
-- p_dry_run: run every check (except the video consent) and change nothing, so the form can show a problem
-- before the 1-minute video instead of after it. Returns {"ok": true}.
-- Someone registered but without a team, sending no team arguments, just edits their profile.
-- Returns {"team": "<name>", "code": "<code>", "created": true|false|null}.
drop function if exists save_profile(text, text, text, text, text);
drop function if exists save_profile(text, text, text, text, text, text, uuid);
drop function if exists save_profile(text, text, text, text, text, text, uuid, boolean);
drop function if exists save_profile(text, text, text, text, text, text, text, text, boolean, boolean);
drop function if exists save_profile(text, text, text, text, text, text, text, text, uuid, boolean, boolean, boolean);
drop function if exists save_profile(text, text, text, text, text, text, text, text, uuid, boolean, boolean, boolean, json);
create or replace function save_profile(p_name text, p_domain text, p_phone text, p_email text,
                                        p_skill text default '', p_link text default '',
                                        p_team_name text default '', p_code text default '', p_team uuid default null,
                                        p_open boolean default false,
                                        p_consent boolean default false, p_session_ok boolean default false,
                                        p_members json default '[]'::json, p_dry_run boolean default false) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := bd_me(); tid uuid; tname text; tsize int; tfull boolean; created boolean; is_new boolean; agreed boolean;
        student boolean; mate_ok jsonb := '{}'::jsonb; bad_mate text; bad text[] := '{}'; bad_msg text; mp text;
        listed_in uuid; listed_name text; claim boolean := false; mates json := coalesce(p_members, '[]'::json); mt json; mn text; me text;
        ph text := bd_phone(p_phone); lk text := trim(coalesce(p_link, ''));
        em text := lower(trim(coalesce(p_email, ''))); cd text := bd_code_clean(p_code);
        nm text := bd_clean(p_name); sk text := bd_clean(p_skill); tn text := bd_clean(p_team_name);
begin
  if char_length(nm) < 2 or nm !~ '[[:alpha:]]' then raise exception 'Please write your name.'; end if;
  if char_length(nm) > 40 then raise exception 'Keep your name under 40 characters.'; end if;
  if not bd_person_name_ok(nm) then raise exception 'Please write your own name.'; end if;
  if p_domain is null or not p_domain = any(bd_domains()) then raise exception 'Pick what you do.'; end if;
  if not bd_phone_typed_ok(p_phone, ph) then raise exception 'Please write your 10-digit WhatsApp number (or the full number with + and the country code).'; end if;
  if not bd_email_ok(em) then raise exception 'Please write a valid email address.'; end if;
  if char_length(sk) > 80 then raise exception 'Keep the line about you under 80 characters.'; end if;
  -- TuteDude student check, before the team lock (it asks TuteDude's API over the internet).
  -- Only for a new registration or a changed email; teammates the leader adds are checked too.
  if (select lower(email) from people where id = uid) is distinct from em then
    student := bd_is_student(em);
    if student = false then bad := bad || em; end if;
  else
    student := (select tutedude_ok from people where id = uid);
  end if;
  if coalesce(trim(p_team_name), '') <> '' and json_typeof(mates) = 'array' and json_array_length(mates) between 1 and 3 then
    for mt in select * from json_array_elements(mates) loop
      me := lower(trim(coalesce(mt->>'email', '')));
      if bd_email_ok(me) and not mate_ok ? me then
        mate_ok := mate_ok || jsonb_build_object(me, bd_is_student(me));
        if mate_ok->>me = 'false' then
          bad := bad || me;
          if bad_mate is null then bad_mate := coalesce(nullif(bd_clean(mt->>'name'), ''), me) || ' (' || me || ')'; end if;
        end if;
      end if;
    end loop;
  end if;
  -- every email that isn't on TuteDude, all at once (the form marks each one in red)
  if cardinality(bad) > 0 then
    bad_msg := case
      when cardinality(bad) = 1 and bad[1] = em then 'This email isn''t on TuteDude. Use the email you use for your TuteDude courses.'
      when cardinality(bad) = 1 then bad_mate || ' isn''t on TuteDude. Use the email your teammate uses for TuteDude.'
      else cardinality(bad) || ' emails aren''t on TuteDude (marked in red): ' || array_to_string(bad, ', ') || '. Use the emails from your TuteDude accounts.' end;
    if coalesce(p_dry_run, false) then   -- an answer, not an error, so the "no"s are remembered
      return json_build_object('ok', false, 'error', bad_msg, 'badEmails', to_json(bad));
    end if;
    raise exception '%', bad_msg;
  end if;
  if lk <> '' and (lk !~* '^https?://\S+$' or char_length(lk) > 200) then raise exception 'Paste the full link, starting with https://'; end if;
  -- one lock for everything that changes teams, always taken first (no deadlocks), so "check, then
  -- insert" is safe when a whole team registers at the same moment
  perform pg_advisory_xact_lock(7231001);
  perform bd_account_ok(uid);
  is_new := not exists (select 1 from people where id = uid);
  if is_new and not coalesce(p_consent, false) then raise exception 'Please confirm you''re a TuteDude student.'; end if;
  -- one registration per WhatsApp number and per email, so one person can't take two seats
  -- (one message for both, so the form can't be used to check who registered)
  if exists (select 1 from people where id <> uid and (phone = ph or lower(email) = em)) then
    if is_new then
      raise exception 'This WhatsApp number or email is already registered. Open the site on the phone or browser you registered with, or tap "Get back to your team".';
    end if;
    raise exception 'That WhatsApp number or email is already used by another registration.';
  end if;
  select team_id into tid from members where person_id = uid;
  -- profile edits are allowed after the lock (to fix a typo); team changes are not
  -- after the lock, only one thing: joining a team the organisers reopened, with its team link
  if tid is null and (is_new or cd <> '' or p_team is not null or tn <> '') then
    if cd <> '' and tn = '' and p_team is null then perform bd_open_for((select id from teams where code = cd));
    else perform bd_open(); end if;
  end if;
  agreed := coalesce((select session_ok_at is not null from people where id = uid), false) or coalesce(p_session_ok, false);
  -- a leader may have added this email to their team already: then that team is the only one they can join
  select team_id into listed_in from team_listed where email = em;
  if listed_in is not null and tid is not null then raise exception 'That email was added to a team as a teammate. Use your own email.'; end if;

  if tid is null and (is_new or cd <> '' or p_team is not null or tn <> '') then
    -- registering (or getting a team again): create one or join one
    if not agreed and not coalesce(p_dry_run, false) then raise exception 'Watch the TuteDude Sessions video and agree to it first.'; end if;
    if cd <> '' then
      select t.id, t.name, t.size, t.closed or t.size >= coalesce(t.cap, bd_max()) into tid, tname, tsize, tfull from teams t where t.code = cd;
      if tid is null then raise exception 'That team link doesn''t work. Ask your team leader to send it again.'; end if;
      claim := coalesce(listed_in = tid, false);   -- the leader added me: my spot is waiting
      if tfull and not claim then raise exception '% is full and isn''t taking new members. Ask your leader, or create your own team.', tname; end if;
      created := false;
    elsif p_team is not null then
      select t.id, t.name, t.size, t.closed or t.size >= coalesce(t.cap, bd_max()) into tid, tname, tsize, tfull from teams t where t.id = p_team and t.open;
      if tid is null then raise exception 'That team isn''t taking new members any more. Pick another team.'; end if;
      claim := coalesce(listed_in = tid, false);
      if tfull and not claim then raise exception '% filled up a moment ago. Pick another team.', tname; end if;
      created := false;
    elsif tn <> '' then
      if char_length(tn) not between 2 and 40 then raise exception 'Give your team a name (2 to 40 letters).'; end if;
      if not bd_team_name_ok(tn) then raise exception 'Please pick a different team name.'; end if;
      if exists (select 1 from teams where lower(name) = lower(tn)) then raise exception 'That team name is taken. Try another one.'; end if;
      created := true;
    else
      raise exception 'Create a team, or join your team with the link your leader sent.';
    end if;
    -- the owner of an email decides: a team that added them, but which they don't join, loses that spot
    if listed_in is not null and listed_in is distinct from tid and not coalesce(p_dry_run, false) then
      delete from team_listed where email = em returning name into listed_name;
      perform bd_say(listed_in, listed_name || ' registered with another team, so they were taken off this one.');
      perform bd_notify(t.leader_id, 'Team update', listed_name || ' registered with another team, so they were taken off ' || t.name || '.', 'team-' || listed_in)
        from teams t where t.id = listed_in;
    end if;
    -- teammates added by name + email (only when creating a team)
    if created then
      if json_typeof(mates) <> 'array' then raise exception 'Something went wrong with the teammates. Try again.'; end if;
      if json_array_length(mates) > bd_max() - 1 then raise exception 'A team has at most % people, including you.', bd_max(); end if;
      for mt in select * from json_array_elements(mates) loop
        mn := bd_clean(mt->>'name'); me := lower(trim(coalesce(mt->>'email', '')));
        if char_length(mn) not between 2 and 40 or mn !~ '[[:alpha:]]' then raise exception 'Write each teammate''s name (2 to 40 letters).'; end if;
        if not bd_person_name_ok(mn) then raise exception 'Write your teammate''s real name.'; end if;
        if not bd_email_ok(me) then raise exception 'Check the email address for %.', mn; end if;
        if me = em then raise exception 'Add your teammates'' emails, not your own.'; end if;
        if (select count(*) from json_array_elements(mates) x where lower(trim(coalesce(x->>'email', ''))) = me) > 1 then raise exception '% is added twice.', me; end if;
        if exists (select 1 from people where lower(email) = me) or exists (select 1 from team_listed where email = me) then
          raise exception '% (%) is already registered or in a team. Create the team without them and send them your team link.', mn, me;
        end if;
        mp := bd_phone(mt->>'phone');   -- optional: the form no longer asks for it
        if mp <> '' then
          if not bd_phone_typed_ok(mt->>'phone', mp) then raise exception 'Check the WhatsApp number of % (10 digits).', mn; end if;
          if mp = ph then raise exception 'Add your teammates'' WhatsApp numbers, not your own.'; end if;
          if (select count(*) from json_array_elements(mates) x where bd_phone(x->>'phone') = mp) > 1 then raise exception 'The same WhatsApp number is added twice.'; end if;
          if exists (select 1 from people where phone = mp) or exists (select 1 from team_listed where phone = mp) then
            raise exception '% (WhatsApp %) is already registered or in a team. Create the team without them and send them your team link.', mn, '+' || mp;
          end if;
        end if;
      end loop;
    end if;
  end if;
  if coalesce(p_dry_run, false) then return json_build_object('ok', true); end if;

  insert into people (id, name, domain, skill, link, phone, avatar, email, consent_at, session_ok_at, tutedude_ok)
  select uid, nm, p_domain, sk, lk, ph,
         -- only real Google profile photos (anyone can set their own metadata, so no other URLs)
         case when coalesce(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture', '') ~ '^https://lh[0-9]+\.googleusercontent\.com/'
              then left(coalesce(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture'), 500) else '' end,
         em, now(), case when agreed then now() end, student
  from auth.users u where u.id = uid
  on conflict (id) do update set name = excluded.name, domain = excluded.domain, skill = excluded.skill,
    link = excluded.link, phone = excluded.phone, avatar = excluded.avatar, email = excluded.email,
    session_ok_at = coalesce(people.session_ok_at, excluded.session_ok_at), tutedude_ok = excluded.tutedude_ok;

  if created is not null then perform bd_move(uid); end if;   -- create / join: at most 6 team changes an hour
  if created then
    insert into teams (name, leader_id, code, open) values (tn, uid, bd_new_code(), coalesce(p_open, false)) returning id, name into tid, tname;
    insert into members (person_id, team_id) values (uid, tid);
    perform bd_say(tid, nm || bd_tag(p_domain) || ' created the team.');
    insert into team_listed (team_id, name, email, phone, tutedude_ok)
      select tid, bd_clean(x->>'name'), lower(trim(x->>'email')), bd_phone(x->>'phone'), (mate_ok->>lower(trim(x->>'email')))::boolean from json_array_elements(mates) x;
    if json_array_length(mates) > 0 then
      perform bd_say(tid, nm || ' added ' || (select string_agg(bd_clean(x->>'name'), ', ') from json_array_elements(mates) x) || ' to the team.');
    end if;
  elsif created = false then
    if claim then delete from team_listed where team_id = tid and email = em; end if;
    insert into members (person_id, team_id) values (uid, tid);
    perform bd_say(tid, nm || bd_tag(p_domain) || ' joined the team 👋');
    perform bd_notify_team(tid, uid, tname || ': new teammate', nm || bd_tag(p_domain) || ' joined your team. Say hi on WhatsApp!', 'team-' || tid);
  end if;
  return (select json_build_object('team', t.name, 'code', t.code, 'created', created) from teams t where t.id = tid);
end $$;

-- Lost the browser session (new phone, iPhone home-screen app, cleared data)? Prove it's you with the
-- same WhatsApp number + email, and the registration moves to this device.
create or replace function reclaim_profile(p_phone text, p_email text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := bd_me(); old uuid; ph text := bd_phone(p_phone); em text := lower(trim(coalesce(p_email, '')));
begin
  perform pg_advisory_xact_lock(7231001);
  perform bd_account_ok(uid);
  if exists (select 1 from people where id = uid) then raise exception 'You are already registered on this device.'; end if;
  select id into old from people where phone <> '' and phone = ph and lower(email) = em and em <> '';
  if old is null then raise exception 'No registration found with that WhatsApp number and email. Check both, or register as new.'; end if;
  -- a registration can move device at most once every 10 minutes (stops two devices fighting over it)
  if (select reclaimed_at from people where id = old) > now() - interval '10 minutes' then
    raise exception 'This registration moved to another phone or browser a moment ago. Try again in 10 minutes.';
  end if;
  insert into people (id, name, domain, skill, link, phone, avatar, email, created_at, consent_at, session_ok_at, wa_ok_at, reclaimed_at)
    select uid, name, domain, skill, link, phone, avatar, email, created_at, consent_at, session_ok_at, wa_ok_at, now() from people where id = old;
  update members set person_id = uid where person_id = old;
  update teams set leader_id = uid where leader_id = old;
  update messages set person_id = uid where person_id = old;
  update notifications set person_id = uid where person_id = old;
  delete from push_subs where person_id = old;   -- belonged to the old device
  delete from people where id = old;
  -- the team hears about it, so a hijack doesn't go unnoticed
  perform bd_say(m.team_id, p.name || '''s registration moved to a new phone or browser.'),
          bd_notify_team(m.team_id, uid, 'Team update', p.name || ' opened the team on a new phone or browser.', 'team-' || m.team_id)
    from members m join people p on p.id = m.person_id where m.person_id = uid;
  return json_build_object('team', (select t.name from members m join teams t on t.id = m.team_id where m.person_id = uid));
end $$;

-- if an organiser deletes a person who leads a team, hand the team to the next member (don't wipe it)
create or replace function bd_before_person_delete() returns trigger
language plpgsql security definer set search_path = public as $$
declare t record; nxt uuid;
begin
  for t in select id from teams where leader_id = old.id loop
    -- join people: when several teammates are deleted in one go (Table Editor, Authentication → Users,
    -- "Start fresh"), the ones already deleted must not become the leader
    select m.person_id into nxt from members m join people p on p.id = m.person_id
      where m.team_id = t.id and m.person_id <> old.id order by m.joined_at limit 1;
    if nxt is null then delete from teams where id = t.id;
    else update teams set leader_id = nxt where id = t.id; end if;
  end loop;
  return old;
end $$;
drop trigger if exists bd_person_delete on people;
create trigger bd_person_delete before delete on people for each row execute function bd_before_person_delete();

-- ---------- Team actions ----------
create or replace function rename_team(p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := bd_me(); tid uuid; nm text := bd_clean(p_name);
begin
  perform bd_open();
  perform pg_advisory_xact_lock(7231001);  -- team names are checked under the same lock as team creation
  select id into tid from teams where leader_id = uid;
  if tid is null then raise exception 'Only the team leader can rename the team.'; end if;
  if char_length(nm) not between 2 and 40 then raise exception 'Give your team a name (2 to 40 letters).'; end if;
  if not bd_team_name_ok(nm) then raise exception 'Please pick a different team name.'; end if;
  if exists (select 1 from teams where lower(name) = lower(nm) and id <> tid) then raise exception 'That team name is taken. Try another one.'; end if;
  update teams set name = nm where id = tid;
  perform bd_say(tid, 'The team is now called ' || nm || '.');
end $$;

-- take someone out of their team (they stay registered, without a team). The leader passes to the
-- next member; a team nobody is left in is deleted. Used by leave_team, remove_member and admin_move.
create or replace function bd_take_out(p_person uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare tid uuid; nxt uuid;
begin
  delete from members where person_id = p_person returning team_id into tid;
  if tid is null then return null; end if;
  select person_id into nxt from members where team_id = tid order by joined_at limit 1;
  if nxt is null then delete from teams where id = tid; return null; end if;
  update teams set leader_id = nxt where id = tid and leader_id = p_person;
  return tid;
end $$;

-- leave my team (until teams lock). If I was the leader, the next teammate becomes leader.
-- how long after joining a team someone can still leave it (hours)
create or replace function bd_leave_hours() returns int language sql immutable as $$ select 24 $$;
create or replace function leave_team() returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := bd_me(); nm text; tid uuid; was_lead boolean; ja timestamptz; sz int; late boolean;
begin
  perform bd_open_for((select team_id from members where person_id = uid));   -- after the lock: only a reopened team
  perform pg_advisory_xact_lock(7231001);
  select p.name, m.team_id, t.leader_id = uid, m.joined_at, t.size, now() > bd_deadline() and t.late_open into nm, tid, was_lead, ja, sz, late
    from people p join members m on m.person_id = p.id join teams t on t.id = m.team_id where p.id = uid;
  if tid is null then return; end if;
  if late and exists (select 1 from submissions where team_id = tid) then
    raise exception 'Your team already submitted its project, so the team is final.';
  end if;
  -- leaving is for the first bd_leave_hours() hours after joining; someone alone in a team can always leave,
  -- and so can anyone in a team the organisers reopened after the lock
  if sz > 1 and not late and now() > ja + make_interval(hours => bd_leave_hours()) then
    raise exception 'You can leave a team only in the first % hours after joining. Need help? Message the organisers on the TuteDude Community.', bd_leave_hours();
  end if;
  perform bd_move(uid);
  tid := bd_take_out(uid);
  if tid is null then return; end if;  -- I was the only one: the team is gone
  perform bd_say(tid, nm || ' left the team.' || case when was_lead then ' ' || (select p.name from teams t join people p on p.id = t.leader_id where t.id = tid) || ' is the leader now.' else '' end);
  perform bd_notify_team(tid, null, 'Team update', nm || ' left your team.' || case when was_lead then ' ' || (select split_part(p.name, ' ', 1) from teams t join people p on p.id = t.leader_id where t.id = tid) || ' is the leader now.' else '' end, 'team-' || tid);
end $$;

-- the leader takes someone out (e.g. a stranger who got the link). They stay registered without a team.
create or replace function remove_member(p_person uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := bd_me(); tid uuid; tname text; pname text;
begin
  -- the leader can remove a teammate in any team, after the lock too (until the team submits)
  perform pg_advisory_xact_lock(7231001);  -- same lock as joins, taken first: no deadlocks
  select id, name into tid, tname from teams where leader_id = uid;
  if tid is null then raise exception 'Only the team leader can remove people.'; end if;
  if now() > bd_deadline() and exists (select 1 from submissions where team_id = tid) then
    raise exception 'Your team already submitted its project, so the team is final.';
  end if;
  if p_person = uid then raise exception 'You can''t remove yourself. Use "Leave team" instead.'; end if;
  if not exists (select 1 from members where person_id = p_person and team_id = tid) then return; end if;
  select name into pname from people where id = p_person;
  perform bd_take_out(p_person);
  perform bd_say(tid, pname || ' was removed by the leader.');
  perform bd_notify(p_person, 'Team update', 'You were removed from ' || tname || case when now() > bd_deadline()
    then '. You can join another team that is still open with its team link, or message the organisers.' else '. Join your team again with its link, or create a new team.' end, 'team-none');
end $$;

-- the leader makes a new team link (the old one stops working), e.g. if it was shared too widely
create or replace function reset_team_code() returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid := bd_me(); tid uuid; cd text;
begin
  perform bd_open();
  perform pg_advisory_xact_lock(7231001);
  select id into tid from teams where leader_id = uid;
  if tid is null then raise exception 'Only the team leader can make a new link.'; end if;
  cd := bd_new_code();
  update teams set code = cd where id = tid;
  perform bd_say(tid, 'The leader made a new team link. The old one no longer works.');
  return cd;
end $$;

-- the leader adds a teammate by name + email, WhatsApp optional (they can open the team link later to take their spot)
drop function if exists add_teammate(text, text);
create or replace function add_teammate(p_name text, p_email text, p_phone text default '') returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := bd_me(); tid uuid; tsize int; tcap int; mn text := bd_clean(p_name);
        me text := lower(trim(coalesce(p_email, ''))); ok boolean; mp text := bd_phone(p_phone);
begin
  perform bd_open_for((select id from teams where leader_id = uid));
  if not bd_email_ok(me) then raise exception 'Please write a valid email address.'; end if;
  if mp <> '' and not bd_phone_typed_ok(p_phone, mp) then raise exception 'Check your teammate''s WhatsApp number (10 digits).'; end if;
  ok := bd_is_student(me);   -- before the team lock: it asks TuteDude's API
  if ok = false then raise exception 'That email isn''t on TuteDude. Use the email your teammate uses for TuteDude.'; end if;
  perform pg_advisory_xact_lock(7231001);
  select id, size, coalesce(cap, bd_max()) into tid, tsize, tcap from teams where leader_id = uid;
  if tid is null then raise exception 'Only the team leader can add teammates.'; end if;
  if char_length(mn) not between 2 and 40 or mn !~ '[[:alpha:]]' then raise exception 'Write your teammate''s name (2 to 40 letters).'; end if;
  if not bd_person_name_ok(mn) then raise exception 'Write your teammate''s real name.'; end if;
  if not bd_email_ok(me) then raise exception 'Please write a valid email address.'; end if;
  if tsize >= bd_max() then raise exception 'Your team already has % people.', bd_max(); end if;
  if tsize >= tcap then raise exception 'You set your team size to % people. Pick a bigger team size first.', tcap; end if;
  if me = (select lower(email) from people where id = uid) then raise exception 'That''s your own email. Add your teammate''s email.'; end if;
  if exists (select 1 from people where lower(email) = me) or exists (select 1 from team_listed where email = me) then
    raise exception 'That email is already registered or in a team. Send them your team link instead.';
  end if;
  if mp <> '' then
    if mp = (select phone from people where id = uid) then raise exception 'That''s your own WhatsApp number. Add your teammate''s.'; end if;
    if exists (select 1 from people where phone = mp) or exists (select 1 from team_listed where phone = mp) then
      raise exception 'That WhatsApp number is already registered or in a team. Send them your team link instead.';
    end if;
  end if;
  insert into team_listed (team_id, name, email, phone, tutedude_ok) values (tid, mn, me, mp, ok);
  perform bd_say(tid, 'The leader added ' || mn || ' to the team.');
end $$;

create or replace function remove_teammate(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := bd_me(); tid uuid; mn text;
begin
  perform bd_open_for((select id from teams where leader_id = uid));
  perform pg_advisory_xact_lock(7231001);
  select id into tid from teams where leader_id = uid;
  if tid is null then raise exception 'Only the team leader can remove teammates.'; end if;
  delete from team_listed where id = p_id and team_id = tid returning name into mn;
  if mn is null then raise exception 'They already joined your team themselves. To take them out, use Remove next to their name in the member list.'; end if;
  perform bd_say(tid, 'The leader removed ' || mn || ' from the team.');
end $$;

-- the leader lets students without a team join (or stops it)
create or replace function set_team_open(p_open boolean) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := bd_me(); tid uuid;
begin
  perform bd_open();
  perform pg_advisory_xact_lock(7231001);
  select id into tid from teams where leader_id = uid;
  if tid is null then raise exception 'Only the team leader can change this.'; end if;
  update teams set open = coalesce(p_open, false) where id = tid and open is distinct from coalesce(p_open, false);
  if found then
    perform bd_say(tid, case when p_open then 'The leader opened the team to students without a team.' else 'The leader closed the team to new members (the team link still works).' end);
  end if;
end $$;

-- "Team is full": the leader closes the team to new members, or opens it again (before the team lock).
-- A team needs bd_min() people before it can close (else it could never take part).
create or replace function set_team_closed(p_closed boolean) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := bd_me(); tid uuid; tsize int; c boolean := coalesce(p_closed, false);
begin
  perform bd_open_for((select id from teams where leader_id = uid));
  perform pg_advisory_xact_lock(7231001);
  select id, size into tid, tsize from teams where leader_id = uid;
  if tid is null then raise exception 'Only the team leader can change this.'; end if;
  if c and tsize < bd_min() then raise exception 'A team needs at least % people to take part. Close it once your teammates have joined.', bd_min(); end if;
  update teams set closed = c where id = tid and closed is distinct from c;
  if found then
    perform bd_say(tid, case when c then 'The leader closed the team. The team link now says "Team is full" and nobody new can join.'
                             else 'The leader opened the team again. New members can join with the team link.' end);
  end if;
end $$;

-- the team size the leader wants (bd_min() to bd_max()): at that size the team link says "Team is full"
create or replace function set_team_cap(p_cap int) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := bd_me(); tid uuid; tsize int;
begin
  perform bd_open_for((select id from teams where leader_id = uid));
  if p_cap is null or p_cap not between bd_min() and bd_max() then raise exception 'Pick a team size from % to %.', bd_min(), bd_max(); end if;
  perform pg_advisory_xact_lock(7231001);
  select id, size into tid, tsize from teams where leader_id = uid;
  if tid is null then raise exception 'Only the team leader can change this.'; end if;
  if p_cap < tsize then raise exception 'Your team already has % people. Pick % or more.', tsize, tsize; end if;
  update teams set cap = nullif(p_cap, bd_max()) where id = tid and coalesce(cap, bd_max()) <> p_cap;
  if found then
    perform bd_say(tid, 'The leader set the team size to ' || p_cap || ' people. At ' || p_cap || ' the team link says "Team is full".');
  end if;
end $$;

-- old: "agree to TuteDude Sessions" after joining (now part of registering) and session links
drop function if exists set_session_link(text);
drop function if exists bd_session_link_ok(text);
drop function if exists bd_session_link_real(text);
drop function if exists bd_link_key(text);
drop function if exists bd_session_page();
drop function if exists bd_session_deadline();

-- reminder notifications (run on a schedule by pg_cron, see the bottom of this file)
create or replace function bd_remind(p_kind text) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; k int;
begin
  if p_kind = 'lock-soon' and now() not between bd_deadline() - interval '20 hours' and bd_deadline() then return 0; end if;
  -- 'solo': twice a day until the last day (that day the "teams lock tonight" reminders take over)
  if p_kind = 'solo' and now() >= bd_deadline() - interval '20 hours' then return 0; end if;
  if p_kind = 'reveal-soon' and now() not between bd_deadline() and bd_reveal() then return 0; end if;
  if p_kind = 'reveal-now' and now() not between bd_reveal() and bd_reveal() + interval '1 day' then return 0; end if;
  if p_kind = 'reveal-now' and coalesce((select value from bd_settings where key = 'problem_statement'), '') = '' then
    raise warning 'reveal-now: no problem statement saved yet, nothing sent';
    return 0;
  end if;
  perform pg_advisory_xact_lock(7231001);   -- nobody is deleted halfway through the send
  if p_kind = 'lock-soon' then
    -- teams with room left: get your teammates in before the lock (a team of 1 can't take part)
    insert into notifications (person_id, title, body, tag, url)
    select m.person_id, '⏳ Teams lock tonight at 11:59 PM',
           case when t.size < bd_min() then 'Only you are in ' || t.name || '. Send your team link, or open the team to students without one. Teams need ' || bd_min() || '+ people.'
                else t.name || ' has ' || t.size || '/' || coalesce(t.cap, bd_max()) || '. Anyone else joining? Send them your team link before 11:59 PM.' end,
           'remind-' || t.id, '#board'
    from teams t join members m on m.team_id = t.id where not t.closed and t.size < coalesce(t.cap, bd_max());
    get diagnostics n = row_count;
    -- registered but not in a team
    insert into notifications (person_id, title, body, tag, url)
    select p.id, '⏳ Teams lock tonight at 11:59 PM', 'You are not in a team yet. Create one, or join your team with the link your leader sent.', 'remind-none', '#board'
    from people p where not exists (select 1 from members m where m.person_id = p.id);
    get diagnostics k = row_count;
    n := n + k;
  elsif p_kind = 'solo' then
    -- a team of one: bring your teammates in (a team of 1 can't take part)
    insert into notifications (person_id, title, body, tag, url)
    select m.person_id, '⚠️ Action needed: your team has only YOU',
           '🚨 ' || t.name || ' can''t take part with 1 person. Share your team link NOW and get your teammates in. Teams lock on '
             || to_char(bd_deadline() at time zone 'Asia/Kolkata', 'FMDD Mon') || ' ⏳',
           'solo-' || t.id, '#board'
    from teams t join members m on m.team_id = t.id where t.size < bd_min();
    get diagnostics n = row_count;
  elsif p_kind = 'reveal-soon' then
    insert into notifications (person_id, title, body, tag, url)
    select m.person_id, '🚀 Problem statement in 1 hour', 'Meet your team on your TuteDude session. The problem statement appears on your team page at ' || to_char(bd_reveal() at time zone 'Asia/Kolkata', 'FMHH12:MI AM') || '.',
           'reveal-' || t.id, '#board'
    from teams t join members m on m.team_id = t.id where t.size >= bd_min();
    get diagnostics n = row_count;
  elsif p_kind = 'reveal-now' then
    insert into notifications (person_id, title, body, tag, url)
    select m.person_id, '📢 The problem statement is out!', 'Open the Buildathon site to read it, then start building with your team.',
           'problem-' || t.id, '#board'
    from teams t join members m on m.team_id = t.id where t.size >= bd_min();
    get diagnostics n = row_count;
  end if;
  return n;
end $$;

-- Team chat was removed: teammates talk on WhatsApp (get_me shows teammates' numbers to their own team only).
-- The messages table stays as a quiet activity log (who joined, left, renamed…), only readable by organisers.
drop function if exists get_messages(bigint);
drop function if exists send_message(text);
drop function if exists bd_chat_limit();

-- ---------- Phone notifications: save / remove this device ----------
create or replace function save_push(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := bd_me();
begin
  if not exists (select 1 from people where id = uid) then raise exception 'Register first.'; end if;
  if coalesce(p_endpoint, '') !~* '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/' then
    raise exception 'Invalid push subscription.';
  end if;
  delete from push_subs where endpoint in (select endpoint from push_subs where person_id = uid and endpoint <> p_endpoint
                                           order by created_at desc offset 4);  -- keep the newest 4 others → max 5
  insert into push_subs (endpoint, person_id, p256dh, auth) values (p_endpoint, uid, p_p256dh, p_auth)
  on conflict (endpoint) do update set person_id = excluded.person_id, p256dh = excluded.p256dh, auth = excluded.auth;
end $$;

create or replace function delete_push(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from push_subs where endpoint = p_endpoint and person_id = auth.uid();
$$;

-- ---------- Project submission ----------
-- links: http(s) only, no spaces or quotes, at most 300 characters
create or replace function bd_url_ok(u text) returns boolean
language sql immutable as $$
  select coalesce(u, '') ~ '^https?://[^[:space:]<>"'']+\.[^[:space:]<>"'']+$' and char_length(u) <= 300
$$;
-- The leader submits the team's project: once, between the problem statement and the deadline.
create or replace function submit_project(p_title text, p_summary text, p_product text, p_site text default '', p_video text default '') returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := bd_me(); tid uuid; tsize int; ttl text := bd_clean(p_title); sm text := bd_clean(p_summary);
        pr text := btrim(coalesce(p_product, '')); st text := btrim(coalesce(p_site, '')); vd text := btrim(coalesce(p_video, ''));
begin
  perform bd_account_ok(uid);
  perform pg_advisory_xact_lock(7231001);
  select id, size into tid, tsize from teams where leader_id = uid;
  if tid is null then raise exception 'Only the team leader can submit the project.'; end if;
  if now() < bd_submit_from() then raise exception 'Submissions open on %.', to_char(bd_submit_from() at time zone 'Asia/Kolkata', 'FMDD Mon'); end if;
  if now() > bd_submit_by() then raise exception 'Submissions are closed.'; end if;
  if tsize < bd_min() then raise exception 'A team needs at least % people to take part.', bd_min(); end if;
  if exists (select 1 from submissions where team_id = tid) then raise exception 'Your team has already submitted. It can''t be changed.'; end if;
  if char_length(ttl) not between 2 and 80 then raise exception 'Give your project a name (2 to 80 characters).'; end if;
  if char_length(sm) not between 20 and 500 then raise exception 'Describe your project in 2 to 3 lines (20 to 500 characters).'; end if;
  if not bd_url_ok(pr) then raise exception 'Paste the full link to your project (it starts with https://).'; end if;
  if st <> '' and not bd_url_ok(st) then raise exception 'The website link doesn''t look right. Paste the full link, or leave it empty.'; end if;
  if vd <> '' and not bd_url_ok(vd) then raise exception 'The video link doesn''t look right. Paste the full link, or leave it empty.'; end if;
  insert into submissions (team_id, title, summary, product_url, site_url, video_url, submitted_by) values (tid, ttl, sm, pr, st, vd, uid);
  perform bd_say(tid, 'Your leader submitted the project: ' || ttl);
  return json_build_object('ok', true);
end $$;

-- ---------- Who can call what ----------
revoke execute on function bd_me(), bd_open(), bd_notify(uuid, text, text, text), bd_notify_team(uuid, uuid, text, text, text),
  bd_say(uuid, text), bd_send_push(), bd_team_counts(), bd_broadcast_note(), bd_remind(text), bd_before_person_delete(),
  bd_account_ok(uuid), bd_new_code(), bd_take_out(uuid), bd_move(uuid), bd_person_skill(),
  bd_tutedude_api(text), bd_is_student(text) from public, anon, authenticated;   -- nobody can use our server to look up emails
revoke execute on function submit_project(text, text, text, text, text) from public, anon;
grant execute on function submit_project(text, text, text, text, text) to authenticated;

-- "Surprise me" (team name ideas): which of these names does a team already have? The site only offers the free ones.
-- It tells nothing new: creating a team with a taken name already answers "That team name is taken".
create or replace function names_taken(p_names text[]) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(n), '{}') from unnest((coalesce(p_names, '{}'::text[]))[1:60]) n
  where char_length(n) <= 40 and exists (select 1 from teams t where lower(t.name) = lower(n))
$$;
revoke execute on function names_taken(text[]) from public;
grant execute on function names_taken(text[]) to anon, authenticated;

-- ---------- WhatsApp rules ----------
-- The site asks once, before the first WhatsApp button opens: only about the Buildathon, no spam, no unwanted
-- messages, or the organisers can remove the student. This saves when a registered student agreed.
create or replace function agree_whatsapp() returns void
language sql security definer set search_path = public as $$
  update people set wa_ok_at = now() where id = auth.uid() and wa_ok_at is null;
$$;
revoke execute on function agree_whatsapp() from public, anon;
grant execute on function agree_whatsapp() to authenticated;
-- student actions: signed-in students only (Supabase anonymous sign-ins are "authenticated" too)
revoke execute on function get_me(), save_profile(text, text, text, text, text, text, text, text, uuid, boolean, boolean, boolean, json, boolean), rename_team(text),
  leave_team(), remove_member(uuid), reset_team_code(), set_team_open(boolean), add_teammate(text, text, text), remove_teammate(uuid), save_push(text, text, text), delete_push(text),
  reclaim_profile(text, text), check_student(text), set_team_closed(boolean), set_team_cap(int) from public, anon;
grant execute on function bd_my_team() to authenticated;
grant execute on function get_board(), get_team_by_code(text), get_open_teams(text) to anon, authenticated;
grant execute on function get_me(), save_profile(text, text, text, text, text, text, text, text, uuid, boolean, boolean, boolean, json, boolean), rename_team(text),
  leave_team(), remove_member(uuid), reset_team_code(), set_team_open(boolean), add_teammate(text, text, text), remove_teammate(uuid), save_push(text, text, text), delete_push(text),
  reclaim_profile(text, text), check_student(text), set_team_closed(boolean), set_team_cap(int) to authenticated;

-- ============================================================
-- ORGANISER PANEL (admin.html)
-- Organisers sign in with email + password: Supabase → Authentication → Users → Add user → Create new user
-- (tick "Auto Confirm User"). Only emails listed in bd_admins get in, and every admin_* function checks
-- bd_admin_only() first, so the page itself holds no secrets. To add an organiser:
--   insert into bd_admins (email) values ('name@tutedude.com');
-- ============================================================
create table if not exists bd_admins (
  email text primary key check (email = lower(email)),
  user_id uuid,                                   -- pinned at first sign-in: a re-created account with the same email doesn't get in
  added_at timestamptz not null default now()
);
alter table bd_admins enable row level security;
insert into bd_admins (email) values ('rajnish@tutedude.com') on conflict (email) do nothing;

create or replace function bd_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from auth.users u join bd_admins a on a.email = lower(u.email)
    where u.id = auth.uid() and u.email_confirmed_at is not null and not coalesce(u.is_anonymous, false)
      and (a.user_id is null or a.user_id = u.id))
$$;
create or replace function bd_admin_only() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not bd_is_admin() then raise exception 'Organisers only.'; end if;
end $$;

-- who am I (the page shows the panel only to organisers); pins the organiser's account on first sign-in
create or replace function admin_whoami() returns json
language plpgsql security definer set search_path = public as $$
declare ok boolean := bd_is_admin(); em text;
begin
  select email into em from auth.users where id = auth.uid();
  if ok then update bd_admins set user_id = auth.uid() where email = lower(em) and user_id is null; end if;
  return json_build_object('admin', ok, 'email', coalesce(em, ''));
end $$;

-- the private numbers
create or replace function admin_overview() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  perform bd_admin_only();
  return json_build_object(
    'people', (select count(*) from people),
    'today', (select count(*) from people where created_at > now() - interval '24 hours'),
    'teamless', (select count(*) from people p where not exists (select 1 from members m where m.person_id = p.id)),
    'listed', (select count(*) from team_listed),
    'notChecked', (select count(*) from people where tutedude_ok is null) + (select count(*) from team_listed where tutedude_ok is null),
    'notStudent', (select count(*) from people where tutedude_ok = false) + (select count(*) from team_listed where tutedude_ok = false),
    'teams', (select count(*) from teams),
    'ready', (select count(*) from teams where size >= bd_min()),
    'short', (select count(*) from teams where size < bd_min()),
    'full', (select count(*) from teams where size >= bd_max()),
    'open', (select count(*) from teams where open and size < bd_max()),
    'bySize', (select coalesce(json_object_agg(size, n), '{}'::json) from (select size, count(*) as n from teams group by size) x),
    'bySkill', (select coalesce(json_object_agg(domain, n), '{}'::json) from (select domain, count(*) as n from people group by domain) x),
    'daily', (select coalesce(json_agg(json_build_object('day', day, 'n', n) order by day), '[]'::json) from (
               select (created_at at time zone 'Asia/Kolkata')::date as day, count(*) as n from people
               where created_at > now() - interval '14 days' group by 1) x),
    'deadline', bd_deadline(), 'reveal', bd_reveal(), 'locked', now() > bd_deadline(), 'min', bd_min(), 'max', bd_max(),
    'problemSet', exists (select 1 from bd_settings where key = 'problem_statement' and value <> ''));
end $$;

-- teams with their members (phones and emails: organisers only), 50 at a time.
-- Filters: all, ready (bd_min()+ people), short (fewer), full, teamless (people without a team: returned
-- as "people" instead of "teams").
create or replace function admin_teams(p_filter text default 'all', p_search text default '', p_offset int default 0) returns json
language plpgsql stable security definer set search_path = public as $$
declare q text := lower(trim(coalesce(p_search, ''))); qd text := regexp_replace(coalesce(p_search, ''), '\D', '', 'g'); res json;
        f text := coalesce(p_filter, 'all'); off int := greatest(0, coalesce(p_offset, 0));
begin
  perform bd_admin_only();
  if char_length(qd) >= 10 then qd := right(qd, 10); end if;
  if f = 'teamless' then
    with base as (
      select p.* from people p where not exists (select 1 from members m where m.person_id = p.id)
        and (q = '' or strpos(lower(p.name), q) > 0 or strpos(lower(p.email), q) > 0 or (char_length(qd) >= 4 and strpos(p.phone, qd) > 0))
    )
    select json_build_object('total', (select count(*) from base), 'people', coalesce((select json_agg(y.j order by y.created_at) from (
      select p.created_at, json_build_object('id', p.id, 'name', p.name, 'domain', p.domain, 'phone', p.phone, 'email', p.email,
        'skill', p.skill, 'link', p.link, 'agreed', p.session_ok_at is not null, 'student', p.tutedude_ok, 'registeredAt', p.created_at) as j
      from base p order by p.created_at limit 50 offset off) y), '[]'::json))
    into res;
    return res;
  end if;
  with base as (
    select t.* from teams t
    where (f = 'all' or (f = 'ready' and t.size >= bd_min()) or (f = 'short' and t.size < bd_min()) or (f = 'full' and t.size >= bd_max())
           or (f = 'open' and t.open and t.size < bd_max()))
      and (q = '' or strpos(lower(t.name), q) > 0 or t.code = bd_code_clean(q)
           or exists (select 1 from members m join people p on p.id = m.person_id where m.team_id = t.id
                      and (strpos(lower(p.name), q) > 0 or strpos(lower(p.email), q) > 0
                           or (char_length(qd) >= 4 and strpos(p.phone, qd) > 0)))
           or exists (select 1 from team_listed l where l.team_id = t.id and (strpos(lower(l.name), q) > 0 or strpos(l.email, q) > 0
                      or (char_length(qd) >= 4 and strpos(l.phone, qd) > 0))))
  )
  select json_build_object(
    'total', (select count(*) from base),
    'teams', coalesce((select json_agg(y.j order by y.created_at) from (
      select t.created_at, json_build_object('id', t.id, 'name', t.name, 'size', t.size, 'code', t.code, 'open', t.open, 'createdAt', t.created_at,
        'closed', t.closed, 'cap', coalesce(t.cap, bd_max()),
        'members', (select json_agg(json_build_object('id', p.id, 'name', p.name, 'domain', p.domain, 'phone', p.phone, 'email', p.email,
                      'skill', p.skill, 'link', p.link, 'agreed', p.session_ok_at is not null, 'student', p.tutedude_ok, 'leader', p.id = t.leader_id,
                      'joinedAt', m.joined_at) order by m.joined_at)
                    from members m join people p on p.id = m.person_id where m.team_id = t.id),
        'listed', coalesce((select json_agg(json_build_object('id', l.id, 'name', l.name, 'email', l.email, 'phone', l.phone, 'student', l.tutedude_ok, 'addedAt', l.created_at) order by l.created_at)
                    from team_listed l where l.team_id = t.id), '[]'::json)) as j
      from base t order by t.created_at limit 50 offset off) y), '[]'::json))
  into res;
  return res;
end $$;

-- teams this person could be moved into (room left), fullest first
create or replace function admin_team_options(p_person uuid, p_search text default '') returns json
language plpgsql stable security definer set search_path = public as $$
declare cur uuid; q text := lower(trim(coalesce(p_search, '')));
begin
  perform bd_admin_only();
  select team_id into cur from members where person_id = p_person;
  return coalesce((select json_agg(json_build_object('id', id, 'name', name, 'size', size) order by size desc, created_at)
    from (select * from teams where id is distinct from cur and size < bd_max()
          and (q = '' or strpos(lower(name), q) > 0 or code = bd_code_clean(q)) order by size desc, created_at limit 30) x), '[]'::json);
end $$;

-- move someone (in a team or not) into a chosen team with room. Works after the lock too.
drop function if exists admin_move(uuid, uuid);
create or replace function admin_move(p_person uuid, p_team uuid) returns text
language plpgsql security definer set search_path = public as $$
declare d text; nm text; old uuid; tname text; tsize int;
begin
  perform bd_admin_only();
  perform pg_advisory_xact_lock(7231001);
  select domain, name into d, nm from people where id = p_person;
  if nm is null then raise exception 'That person is not registered any more.'; end if;
  if p_team is null then raise exception 'Pick a team.'; end if;
  select team_id into old from members where person_id = p_person;
  if p_team = old then raise exception '% is already in that team.', nm; end if;
  select name, size into tname, tsize from teams where id = p_team;
  if tname is null then raise exception 'That team doesn''t exist any more.'; end if;
  if tsize >= bd_max() then raise exception '% is full.', tname; end if;
  -- the last member leaving deletes the team, and a submission goes with it
  if old is not null and (select count(*) from members where team_id = old) <= 1 and exists (select 1 from submissions where team_id = old) then
    raise exception '% is the only member of their team, which already submitted. Moving them would delete the team and its submission.', nm;
  end if;
  if old is not null then
    old := bd_take_out(p_person);
    if old is not null then
      perform bd_say(old, nm || ' was moved to another team by the organisers.');
      perform bd_notify_team(old, null, 'Team update', nm || ' was moved to another team by the organisers.', 'team-' || old);
    end if;
  end if;
  insert into members (person_id, team_id) values (p_person, p_team);
  perform bd_say(p_team, nm || bd_tag(d) || ' was added by the organisers 👋');
  perform bd_notify_team(p_team, p_person, tname || ': new teammate', nm || bd_tag(d) || ' joined your team. Say hi!', 'team-' || p_team);
  perform bd_notify(p_person, 'Team update', 'The organisers added you to ' || tname || '. Say hi to your team!', 'team-' || p_team);
  return tname;
end $$;

-- take someone out of their team but keep their registration, so they can be added to another team.
-- Works after the lock too. If they were the leader, the next member leads; if they were the only member, the team is deleted.
create or replace function admin_take_out(p_person uuid) returns text
language plpgsql security definer set search_path = public as $$
declare nm text; tid uuid; tname text;
begin
  perform bd_admin_only();
  perform pg_advisory_xact_lock(7231001);
  select p.name, m.team_id, t.name into nm, tid, tname
    from people p left join members m on m.person_id = p.id left join teams t on t.id = m.team_id where p.id = p_person;
  if nm is null then raise exception 'That person is not registered any more.'; end if;
  if tid is null then raise exception '% is not in a team.', nm; end if;
  if (select count(*) from members where team_id = tid) <= 1 and exists (select 1 from submissions where team_id = tid) then
    raise exception '% is the only member of %, which already submitted. Taking them out would delete the team and its submission.', nm, tname;
  end if;
  tid := bd_take_out(p_person);
  if tid is not null then
    perform bd_say(tid, nm || ' was taken out of the team by the organisers.');
    perform bd_notify_team(tid, null, 'Team update', nm || ' was taken out of your team by the organisers.', 'team-' || tid);
  end if;
  perform bd_notify(p_person, 'Team update', 'The organisers took you out of ' || tname
    || '. To join another team, use its team link or message the organisers.', 'team-none');
  return tname;
end $$;

-- people the organisers could add to a team: search by name, email or WhatsApp. An empty search lists people without a team.
create or replace function admin_people_options(p_team uuid, p_search text default '') returns json
language plpgsql stable security definer set search_path = public as $$
declare q text := lower(trim(coalesce(p_search, ''))); qd text := regexp_replace(coalesce(p_search, ''), '\D', '', 'g');
begin
  perform bd_admin_only();
  if char_length(qd) >= 10 then qd := right(qd, 10); end if;
  return coalesce((select json_agg(x.j order by x.teamless desc, x.created_at desc) from (
    select p.created_at, m.team_id is null as teamless,
      json_build_object('id', p.id, 'name', p.name, 'email', p.email, 'phone', p.phone, 'domain', p.domain,
        'team', t.name, 'teamMembers', (select count(*) from members mm where mm.team_id = t.id), 'leader', t.leader_id = p.id,
        'submitted', exists (select 1 from submissions s where s.team_id = t.id)) as j
    from people p left join members m on m.person_id = p.id left join teams t on t.id = m.team_id
    where m.team_id is distinct from p_team
      and case when q = '' then m.team_id is null
               else strpos(lower(p.name), q) > 0 or strpos(lower(p.email), q) > 0 or (char_length(qd) >= 4 and strpos(p.phone, qd) > 0) end
    order by (m.team_id is null) desc, p.created_at desc limit 30) x), '[]'::json);
end $$;

-- check again the emails TuteDude's API couldn't answer for (it was down or rate-limited), a few at a time
create or replace function admin_recheck_students(p_limit int default 20) returns json
language plpgsql security definer set search_path = public as $$
declare r record; ok boolean; n int := 0; yes int := 0; no int := 0; unknown int := 0;
begin
  perform bd_admin_only();
  for r in (select 'p' as k, id, email from people where tutedude_ok is null
            union all select 'l', id, email from team_listed where tutedude_ok is null)
           limit least(greatest(coalesce(p_limit, 20), 1), 50) loop
    ok := bd_is_student(r.email);
    n := n + 1;
    if ok is null then unknown := unknown + 1; continue; end if;
    if r.k = 'p' then update people set tutedude_ok = ok where id = r.id; else update team_listed set tutedude_ok = ok where id = r.id; end if;
    if ok then yes := yes + 1; else no := no + 1; end if;
  end loop;
  return json_build_object('checked', n, 'students', yes, 'notStudents', no, 'unknown', unknown,
    'left', (select count(*) from people where tutedude_ok is null) + (select count(*) from team_listed where tutedude_ok is null));
end $$;

-- take a teammate the leader added (no account yet) off their team
create or replace function admin_remove_listed(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare mn text; tid uuid;
begin
  perform bd_admin_only();
  perform pg_advisory_xact_lock(7231001);
  delete from team_listed where id = p_id returning name, team_id into mn, tid;
  if mn is null then raise exception 'Already removed.'; end if;
  perform bd_say(tid, mn || ' was removed by the organisers.');
  return mn;
end $$;

-- delete a fake / outsider registration completely (their team passes to the next member)
create or replace function admin_remove_person(p_person uuid) returns text
language plpgsql security definer set search_path = public as $$
declare nm text; old uuid;
begin
  perform bd_admin_only();
  perform pg_advisory_xact_lock(7231001);
  select name into nm from people where id = p_person;
  if nm is null then raise exception 'That person is not registered any more.'; end if;
  select team_id into old from members where person_id = p_person;
  if old is not null then perform bd_say(old, nm || ' was removed by the organisers.'); end if;
  delete from auth.users where id = p_person;  -- cascades to the profile and membership
  return nm;
end $$;

create or replace function admin_rename_team(p_team uuid, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare nm text := bd_clean(p_name);
begin
  perform bd_admin_only();
  perform pg_advisory_xact_lock(7231001);
  if char_length(nm) not between 2 and 40 then raise exception 'Team names are 2 to 40 letters.'; end if;
  if exists (select 1 from teams where lower(name) = lower(nm) and id <> p_team) then raise exception 'That team name is taken.'; end if;
  update teams set name = nm where id = p_team;
  if not found then raise exception 'Team not found.'; end if;
  perform bd_say(p_team, 'The organisers renamed the team to ' || nm || '.');
end $$;

-- the problem statement (shown on team pages from bd_reveal())
create or replace function admin_get_problem() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  perform bd_admin_only();
  return json_build_object(
    'text', coalesce((select value from bd_settings where key = 'problem_statement'), ''),
    'link', coalesce((select value from bd_settings where key = 'problem_link'), ''),
    'reveal', bd_reveal(), 'live', now() >= bd_reveal());
end $$;
create or replace function admin_set_problem(p_text text, p_link text) returns void
language plpgsql security definer set search_path = public as $$
declare tx text := trim(coalesce(p_text, '')); lk text := trim(coalesce(p_link, ''));
begin
  perform bd_admin_only();
  if char_length(tx) > 10000 then raise exception 'Keep the problem statement under 10000 characters (put the rest in the link).'; end if;
  if lk <> '' and (lk !~* '^https://\S+$' or char_length(lk) > 300) then raise exception 'The link must start with https://'; end if;
  insert into bd_settings (key, value) values ('problem_statement', tx), ('problem_link', lk)
    on conflict (key) do update set value = excluded.value;
end $$;

-- who gets an organiser notification
create or replace function bd_audience(p_audience text, p_team uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select p.id from people p left join members m on m.person_id = p.id left join teams t on t.id = m.team_id
  where case p_audience
          when 'all' then true
          when 'ready' then t.size >= bd_min()
          when 'short' then t.size < bd_min()
          when 'teamless' then t.id is null
          when 'team' then t.id = p_team
          else false
        end
$$;
-- send a notification (site + phone) to a group. p_dry_run = just count who would get it.
create or replace function admin_notify(p_audience text, p_title text, p_body text, p_team uuid default null, p_dry_run boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare ttl text := trim(coalesce(p_title, '')); bd text := trim(coalesce(p_body, '')); n int;
begin
  perform bd_admin_only();
  if p_audience is null or p_audience not in ('all', 'ready', 'short', 'teamless', 'team') then raise exception 'Pick who gets it.'; end if;
  if p_audience = 'team' and p_team is null then raise exception 'Pick a team.'; end if;
  if p_dry_run then return (select count(*) from bd_audience(p_audience, p_team)); end if;
  if char_length(ttl) not between 2 and 80 then raise exception 'Write a title (up to 80 characters).'; end if;
  if char_length(bd) > 140 then raise exception 'Keep the message under 140 characters.'; end if;
  perform pg_advisory_xact_lock(7231001);   -- nobody is deleted halfway through the send
  insert into notifications (person_id, title, body, tag, url)
    select pid, ttl, bd, 'organisers', '#board' from bd_audience(p_audience, p_team) as pid;
  get diagnostics n = row_count;
  return n;
end $$;

-- recent activity (created, joined, left, removed, renamed, moved)
create or replace function admin_activity(p_limit int default 100) returns json
language plpgsql stable security definer set search_path = public as $$
begin
  perform bd_admin_only();
  return coalesce((select json_agg(json_build_object('at', x.created_at, 'team', x.tname, 'text', x.body) order by x.id desc)
    from (select m.id, m.created_at, m.body, t.name as tname from messages m join teams t on t.id = m.team_id
          order by m.id desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) x), '[]'::json);
end $$;

-- everything for a CSV (one row per person)
create or replace function admin_export() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  perform bd_admin_only();
  return (coalesce((select json_agg(json_build_object(
      'team', t.name, 'teamCode', t.code, 'teamSize', t.size, 'teamReady', t.size >= bd_min(), 'teamOpen', t.open, 'leader', t.leader_id = p.id,
      'name', p.name, 'skill', bd_label(p.domain), 'whatsapp', p.phone, 'email', p.email, 'bio', p.skill, 'link', p.link,
      'agreedToSession', p.session_ok_at is not null, 'agreedToWhatsappRules', p.wa_ok_at is not null, 'signedUp', true, 'tutedudeStudent', p.tutedude_ok, 'registeredAt', p.created_at)
    order by t.created_at nulls last, m.joined_at)
    from people p left join members m on m.person_id = p.id left join teams t on t.id = m.team_id), '[]'::json)::jsonb
  || coalesce((select jsonb_agg(jsonb_build_object(
      'team', t.name, 'teamCode', t.code, 'teamSize', t.size, 'teamReady', t.size >= bd_min(), 'teamOpen', t.open, 'leader', false,
      'name', l.name, 'skill', '', 'whatsapp', l.phone, 'email', l.email, 'bio', '', 'link', '',
      'agreedToSession', false, 'agreedToWhatsappRules', false, 'signedUp', false, 'tutedudeStudent', l.tutedude_ok, 'registeredAt', l.created_at) order by t.created_at, l.created_at)
    from team_listed l join teams t on t.id = l.team_id), '[]'::jsonb))::json;
end $$;

-- every submitted project, oldest first (organiser panel → Submissions, and its CSV)
create or replace function admin_submissions() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  perform bd_admin_only();
  return coalesce((select json_agg(json_build_object('teamId', t.id, 'team', t.name, 'teamCode', t.code, 'teamSize', t.size,
      'leader', p.name, 'leaderWhatsapp', p.phone, 'leaderEmail', p.email,
      'title', s.title, 'summary', s.summary, 'projectLink', s.product_url, 'websiteLink', s.site_url, 'videoLink', s.video_url,
      'submittedAt', s.created_at) order by s.created_at)
    from submissions s join teams t on t.id = s.team_id left join people p on p.id = t.leader_id), '[]'::json);
end $$;
-- remove a team's submission so its leader can submit again (wrong link, etc.)
create or replace function admin_delete_submission(p_team uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform bd_admin_only();
  delete from submissions where team_id = p_team;
  if found then perform bd_say(p_team, 'An organiser reopened your submission. Your leader can submit the project again.'); end if;
end $$;
revoke execute on function admin_submissions(), admin_delete_submission(uuid) from public, anon;
grant execute on function admin_submissions(), admin_delete_submission(uuid) to authenticated;

-- ---------- WhatsApp reminder through WATI ----------
-- Everyone alone in their team gets a WhatsApp message: get your teammates in, or the team is out.
-- It goes out by itself once a day at 1 PM IST until teams lock (pg_cron, bottom of this file), and an organiser
-- can send it from the panel (Notify → WhatsApp reminder). Each person gets one of the approved templates, picked at random.
-- The sender is push-server/api/whatsapp.js on Vercel (it holds the WATI token). Settings in bd_settings:
--   whatsapp_url       the sender's address; empty = WhatsApp is not set up
--   whatsapp_template  the approved template names in WATI, separated by commas (variables: name, team, link)
--   site_url           the site's address, for the team link in the message
-- The secret is notify_secret (shared with phone notifications).
--   whatsapp_params    the template's variables, in any order (name, team, link, message); "message" is a random
--                      line from push-server/api/whatsapp.js
insert into bd_settings (key, value) values ('whatsapp_template', 'buildathon_team_status'), ('whatsapp_params', 'name,message,link'),
  ('site_url', 'https://buildathon.tutedude.com/') on conflict (key) do nothing;
-- p_dry_run = just count who would get it. p_quiet = the daily job: nothing to do is not an error.
create or replace function bd_whatsapp_solo(p_dry_run boolean default false, p_quiet boolean default true) returns int
language plpgsql security definer set search_path = public as $$
declare u text; s text; tpl text; prm text; site text; rec jsonb; n int; rid bigint; why text;
begin
  select value into u from bd_settings where key = 'whatsapp_url';
  select value into prm from bd_settings where key = 'whatsapp_params';
  select value into s from bd_settings where key = 'notify_secret';
  select value into tpl from bd_settings where key = 'whatsapp_template';
  select value into site from bd_settings where key = 'site_url';
  select count(*), jsonb_agg(jsonb_build_object('phone', p.phone, 'name', split_part(p.name, ' ', 1), 'team', t.name,
           'link', coalesce(site, '') || '#join=' || t.code))
    into n, rec
    from teams t join members m on m.team_id = t.id join people p on p.id = m.person_id
    where t.size < bd_min() and p.phone <> '';
  if p_dry_run then return n; end if;
  why := case
    when now() > bd_deadline() then 'Teams are locked now.'
    when coalesce(u, '') = '' then 'WhatsApp is not set up yet (see "WhatsApp reminder (WATI)" in README.md).'
    when n = 0 then 'Nobody is alone in a team.'
    when exists (select 1 from bd_settings where key = 'whatsapp_last' and (value::jsonb ->> 'at')::timestamptz > now() - interval '10 minutes')
      then 'A WhatsApp reminder went out less than 10 minutes ago. Wait a little.'
  end;
  if why is not null then
    if p_quiet then return 0; end if;
    raise exception '%', why;
  end if;
  rid := net.http_post(
    url := u,
    body := jsonb_build_object('template', tpl, 'params', coalesce(prm, 'name,team,link'), 'recipients', rec,
      'broadcast', 'buildathon-team-of-one-' || to_char(now() at time zone 'Asia/Kolkata', 'DDMon-HH24MI'),
      'deadline', (extract(epoch from bd_deadline()) * 1000)::bigint, 'teams', (select count(*) from teams)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', coalesce(s, '')),
    timeout_milliseconds := 30000);
  insert into bd_settings (key, value) values ('whatsapp_last', jsonb_build_object('id', rid, 'at', now(), 'count', n)::text)
    on conflict (key) do update set value = excluded.value;
  return n;
end $$;
revoke all on function bd_whatsapp_solo(boolean, boolean) from public, anon, authenticated;

create or replace function admin_whatsapp(p_dry_run boolean default false) returns int
language plpgsql security definer set search_path = public as $$
begin
  perform bd_admin_only();
  return bd_whatsapp_solo(p_dry_run, false);
end $$;

-- what happened to the last WhatsApp reminder: {at, count, done, ok, accepted, failed, error}
create or replace function admin_whatsapp_status() returns json
language plpgsql security definer set search_path = public as $$
declare l jsonb; r record; c jsonb;
begin
  perform bd_admin_only();
  select value::jsonb into l from bd_settings where key = 'whatsapp_last';
  if l is null then return json_build_object('at', null, 'ready', coalesce((select value from bd_settings where key = 'whatsapp_url'), '') <> ''); end if;
  select status_code, content, timed_out, error_msg into r from net._http_response where id = (l ->> 'id')::bigint;
  if not found then return json_build_object('at', l -> 'at', 'count', l -> 'count', 'done', false, 'ready', true); end if;
  begin c := r.content::jsonb; exception when others then c := null; end;
  return json_build_object('at', l -> 'at', 'count', l -> 'count', 'done', true, 'ready', true,
    'ok', coalesce((c ->> 'ok')::boolean, false), 'accepted', coalesce((c ->> 'accepted')::int, 0), 'failed', coalesce((c ->> 'failed')::int, 0),
    'error', coalesce(nullif(c ->> 'error', ''), case when c is null then coalesce(r.error_msg, 'The sender answered ' || coalesce(r.status_code::text, 'nothing') || '.') end, ''));
end $$;
revoke execute on function admin_whatsapp(boolean), admin_whatsapp_status() from public, anon;
grant execute on function admin_whatsapp(boolean), admin_whatsapp_status() to authenticated;

-- ---------- The problem statement on WhatsApp (WATI, the same Utility template) ----------
-- To everyone in a team of 2+ (the teams that take part), never before bd_reveal(). It goes out by itself
-- at 7:16 PM IST on reveal day (pg_cron, below) when the problem statement is saved, and from the panel
-- (Problem statement → Send it on WhatsApp). Once only, unless an organiser sends it again.
-- WhatsApp allows one paragraph in a template variable (600 characters here): a longer statement is cut,
-- and the message says to read all of it on the team page.
create or replace function bd_problem_wa_text() returns text
language plpgsql stable security definer set search_path = public as $$
declare tx text := regexp_replace(trim(coalesce((select value from bd_settings where key = 'problem_statement'), '')), '\s+', ' ', 'g');
        lk text := trim(coalesce((select value from bd_settings where key = 'problem_link'), ''));
        pre text := 'The problem statement is out: ';
        custom text := regexp_replace(trim(coalesce((select value from bd_settings where key = 'problem_whatsapp'), '')), '\s+', ' ', 'g');
        sfx text; room int;
begin
  if tx = '' then return ''; end if;
  -- an organiser-written WhatsApp version (bd_settings "problem_whatsapp") wins over the cut statement
  if custom <> '' then return left(custom, 600); end if;
  sfx := case when lk <> '' then ' Full brief: ' || lk else '' end || ' Read it all on your team page and start building with your team.';
  room := 600 - char_length(pre) - char_length(sfx) - 1;
  if char_length(tx) > room then tx := regexp_replace(left(tx, room - 1), '\s+\S*$', '') || '…';
  elsif tx !~ '[.!?…:]$' then tx := tx || '.'; end if;
  return pre || tx || sfx;
end $$;
revoke all on function bd_problem_wa_text() from public, anon, authenticated;

create or replace function bd_whatsapp_problem(p_dry_run boolean default false, p_quiet boolean default true, p_again boolean default false) returns json
language plpgsql security definer set search_path = public as $$
declare u text; s text; tpl text; prm text; site text; msg text := bd_problem_wa_text(); rec jsonb; n int; why text;
        l jsonb; ids jsonb := '[]'::jsonb; part jsonb; k int := 0;
begin
  perform pg_advisory_xact_lock(7231001);   -- the list doesn't change halfway, and two sends can't cross
  select value into u from bd_settings where key = 'whatsapp_url';
  select value into s from bd_settings where key = 'notify_secret';
  select value into tpl from bd_settings where key = 'whatsapp_template';
  select value into prm from bd_settings where key = 'whatsapp_params';
  select value into site from bd_settings where key = 'site_url';
  select value::jsonb into l from bd_settings where key = 'whatsapp_problem_last';
  select count(*), coalesce(jsonb_agg(jsonb_build_object('phone', p.phone, 'name', split_part(p.name, ' ', 1), 'team', t.name,
           'link', coalesce(site, '') || '#join=' || t.code, 'message', msg)), '[]'::jsonb)
    into n, rec
    from teams t join members m on m.team_id = t.id join people p on p.id = m.person_id
    where t.size >= bd_min() and p.phone <> '';
  if p_dry_run then return json_build_object('count', n, 'message', msg, 'live', now() >= bd_reveal(), 'reveal', bd_reveal(), 'sent', l); end if;
  why := case
    when now() < bd_reveal() then 'The problem statement is still secret: WhatsApp can send it from '
                                  || to_char(bd_reveal() at time zone 'Asia/Kolkata', 'FMDD Mon, FMHH12:MI AM') || ' IST.'
    when msg = '' then 'Save the problem statement first.'
    when coalesce(u, '') = '' then 'WhatsApp is not set up yet (see "WhatsApp reminder (WATI)" in README.md).'
    when n = 0 then 'Nobody is in a team of 2 or more.'
    when l is not null and (l ->> 'at')::timestamptz > now() - interval '10 minutes'
      then 'The problem statement went out on WhatsApp less than 10 minutes ago. Wait a little.'
    when l is not null and not coalesce(p_again, false)
      then 'The problem statement already went out on WhatsApp (' || to_char((l ->> 'at')::timestamptz at time zone 'Asia/Kolkata', 'FMDD Mon, FMHH12:MI AM') || ').'
  end;
  if why is not null then
    if p_quiet then return json_build_object('count', 0, 'skipped', why); end if;
    raise exception '%', why;
  end if;
  -- 250 people per call to the sender, so no single call runs long
  for part in select jsonb_agg(x.r) from (select r, (row_number() over () - 1) / 250 as g from jsonb_array_elements(rec) r) x group by x.g order by x.g loop
    k := k + 1;
    ids := ids || to_jsonb(net.http_post(
      url := regexp_replace(u, '/api/whatsapp/?$', '/api/whatsapp-team'),
      body := jsonb_build_object('template', tpl, 'params', coalesce(prm, 'name,message,link'), 'recipients', part,
        'broadcast', 'buildathon-problem-' || to_char(now() at time zone 'Asia/Kolkata', 'DDMon-HH24MI') || '-' || k),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', coalesce(s, '')),
      timeout_milliseconds := 30000));
  end loop;
  insert into bd_settings (key, value) values ('whatsapp_problem_last', jsonb_build_object('ids', ids, 'at', now(), 'count', n)::text)
    on conflict (key) do update set value = excluded.value;
  return json_build_object('count', n);
end $$;
revoke all on function bd_whatsapp_problem(boolean, boolean, boolean) from public, anon, authenticated;

create or replace function admin_whatsapp_problem(p_dry_run boolean default false, p_again boolean default false) returns json
language plpgsql security definer set search_path = public as $$
begin
  perform bd_admin_only();
  return bd_whatsapp_problem(p_dry_run, false, p_again);
end $$;

-- what WATI said about the last problem-statement send: {at, count, done, accepted, failed, error}
create or replace function admin_whatsapp_problem_status() returns json
language plpgsql security definer set search_path = public as $$
declare l jsonb; r record; c jsonb; acc int := 0; bad int := 0; waiting int := 0; errs text[] := '{}';
begin
  perform bd_admin_only();
  select value::jsonb into l from bd_settings where key = 'whatsapp_problem_last';
  if l is null then return json_build_object('at', null, 'ready', coalesce((select value from bd_settings where key = 'whatsapp_url'), '') <> ''); end if;
  for r in select x.id, h.status_code, h.content, h.error_msg, h.id is not null as done
           from jsonb_array_elements_text(l -> 'ids') x(id) left join net._http_response h on h.id = x.id::bigint loop
    if not r.done then waiting := waiting + 1; continue; end if;
    begin c := r.content::jsonb; exception when others then c := null; end;
    acc := acc + coalesce((c ->> 'accepted')::int, 0);
    bad := bad + coalesce((c ->> 'failed')::int, 0);
    if coalesce(c ->> 'error', '') <> '' then errs := errs || (c ->> 'error');
    elsif c is null then errs := errs || coalesce(r.error_msg, 'The sender answered ' || coalesce(r.status_code::text, 'nothing') || '.'); end if;
  end loop;
  return json_build_object('at', l -> 'at', 'count', l -> 'count', 'done', waiting = 0, 'ready', true,
    'accepted', acc, 'failed', bad, 'error', left(array_to_string(errs, ' | '), 400));
end $$;
-- ---------- After the lock: teams of 2 open to new members (organisers) ----------
-- p_open true: every team of exactly 2 people opens again (closed / team size reset), so it can add people with
-- its team link or "Add a teammate", up to bd_max(). false: every reopened team closes. Dry run: how many are open.
create or replace function admin_late_teams(p_open boolean default null, p_dry_run boolean default false) returns json
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  perform bd_admin_only();
  if not coalesce(p_dry_run, false) and p_open is not null then
    perform pg_advisory_xact_lock(7231001);
    if p_open then
      for r in update teams set late_open = true, closed = false, cap = null where size = 2 and not late_open returning id loop
        perform bd_say(r.id, 'The organisers opened the team again: add teammates with the team link or "Add a teammate".');
        n := n + 1;
      end loop;
    else
      for r in update teams set late_open = false where late_open returning id loop
        perform bd_say(r.id, 'The organisers closed the team to new members.');
        n := n + 1;
      end loop;
    end if;
  end if;
  return json_build_object('changed', n, 'open', (select count(*) from teams where late_open),
                           'teamsOf2', (select count(*) from teams where size = 2 and not late_open), 'locked', now() > bd_deadline());
end $$;
revoke execute on function admin_late_teams(boolean, boolean) from public, anon;
grant execute on function admin_late_teams(boolean, boolean) to authenticated;

revoke execute on function admin_whatsapp_problem(boolean, boolean), admin_whatsapp_problem_status() from public, anon;
grant execute on function admin_whatsapp_problem(boolean, boolean), admin_whatsapp_problem_status() to authenticated;

-- ---------- Messages sent (organiser panel → Overview) ----------
-- The WhatsApp sends kept in bd_settings, by kind (the latest of each).
create or replace function bd_wa_kinds() returns table (key text, what text)
language sql immutable as $$
  values ('whatsapp_live_last', '“We go live at 7 PM” announcement'), ('whatsapp_time_last', '“Problem statement at 7:15 PM” update'),
         ('whatsapp_session_last', '“Join the live session at 7 PM” steps (teams of 2+)'),
         ('whatsapp_session_rest_last', '“Join the live session at 7 PM” steps (everyone else)'),
         ('whatsapp_session_now_last', '“The live session has started, join now”'),
         ('whatsapp_doubt_last', '“Doubt-clearing session is live, join now” (23 Nov)'),
         ('whatsapp_problem_last', 'The problem statement'), ('whatsapp_last', 'Latest WhatsApp reminder / new-team message') $$;
-- What WATI said about one send: {accepted, failed, done}. pg_net keeps answers for about 6 hours,
-- so bd_wa_cache() writes the totals into the send itself once every answer is in.
create or replace function bd_wa_answer(l jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r record; c jsonb; acc int := 0; bad int := 0; waiting int := 0;
begin
  if coalesce((l ->> 'done')::boolean, false) then return jsonb_build_object('accepted', l -> 'accepted', 'failed', l -> 'failed', 'done', true); end if;
  for r in select h.content, h.id is not null as got from jsonb_array_elements_text(coalesce(l -> 'ids', jsonb_build_array(l -> 'id'))) x(id)
           left join net._http_response h on h.id = x.id::bigint loop
    if not r.got then waiting := waiting + 1; continue; end if;
    begin c := r.content::jsonb; exception when others then c := null; end;
    acc := acc + coalesce((c ->> 'accepted')::int, 0);
    bad := bad + coalesce((c ->> 'failed')::int, 0);
  end loop;
  return jsonb_build_object('accepted', acc, 'failed', bad, 'done', waiting = 0,
                            'lost', waiting > 0 and (l ->> 'at')::timestamptz < now() - interval '6 hours');
end $$;
create or replace function bd_wa_cache() returns void
language plpgsql security definer set search_path = public as $$
declare k record; l jsonb; a jsonb;
begin
  for k in select * from bd_wa_kinds() loop
    select value::jsonb into l from bd_settings where bd_settings.key = k.key;
    continue when l is null or coalesce((l ->> 'done')::boolean, false);
    a := bd_wa_answer(l);
    if (a ->> 'done')::boolean then
      update bd_settings set value = (l || jsonb_build_object('accepted', a -> 'accepted', 'failed', a -> 'failed', 'done', true))::text where bd_settings.key = k.key;
    end if;
  end loop;
end $$;
revoke all on function bd_wa_answer(jsonb), bd_wa_cache() from public, anon, authenticated;

-- every message sent to many people: WhatsApp (with WATI's answer) and site + phone notifications, newest first
create or replace function admin_sent_log() returns json
language plpgsql stable security definer set search_path = public as $$
declare o jsonb := '[]'::jsonb; k record; l jsonb; a jsonb;
begin
  perform bd_admin_only();
  for k in select * from bd_wa_kinds() loop
    select value::jsonb into l from bd_settings where bd_settings.key = k.key;
    continue when l is null;
    a := bd_wa_answer(l);
    o := o || (jsonb_build_object('at', l -> 'at', 'channel', 'whatsapp', 'what', k.what, 'people', (l ->> 'count')::int) || a);
  end loop;
  o := o || coalesce((select jsonb_agg(jsonb_build_object('at', x.at, 'channel', 'site', 'what', x.title, 'body', x.body, 'people', x.n))
    from (select min(created_at) as at, title, min(body) as body, count(*) as n from notifications
          where tag in ('organisers', 'live-7pm') or tag like 'remind-%' or tag like 'solo-%' or tag like 'reveal-%' or tag like 'problem-%'
          group by title, date_trunc('minute', created_at) having count(*) >= 2
          order by min(created_at) desc limit 30) x), '[]'::jsonb);
  return coalesce((select jsonb_agg(e order by (e ->> 'at')::timestamptz desc) from jsonb_array_elements(o) e), '[]'::jsonb)::json;
end $$;
revoke execute on function admin_sent_log() from public, anon;
grant execute on function admin_sent_log() to authenticated;

-- ---------- Teams of one → teams of 5 (organisers) ----------
-- Everyone alone in their team (1 person, no added teammates) whose email TuteDude confirmed (tutedude_ok; not
-- checked or "not on TuteDude" = left out) is put together with others in the same spot,
-- in teams of up to bd_max(). The groups are as even as possible (12 people → 4 + 4 + 4, never a team of 1).
-- In each group the oldest team stays (its name, team link and leader); the others join it and their old,
-- empty team is deleted. Everyone gets a site + phone notification, and a WhatsApp message (WATI, when set up)
-- with the team name and their new teammates' names and WhatsApp numbers, so they can message each other.
-- Each person gets the full leave window again (bd_leave_hours(), until teams lock), like any new member.
-- Organiser panel → Notify → "Teams of one → teams of 5", or the SQL Editor:
--   select bd_merge_solos(true);   -- preview: who goes with whom (nothing changes)
--   select bd_merge_solos();       -- do it
create or replace function bd_merge_solos(p_dry_run boolean default false) returns json
language plpgsql security definer set search_path = public as $$
declare n int; g int; grp record; kept uuid; kname text; kcode text; r record; mates text; mates_wa text; body text;
        moved int := 0; made int := 0; prev jsonb := '[]'::jsonb; rec jsonb := '[]'::jsonb;
        u text; wa_url text; s text; tpl text; prm text; site text; rid bigint; wa_note text := '';
begin
  perform pg_advisory_xact_lock(7231001);   -- the same lock as every other team change
  select count(*) into n from teams t join members m on m.team_id = t.id join people p on p.id = m.person_id
    where t.size = 1 and p.tutedude_ok;   -- confirmed TuteDude students only
  g := ceil(n / bd_max()::numeric)::int;
  site := coalesce((select value from bd_settings where key = 'site_url'), '');
  if n < 2 then
    if p_dry_run then return json_build_object('people', n, 'teams', 0, 'groups', '[]'::json); end if;
    raise exception '%', case when n = 0 then 'Nobody is alone in a team.' else 'Only 1 person is alone in a team: nobody to put them with.' end;
  end if;

  -- oldest team first; ntile() makes g groups whose sizes differ by 1 at most
  for grp in
    select x.grp, array_agg(x.team_id order by x.team_at, x.team_id) as teams,
           array_agg(x.person_id order by x.team_at, x.team_id) as people,
           array_agg(x.name order by x.team_at, x.team_id) as names
    from (select t.id as team_id, t.created_at as team_at, m.person_id, p.name,
                 ntile(g) over (order by t.created_at, t.id) as grp
          from teams t join members m on m.team_id = t.id join people p on p.id = m.person_id
          where t.size = 1 and p.tutedude_ok) x
    group by x.grp order by x.grp
  loop
    kept := grp.teams[1];
    select name, code into kname, kcode from teams where id = kept;
    if p_dry_run then
      prev := prev || jsonb_build_object('team', kname, 'people', to_jsonb(grp.names));
      continue;
    end if;
    -- the one who stays starts the team again too (same leave window as the others; the leader stays first)
    update members set joined_at = clock_timestamp() where person_id = grp.people[1];
    for i in 2 .. array_length(grp.people, 1) loop
      perform bd_take_out(grp.people[i]);   -- they were alone: their old team is deleted
      insert into members (person_id, team_id) values (grp.people[i], kept);
      moved := moved + 1;
    end loop;
    update teams set cap = null, closed = false where id = kept;   -- room for everyone in the group
    made := made + 1;
    perform bd_say(kept, 'The organisers put ' || array_length(grp.people, 1) || ' students who were alone in their teams together: '
      || array_to_string(grp.names, ', ') || '.');

    for r in select p.id, p.name, p.phone from members m join people p on p.id = m.person_id where m.team_id = kept order by m.joined_at loop
      select string_agg(split_part(p.name, ' ', 1), ', ' order by m.joined_at),
             string_agg(p.name || case when p.phone <> '' then ' (+' || p.phone || ')' else '' end, ', ' order by m.joined_at)
        into mates, mates_wa
        from members m join people p on p.id = m.person_id where m.team_id = kept and p.id <> r.id;
      body := 'Your teammates: ' || mates || '. Connect with them on WhatsApp from your team page.';
      if char_length(body) > 140 then
        body := 'You have ' || (array_length(grp.people, 1) - 1) || ' teammates. Connect with them on WhatsApp from your team page.';
      end if;
      perform bd_notify(r.id, '✅ You have been assigned to the team ' || kname, body, 'team-' || kept);
      if r.phone <> '' then
        -- one line (WhatsApp doesn't allow line breaks inside a template variable). The link opens their team page.
        rec := rec || jsonb_build_object('phone', r.phone, 'name', split_part(r.name, ' ', 1), 'team', kname,
          'link', site || '#join=' || kcode,
          'message', 'You were the only member of your team, so you have been assigned to the team "' || kname || '" with '
            || mates_wa || '. Please connect with your teammates on WhatsApp and plan your project together. Keep the chat about the Buildathon only.');
      end if;
    end loop;
  end loop;

  if p_dry_run then return json_build_object('people', n, 'teams', g, 'groups', prev); end if;

  -- WhatsApp through WATI: push-server/api/whatsapp-team.js sends each person their own message
  select value into u from bd_settings where key = 'whatsapp_url';
  select value into s from bd_settings where key = 'notify_secret';
  select value into tpl from bd_settings where key = 'whatsapp_template';
  select value into prm from bd_settings where key = 'whatsapp_params';
  wa_url := case when coalesce(u, '') ~ '/api/whatsapp/?$' then regexp_replace(u, '/api/whatsapp/?$', '/api/whatsapp-team') end;
  if wa_url is null then
    wa_note := 'WhatsApp is not set up, so no WhatsApp message went out (site and phone notifications did).';
  elsif coalesce(prm, '') !~ 'message' then
    wa_note := 'The WhatsApp template has no {{message}} variable, so no WhatsApp message went out (site and phone notifications did).';
  elsif jsonb_array_length(rec) > 0 then
    rid := net.http_post(
      url := wa_url,
      body := jsonb_build_object('template', tpl, 'params', prm, 'recipients', rec,
        'broadcast', 'buildathon-new-team-' || to_char(now() at time zone 'Asia/Kolkata', 'DDMon-HH24MI')),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', coalesce(s, '')),
      timeout_milliseconds := 30000);
    insert into bd_settings (key, value) values ('whatsapp_last', jsonb_build_object('id', rid, 'at', now(), 'count', jsonb_array_length(rec))::text)
      on conflict (key) do update set value = excluded.value;
  end if;
  return json_build_object('people', n, 'teams', made, 'moved', moved,
    'whatsapp', case when rid is null then 0 else jsonb_array_length(rec) end, 'note', wa_note);
end $$;
revoke all on function bd_merge_solos(boolean) from public, anon, authenticated;

create or replace function admin_merge_solos(p_dry_run boolean default false) returns json
language plpgsql security definer set search_path = public as $$
begin
  perform bd_admin_only();
  return bd_merge_solos(p_dry_run);
end $$;
revoke execute on function admin_merge_solos(boolean) from public, anon;
grant execute on function admin_merge_solos(boolean) to authenticated;

revoke execute on function bd_admin_only(), bd_audience(text, uuid), admin_whoami(), admin_overview(), admin_teams(text, text, int), admin_team_options(uuid, text),
  admin_move(uuid, uuid), admin_take_out(uuid), admin_people_options(uuid, text), admin_remove_person(uuid), admin_remove_listed(uuid), admin_rename_team(uuid, text), admin_get_problem(),
  admin_set_problem(text, text), admin_notify(text, text, text, uuid, boolean), admin_activity(int), admin_export(), admin_recheck_students(int) from public, anon;
revoke execute on function bd_audience(text, uuid) from authenticated;
grant execute on function admin_whoami(), admin_overview(), admin_teams(text, text, int), admin_team_options(uuid, text),
  admin_move(uuid, uuid), admin_take_out(uuid), admin_people_options(uuid, text), admin_remove_person(uuid), admin_remove_listed(uuid), admin_rename_team(uuid, text), admin_get_problem(),
  admin_set_problem(text, text), admin_notify(text, text, text, uuid, boolean), admin_activity(int), admin_export(), admin_recheck_students(int) to authenticated;

-- ---------- Reminder schedule (pg_cron runs in UTC; IST = UTC + 5:30) ----------
--   every day 1:00 PM + 8:00 PM IST until the last day: "your team has only you" (teams of 1)
--   20 Nov 10:00 AM + 8:00 PM IST: "teams lock tonight" (teams with room left, people without a team)
--   21 Nov 6:00 PM IST: "problem statement in 1 hour"   ·   21 Nov 7:15 PM IST: "problem statement is out" (teams of 2+)
--   21 Nov 7:16 PM IST: the problem statement on WhatsApp (teams of 2+, once)
do $$ begin
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.schedule('buildathon-push-clean', '*/15 * * * *', 'select public.bd_push_clean()');
  perform cron.schedule('buildathon-solo-1pm', '30 7 * * *', 'select public.bd_remind(''solo'')');
  perform cron.schedule('buildathon-solo-8pm', '30 14 * * *', 'select public.bd_remind(''solo'')');
  perform cron.schedule('buildathon-whatsapp-solo-1pm', '30 7 * * *', 'select public.bd_whatsapp_solo()');   -- WhatsApp (WATI), once a day at 1 PM IST
  perform cron.schedule('buildathon-lock-soon-am', '30 4 20 11 *', 'select public.bd_remind(''lock-soon'')');
  perform cron.schedule('buildathon-lock-soon-pm', '30 14 20 11 *', 'select public.bd_remind(''lock-soon'')');
  perform cron.unschedule(jobname) from cron.job where jobname like 'buildathon-session-%';
  perform cron.schedule('buildathon-reveal-soon', '30 12 21 11 *', 'select public.bd_remind(''reveal-soon'')');
  perform cron.schedule('buildathon-reveal-now', '45 13 21 11 *', 'select public.bd_remind(''reveal-now'')');
  perform cron.schedule('buildathon-whatsapp-problem', '46 13 21 11 *', 'select public.bd_whatsapp_problem()');   -- 21 Nov 7:16 PM IST: the problem statement on WhatsApp
  perform cron.schedule('buildathon-whatsapp-answers', '*/5 * * * *', 'select public.bd_wa_cache()');   -- keep WATI's answers (Overview → Messages sent)
exception when others then
  raise notice 'pg_cron not available, reminder notifications are off: %', sqlerrm;
end $$;

-- ---------- After 20 Nov: the final teams (run this in the SQL editor, then Export → CSV) ----------
-- select t.name as team, t.code, t.size, (t.size >= bd_min()) as ready, p.name, p.domain, p.email, p.phone,
--        (t.leader_id = p.id) as leader, (p.session_ok_at is not null) as agreed_to_session
-- from teams t join members m on m.team_id = t.id join people p on p.id = m.person_id
-- order by t.created_at, m.joined_at;
