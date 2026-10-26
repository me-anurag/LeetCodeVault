-- Topic focus for daily wars: a user can pick topics (e.g. String and Array) and every following war takes
-- its questions only from those topics, until they pick others or go back to random (no topics).
-- The 5 Easy / 7 Medium / 3 Hard mix stays. If a topic runs out of new questions of some difficulty,
-- the remaining slots are filled from any topic so the war still has 15.

create table public.war_settings (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  topics     text[] not null default '{}', -- LeetCode topic slugs; empty = any topic
  updated_at timestamptz not null default now()
);

revoke all on public.war_settings from anon, authenticated;
grant select on public.war_settings to authenticated; -- changed only via set_war_topics()
alter table public.war_settings enable row level security;
create policy "own war settings: read" on public.war_settings for select to authenticated
  using (user_id = (select auth.uid()));

create function public.get_war_settings() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('topics', coalesce(
    (select to_jsonb(topics) from public.war_settings where user_id = (select auth.uid())), '[]'
  ))
$$;

-- Empty array = random (any topic).
create function public.set_war_topics(p_topics text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_topics text[];
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Not logged in.';
  end if;
  select coalesce(array_agg(distinct t order by t), '{}') into v_topics
  from unnest(coalesce(p_topics, '{}')) t where t <> '';
  if exists (select 1 from unnest(v_topics) t where t !~ '^[a-z0-9]+(-[a-z0-9]+)*$')
     or cardinality(v_topics) > 20 then
    raise exception using errcode = '22023', message = 'Invalid topics.', detail = '{"topics": "Up to 20 LeetCode topic slugs."}';
  end if;
  insert into public.war_settings (user_id, topics) values (auth.uid(), v_topics)
  on conflict (user_id) do update set topics = excluded.topics, updated_at = now();
  return jsonb_build_object('topics', to_jsonb(v_topics));
end $$;

revoke all on function public.get_war_settings() from public, anon;
revoke all on function public.set_war_topics(text[]) from public, anon;
grant execute on function public.get_war_settings() to authenticated;
grant execute on function public.set_war_topics(text[]) to authenticated;

-- Same as before, plus the topic focus: each page of candidates comes from one of the chosen topics, picked
-- at random (LeetCode's own filter would require *all* chosen topics on a question).
create or replace function private.fill_war(uid uuid) returns int
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
  v_topics   text[];
  v_target   record;
  v_have     int;
  v_filters  jsonb;
  v_total    int;
  v_page     jsonb;
  v_slug     text;
  v_q        jsonb;
  v_snippet  jsonb;
  v_saved    jsonb;
  v_added    int := 0;
  v_attempts int;
  v_max      int;
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

  select coalesce((select topics from public.war_settings where user_id = uid), '{}') into v_topics;
  -- With a topic focus: up to 6 pages from the chosen topics, then up to 3 from any topic as a fallback.
  v_max := case when cardinality(v_topics) > 0 then 9 else 5 end;

  for v_target in select * from (values ('Easy', 5), ('Medium', 7), ('Hard', 3)) t (difficulty, wanted) loop
    select count(*) into v_have from public.daily_war_items where war_id = v_war and difficulty = v_target.difficulty;
    v_attempts := 0;

    while v_have < v_target.wanted and v_attempts < v_max loop
      v_attempts := v_attempts + 1;
      v_filters := jsonb_build_object('difficulty', upper(v_target.difficulty));
      if cardinality(v_topics) > 0 and v_attempts <= 6 then
        v_filters := v_filters || jsonb_build_object(
          'tags', jsonb_build_array(v_topics[1 + floor(random() * cardinality(v_topics))::int])
        );
      end if;

      -- A random page of 100 questions of this difficulty (and topic)...
      v_total := (private.leetcode(list_query, jsonb_build_object('limit', 1, 'skip', 0, 'filters', v_filters))
                  -> 'questionList' ->> 'totalNum')::int;
      v_page := private.leetcode(list_query, jsonb_build_object(
        'limit', 100, 'skip', floor(random() * greatest(coalesce(v_total, 0) - 100, 0))::int, 'filters', v_filters
      )) -> 'questionList' -> 'data';

      -- ...then free questions this user has never had in a war or saved, in random order.
      for v_slug in
        select x ->> 'titleSlug' from jsonb_array_elements(coalesce(v_page, '[]')) x
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

revoke all on function private.fill_war(uuid) from public, anon, authenticated;
