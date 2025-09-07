import { ISlackInteractionPayload } from 'src/slack/common/types/slack-interaction-payload.interface';

export function parseMetadata<Metadata>(
  payload: ISlackInteractionPayload,
): Metadata {
  return JSON.parse(payload.view.private_metadata) as Metadata;
}
