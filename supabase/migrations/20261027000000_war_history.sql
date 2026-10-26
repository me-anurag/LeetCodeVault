-- War history: every question a user has been given, with filters. Also makes "never the same question twice"
-- a database rule: a slug can appear in at most one of a user's wars (fill_war already skips them; this
-- also covers two fills racing each other).

drop index if exists public.daily_war_items_user_slug_idx;
create unique index daily_war_items_user_slug_key on public.daily_war_items (user_id, slug);

-- One row per question given, with its day, result and topics (from the saved question, if still there).
create function public.war_history_rows()
returns table (
  id bigint, question_id bigint, slug text, title text, frontend_id text, difficulty text,
  topics jsonb, topic_slugs text[], war_date date, done_at timestamptz, on_time boolean
)
language sql stable set search_path = '' as $$
  select i.id, i.question_id, i.slug, i.title, i.frontend_id, i.difficulty,
         coalesce(q.topics, '[]'), coalesce(q.topic_slugs, '{}'),
         w.war_date, i.done_at, i.done_at <= w.deadline
  from public.daily_war_items i
  join public.daily_wars w on w.id = i.war_id
  left join public.questions q on q.id = i.question_id
  where i.user_id = (select auth.uid())
$$;

-- Filters: any of `p_difficulties`, all of `p_topics`. Sorts: newest / oldest (day given), number_asc /
-- number_desc (LeetCode number), difficulty, title. Returns the first `p_limit` rows plus totals and the
-- topic list (with counts) for the filter chips.
create function public.war_history(
  p_sort text default 'newest', p_difficulties text[] default '{}', p_topics text[] default '{}', p_limit int default 100
) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_total int;
  v_solved int;
  v_items jsonb;
begin
  if p_sort not in ('newest', 'oldest', 'number_asc', 'number_desc', 'difficulty', 'title') then
    raise exception using errcode = '22023', message = 'Unknown sort.',
      detail = '{"sort": "newest, oldest, number_asc, number_desc, difficulty, title"}';
  end if;
  p_limit := least(greatest(coalesce(p_limit, 100), 1), 1000);

  select count(*), count(*) filter (where h.done_at is not null)
    into v_total, v_solved
    from public.war_history_rows() h
   where (cardinality(coalesce(p_difficulties, '{}')) = 0 or h.difficulty = any (p_difficulties))
     and h.topic_slugs @> coalesce(p_topics, '{}');

  select coalesce(jsonb_agg(to_jsonb(r) - 'topic_slugs' - 'n' order by r.n), '[]') into v_items
  from (
    select h.*, row_number() over (
      order by
        case when p_sort = 'newest' then h.war_date end desc,
        case when p_sort = 'oldest' then h.war_date end asc,
        case when p_sort = 'number_asc' then nullif(regexp_replace(h.frontend_id, '\D', '', 'g'), '')::int end asc nulls last,
        case when p_sort = 'number_desc' then nullif(regexp_replace(h.frontend_id, '\D', '', 'g'), '')::int end desc nulls last,
        case when p_sort = 'difficulty' then array_position(array['Easy', 'Medium', 'Hard'], h.difficulty) end asc,
        case when p_sort = 'title' then lower(h.title) end asc,
        h.war_date desc, array_position(array['Easy', 'Medium', 'Hard'], h.difficulty), h.id
    ) as n
    from public.war_history_rows() h
    where (cardinality(coalesce(p_difficulties, '{}')) = 0 or h.difficulty = any (p_difficulties))
      and h.topic_slugs @> coalesce(p_topics, '{}')
  ) r
  where r.n <= p_limit;

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'solved', v_solved,
    'topics', (
      select coalesce(jsonb_agg(jsonb_build_object('slug', slug, 'name', name, 'count', n) order by n desc, name), '[]')
      from (
        select t ->> 'slug' as slug, min(t ->> 'name') as name, count(*) as n
        from public.war_history_rows() h, jsonb_array_elements(h.topics) t
        group by t ->> 'slug'
      ) s
    )
  );
end $$;

revoke all on function public.war_history_rows() from public, anon;
revoke all on function public.war_history(text, text[], text[], int) from public, anon;
grant execute on function public.war_history_rows() to authenticated;
grant execute on function public.war_history(text, text[], text[], int) to authenticated;
