-- Requests that found nobody to approve them before awaits_approvers existed:
-- pending, without approval steps, and made by the requester. An imported
-- request is made by the admin who imported it and is sent to nobody, so it
-- stays unmarked; so does a pending request HR made for someone, which can't
-- be told apart from an imported one. The daily look at the marked requests
-- (MemberSyncScheduleService) starts those that someone can approve by now.
update public.vacation_requests r
   set awaits_approvers = true
 where r.status = 'pending'
   and r.created_by = r.user_id
   and not r.awaits_approvers
   and not exists (
     select 1 from public.request_workflow_steps s where s.request_id = r.id
   );
