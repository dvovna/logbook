import VacationRequestStatus from 'src/common/enums/vacation-status.enum';

export function getVacationStatusEmoji(status: VacationRequestStatus): string {
  switch (status) {
    case VacationRequestStatus.Approved:
      return '✅';
    case VacationRequestStatus.Rejected:
      return '❌';
    case VacationRequestStatus.Canceled:
      return '🚫';
    case VacationRequestStatus.Pending:
    default:
      return '⏳';
  }
}
