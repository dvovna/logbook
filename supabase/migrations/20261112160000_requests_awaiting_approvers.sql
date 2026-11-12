-- A pending request whose approval found nobody who could decide it (the
-- requester is the only admin and nobody has HR, say). Its approval starts
-- once someone can: a role, a reactivation, a team's approvers or the company
-- rules (VacationRequestProcessingService). A request without approval steps
-- and without this mark was imported, and is sent to nobody.
alter table public.vacation_requests
    add column if not exists awaits_approvers boolean not null default false;

comment on column public.vacation_requests.awaits_approvers is
  'Pending with nobody to approve it: its approval starts once someone can';

-- The requests a change of approvers looks at: few, so a small index.
create index if not exists vacation_requests_awaiting_approvers_idx
    on public.vacation_requests (slack_team_id) where awaits_approvers;
