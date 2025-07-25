export interface IUserVacationsUsageInfo {
  annual_leave: {
    used: number;
    available: number;
  };
  bonus_day: {
    used: number;
    available: number;
  };
  sick_leave: { used: number };
  unpaid_leave: { used: number };
  other: { used: number };
}
