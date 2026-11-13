import { Injectable } from '@nestjs/common';
import type { ViewResponseAction } from '@slack/bolt/dist/types/view';
import { ALL_ROLES } from '@common/constants/role-groups';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import {
  IRemindersFormData,
  RemindersFormParser,
} from '@modules/slack/receipts/parsers/reminders-form.parser';
import { IRemindersMetadata } from '@modules/slack/receipts/views/reminders-modal.view';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { ReimbursementOptOutsService } from 'src/receipts/services/reimbursement-opt-outs.service';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.RemindersForm,
  type: 'view_submission',
  allowedRoles: ALL_ROLES,
})
export class RemindersFormSubmitHandler extends BaseModalFormSubmitHandler<
  IRemindersMetadata,
  IRemindersFormData
> {
  public constructor(
    private readonly optOuts: ReimbursementOptOutsService,
    private readonly tabNavigationService: TabNavigationService,
    parser: RemindersFormParser,
  ) {
    super(parser);
  }

  // Always the sender's own: the user comes from the request.
  protected async onSubmit(
    data: IRemindersFormData,
    { shownIds }: IRemindersMetadata,
    user: IUserViewModel,
  ): Promise<void> {
    await this.optOuts.setReminded(
      user,
      shownIds ?? [],
      data.reminded.map(({ value }) => value),
    );

    this.tabNavigationService.navigate(TabId.Home, {
      user,
      notice: '✅ Reminders saved.',
    });
  }

  protected successResponse(): ViewResponseAction {
    return SlackViewResponseFactory.success();
  }

  protected errorResponse(errorMessage: string): ViewResponseAction {
    return SlackViewResponseFactory.update({
      type: 'modal',
      title: { type: 'plain_text', text: 'Reminders' },
      close: { type: 'plain_text', text: 'Close' },
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `:warning: ${errorMessage}` },
        },
      ],
    });
  }
}
