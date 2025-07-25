import { KnownBlock } from '@slack/types/dist/block-kit/blocks';

export type SlackMessagePayload =
  | {
      text: string;
    }
  | {
      blocks: KnownBlock[];
    };
