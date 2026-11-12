import { IUserViewModel } from '@modules/users/types/user.interface';
import { LEAVE_FILE_UNUSABLE_REASONS as REASONS } from 'src/leave-file/constants/leave-file-unusable-reasons';
import { FileDate } from 'src/leave-file/parsers/leave-file-values';

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function indexPeopleByEmail(people: IUserViewModel[]) {
  const byEmail = new Map<string, IUserViewModel>();
  for (const person of people) {
    const email = normalizeEmail(person.email);
    const known = byEmail.get(email);
    if (!known || (!known.is_active && person.is_active)) {
      byEmail.set(email, person);
    }
  }
  return byEmail;
}

export const badDateReason = (
  date: FileDate,
  column: string,
  text: string,
): string | null => {
  switch (date.kind) {
    case 'invalid':
      return REASONS.invalidDate(column, text);
    case 'ambiguous':
      return REASONS.ambiguousDate(column, text);
    case 'inconsistent':
      return REASONS.inconsistentDates(column, text);
    default:
      return null;
  }
};
