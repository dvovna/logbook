import { Injectable, NotFoundException } from '@nestjs/common';
import { DAY_MS } from '@common/utils/date.utils';
import { TransactionService } from 'src/database/transaction.service';
import TeamsService from '@modules/teams/services/teams.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { UsersService } from '@modules/users/services/users.service';
import { TEAM_FILE_UNDO_DAYS } from 'src/team-file/constants/team-file-limits';
import { TeamFileUploadStatus } from 'src/team-file/enums/team-file-upload-status.enum';
import { TeamFileUploadsRepository } from 'src/team-file/repositories/team-file-uploads.repository';
import { ITeamFileUndo } from 'src/team-file/types/team-file-undo.interface';
import { ITeamFileUndoResult } from 'src/team-file/types/team-file-undo-result.interface';
import { ITeamFileUpload } from 'src/team-file/types/team-file-upload.interface';
import UserRole from '@common/enums/user-role.enum';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sameSet = (a: string[], b: string[]) =>
  new Set(a).size === new Set(b).size && a.every((id) => b.includes(id));

@Injectable()
export class TeamFileUndoService {
  public constructor(
    private readonly uploadsRepository: TeamFileUploadsRepository,
    private readonly usersService: UsersService,
    private readonly teamsService: TeamsService,
    private readonly transactions: TransactionService,
  ) {}

  // Puts back what Apply changed, wherever it is still as Apply left it, and
  // says what it left. The ID comes from a button value: only an upload of the
  // user's workspace is found. Under Apply's lock, so the checks below hold
  // until the commit and two clicks undo once.
  public async undo(
    uploadId: string,
    user: IUserViewModel,
  ): Promise<ITeamFileUndoResult> {
    const slackTeamId = user.slack_team_id;

    if (!UUID.test(uploadId)) {
      throw new NotFoundException('This preview is no longer open.');
    }

    return this.transactions.transaction(async () => {
      await this.transactions.lock(`team-file:${slackTeamId}`);

      const upload = await this.uploadsRepository.findOne({
        id: uploadId,
        slack_team_id: slackTeamId,
      });

      if (!upload) {
        throw new NotFoundException('This preview is no longer open.');
      }

      const reason = await this.closedReason(upload);

      if (reason) {
        return { kind: 'closed', reason };
      }

      const { restored, kept, deletedTeams } = await this.restore(
        upload.undo!,
        user,
      );
      const undone = await this.uploadsRepository.markUndone(
        upload.id,
        slackTeamId,
      );

      return { kind: 'undone', restored, kept, deletedTeams, upload: undone };
    });
  }

  private async closedReason(upload: ITeamFileUpload) {
    if (upload.status === TeamFileUploadStatus.Undone) {
      return 'it was already undone';
    }

    if (upload.status !== TeamFileUploadStatus.Applied || !upload.undo) {
      throw new NotFoundException('This preview is no longer open.');
    }

    const latest = await this.uploadsRepository.findLatestApplied(
      upload.slack_team_id,
    );

    if (latest?.id !== upload.id) {
      return 'a newer file was applied';
    }

    if (
      Date.now() - Date.parse(upload.applied_at!) >
      TEAM_FILE_UNDO_DAYS * DAY_MS
    ) {
      return `it's been more than ${TEAM_FILE_UNDO_DAYS} days`;
    }

    return null;
  }

