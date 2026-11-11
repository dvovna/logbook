import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import UserRole from '@common/enums/user-role.enum';
import { DAY_MS } from '@common/utils/date.utils';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import ITeamViewModel from '@modules/teams/types/team.interface';
import { TransactionService } from 'src/database/transaction.service';
import TeamsService from '@modules/teams/services/teams.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { UsersService } from '@modules/users/services/users.service';
import { TeamFileUploadStatus } from 'src/team-file/enums/team-file-upload-status.enum';
import { TeamFileUploadsRepository } from 'src/team-file/repositories/team-file-uploads.repository';
import {
  planDigest,
  planTeamFile,
} from 'src/team-file/services/team-file-planner';
import { TeamFileUploadsService } from 'src/team-file/services/team-file-uploads.service';
import { ITeamFileRow } from 'src/team-file/types/team-file-row.interface';
import { ITeamFileUpload } from 'src/team-file/types/team-file-upload.interface';

const user = {
  id: 'hr-1',
  role: UserRole.HR,
  slack_team_id: 'workspace-1',
} as IUserViewModel;

const person = (
  id: string,
  isActive = true,
  fields: Partial<IUserViewModel> = {},
) =>
  ({
    id,
    email: `${id}@x.test`,
    name: id,
    role: UserRole.Member,
    is_active: isActive,
    team_id: null,
    slack_id: `S${id}`,
    ...fields,
  }) as IUserViewModel;

const row = (
  n: number,
  email: string,
  team: string,
  lead = '',
): ITeamFileRow => ({
  row: n,
  name: '',
  email,
  team,
  lead,
});

const UPLOAD_ID = '3b9c3c52-6a43-4a0e-9a8c-1f3f6d6f5a11';

