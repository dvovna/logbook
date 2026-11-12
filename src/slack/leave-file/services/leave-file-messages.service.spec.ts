import { Logger, NotFoundException } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import VacationType from '@common/enums/vacation-type.enum';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { LeaveFileMessagesService } from '@modules/slack/leave-file/services/leave-file-messages.service';
import { LeaveFileMessageView } from '@modules/slack/leave-file/views/leave-file-message.view';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { LeaveFileKind } from 'src/leave-file/enums/leave-file-kind.enum';
import { LeaveFileUploadsService } from 'src/leave-file/services/leave-file-uploads.service';
import { ILeaveFileApplyResult } from 'src/leave-file/types/leave-file-apply-result.interface';
import { ILeaveFileUndoResult } from 'src/leave-file/types/leave-file-undo-result.interface';
import { ILeaveFileUpload } from 'src/leave-file/types/leave-file-upload.interface';

const hr = {
  id: 'hr-1',
  role: UserRole.HR,
  slack_id: 'UHR',
  slack_team_id: 'workspace-1',
} as IUserViewModel;

const upload = {
  id: 'upload-1',
  slack_team_id: 'workspace-1',
  file_name: 'leave-history.csv',
  plan_digest: 'digest',
  message_channel: 'DHR',
  message_ts: '1.0001',
} as ILeaveFileUpload;

const applied = (kind: LeaveFileKind): ILeaveFileApplyResult => ({
  kind: 'applied',
  upload,
  preview:
    kind === LeaveFileKind.History
      ? {
          kind,
          people: [],
          plan: {
            add: [
              {
                row: 2,
                userId: 'ann',
                type: VacationType.SickLeave,
                startDate: '2026-05-04',
                endDate: '2026-05-05',
                comment: null,
              },
            ],
            skipped: 0,
            balanceChanges: [],
            plannedLeave: [],
            unusable: [],
          },
        }
      : {
          kind,
          people: [],
          plan: {
            balances: [],
            contractStarts: [
              { userId: 'ann', before: null, after: '2021-04-15' },
            ],
            unchanged: 0,
            unusable: [],
          },
        },
});

