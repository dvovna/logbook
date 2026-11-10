import { ForbiddenException } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import { BILLING_ROLES } from '@common/constants/role-groups';
import { ValidationError } from '@common/errors/validation.error';
import { isValidHourlyRate, MAX_HOURLY_RATE } from '@common/utils/money.utils';

// Who sees and sets hourly rates, and sees amounts: Admin and Finance.
// Managers and HR see projects and assign people to them, but not what the
// time costs.
export const RATE_ROLES = BILLING_ROLES;

export const canSeeRates = (role: UserRole) => RATE_ROLES.includes(role);

export const assertCanSeeRates = ({ role }: { role: UserRole }) => {
  if (!canSeeRates(role)) {
    throw new ForbiddenException('Only Admin and Finance see and set rates.');
  }
};

// A rate from a form: null clears it. The field is `hourlyRate`.
export const assertValidHourlyRate = (rate: number | null) => {
  if (rate !== null && !isValidHourlyRate(rate)) {
    throw new ValidationError(
      `Enter a rate from 0 to ${MAX_HOURLY_RATE}, with at most two decimals.`,
      'hourlyRate',
    );
  }
};
