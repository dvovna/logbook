-- When a time entry went to its approvers, which says how long it has waited
-- (the approvers' reminders). updated_at said so until anything else changed
-- the entry: an edit by HR or an admin of a submitted entry moved it.
alter table public.time_entries
  add column if not exists submitted_at timestamptz;

comment on column public.time_entries.submitted_at is
  'When the entry last became submitted';

update public.time_entries
set submitted_at = updated_at
where status = 'submitted'
  and submitted_at is null;

-- However an entry becomes submitted (its owner submits it, Admin or HR log
-- or set it as submitted), from updated_at, which every write of the app
-- sets with the app's clock: the integration tests fake that clock, not the
-- database's.
create or replace function public.time_entries_set_submitted_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.status = 'submitted'
        and (tg_op = 'INSERT' or old.status is distinct from 'submitted') then
        new.submitted_at := new.updated_at;
    end if;

    return new;
end;
$$;

-- PostgreSQL lets PUBLIC execute a new function; see
-- 20261107100000_lock_down_public_api.sql.
revoke execute on function public.time_entries_set_submitted_at()
    from public, anon, authenticated;

drop trigger if exists time_entries_set_submitted_at on public.time_entries;

create trigger time_entries_set_submitted_at
    before insert or update of status on public.time_entries
    for each row execute function public.time_entries_set_submitted_at();
