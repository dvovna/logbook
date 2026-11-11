import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DuplicatedRecordError } from '@common/errors/duplicated-record.error';
import EntityHasDependenciesError from '@common/errors/entity-has-dependencies.error';
import MaxItemsCountReachedError from '@common/errors/max-items-count-reached.error';
import PrimaryEntityDeleteError from '@common/errors/primary-entity-delete.error';
import { SlackUserAccessException } from '@common/errors/slack-user-access.exception';
import { ValidationError } from '@common/errors/validation.error';
import { classifyActionError } from '@modules/slack/common/utils/action-errors';
import { TimeEntryChangedError } from 'src/time-entries/errors/time-entry-changed.error';
import { TimesheetCellError } from 'src/time-entries/errors/timesheet-cell.error';

describe('classifyActionError', () => {
  it.each([
    new ValidationError('Too many hours', 'minutes'),
    new TimeEntryChangedError(),
    new TimesheetCellError('Too many hours', {
      projectId: 'p1',
      date: '2026-06-17',
    }),
    new NotFoundException('Time Entry not found'),
    new DuplicatedRecordError('A client with this name already exists'),
    new MaxItemsCountReachedError(10, 'teams'),
    new EntityHasDependenciesError('client', 'projects'),
    new PrimaryEntityDeleteError('policy'),
  ])('takes %p as a refusal', (error) => {
    expect(classifyActionError(error)).toBe('refusal');
  });

  it('keeps ForbiddenException apart', () => {
    expect(classifyActionError(new ForbiddenException('No'))).toBe('forbidden');
  });

  it.each([
    new Error('connection lost'),
    new BadRequestException('Bad'),
    new SlackUserAccessException('inactive', 'U1'),
    'a string',
    undefined,
  ])('takes anything else as unexpected: %p', (error) => {
    expect(classifyActionError(error)).toBe('unexpected');
  });
});
