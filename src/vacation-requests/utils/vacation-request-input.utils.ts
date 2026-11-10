import VacationType from '@common/enums/vacation-type.enum';
import { MAX_COMMENT_LENGTH } from '@common/constants/text-limits';
import { ValidationError } from '@common/errors/validation.error';

// What a request may say, whichever way it comes in: the Slack forms check
// the same, so these only fire for other callers.

export const assertDatesInOrder = (startDate: Date, endDate: Date) => {
  if (endDate.getTime() < startDate.getTime()) {
    throw new ValidationError(
      "The end date can't be before the start date",
      'dates',
    );
  }
};

export const assertVacationType = (type: VacationType) => {
  if (!Object.values(VacationType).includes(type)) {
    throw new ValidationError('Invalid vacation type', 'type');
  }
};

export const assertCommentLength = (comment: string | null | undefined) => {
  if (comment && comment.length > MAX_COMMENT_LENGTH) {
    throw new ValidationError(
      `Comment must be at most ${MAX_COMMENT_LENGTH} characters`,
      'comment',
    );
  }
};

export const assertCommentForOther = (
  type: VacationType,
  comment: string | null | undefined,
) => {
  if (type === VacationType.Other && !comment?.trim()) {
    throw new ValidationError(
      'Comment is required when type is Other',
      'comment',
    );
  }
};
