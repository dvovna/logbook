-- Entries logged before the app took the client and billability from the
-- project have no client and are mostly marked as not billable (the form had
-- no such fields, so the app saved null and false). Take both from the
-- entry's project, as the app does now. updated_at/updated_by stay as they
-- are: nobody edited these entries.
update time_entries te
set client_id = p.client_id,
    billable = p.billable
from projects p
where p.id = te.project_id
  and (
        te.client_id is distinct from p.client_id
        or te.billable <> p.billable
      );
