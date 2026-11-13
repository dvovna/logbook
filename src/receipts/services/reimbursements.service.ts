import { Injectable, NotFoundException } from '@nestjs/common';
import { reimbursementsLock } from 'src/database/advisory-locks';
import { TransactionService } from 'src/database/transaction.service';
import { DuplicatedRecordError } from '@common/errors/duplicated-record.error';
import MaxItemsCountReachedError from '@common/errors/max-items-count-reached.error';
import { ValidationError } from '@common/errors/validation.error';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { ReimbursementsRepository } from '@modules/receipts/repositories/reimbursements.repository';
import { IReimbursementViewModel } from '@modules/receipts/types/reimbursement.interface';
import { assertCanManageReceipts } from '@modules/receipts/constants/receipt-roles';
import {
  MAX_ACTIVE_REIMBURSEMENTS,
  MAX_RECEIPT_AMOUNT_CENTS,
} from '@modules/receipts/constants/receipt-limits';

export interface IReimbursementInput {
  name: string;
  dueDay: number;
  limitCents: number | null;
}

const ACTIVE = { operator: 'is', value: null } as const;

@Injectable()
export class ReimbursementsService {
  public constructor(
    private readonly reimbursements: ReimbursementsRepository,
    private readonly transactions: TransactionService,
  ) {}

  public findActive(slackTeamId: string) {
    return this.reimbursements.findMany(
      { slack_team_id: slackTeamId, archived_at: ACTIVE },
      { orderBy: ['name:asc'] },
    );
  }

  public findAll(slackTeamId: string) {
    return this.reimbursements.findMany(
      { slack_team_id: slackTeamId },
      { orderBy: ['name:asc'] },
    );
  }

  public findById(id: string, slackTeamId: string) {
    return this.reimbursements.findOne({ id, slack_team_id: slackTeamId });
  }

  // The count, the name check and the insert in one transaction under the
  // workspace's lock: two admins submitting at once can't both pass the limit
  // or take the same name.
  public async create(
    input: IReimbursementInput,
    actor: IUserViewModel,
  ): Promise<IReimbursementViewModel> {
    assertCanManageReceipts(actor);
    const checked = this.check(input);

    return this.transactions.transaction(async () => {
      await this.transactions.lock(reimbursementsLock(actor.slack_team_id));

      const active = await this.findActive(actor.slack_team_id);

      if (active.length >= MAX_ACTIVE_REIMBURSEMENTS) {
        throw new MaxItemsCountReachedError(
          MAX_ACTIVE_REIMBURSEMENTS,
          'active reimbursements',
        );
      }

      this.assertNameFree(checked.name, active);

      return this.reimbursements.create({
        slack_team_id: actor.slack_team_id,
        name: checked.name,
        due_day: checked.dueDay,
        limit_cents: checked.limitCents,
      });
    });
  }

  public async update(
    id: string,
    input: IReimbursementInput,
    actor: IUserViewModel,
  ): Promise<IReimbursementViewModel> {
    assertCanManageReceipts(actor);
    const checked = this.check(input);

    return this.transactions.transaction(async () => {
      await this.transactions.lock(reimbursementsLock(actor.slack_team_id));

      const active = await this.findActive(actor.slack_team_id);

      if (!active.some((item) => item.id === id)) {
        throw new NotFoundException(`Reimbursement ${id} not found`);
      }

      this.assertNameFree(
        checked.name,
        active.filter((item) => item.id !== id),
      );

      return this.reimbursements.update(
        { id, slack_team_id: actor.slack_team_id },
        {
          name: checked.name,
          due_day: checked.dueDay,
          limit_cents: checked.limitCents,
        },
      );
    });
  }

  public async archive(
    id: string,
    actor: IUserViewModel,
  ): Promise<IReimbursementViewModel> {
    assertCanManageReceipts(actor);

    return this.transactions.transaction(async () => {
      await this.transactions.lock(reimbursementsLock(actor.slack_team_id));

      const found = await this.findById(id, actor.slack_team_id);

      if (!found) {
        throw new NotFoundException(`Reimbursement ${id} not found`);
      }

      if (found.archivedAt) {
        return found;
      }

      return this.reimbursements.update(
        { id, slack_team_id: actor.slack_team_id },
        { archived_at: new Date().toISOString() },
      );
    });
  }

  private check(input: IReimbursementInput): IReimbursementInput {
    const name = input.name.trim();

    if (!name) {
      throw new ValidationError('Enter a name.', 'name');
    }

    if (
      !Number.isInteger(input.dueDay) ||
      input.dueDay < 1 ||
      input.dueDay > 28
    ) {
      throw new ValidationError('The due day is from 1 to 28.', 'dueDay');
    }

    if (
      input.limitCents !== null &&
      (!Number.isInteger(input.limitCents) ||
        input.limitCents < 1 ||
        input.limitCents > MAX_RECEIPT_AMOUNT_CENTS)
    ) {
      throw new ValidationError('The limit must be above zero.', 'limit');
    }

    return { name, dueDay: input.dueDay, limitCents: input.limitCents };
  }

  private assertNameFree(name: string, others: IReimbursementViewModel[]) {
    if (others.some((item) => item.name === name)) {
      throw new DuplicatedRecordError(
        'A reimbursement with this name already exists.',
        'name',
      );
    }
  }
}
