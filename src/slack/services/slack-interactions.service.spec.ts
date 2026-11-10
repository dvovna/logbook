import UserRole from '@common/enums/user-role.enum';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { SlackHandlersRegistry } from '@modules/slack/slack-handlers.registry';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { ActionForbiddenView } from '@modules/slack/common/views/components/action-forbidden.view';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import { ISlackInteractionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import SlackInteractionsService from '@modules/slack/services/slack-interactions.service';

const user = (overrides: Partial<IUserViewModel> = {}) =>
  ({
    id: 'user-1',
    role: UserRole.Member,
    is_active: true,
    ...overrides,
  }) as IUserViewModel;

const viewSubmission = (callbackId: string) =>
  ({
    type: 'view_submission',
    view: { callback_id: callbackId },
  }) as unknown as ISlackInteractionPayload;

const forbidden = SlackViewResponseFactory.update(
  ActionForbiddenView.getView(),
);

describe('SlackInteractionsService', () => {
  let handler: { handle: jest.Mock };
  let registry: { getHandler: jest.Mock };
  let service: SlackInteractionsService;

  beforeEach(() => {
    handler = { handle: jest.fn().mockResolvedValue({ handled: true }) };
    registry = {
      getHandler: jest.fn().mockReturnValue({
        handler,
        allowedRoles: [UserRole.Admin, UserRole.Member],
      }),
    };
    service = new SlackInteractionsService(
      registry as unknown as SlackHandlersRegistry,
    );
  });

  describe('finding the handler', () => {
    it('takes a form submission’s callback_id from its view', async () => {
      const payload = viewSubmission(ViewCallbackId.HolidayFormSubmit);
      const member = user();

      await expect(
        service.handleSlackInteraction(payload, member),
      ).resolves.toEqual({ handled: true });
      expect(registry.getHandler).toHaveBeenCalledWith(
        'view_submission',
        ViewCallbackId.HolidayFormSubmit,
      );
      expect(handler.handle).toHaveBeenCalledWith(payload, member);
    });

    it('takes a click in a tab or modal from the view, not from the block', async () => {
      const payload = {
        type: 'block_actions',
        view: { callback_id: ViewCallbackId.HomeTabView },
        actions: [{ block_id: 'some_block', action_id: 'x' }],
      } as unknown as ISlackInteractionPayload;

      await service.handleSlackInteraction(payload, user());

      expect(registry.getHandler).toHaveBeenCalledWith(
        'block_actions',
        ViewCallbackId.HomeTabView,
      );
    });

    it('takes a click in a message from the block_id of the first action', async () => {
      const payload = {
        type: 'block_actions',
        actions: [
          { block_id: ViewCallbackId.WorkflowStepMessage, action_id: 'a' },
          { block_id: 'second', action_id: 'b' },
        ],
      } as unknown as ISlackInteractionPayload;

      await service.handleSlackInteraction(payload, user());

      expect(registry.getHandler).toHaveBeenCalledWith(
        'block_actions',
        ViewCallbackId.WorkflowStepMessage,
      );
    });

    it('ignores a payload with neither a view nor actions', () => {
      const payload = {
        type: 'block_actions',
        actions: [],
      } as unknown as ISlackInteractionPayload;

      expect(service.handleSlackInteraction(payload, user())).toBeUndefined();
      expect(registry.getHandler).not.toHaveBeenCalled();
    });

    it('ignores a callback_id that has no handler', () => {
      registry.getHandler.mockReturnValue(undefined);

      expect(
        service.handleSlackInteraction(viewSubmission('made_up'), user()),
      ).toBeUndefined();
    });
  });

  describe('access', () => {
    it('refuses a role the handler does not allow', () => {
      const hr = user({ role: UserRole.HR });

      expect(
        service.handleSlackInteraction(
          viewSubmission(ViewCallbackId.HolidayFormSubmit),
          hr,
        ),
      ).toEqual(forbidden);
      expect(handler.handle).not.toHaveBeenCalled();
    });

    it('refuses everyone when the handler lists no roles', () => {
      registry.getHandler.mockReturnValue({ handler });

      expect(
        service.handleSlackInteraction(
          viewSubmission(ViewCallbackId.HolidayFormSubmit),
          user({ role: UserRole.Admin }),
        ),
      ).toEqual(forbidden);
      expect(handler.handle).not.toHaveBeenCalled();
    });

    it('refuses a deactivated user, whatever their role', () => {
      const deactivatedAdmin = user({ role: UserRole.Admin, is_active: false });

      expect(
        service.handleSlackInteraction(
          viewSubmission(ViewCallbackId.HolidayFormSubmit),
          deactivatedAdmin,
        ),
      ).toEqual(forbidden);
      expect(handler.handle).not.toHaveBeenCalled();
    });

    it('still lets a deactivated user use the fallback tab', async () => {
      const payload = {
        type: 'block_actions',
        view: { callback_id: ViewCallbackId.FallbackTabView },
        actions: [{ block_id: 'b', action_id: 'a' }],
      } as unknown as ISlackInteractionPayload;

      await expect(
        service.handleSlackInteraction(payload, user({ is_active: false })),
      ).resolves.toEqual({ handled: true });
    });
  });
});
