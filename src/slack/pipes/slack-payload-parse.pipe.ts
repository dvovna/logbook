import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { ISlackInteractionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';

@Injectable()
export class SlackPayloadParsePipe implements PipeTransform {
  public transform(
    value: { payload: unknown } | undefined,
  ): ISlackInteractionPayload {
    if (!value || typeof value.payload !== 'string') {
      throw new BadRequestException('Missing or invalid payload');
    }

    let payload: ISlackInteractionPayload;
    try {
      payload = JSON.parse(value.payload);
    } catch {
      throw new BadRequestException('Payload is not valid JSON');
    }

    return payload;
  }
}
