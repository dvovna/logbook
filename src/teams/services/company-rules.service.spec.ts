import { CompanyRulesService } from '@modules/teams/services/company-rules.service';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { IRuleSetViewModel } from '@modules/teams/types/rule-set.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { APPROVERS_CHANGED } from '@modules/users/events/users.events';

const transactions = {
  transaction: <T>(work: () => Promise<T>) => work(),
};

describe('CompanyRulesService', () => {
  const user = { id: 'user-1' } as IUserViewModel;

  it('update writes the default set and returns it', async () => {
    const updated = { id: 'set-1' } as IRuleSetViewModel;
    const ruleSetsRepository = {
      ensureDefault: jest
        .fn()
        .mockResolvedValue({ id: 'set-1', hr_approvers: ['UHR'] }),
      update: jest.fn().mockResolvedValue(updated),
    };
    const service = new CompanyRulesService(
      ruleSetsRepository as never,
      transactions as never,
      { emitAsync: jest.fn() } as never,
    );

    const result = await service.update(
      'ws-1',
      {
        hrApprovers: ['UHR'],
        hrApproversRule: ApprovalRule.All,
        notificationRecipients: ['UREC'],
        vacationPolicyId: null,
      },
      user,
    );

    expect(result).toBe(updated);
    expect(ruleSetsRepository.update).toHaveBeenCalledWith(
      { id: 'set-1', slack_team_id: 'ws-1' },
      expect.objectContaining({
        hr_approvers: ['UHR'],
        hr_approvers_rule: ApprovalRule.All,
        approval_notification_recipients: ['UREC'],
        vacation_policy_id: null,
        updated_by: 'user-1',
      }),
    );
  });

  // The requests that waited for anyone who can approve them are looked at
  // again; only someone new on level 2 could approve one.
  it.each([
    [['UHR'], ['UHR', 'UNEW'], true],
    [['UHR', 'UOLD'], ['UHR'], false],
    [['UHR'], ['UHR'], false],
  ])(
    'with level 2 %j becoming %j tells of new approvers: %s',
    async (before, after, tells) => {
      const ruleSetsRepository = {
        ensureDefault: jest
          .fn()
          .mockResolvedValue({ id: 'set-1', hr_approvers: before }),
        update: jest.fn().mockResolvedValue({ id: 'set-1' }),
      };
      const eventEmitter = { emitAsync: jest.fn() };
      const service = new CompanyRulesService(
        ruleSetsRepository as never,
        transactions as never,
        eventEmitter as never,
      );

      await service.update(
        'ws-1',
        {
          hrApprovers: after,
          hrApproversRule: ApprovalRule.Any,
          notificationRecipients: [],
          vacationPolicyId: null,
        },
        user,
      );

      expect(eventEmitter.emitAsync.mock.calls).toEqual(
        tells ? [[APPROVERS_CHANGED, { slackTeamId: 'ws-1' }]] : [],
      );
    },
  );

  it('usesPolicy is true when a rule set of the workspace holds the policy', async () => {
    const ruleSetsRepository = { count: jest.fn().mockResolvedValue(1) };
    const service = new CompanyRulesService(
      ruleSetsRepository as never,
      transactions as never,
      {} as never,
    );

    expect(await service.usesPolicy('p-1', 'ws-1')).toBe(true);
    expect(ruleSetsRepository.count).toHaveBeenCalledWith({
      slack_team_id: 'ws-1',
      vacation_policy_id: 'p-1',
    });
  });
});
