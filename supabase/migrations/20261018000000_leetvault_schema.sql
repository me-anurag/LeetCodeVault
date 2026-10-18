-- LeetVault schema for Supabase.
--
-- Users are Supabase Auth users (auth.users). Every row carries user_id and Row Level Security limits each
-- user to their own rows. The original LeetCode data (statement, starter code) can only be written through
-- save_question(); users may edit only their notes and their own solutions.

-- ---------------------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------------------

create table public.questions (
  id               bigint generated always as identity primary key,
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  frontend_id      text check (char_length(frontend_id) <= 20),
  title            text not null check (char_length(title) between 1 and 300),
  slug             text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 300),
  leetcode_url     text not null check (leetcode_url ~ '^https://leetcode\.(com|cn)/problems/[a-z0-9-]+/$'),
  description      text not null check (char_length(description) between 1 and 300000), -- original HTML
  description_text text not null default '',                                              -- plain text for search
  difficulty       text not null check (difficulty in ('Easy', 'Medium', 'Hard')),
  topics           jsonb not null default '[]' check (jsonb_typeof(topics) = 'array'),    -- [{name, slug}]
  topic_slugs      text[] not null default '{}',                                           -- for filtering
  examples         jsonb not null default '[]' check (jsonb_typeof(examples) = 'array'),  -- [{title, text}]
  constraints      jsonb not null default '[]' check (jsonb_typeof(constraints) = 'array'), -- ["..."]
  personal_notes   text not null default '' check (char_length(personal_notes) <= 200000),
  saved_at         timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint questions_user_slug_key unique (user_id, slug)
);
create index questions_user_saved_at_idx on public.questions (user_id, saved_at desc);
create index questions_user_difficulty_idx on public.questions (user_id, difficulty);
create index questions_topic_slugs_idx on public.questions using gin (topic_slugs);

create table public.question_language_versions (
  id            bigint generated always as identity primary key,
  question_id   bigint not null references public.questions (id) on delete cascade,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  language      text not null check (language ~ '^[a-z0-9+#_-]{1,40}$'),  -- LeetCode langSlug: python3, cpp…
  language_name text not null check (char_length(language_name) between 1 and 60), -- Python3, C++…
  starter_code  text not null check (btrim(starter_code) <> '' and char_length(starter_code) <= 100000),
  saved_at      timestamptz not null default now(),
  constraint question_language_versions_question_language_key unique (question_id, language)
);
create index question_language_versions_user_language_idx on public.question_language_versions (user_id, language);

create table public.personal_solutions (
  id            bigint generated always as identity primary key,
  question_id   bigint not null references public.questions (id) on delete cascade,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  language      text not null default '' check (language = '' or language ~ '^[a-z0-9+#_-]{1,40}$'),
  solution_code text not null default '' check (char_length(solution_code) <= 100000),
  notes         text not null default '' check (char_length(notes) <= 200000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint personal_solutions_not_empty check (btrim(solution_code) <> '' or btrim(notes) <> '')
);
create index personal_solutions_question_idx on public.personal_solutions (question_id);

-- ---------------------------------------------------------------------------------------------------------------
-- Timestamps
-- ---------------------------------------------------------------------------------------------------------------

create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger questions_set_updated_at before update on public.questions
  for each row execute function public.set_updated_at();
create trigger personal_solutions_set_updated_at before update on public.personal_solutions
  for each row execute function public.set_updated_at();

-- Changing a question's languages or solutions counts as editing the question.
create function public.touch_question() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.questions set updated_at = now()
  where id = coalesce(new.question_id, old.question_id);
  return null;
end $$;

create trigger question_language_versions_touch after insert or delete on public.question_language_versions
  for each row execute function public.touch_question();
create trigger personal_solutions_touch after insert or update or delete on public.personal_solutions
  for each row execute function public.touch_question();

-- ---------------------------------------------------------------------------------------------------------------
-- Privileges + Row Level Security
-- ---------------------------------------------------------------------------------------------------------------

revoke all on public.questions, public.question_language_versions, public.personal_solutions from anon, authenticated;

grant select, delete on public.questions to authenticated;
grant update (personal_notes) on public.questions to authenticated;          -- original data stays read-only
grant select, delete on public.question_language_versions to authenticated; -- inserted only via save_question()
grant select, insert, delete on public.personal_solutions to authenticated;
grant update (language, solution_code, notes) on public.personal_solutions to authenticated;

alter table public.questions enable row level security;
alter table public.question_language_versions enable row level security;
alter table public.personal_solutions enable row level security;

create policy "own questions: read" on public.questions for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own questions: edit notes" on public.questions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own questions: delete" on public.questions for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "own versions: read" on public.question_language_versions for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own versions: delete" on public.question_language_versions for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "own solutions: read" on public.personal_solutions for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own solutions: add" on public.personal_solutions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.questions q where q.id = question_id and q.user_id = (select auth.uid()))
  );
