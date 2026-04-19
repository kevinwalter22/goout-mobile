-- Feedback submitted by users (bugs, ideas, general comments).
-- Admins can read all rows; authenticated users can only insert.

create table public.feedback (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        references auth.users(id) on delete set null,
  type        text        not null check (type in ('bug', 'idea', 'general')),
  message     text        not null,
  created_at  timestamptz not null default now()
);

alter table public.feedback enable row level security;

create policy "Users can submit feedback"
  on public.feedback for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Admins can view feedback"
  on public.feedback for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and is_admin = true
    )
  );

grant insert, select on public.feedback to authenticated;
