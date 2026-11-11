import { IProjectRates } from 'src/projects/types/project-user-rate.types';

// The rate billable time of `userId` on `projectId` is worth: the person's
// own rate on the project, else the project's; null if neither.
export const rateOf = (
  rates: Map<string, IProjectRates>,
  projectId: string,
  userId: string,
) => {
  const projectRates = rates.get(projectId);
  const ownRate = projectRates?.personRates.find(
    (rate) => rate.userId === userId,
  );

  return ownRate?.hourlyRate ?? projectRates?.hourlyRate ?? null;
};