create policy "own solutions: edit" on public.personal_solutions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own solutions: delete" on public.personal_solutions for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------------------------
-- save_question: validate and store one question + one language version, atomically.
-- Returns {status: created | language_added | already_saved, question_id, language, languages}.
-- Validation failures raise SQLSTATE 22023 with per-field messages as JSON in DETAIL.
-- ---------------------------------------------------------------------------------------------------------------

create function public.save_question(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid           uuid := auth.uid();
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

revoke all on function public.save_question(jsonb) from public, anon;
grant execute on function public.save_question(jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Read helpers (run as the caller, so RLS applies)
-- ---------------------------------------------------------------------------------------------------------------

create function public.question_summary(q public.questions) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', q.id,
    'frontend_id', q.frontend_id,
    'title', q.title,
    'slug', q.slug,
    'leetcode_url', q.leetcode_url,
    'difficulty', q.difficulty,
    'topics', q.topics,
    'languages', (
      select coalesce(jsonb_agg(jsonb_build_object('language', v.language, 'language_name', v.language_name)
                                order by v.saved_at, v.id), '[]')
      from public.question_language_versions v where v.question_id = q.id
    ),
    'saved_at', q.saved_at,
    'updated_at', q.updated_at
  )
$$;

-- Search: every word of q must match the title, statement text, a topic, or the problem number.
-- Filters: any of `difficulties`, all of `topics`, any of `languages`.
create function public.filtered_questions(
  p_q text default '', p_difficulties text[] default '{}', p_topics text[] default '{}', p_languages text[] default '{}'
) returns setof public.questions
language sql stable set search_path = '' as $$
  select qq.*
  from public.questions qq
  where qq.user_id = (select auth.uid())
    and (cardinality(coalesce(p_difficulties, '{}')) = 0 or qq.difficulty = any (p_difficulties))
    and qq.topic_slugs @> coalesce(p_topics, '{}')
    and (cardinality(coalesce(p_languages, '{}')) = 0 or exists (
      select 1 from public.question_language_versions v where v.question_id = qq.id and v.language = any (p_languages)
    ))
    and not exists (
      select 1
      from (
        select '%' || replace(replace(replace(term, '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern, term
        from unnest(regexp_split_to_array(btrim(coalesce(p_q, '')), '\s+')) with ordinality as w (term, n)
        where term <> '' and n <= 10
      ) w
      where not (
        qq.title ilike w.pattern
        or qq.description_text ilike w.pattern
        or qq.frontend_id = w.term
        or exists (
          select 1 from jsonb_array_elements(qq.topics) t
          where t ->> 'name' ilike w.pattern or t ->> 'slug' ilike w.pattern
        )
      )
    )
$$;

create function public.list_questions(
  p_q text default '', p_difficulties text[] default '{}', p_topics text[] default '{}', p_languages text[] default '{}',
  p_sort text default 'newest', p_page int default 1, p_per_page int default 25
) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_total int;
  v_items jsonb;
begin
  if p_sort not in ('newest', 'oldest', 'title', 'difficulty', 'updated') then
    raise exception using errcode = '22023', message = 'Unknown sort.', detail = '{"sort": "newest, oldest, title, difficulty, updated"}';
  end if;
  if exists (select 1 from unnest(coalesce(p_difficulties, '{}')) d where d not in ('Easy', 'Medium', 'Hard')) then
    raise exception using errcode = '22023', message = 'Unknown difficulty filter.', detail = '{"difficulty": "Easy, Medium or Hard."}';
  end if;
  p_page := greatest(coalesce(p_page, 1), 1);
  p_per_page := least(greatest(coalesce(p_per_page, 25), 1), 100);

  select count(*) into v_total from public.filtered_questions(p_q, p_difficulties, p_topics, p_languages);

  select coalesce(jsonb_agg(public.question_summary(qq) order by f.rn), '[]') into v_items
  from (
    select fq.id, row_number() over (
      order by
        case when p_sort = 'newest' then fq.saved_at end desc,
        case when p_sort = 'oldest' then fq.saved_at end asc,
        case when p_sort = 'title' then lower(fq.title) end asc,
        case when p_sort = 'difficulty' then array_position(array['Easy', 'Medium', 'Hard'], fq.difficulty) end asc,
        case when p_sort = 'updated' then fq.updated_at end desc,
        fq.saved_at desc, fq.id desc
    ) as rn
    from public.filtered_questions(p_q, p_difficulties, p_topics, p_languages) fq
  ) f
  join public.questions qq on qq.id = f.id
  where f.rn > (p_page - 1) * p_per_page and f.rn <= p_page * p_per_page;

  return jsonb_build_object(
    'items', v_items, 'page', p_page, 'per_page', p_per_page, 'total', v_total,
    'pages', (v_total + p_per_page - 1) / p_per_page
  );
end $$;

create function public.get_stats() returns jsonb
language sql stable set search_path = '' as $$
  with mine as (select * from public.questions where user_id = (select auth.uid()))
  select jsonb_build_object(
    'total', (select count(*) from mine),
    'difficulty', jsonb_build_object(
      'Easy', (select count(*) from mine where difficulty = 'Easy'),
      'Medium', (select count(*) from mine where difficulty = 'Medium'),
      'Hard', (select count(*) from mine where difficulty = 'Hard')
    ),
    'topics', (
      select coalesce(jsonb_agg(jsonb_build_object('slug', slug, 'name', name, 'count', n) order by n desc, name), '[]')
      from (
        select t ->> 'slug' as slug, min(t ->> 'name') as name, count(*) as n
        from mine, jsonb_array_elements(mine.topics) t
        group by t ->> 'slug'
      ) s
    ),
    'languages', (
      select coalesce(jsonb_agg(jsonb_build_object('language', language, 'language_name', language_name, 'count', n)
                                order by n desc, language), '[]')
      from (
        select v.language, min(v.language_name) as language_name, count(*) as n
        from public.question_language_versions v join mine on mine.id = v.question_id
        group by v.language
      ) l
    ),
    'recent', (
      select coalesce(jsonb_agg(public.question_summary(r) order by r.saved_at desc, r.id desc), '[]')
      from (select * from mine order by saved_at desc, id desc limit 5) r
    )
  )
$$;

revoke all on function public.question_summary(public.questions) from public, anon;
revoke all on function public.filtered_questions(text, text[], text[], text[]) from public, anon;
revoke all on function public.list_questions(text, text[], text[], text[], text, int, int) from public, anon;
revoke all on function public.get_stats() from public, anon;
grant execute on function public.question_summary(public.questions) to authenticated;
grant execute on function public.filtered_questions(text, text[], text[], text[]) to authenticated;
grant execute on function public.list_questions(text, text[], text[], text[], text, int, int) to authenticated;
grant execute on function public.get_stats() to authenticated;

-- Trigger helpers are not API endpoints.
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.touch_question() from public, anon, authenticated;
