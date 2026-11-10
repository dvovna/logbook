import { KnownBlock } from '@slack/types/dist/block-kit/blocks';

export type SlackMessagePayloadInterface =
  | {
      text: string;
    }
  | {
      blocks: KnownBlock[];
    };
