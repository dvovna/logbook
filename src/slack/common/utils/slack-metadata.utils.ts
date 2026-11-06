import { ISlackInteractionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';

export function parseMetadata<Metadata>(
  payload: ISlackInteractionPayload,
): Metadata {
  return JSON.parse(payload.view.private_metadata) as Metadata;
}
