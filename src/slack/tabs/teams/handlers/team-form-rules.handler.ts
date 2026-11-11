import { Injectable } from '@nestjs/common';
import type { StaticSelectAction } from '@slack/bolt/dist/types/actions/block-action';
import { ADMIN_AND_HR_ROLES } from '@common/constants/role-groups';
import { IUserViewModel } from '@modules/users/types/user.interface';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import {
  ActionMapType,
  BaseActionHandler,
} from '@modules/slack/common/handlers/base-action.handler';
import { ISlackBlockActionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import { parseMetadata } from '@modules/slack/common/utils/slack-metadata.utils';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { TeamRulesChoice } from '@modules/slack/tabs/teams/enums/team-rules-choice.enum';
import { TeamModalActionId } from '@modules/slack/tabs/teams/enums/teams-tab-view-actions-id.enum';
import {
  TeamsTabModalName,
  TeamsTabService,
} from '@modules/slack/tabs/teams/services/teams-tab.service';
import { ITeamModalViewMetadata } from '@modules/slack/tabs/teams/views/team-modal.view';

// Choosing between the company rules and a team's own rebuilds the team
// form. The rule fields get new block_ids (views.update keeps what a field
// with the same block_id holds), so those of a team that followed the
// company rules show the company rules; the other fields keep what the user
// typed.
@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.TeamFormSubmit,
  type: 'block_actions',
  allowedRoles: ADMIN_AND_HR_ROLES,
})
export class TeamFormRulesHandler extends BaseActionHandler {
  protected actionMap: ActionMapType = {
    [TeamModalActionId.Rules]: (payload, user) => this.rebuild(payload, user),
  };

  public constructor(
    private readonly teamsTabService: TeamsTabService,
    private readonly slackCommunicationService: SlackCommunicationService,
  ) {
    super();
  }

  private async rebuild(
    payload: ISlackBlockActionPayload,
    user: IUserViewModel,
  ) {
    const rules = (payload.actions[0] as StaticSelectAction).selected_option
      ?.value as TeamRulesChoice | undefined;

    if (
      !payload.view?.id ||
      !rules ||
      !Object.values(TeamRulesChoice).includes(rules)
    ) {
      return;
    }

    const metadata = parseMetadata<ITeamModalViewMetadata>(payload);
    const params = {
      user,
      pageMetadata: metadata.pageMetadata,
      rules,
      ruleFieldsVersion: `${rules}.${Date.now().toString(36)}`,
    };
    const view = metadata.id
      ? await this.teamsTabService.getModalView(TeamsTabModalName.UpdateTeam, {
          ...params,
          teamId: metadata.id,
        })
      : await this.teamsTabService.getModalView(
          TeamsTabModalName.CreateTeam,
          params,
        );

    await this.slackCommunicationService.updateView(
      payload.view.id,
      view,
      user.slack_team_id,
      payload.view.hash,
    );
  }
}
