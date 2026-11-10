import { Injectable } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import VacationType from '@common/enums/vacation-type.enum';
import { IUserViewModel } from '@modules/users/types/user.interface';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import {
  ProjectsTabModalName,
  ProjectsTabService,
} from '@modules/slack/tabs/projects/services/projects-tab.service';
import { IProjectsTabMetaData } from '@modules/slack/tabs/projects/views/projects-tab.view';
import { ITimeOffSettingsModalViewMetadata } from '@modules/slack/tabs/projects/views/time-off-settings-modal.view';
import TimeOffSettingsModalViewValuesParser, {
  ITimeOffSettingsFormViewData,
} from '@modules/slack/tabs/projects/parsers/time-off-settings-modal-view-values.parser';
import { TimeOffSettingsService } from 'src/time-off-logging/services/time-off-settings.service';
import { TIME_OFF_LEAVE_TYPES } from 'src/time-off-logging/constants/time-off-leave-types';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.TimeOffSettingsForm,
  type: 'view_submission',
  allowedRoles: [UserRole.Admin],
})
export class TimeOffSettingsFormSubmitHandler extends BaseModalFormSubmitHandler<
  ITimeOffSettingsModalViewMetadata,
  ITimeOffSettingsFormViewData
> {
  public constructor(
    private readonly timeOffSettingsService: TimeOffSettingsService,
    private readonly projectsTabService: ProjectsTabService,
    private readonly tabNavigationService: TabNavigationService,
    formParser: TimeOffSettingsModalViewValuesParser,
  ) {
    super(formParser);
  }

  protected async onSubmit(
    data: ITimeOffSettingsFormViewData,
    _metadata: ITimeOffSettingsModalViewMetadata,
    user: IUserViewModel,
  ): Promise<void> {
    const projectIds: Partial<Record<VacationType, string>> = {};

    for (const type of TIME_OFF_LEAVE_TYPES) {
      const project = data[type];

      if (project) {
        projectIds[type] = project.value;
      }
    }

    await this.timeOffSettingsService.set(user, {
      minutesPerDay: Math.round(data.hours * 60),
      projectIds,
    });
  }

  protected successResponse(
    _result: void,
    user: IUserViewModel,
    metadata: ITimeOffSettingsModalViewMetadata,
  ) {
    const pageMetadata = metadata.pageMetadata
      ? (JSON.parse(metadata.pageMetadata) as IProjectsTabMetaData)
      : {};

    this.tabNavigationService.navigate(TabId.Projects, {
      user,
      metadata: pageMetadata,
      notice: '✅ Time off projects saved.',
    });

    return SlackViewResponseFactory.success();
  }

  protected async errorResponse(
    errorMessage: string,
    _data: ITimeOffSettingsFormViewData,
    metadata: ITimeOffSettingsModalViewMetadata,
    user: IUserViewModel,
  ) {
    return SlackViewResponseFactory.update(
      await this.projectsTabService.getModalView(
        ProjectsTabModalName.TimeOffSettings,
        { errorMessage, user, pageMetadata: metadata.pageMetadata },
      ),
    );
  }
}
