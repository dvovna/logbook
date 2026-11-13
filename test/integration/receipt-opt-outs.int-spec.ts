import { View } from '@slack/types/dist/views';
import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { ReceiptsService } from '@modules/receipts/services/receipts.service';
import { ReceiptsMonthService } from '@modules/receipts/services/receipts-month.service';
import { ReimbursementOptOutsService } from '@modules/receipts/services/reimbursement-opt-outs.service';
import { HomeTabActionId } from '@modules/slack/tabs/home/views/home-tab.view';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { openAppHomeTab, openModalFrom } from './support/app-home';
import { shareReceipt, seedReimbursement } from './support/receipts';
import { actionIdsOf, noticeOf, sectionTexts } from './support/tab-readers';

const asUser = (row: Tables<'users'>) => row as unknown as IUserViewModel;

// Today is Wednesday 2026-06-17 (TEST_NOW).
describe('Receipt reminders opt-outs', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let member: Tables<'users'>;
  let finance: Tables<'users'>;
  let sport: Tables<'reimbursements'>;
  let lunch: Tables<'reimbursements'>;
  let optOuts: ReimbursementOptOutsService;

  beforeAll(async () => {
    t = await createTestApp();
    optOuts = t.app.get(ReimbursementOptOutsService);
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    member = await workspace.addUser({ name: 'Mia Member' });
    finance = await workspace.addUser({
      name: 'Fiona Finance',
      role: UserRole.Finance,
    });
    sport = await seedReimbursement(t, workspace, { name: 'Sport' });
    lunch = await seedReimbursement(t, workspace, { name: 'Lunch' });
  });

  const rows = () =>
    t.db
      .selectFrom('reimbursement_opt_outs')
      .selectAll()
      .where('slack_team_id', '=', workspace.id)
      .execute();

  interface IOption {
    text: { text: string };
    value: string;
  }

  const remindedElement = (form: View) =>
    (
      form.blocks as {
        block_id?: string;
        element?: { options: IOption[]; initial_options?: IOption[] };
      }[]
    ).find(({ block_id }) => block_id === 'reminded_block')!.element!;

  const checked = (form: View) => {
    const element = remindedElement(form);

    return {
      options: element.options.map((option) => option.text.text),
      initial: (element.initial_options ?? []).map(
        (option) => option.text.text,
      ),
    };
  };

  const openForm = async () =>
    openModalFrom(
      t,
      workspace,
      member,
      await openAppHomeTab(t, workspace, member),
      HomeTabActionId.Reminders,
    );

  it('shows the form with every reimbursement checked', async () => {
    const form = await openForm();

    expect((form as { title: unknown }).title).toEqual(
      expect.objectContaining({ text: 'Reminders' }),
    );
    expect(checked(form)).toEqual({
      options: ['Lunch', 'Sport'],
      initial: ['Lunch', 'Sport'],
    });
    expect(sectionTexts(form).concat(JSON.stringify(form.blocks))).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'Reminders about logging time will be set here too.',
        ),
      ]),
    );
  });

  it('opts out of an unchecked reimbursement, and Home and Finance follow', async () => {
    const form = await openForm();
    const sportValue = remindedElement(form).options.find(
      (option) => option.text.text === 'Sport',
    )!.value;
    const since = t.slackApi.mark();

    await t.slack
      .submitView(workspace, member, form, { reminded: [lunch.id] })
      .expect(200)
      .expect(({ body }) => expect(body).toEqual({ response_action: 'clear' }));
    await t.idle();

    expect(await rows()).toEqual([
      {
        slack_team_id: workspace.id,
        user_id: member.id,
        reimbursement_id: sportValue,
      },
    ]);

    const home = await t.slackApi.homeView(workspace.token, member.slack_id, {
      since,
    });
    const texts = sectionTexts(home).join('\n');

    expect(noticeOf(home)).toBe('✅ Reminders saved.');
    expect(texts).toContain('Lunch · June 2026');
    expect(texts).not.toContain('Sport · ');

    const month = await t.app
      .get(ReceiptsMonthService)
      .getMonth(
        { reimbursementId: sport.id, month: '2026-05-01' },
        asUser(finance),
      );

    expect(month.sentNothing.map(({ userId }) => userId)).not.toContain(
      member.id,
    );
  });

  it('keeps the section and its buttons when every reminder is off', async () => {
    await optOuts.setReminded(asUser(member), []);

    const home = await openAppHomeTab(t, workspace, member);

    expect(sectionTexts(home)).toEqual(
      expect.arrayContaining([
        '*🧾 Receipts*',
        'You turned receipt reminders off.',
      ]),
    );
    expect(actionIdsOf(home)).toContain(HomeTabActionId.Reminders);

    const form = await openModalFrom(
      t,
      workspace,
      member,
      home,
      HomeTabActionId.Reminders,
    );

    expect(checked(form).initial).toEqual([]);

    await t.slack
      .submitView(workspace, member, form, { reminded: [sport.id] })
      .expect(200);
    await t.idle();

    expect(await rows()).toEqual([
      expect.objectContaining({ reimbursement_id: lunch.id }),
    ]);
  });

  it('removes the opt-out when the person sends a receipt for it', async () => {
    await optOuts.optOut(asUser(member), sport.id);
    await shareReceipt(t, workspace, member, 'pdf', 'gym.pdf');
    const draft = await t.db
      .selectFrom('receipts')
      .selectAll()
      .where('user_id', '=', member.id)
      .executeTakeFirstOrThrow();

    await t.app.get(ReceiptsService).saveDetails(
      draft.id,
      {
        reimbursementId: sport.id,
        month: '2026-06-01',
        amountCents: 1000,
        comment: null,
      },
      asUser(member),
    );

    expect(await rows()).toEqual([]);
  });

  it('opts out idempotently and only of the workspace’s reimbursements', async () => {
    const other = await t.createWorkspace();
    const foreign = await seedReimbursement(t, other, { name: 'Foreign' });

    await optOuts.optOut(asUser(member), sport.id);
    await optOuts.optOut(asUser(member), sport.id);
    await expect(optOuts.optOut(asUser(member), foreign.id)).rejects.toThrow();

    expect(await optOuts.findOptedOutIds(asUser(member))).toEqual([sport.id]);
  });

  it('ignores another workspace’s reimbursement and leaves archived ones', async () => {
    const other = await t.createWorkspace();
    const foreign = await seedReimbursement(t, other, { name: 'Foreign' });
    const old = await seedReimbursement(t, workspace, { name: 'Old' });

    await optOuts.optOut(asUser(member), old.id);
    await t.db
      .updateTable('reimbursements')
      .set({ archived_at: new Date().toISOString() })
      .where('id', '=', old.id)
      .execute();

    await optOuts.setReminded(asUser(member), [foreign.id, sport.id]);

    expect((await rows()).map((row) => row.reimbursement_id).sort()).toEqual(
      [lunch.id, old.id].sort(),
    );
    expect(await optOuts.findOptedOutUserIds(lunch.id, workspace.id)).toEqual([
      member.id,
    ]);
    expect(await optOuts.findOptedOutUserIds(foreign.id, workspace.id)).toEqual(
      [],
    );
  });

  it('opens nothing without reimbursements', async () => {
    const empty = await t.createWorkspace();
    const person = await empty.addUser({ name: 'Solo' });
    const home = await openAppHomeTab(t, empty, person);

    expect(actionIdsOf(home)).not.toContain(HomeTabActionId.Reminders);
  });
});
