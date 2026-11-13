import { Injectable, NotFoundException } from '@nestjs/common';
import { ValidationError } from '@common/errors/validation.error';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { UsersService } from '@modules/users/services/users.service';
import TeamsService from '@modules/teams/services/teams.service';
import { assertCanManageReceipts } from '@modules/receipts/constants/receipt-roles';
import { ReceiptStatus } from '@modules/receipts/enums/receipt-status.enum';
import { ReceiptsRepository } from '@modules/receipts/repositories/receipts.repository';
import { ReimbursementOptOutsService } from '@modules/receipts/services/reimbursement-opt-outs.service';
import { ReimbursementsService } from '@modules/receipts/services/reimbursements.service';
import { IReceiptsMonth } from '@modules/receipts/types/receipts-month.interface';
import { buildMonthOverview } from '@modules/receipts/utils/month-overview';
import { isMonthStart } from '@modules/receipts/utils/receipt-months';

@Injectable()
export class ReceiptsMonthService {
  public constructor(
    private readonly receipts: ReceiptsRepository,
    private readonly optOuts: ReimbursementOptOutsService,
    private readonly reimbursements: ReimbursementsService,
    private readonly users: UsersService,
    private readonly teams: TeamsService,
  ) {}

  // One reimbursement's month: every read at once on the pool.
  public async getMonth(
    params: { reimbursementId: string; month: string },
    actor: IUserViewModel,
  ): Promise<IReceiptsMonth> {
    assertCanManageReceipts(actor);

    return this.getMonthOf(params, actor.slack_team_id);
  }

  // The same overview for the reminders, which run as nobody: the caller
  // is Logbook itself and decides who hears of it.
  public getMonthForSystem(
    params: { reimbursementId: string; month: string },
    slackTeamId: string,
  ): Promise<IReceiptsMonth> {
    return this.getMonthOf(params, slackTeamId);
  }

  private async getMonthOf(
    params: { reimbursementId: string; month: string },
    slackTeamId: string,
  ): Promise<IReceiptsMonth> {
    if (!isMonthStart(params.month)) {
      throw new ValidationError('Choose a month.', 'month');
    }

    const [reimbursement, receipts, users, teams, optOuts, sameFileOwners] =
      await Promise.all([
        this.reimbursements.findById(params.reimbursementId, slackTeamId),
        this.receipts.findMany(
          {
            slack_team_id: slackTeamId,
            reimbursement_id: params.reimbursementId,
            month: params.month,
            status: { operator: 'neq', value: ReceiptStatus.Draft },
          },
          { orderBy: ['submitted_at:asc', 'file_name:asc', 'created_at:asc'] },
        ),
        this.users.findMany({ slackTeamId }),
        this.teams.findMany({ slackTeamId }),
        this.optOuts.findOptedOutUserIds(params.reimbursementId, slackTeamId),
        this.receipts.findFileOwners(
          slackTeamId,
          params.reimbursementId,
          params.month,
        ),
      ]);

    if (!reimbursement) {
      throw new NotFoundException(
        `Reimbursement ${params.reimbursementId} not found`,
      );
    }

    // Owners and deciders deactivated since (receipts or same files) are still
    // named in the month.
    const known = new Set(users.map(({ id }) => id));
    const missing = [
      ...new Set([
        ...receipts.map(({ userId }) => userId),
        ...receipts.flatMap(({ decidedBy }) => (decidedBy ? [decidedBy] : [])),
        ...[...sameFileOwners.values()].flat(),
      ]),
    ].filter((id) => !known.has(id));
    const inactive = missing.length
      ? await this.users.findMany({
          slackTeamId,
          ids: missing,
          includeInactive: true,
        })
      : [];

    const teamNames = new Map(teams.map(({ id, name }) => [id, name]));

    return buildMonthOverview({
      reimbursement,
      month: params.month,
      receipts,
      people: [...users, ...inactive].map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        active: user.is_active,
        teamName: (user.team_id && teamNames.get(user.team_id)) || null,
      })),
      optedOutUserIds: new Set(optOuts),
      sameFileOwners,
    });
  }
}
