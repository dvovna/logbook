import { Injectable } from '@nestjs/common';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import ITeamViewModel from 'src/teams/types/team.interface';
import BaseViewService from 'src/slack/services/slack-views/base.view-service';
import { View } from '@slack/types/dist/views';

interface IGetViewParams {
  team: ITeamViewModel;
  generalError?: string;
}

export type IDeleteTeamModalViewMetadata = {
  teamIdToDelete: string;
};

@Injectable()
export default class DeleteTeamModalViewService extends BaseViewService<IGetViewParams> {
  public getView({ team, generalError }: IGetViewParams): View {
    return {
      type: 'modal',
      callback_id: ViewCallbackId.DeleteTeam,
      private_metadata: JSON.stringify({
        teamIdToDelete: team.id,
      } as IDeleteTeamModalViewMetadata),
      title: {
        type: 'plain_text',
        text: 'Delete Team',
      },
      submit: {
        type: 'plain_text',
        text: 'Delete',
      },
      close: {
        type: 'plain_text',
        text: 'Cancel',
      },
      blocks: [
        ...(generalError ? [this.getGeneralErrorBlock(generalError)] : []),
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:alert: The team *${team?.name}* will be permanently deleted. This action cannot be undone.`,
          },
        },
      ],
    };
  }
}
