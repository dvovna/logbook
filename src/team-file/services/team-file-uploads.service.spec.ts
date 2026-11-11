import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import UserRole from '@common/enums/user-role.enum';
import { TransactionService } from 'src/database/transaction.service';
import TeamsService from '@modules/teams/services/teams.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { UsersService } from '@modules/users/services/users.service';
import { TeamFileUploadStatus } from 'src/team-file/enums/team-file-upload-status.enum';
import { TeamFileUploadsRepository } from 'src/team-file/repositories/team-file-uploads.repository';
import { planDigest } from 'src/team-file/services/team-file-planner';
import { TeamFileUploadsService } from 'src/team-file/services/team-file-uploads.service';
import { ITeamFileRow } from 'src/team-file/types/team-file-row.interface';
import { ITeamFileUpload } from 'src/team-file/types/team-file-upload.interface';

const user = {
  id: 'hr-1',
  role: UserRole.HR,
  slack_team_id: 'workspace-1',
} as IUserViewModel;

const person = (id: string, isActive = true) =>
  ({
    id,
    email: `${id}@x.test`,
    name: id,
    role: UserRole.Member,
    is_active: isActive,
    team_id: null,
    slack_id: `S${id}`,
  }) as IUserViewModel;

const row = (n: number, email: string, team: string): ITeamFileRow => ({
  row: n,
  name: '',
  email,
  team,
  lead: '',
});

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
    };
    const usersService = {
      findMany: jest
        .fn()
        .mockResolvedValue([person('ann'), person('old', false)]),
    };
    const teamsService = { findMany: jest.fn().mockResolvedValue([]) };
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

      const { upload, plan } = await service.receive(rows, 'file.csv', user);

      expect(usersService.findMany).toHaveBeenCalledWith({
        slackTeamId: 'workspace-1',
        includeInactive: true,
      });
      expect(teamsService.findMany).toHaveBeenCalledWith({
        slackTeamId: 'workspace-1',
      });
      expect(upload).toBe(stored);
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
});
