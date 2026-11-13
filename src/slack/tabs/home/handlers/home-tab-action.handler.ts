import { rolesOfTab } from '@modules/slack/common/navigation/screens';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { Injectable, Logger } from '@nestjs/common';
import { ISlackInteractionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import {
  HomeTabModalName,
  HomeTabService,
} from '@modules/slack/tabs/home/services/home-tab.service';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { HomeTabActionId } from '@modules/slack/tabs/home/views/home-tab.view';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import { ActionMapType } from '@modules/slack/common/handlers/base-action.handler';
import { BaseTabActionHandler } from '@modules/slack/common/handlers/base-tab-action.handler';
import { withMenuAction } from '@modules/slack/common/utils/slack-menu.utils';
import { runInBackground } from '@common/utils/run-in-background';
import { ADMIN_AND_HR_ROLES } from '@common/constants/role-groups';
import {
  TeamsTabModalName,
  TeamsTabService,
} from '@modules/slack/tabs/teams/services/teams-tab.service';
import { LeaveFileDmService } from '@modules/slack/leave-file/services/leave-file-dm.service';
import { UsersTabViewActionId } from '@modules/slack/tabs/users/enums/users-tab-view-action-id.enum';
import { TeamFileDmService } from '@modules/slack/team-file/services/team-file-dm.service';
import { TeamsTabViewActionId } from '@modules/slack/tabs/teams/enums/teams-tab-view-actions-id.enum';
import { RemindersModalService } from '@modules/slack/receipts/services/reminders-modal.service';
import { TeamAnnouncementService } from '@modules/slack/tabs/home/services/team-announcement.service';
import { submittedNotice } from '@modules/slack/tabs/time-tracking/utils/submitted-notice.utils';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.HomeTabView,
  type: 'block_actions',
  allowedRoles: rolesOfTab(TabId.Home),
})
export default class HomeTabActionHandler extends BaseTabActionHandler {
  protected actionMap: ActionMapType;

  private readonly logger = new Logger(HomeTabActionHandler.name);

  public constructor(
    private readonly homeTabService: HomeTabService,
    private readonly timeEntriesService: TimeEntriesService,
    private readonly teamsTabService: TeamsTabService,
    private readonly teamFileDmService: TeamFileDmService,
    private readonly leaveFileDmService: LeaveFileDmService,
    private readonly remindersModalService: RemindersModalService,
    private readonly teamAnnouncementService: TeamAnnouncementService,
    protected readonly tabNavigationService: TabNavigationService,
  ) {
    super(tabNavigationService);

    this.actionMap = {
      [HomeTabActionId.OpenVacationModal]: this.handleCreateVacationRequest,
      [HomeTabActionId.ManagePendingRequestMenu]: withMenuAction(
        this.handleMenuAction,
        this.logger,
      ),
      [HomeTabActionId.LogTime]: this.handleLogTime,
      [HomeTabActionId.SubmitTimeEntries]: this.handleSubmitTimeEntries,
      [TeamsTabViewActionId.CompanyRules]: this.handleCompanyRules,
      [TeamsTabViewActionId.TeamFile]: this.handleTeamFile,
      [UsersTabViewActionId.ImportLeave]: this.handleImportLeave,
      [HomeTabActionId.Reminders]: this.handleReminders,
      [HomeTabActionId.TellTeam]: this.handleTellTeam,
    };
  }

  private handleCreateVacationRequest = async (
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    await this.homeTabService.openModal(
      payload.trigger_id || user.slack_id,
      HomeTabModalName.CreateVacationRequest,
      { user },
    );
  };

  // The setup checklist's buttons. Home is open to every role, so these
  // check the role themselves.
  private handleCompanyRules = async (
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    if (!ADMIN_AND_HR_ROLES.includes(user.role)) {
      return;
    }

    await this.teamsTabService.openModal(
      payload.trigger_id || user.slack_id,
      TeamsTabModalName.CompanyRules,
      {
        user,
        pageMetadata: '',
        openedFrom: TabId.Home,
      },
    );
  };

  private handleTeamFile = (
    _payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    if (!ADMIN_AND_HR_ROLES.includes(user.role)) {
      return;
    }

    runInBackground(this.logger, 'send the team file', () =>
      this.teamFileDmService.sendTemplate(user),
    );
  };

  private handleImportLeave = (
    _payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    if (!ADMIN_AND_HR_ROLES.includes(user.role)) {
      return;
    }

    runInBackground(this.logger, 'send the leave file templates', () =>
      this.leaveFileDmService.sendTemplates(user),
    );
  };

  // The checklist's last step: the message for the team goes to the
  // person's DM, then Home shows the checklist done.
  private handleTellTeam = (
    _payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    if (!ADMIN_AND_HR_ROLES.includes(user.role)) {
      return;
    }

    runInBackground(this.logger, 'send the message for the team', async () => {
      await this.teamAnnouncementService.send(user);
      this.tabNavigationService.navigate(TabId.Home, {
        user,
        notice:
          '✅ The message for your team is in your DMs from Logbook: copy it into a channel.',
      });
    });
  };

  private handleReminders = async (
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    await this.remindersModalService.open(
      payload.trigger_id || user.slack_id,
      user,
    );
  };

  private handleLogTime = async (
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    await this.homeTabService.openModal(
      payload.trigger_id || user.slack_id,
      HomeTabModalName.CreateTimeEntry,
      { user },
    );
  };

  // Sends all of the user's drafts and rejected entries for approval, then
  // shows Home without the reminder.
  private handleSubmitTimeEntries = async (
    _payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    const submitted = await this.timeEntriesService.submit(
      { slackTeamId: user.slack_team_id },
      user,
    );

    this.tabNavigationService.navigate(TabId.Home, {
      user,
      notice: submittedNotice(submitted),
    });
  };

  private handleMenuAction = async (
    actionType: HomeTabActionId,
    requestId: string,
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    switch (actionType) {
      case HomeTabActionId.ViewDetails: {
        return this.homeTabService.openModal(
          payload.trigger_id || user.slack_id,
          HomeTabModalName.ViewVacationRequest,
          { user, requestId },
        );
      }
      case HomeTabActionId.CancelRequest: {
        return this.homeTabService.openModal(
          payload.trigger_id || user.slack_id,
          HomeTabModalName.CancelVacationRequest,
          { user, requestId },
        );
      }
      default: {
        this.logger.warn(`Unhandled Home Tab Menu actionType: ${actionType}`);
      }
    }
  };
}
