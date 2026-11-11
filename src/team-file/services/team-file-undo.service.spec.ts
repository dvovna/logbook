import { NotFoundException } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import { DAY_MS } from '@common/utils/date.utils';
import TeamsService from '@modules/teams/services/teams.service';
import ITeamViewModel from '@modules/teams/types/team.interface';
import { UsersService } from '@modules/users/services/users.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { TransactionService } from 'src/database/transaction.service';
import { TeamFileUploadStatus } from 'src/team-file/enums/team-file-upload-status.enum';
import { TeamFileUploadsRepository } from 'src/team-file/repositories/team-file-uploads.repository';
import { TeamFileUndoService } from 'src/team-file/services/team-file-undo.service';
import { ITeamFileUndo } from 'src/team-file/types/team-file-undo.interface';
import { ITeamFileUpload } from 'src/team-file/types/team-file-upload.interface';

const hr = { id: 'hr', slack_team_id: 'ws' } as IUserViewModel;
const UPLOAD_ID = '3b9c3c52-6a43-4a0e-9a8c-1f3f6d6f5a11';

const person = (id: string, fields: Partial<IUserViewModel> = {}) =>
  ({
    id,
    name: `Name ${id}`,
    email: `${id}@x.test`,
    role: UserRole.Member,
    team_id: null,
    slack_id: `S${id}`,
    ...fields,
  }) as IUserViewModel;

const team = (id: string, fields: Partial<ITeamViewModel> = {}) =>
  ({
    id,
    name: `Team ${id}`,
    manager_approvers: [],
    ...fields,
  }) as ITeamViewModel;

const emptyUndo: ITeamFileUndo = {
  createdTeamIds: [],
  assignments: [],
  approvers: [],
  promotions: [],
};

