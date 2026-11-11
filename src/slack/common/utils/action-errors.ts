import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DuplicatedRecordError } from '@common/errors/duplicated-record.error';
import EntityHasDependenciesError from '@common/errors/entity-has-dependencies.error';
import MaxItemsCountReachedError from '@common/errors/max-items-count-reached.error';
import PrimaryEntityDeleteError from '@common/errors/primary-entity-delete.error';
import { ValidationError } from '@common/errors/validation.error';

const REFUSALS: (abstract new (...args: never[]) => Error)[] = [
  ValidationError,
  NotFoundException,
  DuplicatedRecordError,
  MaxItemsCountReachedError,
  EntityHasDependenciesError,
  PrimaryEntityDeleteError,
];

// What an error of a Slack action or form is: a refusal, written for the
// user to read; forbidden, which each caller shows or only logs; or a
// failure, logged and reported.
export const classifyActionError = (
  error: unknown,
): 'refusal' | 'forbidden' | 'unexpected' => {
  if (error instanceof ForbiddenException) {
    return 'forbidden';
  }

  return REFUSALS.some((type) => error instanceof type)
    ? 'refusal'
    : 'unexpected';
};
