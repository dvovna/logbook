import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { jsonObjectFrom } from 'kysely/helpers/postgres';
import {
  IRelation,
  BaseRepository,
} from '@common/repositories/base.repository';
import { SqlRow } from '@common/types/sql-database.types';
import ITeamViewModel from '@modules/teams/types/team.interface';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { CompanyRuleValues } from '@modules/teams/types/rule-set.interface';

@Injectable()
export class TeamsRepository extends BaseRepository<'teams', ITeamViewModel> {
  protected readonly tableName = 'teams';

  protected relations: Record<string, IRelation> = {
    vacation_policy: {
      table: 'vacation_policies',
      foreignKey: 'vacation_policy_id',
      columns: ['id', 'name'],
    },
  };

  protected mapToViewModel = (row: SqlRow<'teams'>) => {
    const extendedRow = row as SqlRow<'teams'> & {
      vacation_policy: { id: string; name: string } | null;
    };

    return {
      id: extendedRow.id,
      name: extendedRow.name,
      description: extendedRow.description || '',
      slack_team_id: extendedRow.slack_team_id,
      vacation_policy_id: extendedRow.vacation_policy_id,
      rule_set_id: extendedRow.rule_set_id,
      vacation_policy: extendedRow.vacation_policy,
      manager_approvers: extendedRow.manager_approvers,
      hr_approvers: extendedRow.hr_approvers,
      approval_notification_recipients:
        extendedRow.approval_notification_recipients,
      manager_approvers_rule:
        extendedRow.manager_approvers_rule as ApprovalRule,
      hr_approvers_rule: extendedRow.hr_approvers_rule as ApprovalRule,
      created_at: extendedRow.created_at,
      updated_at: extendedRow.updated_at,
      created_by: extendedRow.created_by,
      updated_by: extendedRow.updated_by,
    };
  };

  // One statement: `teamIds` that requests or time entries (which would lose
  // their team) or project assignments (which would be deleted) refer to.
  // A team with both counts as 'records'.
  public async findReferenced(
    teamIds: string[],
    slackTeamId: string,
  ): Promise<Map<string, 'records' | 'projects'>> {
    if (!teamIds.length) {
      return new Map();
    }

    const referencing = (
      table: 'project_teams' | 'time_entries' | 'vacation_requests',
      kind: 'records' | 'projects',
    ) =>
      this.db
        .selectFrom(table)
        .select(['team_id', sql<string>`${kind}`.as('kind')])
        .where('slack_team_id', '=', slackTeamId)
        .where('team_id', 'in', teamIds);
    const rows = await referencing('project_teams', 'projects')
      .union(referencing('time_entries', 'records'))
      .union(referencing('vacation_requests', 'records'))
      .execute();
    const found = new Map<string, 'records' | 'projects'>();

    for (const { team_id, kind } of rows) {
      if (found.get(team_id!) !== 'records') {
        found.set(team_id!, kind as 'records' | 'projects');
      }
    }

    return found;
  }

  // The team and the company rules of its workspace in one statement, since
  // every vacation request reads them. companyRules is null before the
  // workspace has them.
  public async findOneWithCompanyRules(
    id: string,
    slackTeamId: string,
  ): Promise<{
    team: ITeamViewModel;
    companyRules: CompanyRuleValues | null;
  } | null> {
    const row = await this.selectInWorkspace(slackTeamId)
      .selectAll('teams')
      .select((eb) => [
        ...this.relationColumns(eb as never, 'teams'),
        jsonObjectFrom(
          eb
            .selectFrom('rule_sets')
            .select([
              'rule_sets.hr_approvers',
              'rule_sets.hr_approvers_rule',
              'rule_sets.approval_notification_recipients',
              'rule_sets.vacation_policy_id',
            ])
            .whereRef('rule_sets.slack_team_id', '=', 'teams.slack_team_id')
            .where('rule_sets.is_default', '=', true),
        ).as('company_rules'),
      ])
      .where('teams.id', '=', id)
      .executeTakeFirst();

    if (!row) {
      return null;
    }

    const { company_rules: rules } = row;

    return {
      team: this.toViewModel(row),
      companyRules: rules && {
        ...rules,
        hr_approvers_rule: rules.hr_approvers_rule as ApprovalRule,
      },
    };
  }

  // The leads change only while they are still `expected`, in any order:
  // null when they are not.
  public async replaceApprovers(
    id: string,
    slackTeamId: string,
    expected: string[],
    approvers: string[],
    updatedBy: string,
  ) {
    const row = await this.updateInWorkspace(slackTeamId)
      .set({
        manager_approvers: approvers,
        updated_at: new Date().toISOString(),
        updated_by: updatedBy,
      })
      .where('id', '=', id)
      // As sets, a missing list being empty: the order of leads means
      // nothing. sql.val, since a plain array would be read as a value list.
      .where(
        sql<boolean>`coalesce(manager_approvers, '{}') @> ${sql.val(expected)}::text[] and coalesce(manager_approvers, '{}') <@ ${sql.val(expected)}::text[]`,
      )
      .returningAll()
      .executeTakeFirst();

    return row ? this.toViewModel(row) : null;
  }
}
