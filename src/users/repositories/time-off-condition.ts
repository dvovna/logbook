import { RawBuilder, sql } from 'kysely';
import VacationRequestStatus from '@common/enums/vacation-status.enum';

// The one definition of "away": approved time off, of any type, that covers
// the day (both ends included), in SQL (coversDay) and for a request at hand
// (coversDayOf). A change to one is a change to both.
export const coversDayOf = (
  request: { status: string; start_date: string; end_date: string },
  date: string,
) =>
  request.status === (VacationRequestStatus.Approved as string) &&
  request.start_date <= date &&
  request.end_date >= date;

export const coversDay = (
  requestAlias: string,
  date: string,
): RawBuilder<boolean> =>
  sql<boolean>`${sql.ref(`${requestAlias}.status`)} = 'approved'
    and ${sql.ref(`${requestAlias}.start_date`)} <= ${date}::date
    and ${sql.ref(`${requestAlias}.end_date`)} >= ${date}::date`;

export const onTimeOff = (
  userIdRef: string,
  slackTeamId: string,
  date: string,
): RawBuilder<boolean> =>
  sql<boolean>`exists (
    select 1 from vacation_requests as away_request
    where away_request.slack_team_id = ${slackTeamId}
      and away_request.user_id = ${sql.ref(userIdRef)}
      and ${coversDay('away_request', date)}
  )`;
