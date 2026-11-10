import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { formatHourlyRate } from '@common/utils/money.utils';
import { RATE_ROLES } from 'src/projects/constants/rate-roles';
import {
  IPersonRateChange,
  ProjectRatesService,
} from 'src/projects/services/project-rates.service';
import {
  ProjectsTabModalName,
  ProjectsTabService,
} from '@modules/slack/tabs/projects/services/projects-tab.service';
import { IProjectsTabMetaData } from '@modules/slack/tabs/projects/views/projects-tab.view';
import { IPersonRateModalViewMetadata } from '@modules/slack/tabs/projects/views/person-rate-modal.view';
import PersonRateModalViewValuesParser, {
  IPersonRateFormViewData,
} from '@modules/slack/tabs/projects/parsers/person-rate-modal-view-values.parser';

interface IPersonRateResult extends IPersonRateChange {
  currency: string;
}

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.PersonRateFormSubmit,
  type: 'view_submission',
  allowedRoles: RATE_ROLES,
})
export class PersonRateFormSubmitHandler extends BaseModalFormSubmitHandler<
  IPersonRateModalViewMetadata,
  IPersonRateFormViewData,
  IPersonRateResult
> {
  public constructor(
    private readonly projectRatesService: ProjectRatesService,
    private readonly slackTeamsService: SlackTeamsService,
    private readonly projectsTabService: ProjectsTabService,
    private readonly tabNavigationService: TabNavigationService,
    formParser: PersonRateModalViewValuesParser,
  ) {
    super(formParser);
  }

  protected async onSubmit(
    data: IPersonRateFormViewData,
    metadata: IPersonRateModalViewMetadata,
    user: IUserViewModel,
  ): Promise<IPersonRateResult> {
    const [change, currency] = await Promise.all([
      this.projectRatesService.setPersonRate({
        projectId: metadata.id,
        userId: data.person.value,
        hourlyRate: data.hourlyRate,
        user,
      }),
      this.slackTeamsService.getCurrency(user.slack_team_id),
    ]);

    return { ...change, currency };
  }

  protected successResponse(
    { project, person, hourlyRate, currency }: IPersonRateResult,
    user: IUserViewModel,
    metadata: IPersonRateModalViewMetadata,
  ) {
    const pageMetadata = metadata.pageMetadata
      ? (JSON.parse(metadata.pageMetadata) as IProjectsTabMetaData)
      : {};

    this.tabNavigationService.navigate(TabId.Projects, {
      user,
      metadata: pageMetadata,
      notice:
        hourlyRate === null
          ? `✅ ${person.name} has no rate of their own on ${project.name} now.`
          : `✅ ${person.name}'s rate on ${project.name}: ${formatHourlyRate(hourlyRate, currency)}.`,
    });

    return SlackViewResponseFactory.success();
  }

  protected async errorResponse(
    errorMessage: string,
    _data: IPersonRateFormViewData,
    metadata: IPersonRateModalViewMetadata,
    user: IUserViewModel,
  ) {
    return SlackViewResponseFactory.update(
      await this.projectsTabService.getModalView(
        ProjectsTabModalName.ManagePersonRates,
        {
          projectId: metadata.id,
          errorMessage,
          user,
          pageMetadata: metadata.pageMetadata,
        },
      ),
    );
  }
}
