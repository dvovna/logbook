-- Finance: rates, billing reports, snapshots and the uninvoiced report,
-- without managing people or approving anything.
alter table public.users drop constraint if exists users_role_check;

alter table public.users
  add constraint users_role_check
  check (role = any (array['member', 'admin', 'hr', 'manager', 'finance']));
