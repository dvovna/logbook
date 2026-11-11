import { Logger } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { TeamFileMessagesService } from '@modules/slack/team-file/services/team-file-messages.service';
import { TeamFileMessageView } from '@modules/slack/team-file/views/team-file-message.view';
import { CompanyRulesService } from '@modules/teams/services/company-rules.service';
import { IRuleSetViewModel } from '@modules/teams/types/rule-set.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { TeamFileUploadsService } from 'src/team-file/services/team-file-uploads.service';
import { ITeamFileUndoResult } from 'src/team-file/types/team-file-undo-result.interface';
import { ITeamFileApplyResult } from 'src/team-file/types/team-file-apply-result.interface';
import { ITeamFilePlan } from 'src/team-file/types/team-file-plan.interface';
import { ITeamFileUpload } from 'src/team-file/types/team-file-upload.interface';

const hr = {
  id: 'hr-1',
  role: UserRole.HR,
  slack_id: 'UHR',
  slack_team_id: 'workspace-1',
} as IUserViewModel;

const upload = {
  id: 'upload-1',
  slack_team_id: 'workspace-1',
  message_channel: 'DHR',
  message_ts: '1.0001',
} as ITeamFileUpload;

const plan: ITeamFilePlan = {
  createTeams: [],
  assignments: [
    { userId: 'ann', fromTeamId: null, toTeamId: 'acme', toTeamKey: null },
  ],
  leadChanges: [],
  promotions: [],
  nameMatches: [],
  teamsWithoutLead: [],
  leftWithoutTeam: [],
  unusable: [],
};

describe('TeamFileMessagesService', () => {
  const build = (apply: () => Promise<ITeamFileApplyResult>) => {
    const slack = {
      postEphemeral: jest.fn(),
      updateMessage: jest.fn(),
    };
    const service = new TeamFileMessagesService(
      slack as unknown as SlackCommunicationService,
      { apply: jest.fn(apply) } as unknown as TeamFileUploadsService,
      {
        get: jest.fn().mockResolvedValue({
          hr_approvers: [],
          approval_notification_recipients: [],
          vacation_policy: null,
        } as unknown as IRuleSetViewModel),
      } as unknown as CompanyRulesService,
      new TeamFileMessageView(),
    );

    return { service, slack };
  };
  const ephemeralTexts = (slack: { postEphemeral: jest.Mock }) =>
    slack.postEphemeral.mock.calls.map(([, { text }]) => text as string);

  it('tells the clicker that nothing changed when Apply fails, and lets the error be logged', async () => {
    const failure = new Error('connection lost');
    const { service, slack } = build(() => Promise.reject(failure));

    await expect(service.apply('upload-1', 'digest', hr)).rejects.toBe(failure);
    expect(slack.postEphemeral).toHaveBeenCalledWith(
      'UHR',
      { text: "The file couldn't be applied, so nothing changed. Try again." },
      'workspace-1',
    );
    expect(slack.updateMessage).not.toHaveBeenCalled();
  });

  it("keeps Apply's error when telling the clicker fails too, and logs that failure", async () => {
    const failure = new Error('connection lost');
    const { service, slack } = build(() => Promise.reject(failure));
    slack.postEphemeral.mockRejectedValue(new Error('service_unavailable'));
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await expect(service.apply('upload-1', 'digest', hr)).rejects.toBe(failure);
    expect(warn).toHaveBeenCalledWith(
      'Failed to tell UHR about a team file: service_unavailable',
    );
    warn.mockRestore();
  });

  it.each([
    [
      'applied',
      "Applied, but the message couldn't be updated. Open Teams to check.",
    ],
    [
      'changed',
      "Logbook changed since this preview, but the new preview couldn't be shown. Click Apply again to see it.",
    ],
  ] as const)(
    'tells the clicker when the message of an %s file could not be updated',
    async (kind, told) => {
      const failure = new Error('service_unavailable');
      const { service, slack } = build(async () => ({
        kind,
        plan,
        state: { people: [], teams: [] },
        upload,
      }));
      slack.updateMessage.mockRejectedValue(failure);

      await expect(service.apply('upload-1', 'digest', hr)).rejects.toBe(
        failure,
      );
      expect(ephemeralTexts(slack)).toEqual([told]);
    },
  );

  describe('undo', () => {
    const buildUndo = (undo: () => Promise<ITeamFileUndoResult>) => {
      const built = build(() => Promise.reject(new Error('unused')));
      const uploads = { undo: jest.fn(undo) };
      const service = new TeamFileMessagesService(
        built.slack as unknown as SlackCommunicationService,
        uploads as unknown as TeamFileUploadsService,
        {} as unknown as CompanyRulesService,
        new TeamFileMessageView(),
      );

      return { service, slack: built.slack };
    };

    it('tells the clicker why Undo is closed and leaves the message', async () => {
      const { service, slack } = buildUndo(async () => ({
        kind: 'closed',
        reason: 'a newer file was applied',
      }));

      await service.undo('upload-1', hr);

      expect(ephemeralTexts(slack)).toEqual([
        'Undo is no longer available: a newer file was applied.',
      ]);
      expect(slack.updateMessage).not.toHaveBeenCalled();
    });

    it('replaces the message with what was restored and kept', async () => {
      const { service, slack } = buildUndo(async () => ({
        kind: 'undone',
        restored: 2,
        kept: ["Bo's team, changed since"],
        upload,
      }));

      await service.undo('upload-1', hr);

      expect(slack.updateMessage).toHaveBeenCalledWith(
        'DHR',
        '1.0001',
        expect.objectContaining({ text: '↩️ Undone: 2 changes restored.' }),
        'workspace-1',
      );
    });

    it('tells the clicker what was kept when the message could not be updated', async () => {
      const failure = new Error('service_unavailable');
      const { service, slack } = buildUndo(async () => ({
        kind: 'undone',
        restored: 2,
        kept: ["Bo's team, changed since"],
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
                text: "↩️ Undone: 2 changes restored.\nKept as they are:\n• Bo's team, changed since",
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
});
