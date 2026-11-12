import { KnownBlock } from '@slack/types';

export interface ITeamFileMessage {
  // The fallback Slack shows where it can't show blocks.
  text: string;
  blocks: KnownBlock[];
}
