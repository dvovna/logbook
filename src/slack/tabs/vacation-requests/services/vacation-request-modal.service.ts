import { Injectable } from '@nestjs/common';
import { IOpenModalBaseParams } from '@modules/slack/common/services/base-tab.service';
import { View } from '@slack/types';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import {
  VacationRequestFormModalView,
} from '@modules/slack/tabs/vacation-requests/views/vacation-request-form-modal.view';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';

export interface IVacationRequestModalViewParams
  extends IOpenModalBaseParams {
  callbackId?: ViewCallbackId.AdminVacationRequest | ViewCallbackId.UserVacationRequest;
  requestId?: string;
  pageMetadata?: string;
}

@Injectable()
export class VacationRequestModalService {
  public constructor(
    private vacationRequestFormModalView: VacationRequestFormModalView,
    private vacationRequestsService: VacationRequestsService,
  ) {}

  public async getModal({
    requestId,
    user,
    callbackId = ViewCallbackId.AdminVacationRequest,
    errorMessage,
    pageMetadata = '',
  }: IVacationRequestModalViewParams): Promise<View> {
    const request = requestId
      ? await this.vacationRequestsService.findOneWithValidation({
        id: requestId,
        slackTeamId: user.slack_team_id,
      })
      : undefined;

    return this.vacationRequestFormModalView.getView(
      {
        errorMessage,
        initialData: request && {
          id: request.id,
          type: request.type,
          status: request.status,
          comment: request.user_comment || '',
          start_date: request.start_date,
          end_date: request.end_date,
          user: request.user && {
            id: request.user.id,
            name: request.user.name,
          },
        },
        userRole: user.role,
        callbackId,
      },
      {
        pageMetadata,
        id: request?.id,
      },
    );
  }
}
