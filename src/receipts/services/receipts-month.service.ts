import { Injectable, NotFoundException } from '@nestjs/common';
import { ValidationError } from '@common/errors/validation.error';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { UsersService } from '@modules/users/services/users.service';
import TeamsService from '@modules/teams/services/teams.service';
import { assertCanManageReceipts } from '@modules/receipts/constants/receipt-roles';
import { ReceiptStatus } from '@modules/receipts/enums/receipt-status.enum';
import { ReceiptsRepository } from '@modules/receipts/repositories/receipts.repository';
import { ReimbursementOptOutsRepository } from '@modules/receipts/repositories/reimbursement-opt-outs.repository';
import { ReimbursementsService } from '@modules/receipts/services/reimbursements.service';
import { IReceiptsMonth } from '@modules/receipts/types/receipts-month.interface';
import { buildMonthOverview } from '@modules/receipts/utils/month-overview';
import { isMonthStart } from '@modules/receipts/utils/receipt-months';

@Injectable()
export class ReceiptsMonthService {
  public constructor(
    private readonly receipts: ReceiptsRepository,
    private readonly optOuts: ReimbursementOptOutsRepository,
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

    if (!isMonthStart(params.month)) {
      throw new ValidationError('Choose a month.', 'month');
    }

    const slackTeamId = actor.slack_team_id;
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
          { orderBy: ['submitted_at:asc', 'created_at:asc'] },
        ),
        this.users.findMany({ slackTeamId }),
        this.teams.findMany({ slackTeamId }),
        this.optOuts.findMany({
          slack_team_id: slackTeamId,
          reimbursement_id: params.reimbursementId,
        }),
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

    // Owners deactivated since (receipts or same files) stay in the month.
    const known = new Set(users.map(({ id }) => id));
    const missing = [
      ...new Set([
        ...receipts.map(({ userId }) => userId),
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
      optedOutUserIds: new Set(optOuts.map(({ userId }) => userId)),
      sameFileOwners,
    });
  }
}
