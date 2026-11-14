export const ABSENCE_DAY_CHECKED = 'absence.day_checked';

// The workspace's check for approvers on time off ran for `date` (UTC day).
export class AbsenceDayCheckedEvent {
  public constructor(
    public readonly slackTeamId: string,
    public readonly date: string,
  ) {}
}
