-- DailyWars: every day at 3:00 am (India time) each user gets 15 new LeetCode questions (5 Easy, 7 Medium,
-- 3 Hard) to finish before 10:30 pm. The database picks and fetches them itself (pg_cron + the http
-- extension), so nothing has to be running on the user's computer.
--
-- A day is "won" when every question of that day's war was marked done before its deadline. Questions are
-- stored in the normal `questions` table (with starter code in the user's most-used language), so they can be
-- read, annotated and solved like saved ones.

create extension if not exists pg_cron;
create extension if not exists http with schema extensions;

-- Not exposed through the API: only the cron job and other functions call these.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- save_question, callable for any user (the cron job has no logged-in user)
-- ---------------------------------------------------------------------------------------------------------------

create function private.save_question_for(uid uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  errors        jsonb := '{}';
  m             text[];
  v_title       text := btrim(coalesce(p ->> 'title', ''));
  v_url         text := btrim(coalesce(p ->> 'leetcode_url', ''));
  v_slug        text;
  v_description text := coalesce(p ->> 'description', '');
  v_text        text := coalesce(p ->> 'description_text', '');
  v_difficulty  text := initcap(btrim(coalesce(p ->> 'difficulty', '')));
  v_language    text := lower(btrim(coalesce(p ->> 'language', '')));
  v_lang_name   text := btrim(coalesce(p ->> 'language_name', ''));
  v_code        text := coalesce(p ->> 'starter_code', '');
  v_frontend    text := nullif(btrim(coalesce(p ->> 'frontend_id', '')), '');
  v_topics      jsonb := '[]';
  v_topic_slugs text[] := '{}';
  v_examples    jsonb := coalesce(p -> 'examples', '[]');
  v_constraints jsonb := coalesce(p -> 'constraints', '[]');
  v_saved_at    timestamptz := now();
  v_question_id bigint;
  v_version_id  bigint;
  v_created     boolean := false;
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'Not logged in.';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception using errcode = '22023', message = 'Expected a JSON object.';
  end if;

  if v_title = '' then errors := errors || '{"title": "This field is required."}';
  elsif char_length(v_title) > 300 then errors := errors || '{"title": "Must be at most 300 characters."}'; end if;

  m := regexp_match(v_url, '^https?://(?:www\.)?(leetcode\.(?:com|cn))/problems/([a-z0-9]+(?:-[a-z0-9]+)*)(?:[/?#]|$)');
  if m is null then
    errors := errors || '{"leetcode_url": "Not a LeetCode problem URL."}';
  else
    v_slug := m[2];
    v_url := 'https://' || m[1] || '/problems/' || v_slug || '/';
    if coalesce(p ->> 'slug', '') not in ('', v_slug) then
      errors := errors || '{"slug": "Slug does not match the problem URL."}';
    end if;
  end if;

  if btrim(v_description) = '' then errors := errors || '{"description": "This field is required."}';
  elsif char_length(v_description) > 300000 then errors := errors || '{"description": "Too long."}'; end if;

  if v_difficulty not in ('Easy', 'Medium', 'Hard') then
    errors := errors || '{"difficulty": "Must be Easy, Medium or Hard."}';
  end if;

  if v_language !~ '^[a-z0-9+#_-]{1,40}$' then errors := errors || '{"language": "Invalid language identifier."}'; end if;
  if v_lang_name = '' then v_lang_name := v_language; end if;
  if char_length(v_lang_name) > 60 then errors := errors || '{"language_name": "Too long."}'; end if;

  if btrim(v_code) = '' then errors := errors || '{"starter_code": "This field is required."}';
  elsif char_length(v_code) > 100000 then errors := errors || '{"starter_code": "Too long."}'; end if;

  if v_frontend is not null and char_length(v_frontend) > 20 then
    errors := errors || '{"frontend_id": "Too long."}';
  end if;

  if p ? 'topics' and jsonb_typeof(p -> 'topics') = 'array' then
    if exists (
      select 1 from jsonb_array_elements(p -> 'topics') t
      where jsonb_typeof(t) <> 'object' or coalesce(t ->> 'slug', '') !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
         or btrim(coalesce(t ->> 'name', '')) = '' or char_length(t ->> 'name') > 100
    ) then
      errors := errors || '{"topics": "Each topic must be {name, slug}."}';
    else
      select coalesce(jsonb_agg(jsonb_build_object('name', name, 'slug', slug) order by ord), '[]'),
             coalesce(array_agg(slug order by ord), '{}')
        into v_topics, v_topic_slugs
        from (
          select distinct on (t ->> 'slug') btrim(t ->> 'name') as name, t ->> 'slug' as slug, ord
          from jsonb_array_elements(p -> 'topics') with ordinality as x (t, ord)
          order by t ->> 'slug', ord
        ) d;
    end if;
  elsif p ? 'topics' and jsonb_typeof(p -> 'topics') <> 'null' then
    errors := errors || '{"topics": "Must be a list."}';
  end if;

  if jsonb_typeof(v_examples) <> 'array' then errors := errors || '{"examples": "Must be a list."}'; end if;
  if jsonb_typeof(v_constraints) <> 'array' then errors := errors || '{"constraints": "Must be a list."}'; end if;

  if errors <> '{}' then
    raise exception using errcode = '22023',
      message = 'Some required question fields are missing or invalid.', detail = errors::text;
  end if;

  -- When the user clicked Save (matters for saves queued offline). Implausible values fall back to now().
  begin
    v_saved_at := (p ->> 'saved_at')::timestamptz;
    if v_saved_at is null or v_saved_at > now() + interval '5 minutes' or v_saved_at < now() - interval '90 days' then
      v_saved_at := now();
    end if;
    v_saved_at := least(v_saved_at, now());
  exception when others then
    v_saved_at := now();
  end;

  if btrim(v_text) = '' then
    v_text := btrim(regexp_replace(regexp_replace(v_description, '<[^>]+>', ' ', 'g'), '\s+', ' ', 'g'));
  end if;

  insert into public.questions (
    user_id, frontend_id, title, slug, leetcode_url, description, description_text, difficulty,
    topics, topic_slugs, examples, constraints, saved_at, updated_at
  ) values (
    uid, v_frontend, v_title, v_slug, v_url, v_description, v_text, v_difficulty,
    v_topics, v_topic_slugs, v_examples, v_constraints, v_saved_at, v_saved_at
  )
  on conflict (user_id, slug) do nothing
  returning id into v_question_id;

  if v_question_id is not null then
    v_created := true;
  else
    select id into v_question_id from public.questions where user_id = uid and slug = v_slug;
    -- Never overwrite the original statement; only fill in what an earlier save could not capture.
    update public.questions
       set topics = v_topics, topic_slugs = v_topic_slugs
     where id = v_question_id and cardinality(topic_slugs) = 0 and cardinality(v_topic_slugs) > 0;
    update public.questions
       set frontend_id = v_frontend
     where id = v_question_id and frontend_id is null and v_frontend is not null;
  end if;

  insert into public.question_language_versions (question_id, user_id, language, language_name, starter_code, saved_at)
  values (v_question_id, uid, v_language, v_lang_name, v_code, v_saved_at)
  on conflict (question_id, language) do nothing
  returning id into v_version_id;

  return jsonb_build_object(
    'status', case when v_version_id is null then 'already_saved' when v_created then 'created' else 'language_added' end,
    'question_id', v_question_id,
    'language', v_language,
    'languages', (
      select coalesce(jsonb_agg(language order by saved_at, id), '[]')
      from public.question_language_versions where question_id = v_question_id
    )
  );
end $$;

-- The extension's endpoint is unchanged: it now delegates to the shared implementation.
create or replace function public.save_question(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  return private.save_question_for(auth.uid(), p);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------------------

create table public.daily_wars (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  war_date   date not null,          -- the day in India time; the war runs 3:00 am to 10:30 pm
  deadline   timestamptz not null,
  created_at timestamptz not null default now(),
  constraint daily_wars_user_date_key unique (user_id, war_date)
);

-- Title/slug/difficulty are copied so a past war still reads correctly if the question is deleted later.
create table public.daily_war_items (
  id          bigint generated always as identity primary key,
  war_id      bigint not null references public.daily_wars (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  question_id bigint references public.questions (id) on delete set null,
  position    smallint not null,
  slug        text not null,
  title       text not null,
  frontend_id text,
  difficulty  text not null check (difficulty in ('Easy', 'Medium', 'Hard')),
  done_at     timestamptz,           -- set by the "done" button; after the deadline it counts as late
  constraint daily_war_items_war_position_key unique (war_id, position),
  constraint daily_war_items_war_slug_key unique (war_id, slug)
);
create index daily_war_items_question_idx on public.daily_war_items (question_id);
create index daily_war_items_user_slug_idx on public.daily_war_items (user_id, slug);

revoke all on public.daily_wars, public.daily_war_items from anon, authenticated;
grant select on public.daily_wars, public.daily_war_items to authenticated; -- changes only via functions

alter table public.daily_wars enable row level security;
alter table public.daily_war_items enable row level security;

create policy "own wars: read" on public.daily_wars for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own war items: read" on public.daily_war_items for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------------------------
-- Picking and fetching questions from LeetCode
-- ---------------------------------------------------------------------------------------------------------------

create function private.leetcode(p_query text, p_variables jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  r extensions.http_response;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '20');
  r := extensions.http((
    'POST',
    'https://leetcode.com/graphql/',
    array[
      extensions.http_header('Referer', 'https://leetcode.com/problemset/'),
      extensions.http_header('User-Agent', 'Mozilla/5.0 (compatible; DailyWars)')
    ],
    'application/json',
    jsonb_build_object('query', p_query, 'variables', p_variables)::text
  )::extensions.http_request);
  if r.status <> 200 then
    raise exception 'LeetCode returned HTTP %', r.status;
  end if;
  return r.content::jsonb -> 'data';
end $$;

-- Today's war in India time. The "war day" starts at 3:00 am, so between midnight and 3:00 am it is still
-- the previous day's war.
create function private.war_today() returns date
language sql stable set search_path = '' as $$
  select ((now() at time zone 'Asia/Kolkata') - interval '3 hours')::date
$$;

-- Creates today's war for one user, or tops it up if an earlier attempt could not fetch everything.
-- Returns the number of questions added.
create function private.fill_war(uid uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  list_query constant text := 'query list($limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
    questionList(categorySlug: "algorithms", limit: $limit, skip: $skip, filters: $filters) {
      totalNum data { titleSlug isPaidOnly } } }';
  detail_query constant text := 'query detail($titleSlug: String!) {
    question(titleSlug: $titleSlug) {
      questionFrontendId title titleSlug difficulty isPaidOnly content
      topicTags { name slug } codeSnippets { lang langSlug code } } }';
  v_date     date := private.war_today();
  v_war      bigint;
  v_lang     text;
  v_target   record;
  v_have     int;
  v_total    int;
  v_page     jsonb;
  v_slug     text;
  v_q        jsonb;
  v_snippet  jsonb;
  v_saved    jsonb;
  v_added    int := 0;
  v_attempts int;
begin
  insert into public.daily_wars (user_id, war_date, deadline)
  values (uid, v_date, (v_date + time '22:30') at time zone 'Asia/Kolkata')
  on conflict (user_id, war_date) do nothing;
  select id into v_war from public.daily_wars where user_id = uid and war_date = v_date;

  -- Starter code in the language this user saves most, else Python.
  select coalesce((
    select language from public.question_language_versions where user_id = uid
    group by language order by count(*) desc, max(saved_at) desc limit 1
  ), 'python3') into v_lang;

  for v_target in select * from (values ('Easy', 5), ('Medium', 7), ('Hard', 3)) t (difficulty, wanted) loop
    select count(*) into v_have from public.daily_war_items where war_id = v_war and difficulty = v_target.difficulty;
    if v_have >= v_target.wanted then continue; end if;

    v_total := (private.leetcode(list_query, jsonb_build_object(
      'limit', 1, 'skip', 0, 'filters', jsonb_build_object('difficulty', upper(v_target.difficulty))
    )) -> 'questionList' ->> 'totalNum')::int;
    v_attempts := 0;

    while v_have < v_target.wanted and v_attempts < 5 loop
      v_attempts := v_attempts + 1;
      -- A random page of 100 questions of this difficulty...
      v_page := private.leetcode(list_query, jsonb_build_object(
        'limit', 100,
        'skip', floor(random() * greatest(v_total - 100, 0))::int,
        'filters', jsonb_build_object('difficulty', upper(v_target.difficulty))
      )) -> 'questionList' -> 'data';

      -- ...then free questions this user has never had in a war or saved, in random order.
      for v_slug in
        select x ->> 'titleSlug' from jsonb_array_elements(v_page) x
        where not (x ->> 'isPaidOnly')::boolean
          and not exists (select 1 from public.questions q where q.user_id = uid and q.slug = x ->> 'titleSlug')
          and not exists (select 1 from public.daily_war_items i where i.user_id = uid and i.slug = x ->> 'titleSlug')
        order by random()
      loop
        exit when v_have >= v_target.wanted;
        begin
          v_q := private.leetcode(detail_query, jsonb_build_object('titleSlug', v_slug)) -> 'question';
          if v_q is null or v_q ->> 'content' is null or v_q ->> 'difficulty' <> v_target.difficulty then
            continue;
          end if;
          select s into v_snippet from jsonb_array_elements(v_q -> 'codeSnippets') s
          order by (s ->> 'langSlug') = v_lang desc, (s ->> 'langSlug') = 'python3' desc limit 1;
          if v_snippet is null then continue; end if;

          v_saved := private.save_question_for(uid, jsonb_build_object(
            'title', v_q ->> 'title',
            'slug', v_q ->> 'titleSlug',
            'frontend_id', v_q ->> 'questionFrontendId',
            'leetcode_url', 'https://leetcode.com/problems/' || (v_q ->> 'titleSlug') || '/',
            'description', v_q ->> 'content',
            'difficulty', v_q ->> 'difficulty',
            'topics', coalesce((
              select jsonb_agg(jsonb_build_object('name', t ->> 'name', 'slug', t ->> 'slug'))
              from jsonb_array_elements(v_q -> 'topicTags') t
            ), '[]'),
            'language', v_snippet ->> 'langSlug',
            'language_name', v_snippet ->> 'lang',
            'starter_code', v_snippet ->> 'code'
          ));
          insert into public.daily_war_items (war_id, user_id, question_id, position, slug, title, frontend_id, difficulty)
          values (
            v_war, uid, (v_saved ->> 'question_id')::bigint,
            (select coalesce(max(position), 0) + 1 from public.daily_war_items where war_id = v_war),
            v_q ->> 'titleSlug', v_q ->> 'title', v_q ->> 'questionFrontendId', v_target.difficulty
          );
          v_have := v_have + 1;
          v_added := v_added + 1;
        exception when others then
          raise warning 'DailyWars: skipped % for user %: %', v_slug, uid, sqlerrm;
        end;
      end loop;
    end loop;
  end loop;
  return v_added;
end $$;

-- Run by pg_cron every 15 minutes. Between 3:00 am and 10:30 pm it makes sure every user has a full war
-- for today (normally all the work happens at 3:00 am; later runs only retry after a LeetCode failure).
create function private.generate_daily_wars() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_now  time := (now() at time zone 'Asia/Kolkata')::time;
  v_user uuid;
begin
  if v_now < time '03:00' or v_now >= time '22:30' then return; end if;
  for v_user in
    select u.id from auth.users u
    where not exists (
      select 1 from public.daily_wars w
      where w.user_id = u.id and w.war_date = private.war_today()
        and (select count(*) from public.daily_war_items i where i.war_id = w.id) >= 15
    )
  loop
    begin
      perform private.fill_war(v_user);
    exception when others then
      raise warning 'DailyWars: could not build the war for user %: %', v_user, sqlerrm;
    end;
  end loop;
end $$;

revoke all on function private.save_question_for(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.leetcode(text, jsonb) from public, anon, authenticated;
revoke all on function private.war_today() from public, anon, authenticated;
revoke all on function private.fill_war(uuid) from public, anon, authenticated;
revoke all on function private.generate_daily_wars() from public, anon, authenticated;

select cron.schedule('daily-wars', '*/15 * * * *', 'select private.generate_daily_wars()');

-- ---------------------------------------------------------------------------------------------------------------
-- API for the website (runs as the caller, so RLS applies, except the done button)
-- ---------------------------------------------------------------------------------------------------------------

-- One row per war: how many questions, how many done, how many done before the deadline.
create function public.war_days(p_from date default '2000-01-01', p_to date default '9999-12-31')
returns table (war_date date, deadline timestamptz, total int, done int, on_time int, won boolean, ended boolean)
language sql stable set search_path = '' as $$
  select w.war_date, w.deadline,
         count(i.id)::int,
         count(i.done_at)::int,
         count(*) filter (where i.done_at <= w.deadline)::int,
         count(i.id) > 0 and count(*) filter (where i.done_at <= w.deadline) = count(i.id),
         now() > w.deadline
  from public.daily_wars w
  left join public.daily_war_items i on i.war_id = w.id
  where w.user_id = (select auth.uid()) and w.war_date between p_from and p_to
  group by w.id
  order by w.war_date
$$;

-- Current and best streak of won days. Today's war does not break the streak while it is still running,
-- and a day the server could not fetch any questions for is skipped.
create function public.war_streak() returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  d      record;
  v_run  int := 0;
  v_best int := 0;
  v_won  int := 0;
begin
  for d in select * from public.war_days() loop
    continue when d.total = 0 or (not d.won and not d.ended);
    if d.won then
      v_run := v_run + 1;
      v_won := v_won + 1;
      v_best := greatest(v_best, v_run);
    else
      v_run := 0;
    end if;
  end loop;
  return jsonb_build_object('current', v_run, 'best', v_best, 'won', v_won);
end $$;

-- The war for one day (default: today) with its questions, deadline and the streak.
create function public.get_war(p_date date default null) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_today date := private.war_today();
  v_date  date := coalesce(p_date, v_today);
  v_war   public.daily_wars;
begin
  select * into v_war from public.daily_wars where user_id = (select auth.uid()) and war_date = v_date;
  return jsonb_build_object(
    'date', v_date,
    'today', v_today,
    'exists', v_war.id is not null,
    'starts_at', (v_date + time '03:00') at time zone 'Asia/Kolkata',
    'deadline', coalesce(v_war.deadline, (v_date + time '22:30') at time zone 'Asia/Kolkata'),
    'next_start', ((v_today + 1) + time '03:00') at time zone 'Asia/Kolkata',
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'question_id', i.question_id, 'slug', i.slug, 'title', i.title,
        'frontend_id', i.frontend_id, 'difficulty', i.difficulty, 'done_at', i.done_at
      ) order by array_position(array['Easy', 'Medium', 'Hard'], i.difficulty), i.position)
      from public.daily_war_items i where i.war_id = v_war.id
    ), '[]'),
    'streak', public.war_streak()
  );
end $$;

-- The done button. Marking is recorded with the current time (after the deadline it counts as late);
-- unmarking clears it.
create function public.set_war_item_done(p_item bigint, p_done boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v jsonb;
begin
  update public.daily_war_items
     set done_at = case when p_done then coalesce(done_at, now()) end
   where id = p_item and user_id = auth.uid()
  returning jsonb_build_object('id', id, 'done_at', done_at) into v;
  if v is null then
    raise exception using errcode = 'PT404', message = 'War question not found.'; -- PostgREST: HTTP 404
  end if;
  return v;
end $$;

revoke all on function public.war_days(date, date) from public, anon;
revoke all on function public.war_streak() from public, anon;
revoke all on function public.get_war(date) from public, anon;
revoke all on function public.set_war_item_done(bigint, boolean) from public, anon;
grant execute on function public.war_days(date, date) to authenticated;
grant execute on function public.war_streak() to authenticated;
grant execute on function public.get_war(date) to authenticated;
grant execute on function public.set_war_item_done(bigint, boolean) to authenticated;

-- get_war (running as the caller) needs today's date helper.
grant usage on schema private to authenticated;
grant execute on function private.war_today() to authenticated;
