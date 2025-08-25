import { ISlackInteractionPayload } from 'src/slack/types/slack-interaction-payload.interface';

class SlackMetadataParser {
  public static parse<Metadata>(payload: ISlackInteractionPayload): Metadata {
    return JSON.parse(payload.view.private_metadata) as Metadata;
  }
}

export default SlackMetadataParser;
