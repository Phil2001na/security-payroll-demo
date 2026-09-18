-- Public capture surface for the client business-rules review.
--
-- DogForce reviewers have no login here, so the page is anonymous. Tables therefore live in a
-- schema that is NOT exposed to PostgREST, and the only reachable surface is two SECURITY DEFINER
-- functions in `public` (which is already exposed, so no project-level config change is needed).
-- anon gets EXECUTE on those two functions and nothing else -- it cannot read, list, or write a
-- table directly, and cannot enumerate other reviewers' notes.
--
-- The unguessable `token` in the review link is the credential. A reviewer_id minted in the
-- browser separates people sharing one link; the display name is theirs to type.

create schema if not exists rules_review;

create table if not exists rules_review.reviews (
  token            text primary key,
  label            text not null,
  document_version text not null default '1.2',
  is_open          boolean not null default true,
  max_reviewers    integer not null default 50,
  created_at       timestamptz not null default now()
);

create table if not exists rules_review.responses (
  token         text not null references rules_review.reviews(token) on delete cascade,
  reviewer_id   text not null,
  section_key   text not null,
  reviewer_name text,
  mark          text check (mark in ('Confirm','Change','Question')),
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (token, reviewer_id, section_key)
);

create index if not exists responses_token_updated_idx
  on rules_review.responses (token, updated_at desc);

-- Nothing in this schema is reachable except through the functions below.
revoke all on schema rules_review from anon, authenticated;
revoke all on all tables in schema rules_review from anon, authenticated;

-- Load: only ever this reviewer's own rows, and only while the review is open.
create or replace function public.rules_review_load(p_token text, p_reviewer text)
returns table (section_key text, mark text, note text, reviewer_name text)
language sql
security definer
set search_path = ''
as $$
  select r.section_key, r.mark, r.note, r.reviewer_name
  from rules_review.responses r
  join rules_review.reviews v on v.token = r.token
  where r.token = p_token and r.reviewer_id = p_reviewer and v.is_open;
$$;

-- Save one section. Upsert, so typing is idempotent and re-saving is free.
create or replace function public.rules_review_save(
  p_token text, p_reviewer text, p_name text,
  p_section text, p_mark text, p_note text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_max integer; v_seen integer;
begin
  select max_reviewers into v_max from rules_review.reviews
  where token = p_token and is_open;
  if not found then
    raise exception 'This review link is not active';
  end if;

  if p_reviewer is null or length(p_reviewer) not between 8 and 64 then
    raise exception 'Invalid reviewer';
  end if;
  if p_mark is not null and p_mark not in ('Confirm','Change','Question') then
    raise exception 'Invalid mark';
  end if;
  if length(coalesce(p_note,'')) > 4000 then
    raise exception 'Note is too long (4000 characters maximum)';
  end if;
  if length(coalesce(p_name,'')) > 120 or length(coalesce(p_section,'')) > 200 then
    raise exception 'Input too long';
  end if;

  -- Cheap abuse ceiling: a link cannot mint unlimited reviewers.
  if not exists (
    select 1 from rules_review.responses
    where token = p_token and reviewer_id = p_reviewer
  ) then
    select count(distinct reviewer_id) into v_seen
    from rules_review.responses where token = p_token;
    if v_seen >= v_max then
      raise exception 'This review link has reached its reviewer limit';
    end if;
  end if;

  insert into rules_review.responses
    (token, reviewer_id, section_key, reviewer_name, mark, note, updated_at)
  values
    (p_token, p_reviewer, p_section,
     nullif(trim(coalesce(p_name,'')),''), p_mark, nullif(p_note,''), now())
  on conflict (token, reviewer_id, section_key) do update
    set reviewer_name = excluded.reviewer_name,
        mark          = excluded.mark,
        note          = excluded.note,
        updated_at    = now();
end $$;

revoke all on function public.rules_review_load(text,text) from public;
revoke all on function public.rules_review_save(text,text,text,text,text,text) from public;
grant execute on function public.rules_review_load(text,text) to anon, authenticated;
grant execute on function public.rules_review_save(text,text,text,text,text,text) to anon, authenticated;