describe('TeamFileUndoService', () => {
  const build = (
    undo: Partial<ITeamFileUndo>,
    {
      people,
      teams,
      referenced = new Map<string, 'records' | 'projects'>(),
      upload = {},
      latestId = UPLOAD_ID,
    }: {
      people: IUserViewModel[];
      teams: ITeamViewModel[];
      referenced?: Map<string, 'records' | 'projects'>;
      upload?: Partial<ITeamFileUpload>;
      latestId?: string;
    },
  ) => {
    const stored = {
      id: UPLOAD_ID,
      slack_team_id: 'ws',
      status: TeamFileUploadStatus.Applied,
      applied_at: new Date().toISOString(),
      undo: { ...emptyUndo, ...undo },
      ...upload,
    } as ITeamFileUpload;
    const repository = {
      findOne: jest.fn().mockResolvedValue(stored),
      findLatestApplied: jest.fn().mockResolvedValue({ id: latestId }),
      markUndone: jest.fn().mockResolvedValue(stored),
    };
    // Reads the current state: what the service changes is not reflected.
    const usersService = {
      findMany: jest.fn(async ({ teamIds }: { teamIds?: string[] }) =>
        teamIds
          ? people.filter((p) => p.team_id && teamIds.includes(p.team_id))
          : people,
      ),
      restoreTeams: jest.fn(
        async (
          restores: {
            userId: string;
            from: string | null;
            to: string | null;
          }[],
        ) =>
          people.filter((p) =>
            restores.some((r) => r.userId === p.id && r.from === p.team_id),
          ),
      ),
      restoreRoles: jest.fn(async (roles: unknown[]) => roles),
    };
    const teamsService = {
      findMany: jest.fn().mockResolvedValue(teams),
      replaceApprovers: jest.fn(
        async (teamId: string, expected: string[]) =>
          teams.find((t) => t.id === teamId)!.manager_approvers?.join() ===
          expected.join(),
      ),
      findReferenced: jest.fn().mockResolvedValue(referenced),
      delete: jest.fn(),
    };
    const transactions = {
      transaction: jest.fn((work: () => Promise<unknown>) => work()),
      lock: jest.fn(),
    };
    const service = new TeamFileUndoService(
      repository as unknown as TeamFileUploadsRepository,
      usersService as unknown as UsersService,
      teamsService as unknown as TeamsService,
      transactions as unknown as TransactionService,
    );

    return {
      service,
      stored,
      repository,
      usersService,
      teamsService,
      transactions,
    };
  };

  it('takes the workspace lock and finds the upload only in the clicker’s workspace', async () => {
    const { service, repository, transactions } = build(
      {},
      { people: [], teams: [] },
    );

    await service.undo(UPLOAD_ID, hr);

    expect(transactions.lock).toHaveBeenCalledWith('team-file:ws');
    expect(repository.findOne).toHaveBeenCalledWith({
      id: UPLOAD_ID,
      slack_team_id: 'ws',
    });
  });

  it.each(['not-an-id', ''])('treats %j as no upload', async (id) => {
    const { service, transactions } = build({}, { people: [], teams: [] });

    await expect(service.undo(id, hr)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(transactions.transaction).not.toHaveBeenCalled();
  });

  it('treats an upload of another status than applied or undone as no upload', async () => {
    const { service } = build(
      {},
      {
        people: [],
        teams: [],
        upload: { status: TeamFileUploadStatus.Previewed },
      },
    );

    await expect(service.undo(UPLOAD_ID, hr)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it.each([
    [
      { status: TeamFileUploadStatus.Undone },
      UPLOAD_ID,
      'it was already undone',
    ],
    [{}, 'newer', 'a newer file was applied'],
    [
      { applied_at: new Date(Date.now() - 8 * DAY_MS).toISOString() },
      UPLOAD_ID,
      "it's been more than 7 days",
    ],
  ])('is closed for %j', async (upload, latestId, reason) => {
    const { service, repository, usersService } = build(
      {},
      { people: [], teams: [], upload, latestId },
    );

    expect(await service.undo(UPLOAD_ID, hr)).toEqual({
      kind: 'closed',
      reason,
    });
    expect(repository.markUndone).not.toHaveBeenCalled();
    expect(usersService.restoreTeams).not.toHaveBeenCalled();
  });

  it('restores each value that is still as Apply left it and keeps the rest', async () => {
    const { service, stored, usersService, teamsService } = build(
      {
        assignments: [
          { userId: 'ann', before: 'old', after: 'new' },
          { userId: 'bo', before: null, after: 'new' },
          { userId: 'cy', before: 'gone', after: 'new' },
        ],
        approvers: [
          { teamId: 'old', before: ['SX', 'SY'], after: ['SX'] },
          { teamId: 'new', before: [], after: ['SA'] },
        ],
      },
      {
        people: [
          person('ann', { team_id: 'new' }),
          person('bo', { team_id: 'old' }),
          person('cy', { team_id: 'new' }),
        ],
        teams: [
          team('old', { manager_approvers: ['SX'] }),
          team('new', { manager_approvers: ['SA', 'SB'] }),
        ],
      },
    );

    const result = await service.undo(UPLOAD_ID, hr);

    expect(usersService.restoreTeams).toHaveBeenCalledWith(
      [
        { userId: 'ann', from: 'new', to: 'old' },
        { userId: 'bo', from: 'new', to: null },
      ],
      hr,
    );
    expect(teamsService.replaceApprovers).toHaveBeenCalledWith(
      'old',
      ['SX'],
      ['SX', 'SY'],
      hr,
    );
    expect(teamsService.replaceApprovers).toHaveBeenCalledWith(
      'new',
      ['SA'],
      [],
      hr,
    );
    expect(result).toEqual({
      kind: 'undone',
      restored: 2,
      kept: [
        "Name cy's earlier team was deleted",
        "Name bo's team, changed since",
        "Team new's leads, changed since",
      ],
      upload: stored,
    });
  });

  it('deletes a created team with no people and no records, and keeps the others with the reason', async () => {
    const { service, stored, teamsService } = build(
      { createdTeamIds: ['empty', 'people', 'requests', 'projects', 'gone'] },
      {
        people: [person('ann', { team_id: 'people' })],
        teams: ['empty', 'people', 'requests', 'projects'].map((id) =>
          team(id),
        ),
        referenced: new Map([
          ['requests', 'records'],
          ['projects', 'projects'],
        ]),
      },
    );

    const result = await service.undo(UPLOAD_ID, hr);

    expect(teamsService.findReferenced).toHaveBeenCalledWith(
      ['empty', 'people', 'requests', 'projects'],
      'ws',
    );
    expect(teamsService.delete).toHaveBeenCalledTimes(1);
    expect(teamsService.delete).toHaveBeenCalledWith('empty', hr);
    expect(result).toEqual({
      kind: 'undone',
      restored: 1,
      kept: [
        'Team people kept: it still has people',
        'Team requests kept: it has requests or time',
        'Team projects kept: it is assigned to projects',
      ],
      upload: stored,
    });
  });

  it('reverses a promotion only for a Manager who leads no team', async () => {
    const { service, stored, usersService } = build(
      {
        promotions: [
          { userId: 'free', before: UserRole.Member },
          { userId: 'leads', before: UserRole.Member },
          { userId: 'changed', before: UserRole.Member },
        ],
      },
      {
        people: [
          person('free', { role: UserRole.Manager }),
          person('leads', { role: UserRole.Manager }),
          person('changed', { role: UserRole.HR }),
        ],
        teams: [team('t', { manager_approvers: ['Sleads'] })],
      },
    );

    const result = await service.undo(UPLOAD_ID, hr);

    expect(usersService.restoreRoles).toHaveBeenCalledWith(
      [{ userId: 'free', role: UserRole.Member }],
      hr,
    );
    expect(result).toEqual({
      kind: 'undone',
      restored: 1,
      kept: [
        'Name leads stays a Manager: still leads Team t',
        "Name changed's role, changed since",
      ],
      upload: stored,
    });
  });
});
