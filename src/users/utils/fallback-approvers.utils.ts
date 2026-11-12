import UserRole from '@common/enums/user-role.enum';

// Who decides what no approver of a team can, for time off (time entries
// follow the same rule in SQL, TimeEntriesRepository.approves): everyone
// with the HR role, else every admin; never the person it is about. Null
// when there is nobody.
export const fallbackApprovers = <
  Person extends { id: string; role: UserRole },
>(
  people: Person[],
  ownerId: string,
): { role: UserRole.HR | UserRole.Admin; approvers: Person[] } | null => {
  for (const role of [UserRole.HR, UserRole.Admin] as const) {
    const approvers = people.filter(
      (person) => person.role === role && person.id !== ownerId,
    );

    if (approvers.length) {
      return { role, approvers };
    }
  }

  return null;
};
