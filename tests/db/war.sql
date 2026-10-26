-- DailyWars generator and streak test. Calls the live LeetCode API and rolls everything back afterwards.
-- Run against local Supabase (`npm run db:start`):  npm run test:war

begin;

insert into auth.users (id, email, aud, role)
values ('00000000-0000-0000-0000-0000000000aa', 'war-test@example.com', 'authenticated', 'authenticated');

-- 1. Today's war: 5 Easy, 7 Medium, 3 Hard, each stored as a full question with starter code.
do $$
declare
  uid constant uuid := '00000000-0000-0000-0000-0000000000aa';
  v_added int;
  v_counts jsonb;
begin
  v_added := private.fill_war(uid);
  select jsonb_object_agg(difficulty, n) into v_counts
  from (select difficulty, count(*) n from public.daily_war_items where user_id = uid group by difficulty) c;
  raise notice 'added %: %', v_added, v_counts;
  assert v_added = 15, format('expected 15 questions, got %s', v_added);
  assert v_counts = '{"Easy": 5, "Medium": 7, "Hard": 3}'::jsonb, v_counts::text;
  assert not exists (
    select 1 from public.daily_war_items i
    left join public.questions q on q.id = i.question_id
    left join public.question_language_versions v on v.question_id = q.id
    where i.user_id = uid and (q.id is null or v.id is null or q.description = '' or q.difficulty <> i.difficulty)
  ), 'every war question is saved with its statement and starter code';
  assert (select count(distinct slug) from public.daily_war_items where user_id = uid) = 15, 'no duplicates';
  assert private.fill_war(uid) = 0, 'a full war is not topped up again';
end $$;

-- 2. Streak rules, seen as the user: three won days in a row after a lost one; today still running.
update public.daily_wars set deadline = now() + interval '1 hour'
where user_id = '00000000-0000-0000-0000-0000000000aa' and war_date = private.war_today();
insert into public.daily_wars (user_id, war_date, deadline)
select '00000000-0000-0000-0000-0000000000aa', private.war_today() - d, now() - make_interval(days => d)
from generate_series(1, 4) d;
insert into public.daily_war_items (war_id, user_id, position, slug, title, difficulty, done_at)
select w.id, w.user_id, 1, 'past-' || w.war_date, 'Past', 'Easy',
       case when w.war_date = private.war_today() - 4 then null else w.deadline - interval '1 hour' end
from public.daily_wars w
where w.user_id = '00000000-0000-0000-0000-0000000000aa' and w.war_date < private.war_today();

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000aa", "role": "authenticated"}';

do $$
declare
  v_streak jsonb := public.war_streak();
  v_war jsonb := public.get_war();
  v_item bigint := (v_war -> 'items' -> 0 ->> 'id')::bigint;
begin
  raise notice 'streak %', v_streak;
  assert v_streak = '{"current": 3, "best": 3, "won": 3}'::jsonb, v_streak::text;
  assert jsonb_array_length(v_war -> 'items') = 15;
  assert v_war -> 'items' -> 0 ->> 'difficulty' = 'Easy', 'Easy questions first';
  assert public.set_war_item_done(v_item, true) ->> 'done_at' is not null;
  assert (select done from public.war_days() where war_date = private.war_today()) = 1;
  assert public.set_war_item_done(v_item, false) ->> 'done_at' is null;
end $$;

rollback;