describe('TeamFileUploadsService', () => {
  const calls: string[] = [];
  const stored = { id: 'upload-1' } as ITeamFileUpload;

  const build = () => {
    calls.length = 0;
    const repository = {
      supersedePreviewed: jest.fn(async () => {
        calls.push('supersede');
      }),
      create: jest.fn(async () => {
        calls.push('create');

        return stored;
      }),
      cancelPreviewed: jest.fn(),
      setMessage: jest.fn(),
      findOne: jest.fn(async () => {
        calls.push('find upload');

        return null as ITeamFileUpload | null;
      }),
      setDigest: jest.fn(async () => {
        calls.push('set digest');
      }),
      markApplied: jest.fn(async () => {
        calls.push('mark applied');

        return stored;
      }),
    };
    const usersService = {
      findMany: jest
        .fn()
        .mockResolvedValue([person('ann'), person('old', false)]),
      assignTeams: jest.fn(async () => {
        calls.push('assign teams');
      }),
      makeManagers: jest.fn(async () => {
        calls.push('make managers');

        return [] as IUserViewModel[];
      }),
    };
    const teamsService = {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(async ({ name }: { name: string }) => {
        calls.push(`create ${name}`);

        return { id: `${name.toLowerCase()}-id` } as ITeamViewModel;
      }),
      update: jest.fn(async () => {
        calls.push('update team');
      }),
    };
    const transactions = {
      transaction: jest.fn(async (work: () => Promise<unknown>) => {
        calls.push('begin');

        return work();
      }),
      lock: jest.fn(async () => {
        calls.push('lock');
      }),
    };
    const config = { getOrThrow: jest.fn().mockReturnValue(5) };
    const service = new TeamFileUploadsService(
      repository as unknown as TeamFileUploadsRepository,
      usersService as unknown as UsersService,
      teamsService as unknown as TeamsService,
      transactions as unknown as TransactionService,
      config as unknown as ConfigService,
    );

    return { service, repository, usersService, teamsService };
  };

  describe('receive', () => {
    it('plans against everyone in the workspace, active or not, and stores the rows and the plan digest', async () => {
      const { service, repository, usersService, teamsService } = build();
      const rows = [row(2, 'ann@x.test', 'Acme'), row(3, 'old@x.test', 'Acme')];

      const { upload, plan, state } = await service.receive(
        rows,
        'file.csv',
        user,
      );

      expect(usersService.findMany).toHaveBeenCalledWith({
        slackTeamId: 'workspace-1',
        includeInactive: true,
      });
      expect(teamsService.findMany).toHaveBeenCalledWith({
        slackTeamId: 'workspace-1',
      });
      expect(upload).toBe(stored);
      expect(state.people.map(({ id }) => id)).toEqual(['ann', 'old']);
      expect(state.teams).toEqual([]);
      expect(plan.createTeams).toMatchObject([{ name: 'Acme' }]);
      expect(plan.unusable).toEqual([
        { row: 3, reason: 'old@x.test is deactivated' },
      ]);
      expect(repository.create).toHaveBeenCalledWith({
        slack_team_id: 'workspace-1',
        uploaded_by: 'hr-1',
        file_name: 'file.csv',
        rows: JSON.stringify(rows),
        plan_digest: planDigest(plan),
        status: TeamFileUploadStatus.Previewed,
        created_at: expect.any(String),
      });
    });

    it("takes the workspace's lock, then supersedes the open previews and stores the new one in one transaction", async () => {
      const { service, repository } = build();

      await service.receive([], 'file.csv', user);

      expect(calls).toEqual(['begin', 'lock', 'supersede', 'create']);
      expect(repository.supersedePreviewed).toHaveBeenCalledWith('workspace-1');
    });
  });

  describe('cancel', () => {
    it("cancels a preview of the sharer's workspace", async () => {
      const { service, repository } = build();
      repository.cancelPreviewed.mockResolvedValue(stored);

      await expect(
        service.cancel('3b9c3c52-6a43-4a0e-9a8c-1f3f6d6f5a11', user),
      ).resolves.toBe(stored);
      expect(repository.cancelPreviewed).toHaveBeenCalledWith(
        '3b9c3c52-6a43-4a0e-9a8c-1f3f6d6f5a11',
        'workspace-1',
      );
    });

    it('refuses an upload that is not an open preview of the workspace', async () => {
      const { service, repository } = build();
      repository.cancelPreviewed.mockResolvedValue(null);

      await expect(
        service.cancel('3b9c3c52-6a43-4a0e-9a8c-1f3f6d6f5a11', user),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses an ID that is no UUID without asking the database', async () => {
      const { service, repository } = build();

      await expect(service.cancel('not-an-id', user)).rejects.toThrow(
        NotFoundException,
      );
      expect(repository.cancelPreviewed).not.toHaveBeenCalled();
    });
  });

  describe('apply', () => {
    const backend = {
      id: 'backend',
      name: 'Backend',
      manager_approvers: ['Slee', 'Sghost'],
    } as ITeamViewModel;
    const people = [
      person('ann'),
      person('bo', true, { team_id: 'backend' }),
      person('lee', true, { team_id: 'backend', role: UserRole.Manager }),
    ];
    const rows = [
      row(2, 'ann@x.test', 'Acme', 'yes'),
      row(3, 'bo@x.test', 'Acme'),
      row(4, 'lee@x.test', 'Backend'),
    ];
    const digest = planDigest(
      planTeamFile(rows, { people, teams: [backend] }, 5),
    );
    const upload = (fields: Partial<ITeamFileUpload> = {}) =>
      ({
        id: UPLOAD_ID,
        slack_team_id: 'workspace-1',
        rows,
        plan_digest: digest,
        status: TeamFileUploadStatus.Previewed,
        created_at: new Date(Date.now() - DAY_MS).toISOString(),
        ...fields,
      }) as ITeamFileUpload;

    const buildWith = (stored: ITeamFileUpload | null) => {
      const built = build();
      built.repository.findOne.mockImplementation(async () => {
        calls.push('find upload');

        return stored;
      });
      built.usersService.findMany.mockImplementation(async () => {
        calls.push('read people');

        return people;
      });
      built.teamsService.findMany.mockImplementation(async () => {
        calls.push('read teams');

        return [backend];
      });

      return built;
    };

    it("creates the teams, places people, sets leads and makes Members Managers under the workspace's lock, and stores what it changed", async () => {
      const { service, repository, usersService, teamsService } =
        buildWith(upload());
      usersService.makeManagers.mockImplementation(async () => {
        calls.push('make managers');

        return [person('ann', true, { role: UserRole.Manager })];
      });

      const result = await service.apply(UPLOAD_ID, user);

      expect(calls).toEqual([
        'begin',
        'lock',
        'find upload',
        'read people',
        'read teams',
        'create Acme',
        'assign teams',
        'update team',
        'make managers',
        'mark applied',
      ]);
      expect(repository.findOne).toHaveBeenCalledWith({
        id: UPLOAD_ID,
        slack_team_id: 'workspace-1',
      });
      expect(teamsService.create).toHaveBeenCalledWith(
        {
          name: 'Acme',
          slackTeamId: 'workspace-1',
          followsCompanyRules: true,
          managerApprovers: ['Sann'],
          managerApproversRule: ApprovalRule.Any,
        },
        user,
      );
      expect(usersService.assignTeams).toHaveBeenCalledWith(
        [
          { userId: 'ann', teamId: 'acme-id' },
          { userId: 'bo', teamId: 'acme-id' },
        ],
        user,
      );
      expect(teamsService.update).toHaveBeenCalledWith(
        { id: 'backend', slackTeamId: 'workspace-1' },
        { managerApprovers: ['Sghost'] },
        user,
      );
      expect(usersService.makeManagers).toHaveBeenCalledWith(['ann'], user);
      expect(repository.markApplied).toHaveBeenCalledWith(
        UPLOAD_ID,
        'workspace-1',
        {
          createdTeamIds: ['acme-id'],
          assignments: [
            { userId: 'ann', before: null, after: 'acme-id' },
            { userId: 'bo', before: 'backend', after: 'acme-id' },
          ],
          approvers: [
            {
              teamId: 'backend',
              before: ['Slee', 'Sghost'],
              after: ['Sghost'],
            },
          ],
          promotions: [{ userId: 'ann', before: UserRole.Member }],
        },
      );
      expect(result).toMatchObject({
        kind: 'applied',
        upload: stored,
        state: { people, teams: [backend] },
      });
      expect(result.kind === 'applied' && result.plan.createTeams).toEqual([
        {
          key: 'acme',
          name: 'Acme',
          leadIds: ['ann'],
          memberIds: ['ann', 'bo'],
        },
      ]);
    });

    it('stores the new digest and changes nothing else when the workspace changed since the preview', async () => {
      const { service, repository, usersService, teamsService } = buildWith(
        upload({ plan_digest: 'what the preview showed' }),
      );

      const result = await service.apply(UPLOAD_ID, user);

      expect(repository.setDigest).toHaveBeenCalledWith(
        UPLOAD_ID,
        'workspace-1',
        digest,
      );
      expect(result).toMatchObject({
        kind: 'changed',
        upload: { id: UPLOAD_ID, plan_digest: digest },
        state: { people, teams: [backend] },
      });
      expect(teamsService.create).not.toHaveBeenCalled();
      expect(teamsService.update).not.toHaveBeenCalled();
      expect(usersService.assignTeams).not.toHaveBeenCalled();
      expect(usersService.makeManagers).not.toHaveBeenCalled();
      expect(repository.markApplied).not.toHaveBeenCalled();
    });

    it.each([
      TeamFileUploadStatus.Superseded,
      TeamFileUploadStatus.Canceled,
      TeamFileUploadStatus.Applied,
    ])('changes nothing on an upload that is %s', async (status) => {
      const stored = upload({ status });
      const { service, repository, usersService } = buildWith(stored);

      await expect(service.apply(UPLOAD_ID, user)).resolves.toEqual({
        kind: 'closed',
        status,
        upload: stored,
      });
      expect(calls).toEqual(['begin', 'lock', 'find upload']);
      expect(usersService.findMany).not.toHaveBeenCalled();
      expect(repository.setDigest).not.toHaveBeenCalled();
      expect(repository.markApplied).not.toHaveBeenCalled();
    });

    it('changes nothing on a preview posted more than 7 days ago', async () => {
      const stored = upload({
        created_at: new Date(Date.now() - 7 * DAY_MS - 60_000).toISOString(),
      });
      const { service, repository } = buildWith(stored);

      await expect(service.apply(UPLOAD_ID, user)).resolves.toEqual({
        kind: 'closed',
        status: 'expired',
        upload: stored,
      });
      expect(calls).toEqual(['begin', 'lock', 'find upload']);
      expect(repository.markApplied).not.toHaveBeenCalled();
    });

    it("refuses an ID that is not one of the workspace's uploads", async () => {
      const { service } = buildWith(null);

      await expect(service.apply(UPLOAD_ID, user)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses an ID that is no UUID without asking the database', async () => {
      const { service, repository } = buildWith(upload());

      await expect(service.apply('not-an-id', user)).rejects.toThrow(
        NotFoundException,
      );
      expect(repository.findOne).not.toHaveBeenCalled();
    });
  });
});
