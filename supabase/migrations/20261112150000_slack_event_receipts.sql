-- Slack sends an event again when it got no answer within 3 seconds: at
-- once, a minute later and 5 minutes later. The first delivery of an event
-- leaves its ID here in the transaction that saves the event's job, and a
-- delivery that finds it here starts nothing. pg-boss can't tell: the job of
-- the first delivery is deleted as soon as its first run succeeds, often
-- before the later deliveries arrive. Kept an hour at least.
create table if not exists public.slack_event_receipts (
    slack_team_id uuid not null
        references public.slack_teams (id) on delete cascade,
    event_id text not null,
    received_at timestamptz not null,
    primary key (slack_team_id, event_id)
);

comment on table public.slack_event_receipts is
  'Slack events the app took, by event_id, so that Slack''s retries start nothing';

create index if not exists slack_event_receipts_received_at_idx
    on public.slack_event_receipts (received_at);

alter table public.slack_event_receipts enable row level security;
