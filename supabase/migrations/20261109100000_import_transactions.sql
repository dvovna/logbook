-- The CSV import of a user's vacations and the import of a country's holidays
-- replace rows: the old ones go, the new ones come. They were two requests,
-- insert then delete, and a failure between them left both sets. Each is one
-- function now, so it runs in one transaction: all or nothing.

-- Replaces every vacation of a user with p_vacations, a JSON array of
-- vacation_requests rows (team_id, type, status, start_date, end_date, days,
-- working_days, created_by, updated_by). The workspace and the user come from
-- the parameters, never from the rows.
create function replace_user_vacations(
    p_slack_team_id uuid,
    p_user_id uuid,
    p_vacations jsonb
)
returns setof vacation_requests
language plpgsql
set search_path = public
as $$
begin
    delete from vacation_requests
     where slack_team_id = p_slack_team_id
       and user_id = p_user_id;

    return query
    insert into vacation_requests (
        slack_team_id, user_id, team_id, type, status, start_date, end_date,
        days, working_days, created_by, updated_by
    )
    select p_slack_team_id, p_user_id, v.team_id, v.type, v.status,
           v.start_date, v.end_date, v.days, v.working_days, v.created_by,
           v.updated_by
      from jsonb_populate_recordset(null::vacation_requests, p_vacations) v
    returning *;
end;
$$;

-- Replaces a policy's country holidays of p_year with p_holidays, a JSON
-- array of holidays rows (name, date, country_code, created_by, updated_by).
-- The company's own holidays stay.
create function replace_country_holidays(
    p_slack_team_id uuid,
    p_vacation_policy_id uuid,
    p_year integer,
    p_holidays jsonb
)
returns setof holidays
language plpgsql
set search_path = public
as $$
begin
    delete from holidays
     where slack_team_id = p_slack_team_id
       and vacation_policy_id = p_vacation_policy_id
       and year = p_year
       and not is_company_custom;

    return query
    insert into holidays (
        slack_team_id, vacation_policy_id, name, date, year,
        is_company_custom, country_code, created_by, updated_by
    )
    select p_slack_team_id, p_vacation_policy_id, h.name, h.date,
           extract(year from h.date)::integer, false, h.country_code,
           h.created_by, h.updated_by
      from jsonb_populate_recordset(null::holidays, p_holidays) h
    returning *;
end;
$$;

-- New functions are executable by PUBLIC (see 20261107100000): only the
-- app's service role may call these.
revoke execute on function replace_user_vacations(uuid, uuid, jsonb)
    from public, anon, authenticated;
grant execute on function replace_user_vacations(uuid, uuid, jsonb)
    to service_role;
revoke execute on function replace_country_holidays(uuid, uuid, integer, jsonb)
    from public, anon, authenticated;
grant execute on function replace_country_holidays(uuid, uuid, integer, jsonb)
    to service_role;
