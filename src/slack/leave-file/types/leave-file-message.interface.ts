import { KnownBlock } from '@slack/types';

export interface ILeaveFileMessage {
  // The fallback Slack shows where it can't show blocks.
  text: string;
  blocks: KnownBlock[];
}
