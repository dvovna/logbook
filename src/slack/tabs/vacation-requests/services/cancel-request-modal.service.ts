import { Injectable } from '@nestjs/common';
import { View } from '@slack/types';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { formatDateRange } from '@common/utils/date.utils';
import ConfirmationModalView from '@modules/slack/common/views/components/confirmation-modal.view';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';

export interface ICancelRequestModalParams {
  user: IUserViewModel;
  requestId: string;
  errorMessage?: string;
  // The Time off screen's metadata when the cancel starts there: it is shown
  // again after the cancel, instead of Home.
  pageMetadata?: string;
}

// The requester's confirmation of a cancel, from Home, Time off or their DM.
// What it says depends on the request: an approved time off tells people.
@Injectable()
export class CancelRequestModalService {
  public constructor(
    private readonly vacationRequestsService: VacationRequestsService,
    private readonly confirmationModalView: ConfirmationModalView,
  ) {}

  public async getModal({
    user,
    requestId,
    errorMessage,
    pageMetadata,
  }: ICancelRequestModalParams): Promise<View> {
    const request = await this.vacationRequestsService.findOne({
      id: requestId,
      slackTeamId: user.slack_team_id,
    });

    return this.confirmationModalView.getView(
      {
        callbackId: ViewCallbackId.CancelVacationRequestFormSubmit,
        title: 'Cancel Request',
        message:
          request?.status === VacationRequestStatus.Approved
            ? `Cancel your approved time off for ${formatDateRange(request.start_date, request.end_date)}? The people who approved it, and those who hear of time off decisions, will be told.`
            : 'Cancel this vacation request? Your approvers will no longer be asked.',
        cancelText: 'Keep Request',
        errorMessage,
      },
      {
        id: requestId,
        ...(pageMetadata !== undefined ? { pageMetadata } : {}),
      },
    );
  }
}
