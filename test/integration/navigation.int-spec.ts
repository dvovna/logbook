import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { HEADER_BLOCK_IDS } from '@modules/slack/common/views/components/screen-header.view';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { VacationHistoryTabViewActionId } from '@modules/slack/tabs/vacation-requests/enums/vacation-history-tab-view-action-id.enum';
import { PolicyTabViewActionId } from '@modules/slack/tabs/vacation-policies/views/vacation-policy-tab.view';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { View } from '@slack/types/dist/views';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { SlackJson } from './support/block-kit';
import { actOnTab, openAppHomeTab, openModalFrom } from './support/app-home';
import { buttonText, sectionTexts } from './support/tab-readers';
import { workWeek } from './support/dates';
import { approvalMessageTo, requestVacation } from './support/vacation-flows';

const elementsOf = (view: View, blockId: string): SlackJson[] =>
  (view.blocks as SlackJson[]).find((block) => block.block_id === blockId)
    ?.elements ?? [];

// A header row as it reads: the buttons' labels and the More menu with what
// it shows ('☰ More ▾'), the open screen in [brackets].
const rowOf = (view: View, blockId: string) =>
  elementsOf(view, blockId).map(
    ({ type, text, style, placeholder, initial_option }: SlackJson) => {
      if (type === 'static_select') {
        return initial_option
          ? `[${initial_option.text.text} ▾]`
          : `${placeholder.text} ▾`;
      }

      return style === 'primary' ? `[${text.text}]` : text.text;
    },
  );

// The More menu's screens by group.
const menuOf = (view: View) => {
  const menu = elementsOf(view, HEADER_BLOCK_IDS.navigation).find(
    ({ action_id }) => action_id === NavigationActionId.Menu,
  )!;
  const titles = (options: SlackJson[]) =>
    options.map((option) => option.text.text);

  return menu.option_groups
    ? Object.fromEntries(
        menu.option_groups.map((group: SlackJson) => [
          group.label.text,
          titles(group.options),
        ]),
      )
    : titles(menu.options);
};

