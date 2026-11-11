import type { AnyBlock } from '@slack/web-api';
import { KnownBlock } from '@slack/types/dist/block-kit/blocks';
import VacationType from '@common/enums/vacation-type.enum';

export interface IOfferJob {
  requestId: string;
  slackTeamId: string;
  // The time an edit or a deletion removed from the request, told in the
  // same DM before the offer.
  removed?: IRemovedTimeNotice;
  // Only the removal: the request is gone, holds no offer, or the offer goes
  // to someone else (its person changed).
  removalOnly?: boolean;
}

// What happened to the time off that removed its logged time.
export type TimeOffChange =
  'changed' | 'rejected' | 'canceled' | 'pending' | 'deleted' | 'moved';

// What a person hears of their removed time: the time off as it was when the
// time was logged, what happened to it, and what went. The request may be
// gone when the job runs, so the job carries it.
export interface IRemovedTimeNotice {
  userId: string;
  type: VacationType;
  startDate: string;
  endDate: string;
  change: TimeOffChange;
  minutes: number;
  projectIds: string[];
  billedDates: string[];
}

// The DM whose button was clicked.
export interface IOfferMessage {
  channel?: string;
  ts?: string;
  blocks?: AnyBlock[];
}

export interface ITimeOffMessage {
  text: string;
  blocks: KnownBlock[];
}
