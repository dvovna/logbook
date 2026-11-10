import { Injectable } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
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
import {
  ProjectsTabModalName,
  ProjectsTabService,
} from '@modules/slack/tabs/projects/services/projects-tab.service';
import { IProjectsTabMetaData } from '@modules/slack/tabs/projects/views/projects-tab.view';
import { ICurrencyModalViewMetadata } from '@modules/slack/tabs/projects/views/currency-modal.view';
import CurrencyModalViewValuesParser, {
  ICurrencyFormViewData,
} from '@modules/slack/tabs/projects/parsers/currency-modal-view-values.parser';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.CurrencyFormSubmit,
  type: 'view_submission',
  allowedRoles: [UserRole.Admin],
})
export class CurrencyFormSubmitHandler extends BaseModalFormSubmitHandler<
  ICurrencyModalViewMetadata,
  ICurrencyFormViewData,
  string
> {
  public constructor(
    private readonly slackTeamsService: SlackTeamsService,
    private readonly projectsTabService: ProjectsTabService,
    private readonly tabNavigationService: TabNavigationService,
    formParser: CurrencyModalViewValuesParser,
  ) {
    super(formParser);
  }

  protected onSubmit(
    data: ICurrencyFormViewData,
    _metadata: ICurrencyModalViewMetadata,
    user: IUserViewModel,
  ): Promise<string> {
    return this.slackTeamsService.setCurrency(data.currency, user);
  }

  protected successResponse(
    currency: string,
    user: IUserViewModel,
    metadata: ICurrencyModalViewMetadata,
  ) {
    const pageMetadata = metadata.pageMetadata
      ? (JSON.parse(metadata.pageMetadata) as IProjectsTabMetaData)
      : {};

    this.tabNavigationService.navigate(TabId.Projects, {
      user,
      metadata: pageMetadata,
      notice: `✅ Rates and amounts are in ${currency} now.`,
    });

    return SlackViewResponseFactory.success();
  }

  protected async errorResponse(
    errorMessage: string,
    _data: ICurrencyFormViewData,
    metadata: ICurrencyModalViewMetadata,
    user: IUserViewModel,
  ) {
    return SlackViewResponseFactory.update(
      await this.projectsTabService.getModalView(
        ProjectsTabModalName.ChangeCurrency,
        { errorMessage, user, pageMetadata: metadata.pageMetadata },
      ),
    );
  }
}