describe('Navigation', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let admin: Tables<'users'>;
  let manager: Tables<'users'>;
  let member: Tables<'users'>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    admin = await workspace.addUser({ role: UserRole.Admin });
    manager = await workspace.addUser({ role: UserRole.Manager });
    const team = await workspace.addTeam({
      manager_approvers: [manager.slack_id],
    });
    member = await workspace.addUser({ team_id: team.id, name: 'Max Member' });
  });

  it('shows each role one row: its main screens and a More menu', async () => {
    // A member's menu would hold Reports alone: a button instead.
    expect(
      rowOf(
        await openAppHomeTab(t, workspace, member),
        HEADER_BLOCK_IDS.navigation,
      ),
    ).toEqual(['[🏠 Home]', '🕒 My time', '🌴 Time off', '📊 Reports']);

    const managerTimeOff = await openAppHomeTab(t, workspace, manager, [
      NavigationActionId.TimeOff,
    ]);
    expect(rowOf(managerTimeOff, HEADER_BLOCK_IDS.navigation)).toEqual([
      '🏠 Home',
      '🕒 My time',
      '[🌴 Time off]',
      '✅ Approvals',
      '☰ More ▾',
    ]);
    expect(menuOf(managerTimeOff)).toEqual({
      Manage: ['👥 People', '📊 Reports'],
      Settings: ['📁 Projects', '💼 Clients'],
    });

    expect(menuOf(await openAppHomeTab(t, workspace, admin))).toEqual({
      Manage: ['👥 People', '📊 Reports'],
      Settings: ['🏢 Teams', '📜 Policies', '📁 Projects', '💼 Clients'],
    });
  });

  it('opens a screen chosen in the More menu, which then shows it', async () => {
    const teams = await openAppHomeTab(t, workspace, admin, [
      NavigationActionId.Teams,
    ]);

    expect(teams.callback_id).toBe(ViewCallbackId.TeamsTabView);
    expect(rowOf(teams, HEADER_BLOCK_IDS.navigation)).toEqual([
      '🏠 Home',
      '🕒 My time',
      '🌴 Time off',
      '✅ Approvals',
      '[🏢 Teams ▾]',
    ]);

    const home = await actOnTab(
      t,
      workspace,
      admin,
      teams,
      NavigationActionId.Home,
    );
    expect(rowOf(home, HEADER_BLOCK_IDS.navigation)).toContain('☰ More ▾');
  });

  it('goes back from Holidays to Policies', async () => {
    const policy = await workspace.addVacationPolicy({ name: 'Berlin' });
    const holidays = await actOnTab(
      t,
      workspace,
      admin,
      await openAppHomeTab(t, workspace, admin, [NavigationActionId.Policies]),
      PolicyTabViewActionId.ManagePolicyMenu,
      `${PolicyTabViewActionId.EditHolidays}:${policy.id}`,
    );

    expect(rowOf(holidays, HEADER_BLOCK_IDS.navigation)).toContain(
      '[📜 Policies ▾]',
    );
    expect(rowOf(holidays, HEADER_BLOCK_IDS.back)).toEqual([
      '⬅️ Back to 📜 Policies',
    ]);

    const policies = await actOnTab(
      t,
      workspace,
      admin,
      holidays,
      NavigationActionId.Policies,
    );
    expect(policies.callback_id).toBe(ViewCallbackId.VacationPoliciesTabView);
  });

  it('tells an approver on Home what waits, and counts it on Approvals', async () => {
    const project = await workspace.addProject({ name: 'Website' });
    await workspace.addTimeEntry(member, project, {
      status: TimeEntryStatus.Submitted,
    });
    await requestVacation(t, workspace, member, workWeek(2));
    await approvalMessageTo(t, workspace, manager);

    const home = await openAppHomeTab(t, workspace, manager);

    expect(sectionTexts(home)).toContain(
      '*⏳ Needs your attention*\n1 time off request and 1 time entry wait for your decision.',
    );
    expect(buttonText(home, NavigationActionId.Approvals)).toBe(
      '✅ Approvals (2)',
    );

    const approvals = await actOnTab(
      t,
      workspace,
      manager,
      home,
      NavigationActionId.Approvals,
    );
    expect(approvals.callback_id).toBe(ViewCallbackId.ApprovalsTabView);
  });

  // Nobody approves their own request. A step made for the requester before
  // that rule would otherwise wait in their inbox forever.
  it("leaves the approver's own request out of Approvals and its count", async () => {
    const request = await workspace.addVacationRequest(manager, {
      start_date: '2026-07-06',
      end_date: '2026-07-06',
      status: 'pending',
    });
    await t.db
      .insertInto('request_workflow_steps')
      .values({
        request_id: request.id,
        slack_team_id: workspace.id,
        step_type: 'approver',
        step_level: 1,
        slack_user_id: manager.slack_id,
        processed_at: new Date().toISOString(),
        step_data: {
          status: 'pending',
          snapshot: {
            user_id: manager.id,
            slack_user_id: manager.slack_id,
            user_name: manager.name,
            user_email: manager.email,
            start_date: '2026-07-06',
            end_date: '2026-07-06',
            days: 1,
            working_days: 1,
            type: 'annual_leave',
            comment: '',
          },
        },
      })
      .execute();

    const home = await openAppHomeTab(t, workspace, manager);
    expect(buttonText(home, NavigationActionId.Approvals)).toBe('✅ Approvals');
    expect(
      sectionTexts(home).filter((text) =>
        text.includes('Needs your attention'),
      ),
    ).toEqual([]);

    const approvals = await actOnTab(
      t,
      workspace,
      manager,
      home,
      NavigationActionId.Approvals,
    );
    expect(sectionTexts(approvals)).toContain('*🌴 Time off* (0)');
  });

  it('keeps Home quiet for people with nothing to decide', async () => {
    expect(
      sectionTexts(await openAppHomeTab(t, workspace, member)).filter((text) =>
        text.includes('Needs your attention'),
      ),
    ).toEqual([]);
  });

  it('requests time off from Time off', async () => {
    const form = await openModalFrom(
      t,
      workspace,
      member,
      await openAppHomeTab(t, workspace, member, [NavigationActionId.TimeOff]),
      VacationHistoryTabViewActionId.RequestTimeOff,
    );

    expect(form.callback_id).toBe(ViewCallbackId.UserVacationRequest);
  });
});
