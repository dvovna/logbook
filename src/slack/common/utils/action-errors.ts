import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DuplicatedRecordError } from '@common/errors/duplicated-record.error';
import EntityHasDependenciesError from '@common/errors/entity-has-dependencies.error';
import MaxItemsCountReachedError from '@common/errors/max-items-count-reached.error';
import PrimaryEntityDeleteError from '@common/errors/primary-entity-delete.error';
import { ValidationError } from '@common/errors/validation.error';

export type ActionErrorKind =
  'refusal' | 'not-found' | 'forbidden' | 'unexpected';

const REFUSALS: (abstract new (...args: never[]) => Error)[] = [
  ValidationError,
  DuplicatedRecordError,
  MaxItemsCountReachedError,
  EntityHasDependenciesError,
  PrimaryEntityDeleteError,
];

// A refusal is written for the user to read. Not found is apart because some
// of its messages name a record by its internal ID ('Client with id … not
// found'); forbidden because a message button only logs it.
export const classifyActionError = (error: unknown): ActionErrorKind => {
  if (error instanceof ForbiddenException) {
    return 'forbidden';
  }

  if (error instanceof NotFoundException) {
    return 'not-found';
  }

  return REFUSALS.some((type) => error instanceof type)
    ? 'refusal'
    : 'unexpected';
};