  // The order matters: people first, so that the created teams can be seen
  // empty; the created teams before the roles, since a team that goes no
  // longer keeps its lead a Manager.
  private async restore(undo: ITeamFileUndo, user: IUserViewModel) {
    const slackTeamId = user.slack_team_id;
    const kept: string[] = [];
    let restored = 0;

    const [people, teams] = await Promise.all([
      this.usersService.findMany({ slackTeamId, includeInactive: true }),
      this.teamsService.findMany({ slackTeamId }),
    ]);
    const peopleById = new Map(people.map((p) => [p.id, p]));
    const teamsById = new Map(teams.map((t) => [t.id, t]));
    const nameOf = (id: string) =>
      peopleById.get(id)?.name || peopleById.get(id)?.email || 'Someone';

    const restorable: ITeamFileUndo['assignments'] = [];

    for (const assignment of undo.assignments) {
      const person = peopleById.get(assignment.userId);

      if (!person) continue;

      if (person.team_id !== assignment.after) {
        kept.push(`${nameOf(assignment.userId)}'s team, changed since`);
      } else if (assignment.before && !teamsById.has(assignment.before)) {
        kept.push(`${nameOf(assignment.userId)}'s earlier team was deleted`);
      } else {
        restorable.push(assignment);
      }
    }

    await this.usersService.assignTeams(
      restorable.map(({ userId, before }) => ({ userId, teamId: before })),
      user,
    );
    restored += restorable.length;

    for (const { teamId, before, after } of undo.approvers) {
      const team = teamsById.get(teamId);

      if (!team) continue;

      if (sameSet(team.manager_approvers ?? [], after)) {
        await this.teamsService.update(
          { id: teamId, slackTeamId },
          { managerApprovers: before },
          user,
        );
        restored += 1;
      } else {
        kept.push(`${team.name}'s leads, changed since`);
      }
    }

    const deletedTeams = await this.deleteEmptyCreatedTeams(
      undo.createdTeamIds,
      teamsById,
      kept,
      user,
    );
    restored += await this.restoreRoles(undo, nameOf, kept, user);

    return { restored, kept, deletedTeams };
  }

  // Only a team that has nothing left: what deleting would refuse or lose
  // is checked first, since a failed statement ends the transaction.
  private async deleteEmptyCreatedTeams(
    createdTeamIds: string[],
    teamsById: Map<string, { name: string }>,
    kept: string[],
    user: IUserViewModel,
  ) {
    const slackTeamId = user.slack_team_id;
    const existing = createdTeamIds.filter((id) => teamsById.has(id));
    const [members, held] = await Promise.all([
      this.usersService.findMany({
        slackTeamId,
        teamIds: existing,
        includeInactive: true,
      }),
      this.uploadsRepository.findTeamsHeldByRecords(existing, slackTeamId),
    ]);
    const withMembers = new Set(members.map(({ team_id }) => team_id));
    const deleted: string[] = [];

    for (const id of existing) {
      const name = teamsById.get(id)!.name;
      const reason = withMembers.has(id) ? 'it still has people' : held.get(id);

      if (reason) {
        kept.push(`${name} kept: ${reason}`);
      } else {
        await this.teamsService.delete(id, user);
        deleted.push(name);
      }
    }

    return deleted;
  }

  // A Manager goes back to the role before the file only when nothing makes
  // them a Manager any more: no team lists them as a lead.
  private async restoreRoles(
    undo: ITeamFileUndo,
    nameOf: (id: string) => string,
    kept: string[],
    user: IUserViewModel,
  ) {
    if (!undo.promotions.length) {
      return 0;
    }

    const slackTeamId = user.slack_team_id;
    const [people, teams] = await Promise.all([
      this.usersService.findMany({ slackTeamId, includeInactive: true }),
      this.teamsService.findMany({ slackTeamId }),
    ]);
    const peopleById = new Map(people.map((p) => [p.id, p]));
    const reversible: { userId: string; role: UserRole }[] = [];

    for (const { userId, before } of undo.promotions) {
      const person = peopleById.get(userId);

      if (!person) continue;

      const led = teams.find((t) =>
        t.manager_approvers?.includes(person.slack_id),
      );

      if (person.role !== UserRole.Manager) {
        kept.push(`${nameOf(userId)}'s role, changed since`);
      } else if (led) {
        kept.push(`${nameOf(userId)} stays a Manager: still leads ${led.name}`);
      } else {
        reversible.push({ userId, role: before });
      }
    }

    return (await this.usersService.restoreRoles(reversible, user)).length;
  }
}
