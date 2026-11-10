import { ALL_ROLES } from '@common/constants/role-groups';
import { Injectable } from '@nestjs/common';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { IUserViewModel } from '@modules/users/types/user.interface';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import VacationRequestUserViewValuesParser, {
  IVacationRequestUserFormViewData,
} from '@modules/slack/tabs/vacation-requests/parsers/vacation-request-user-view-values.parser';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import {
  IVacationRequestModalViewMetadata,
  VacationRequestFormModalView,
} from '@modules/slack/tabs/vacation-requests/views/vacation-request-form-modal.view';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import { IVacationHistoryTabMetadata } from '@modules/slack/tabs/vacation-requests/views/vacation-history-tab.view';
import { jsonParse } from '@common/utils/json-parse';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.UserVacationRequest,
  type: 'view_submission',
  allowedRoles: ALL_ROLES,
})
export class UserVacationRequestHandler extends BaseModalFormSubmitHandler<
  IVacationRequestModalViewMetadata,
  IVacationRequestUserFormViewData,
  IVacationRequestViewModel
> {
  // Overlaps and balance concern the period: shown under its end.
  protected readonly errorFields = { dates: 'end_date' as const };

  public constructor(
    private readonly vacationRequestsService: VacationRequestsService,
    private readonly tabNavigationService: TabNavigationService,
    private readonly vacationRequestModalView: VacationRequestFormModalView,
    vacationRequestUserViewValuesParser: VacationRequestUserViewValuesParser,
  ) {
    super(vacationRequestUserViewValuesParser);
  }

  // Opened from Time off (it carries that tab's metadata) the form goes back
  // there. Opened from Home or with `/vacations request` it goes to Home,
  // which lists the pending request; the requester's DM about who decides it
  // confirms it outside App Home.
  protected successResponse(
    _request: IVacationRequestViewModel,
    user: IUserViewModel,
    metadata: IVacationRequestModalViewMetadata,
  ) {
    const notice = '✅ Vacation request created.';

    if (metadata.pageMetadata) {
      this.tabNavigationService.navigate(TabId.TimeOff, {
        user,
        metadata: {
          ...jsonParse<IVacationHistoryTabMetadata>(metadata.pageMetadata),
          page: 1,
        },
        notice,
      });
    } else {
      this.tabNavigationService.navigate(TabId.Home, { user, notice });
    }

    return SlackViewResponseFactory.success();
  }

  protected onSubmit(
    data: IVacationRequestUserFormViewData,
    _metadata: IVacationRequestModalViewMetadata,
    user: IUserViewModel,
  ) {
    return this.create(data, user);
  }

  private create(data: IVacationRequestUserFormViewData, user: IUserViewModel) {
    return this.vacationRequestsService.create(
      {
        userId: user.id,
        teamId: user.team_id,
        startDate: new Date(data.start_date),
        endDate: new Date(data.end_date),
        type: data.type_option.value,
        status: VacationRequestStatus.Pending,
        userComment: data.comment,
      },
      user,
    );
  }

  // Keeps the metadata, so the form still goes back to its tab.
  protected errorResponse(
    errorMessage: string,
    _data: IVacationRequestUserFormViewData,
    metadata: IVacationRequestModalViewMetadata,
  ) {
    return SlackViewResponseFactory.update(
      this.vacationRequestModalView.getView(
        {
          errorMessage,
          callbackId: ViewCallbackId.UserVacationRequest,
        },
        metadata,
      ),
    );
  }
}