describe('LeaveFileMessagesService', () => {
  const build = (
    uploads: Partial<Record<keyof LeaveFileUploadsService, jest.Mock>>,
  ) => {
    const slack = {
      postEphemeral: jest.fn(),
      updateMessage: jest.fn(),
    };
    const service = new LeaveFileMessagesService(
      slack as unknown as SlackCommunicationService,
      uploads as unknown as LeaveFileUploadsService,
      new LeaveFileMessageView(),
    );

    return { service, slack };
  };
  const ephemeralTexts = (slack: { postEphemeral: jest.Mock }) =>
    slack.postEphemeral.mock.calls.map(([, { text }]) => text as string);

  describe('apply', () => {
    it('tells the clicker that nothing changed when Apply fails, and lets the error be logged', async () => {
      const failure = new Error('connection lost');
      const { service, slack } = build({
        apply: jest.fn().mockRejectedValue(failure),
      });

      await expect(service.apply('upload-1', 'digest', hr)).rejects.toBe(
        failure,
      );
      expect(ephemeralTexts(slack)).toEqual([
        "The file couldn't be applied, so nothing changed. Try again.",
      ]);
      expect(slack.updateMessage).not.toHaveBeenCalled();
    });

    it("keeps Apply's error when telling the clicker fails too, and logs that failure", async () => {
      const failure = new Error('connection lost');
      const { service, slack } = build({
        apply: jest.fn().mockRejectedValue(failure),
      });
      slack.postEphemeral.mockRejectedValue(new Error('service_unavailable'));
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      await expect(service.apply('upload-1', 'digest', hr)).rejects.toBe(
        failure,
      );
      expect(warn).toHaveBeenCalledWith(
        'Failed to tell UHR about a leave file: service_unavailable',
      );
      warn.mockRestore();
    });

    it('says the preview is no longer open for an upload it does not find', async () => {
      const { service, slack } = build({
        apply: jest
          .fn()
          .mockRejectedValue(
            new NotFoundException('This preview is no longer open.'),
          ),
      });

      await service.apply('upload-1', 'digest', hr);

      expect(ephemeralTexts(slack)).toEqual([
        'This preview is no longer open. Nothing changed.',
      ]);
    });

    it.each([
      [
        LeaveFileKind.Balances,
        "Applied, but the message couldn't be updated. Open People to check.",
        'nav_people',
      ],
      [
        LeaveFileKind.History,
        "Applied, but the message couldn't be updated. Open Time off to check.",
        'nav_time_off',
      ],
    ])(
      'shows the clicker what Apply of a %s file did, with its Undo, when the message could not be updated',
      async (kind, told, open) => {
        const failure = new Error('service_unavailable');
        const { service, slack } = build({
          apply: jest.fn().mockResolvedValue(applied(kind)),
        });
        slack.updateMessage.mockRejectedValue(failure);

        await expect(service.apply('upload-1', 'digest', hr)).rejects.toBe(
          failure,
        );
        expect(ephemeralTexts(slack)).toEqual([told]);
        const [[, { blocks }]] = slack.postEphemeral.mock.calls as [
          unknown,
          { blocks: { elements?: { action_id: string }[] }[] },
        ][];
        expect(
          blocks
            .flatMap(({ elements = [] }) => elements)
            .map(({ action_id }) => action_id),
        ).toEqual([open, 'undo']);
      },
    );

    it("tells the clicker to click again when a changed preview couldn't be shown", async () => {
      const failure = new Error('service_unavailable');
      const { service, slack } = build({
        apply: jest.fn().mockResolvedValue({
          ...applied(LeaveFileKind.History),
          kind: 'changed',
        }),
      });
      slack.updateMessage.mockRejectedValue(failure);

      await expect(service.apply('upload-1', 'digest', hr)).rejects.toBe(
        failure,
      );
      expect(ephemeralTexts(slack)).toEqual([
        "Logbook changed since this preview, but the new preview couldn't be shown. Click Apply again to see it.",
      ]);
    });
  });

  describe('undo', () => {
    const buildUndo = (undo: () => Promise<ILeaveFileUndoResult>) =>
      build({ undo: jest.fn(undo) });

    it('tells the clicker why the file can not be undone and leaves the message', async () => {
      const { service, slack } = buildUndo(async () => ({
        kind: 'closed',
        reason: "it's been more than 7 days",
      }));

      await service.undo('upload-1', hr);

      expect(ephemeralTexts(slack)).toEqual([
        "This file can't be undone: it's been more than 7 days.",
      ]);
      expect(slack.updateMessage).not.toHaveBeenCalled();
    });

    it('tells the clicker what was kept when the message could not be updated', async () => {
      const failure = new Error('service_unavailable');
      const { service, slack } = buildUndo(async () => ({
        kind: 'undone',
        restored: 2,
        kept: ["Bo's balance"],
        upload,
      }));
      slack.updateMessage.mockRejectedValue(failure);

      await expect(service.undo('upload-1', hr)).rejects.toBe(failure);
      expect(slack.postEphemeral).toHaveBeenCalledWith(
        'UHR',
        {
          text: '↩️ Undone: 2 changes restored.',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: "↩️ Undone: 2 changes restored.\nKept, because they changed since:\n• Bo's balance",
              },
            },
          ],
        },
        'workspace-1',
      );
    });

    it('tells the clicker that nothing changed when Undo fails', async () => {
      const failure = new Error('connection lost');
      const { service, slack } = buildUndo(() => Promise.reject(failure));

      await expect(service.undo('upload-1', hr)).rejects.toBe(failure);
      expect(ephemeralTexts(slack)).toEqual([
        "The file couldn't be undone, so nothing changed. Try again.",
      ]);
    });
  });

  it('says a Cancel of a preview that is no longer open changed nothing', async () => {
    const { service, slack } = build({
      cancel: jest
        .fn()
        .mockRejectedValue(
          new NotFoundException('This preview is no longer open.'),
        ),
    });

    await service.cancel('upload-1', hr);

    expect(ephemeralTexts(slack)).toEqual([
      'This preview is no longer open. Nothing changed.',
    ]);
    expect(slack.updateMessage).not.toHaveBeenCalled();
  });
});
