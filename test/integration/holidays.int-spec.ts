import { View } from '@slack/types/dist/views';
import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { AdminNavigationActionId } from '@modules/slack/common/enums/admin-navigation-action-id';
import { HolidaysTabViewActionId } from '@modules/slack/tabs/holidays/views/holidays-tab.view';
import { PolicyTabViewActionId } from '@modules/slack/tabs/vacation-policies/views/vacation-policy-tab.view';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import {
  actOnTab,
  openAppHomeTab,
  openModalFrom,
  publishedHome,
} from './support/app-home';
import { listItems, sectionTexts, noticeOf } from './support/tab-readers';

// Home → Vacations → Vacation Policies.
const POLICIES_TAB = [
  AdminNavigationActionId.ManageVacations,
  AdminNavigationActionId.ManageVacationPolicies,
];

// Today is 2026-06-17 (TEST_NOW), so the tab starts on 2026. Country
// holidays are cached per country and year for the app's life, so every
// test imports another country.
describe('Holidays', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let admin: Tables<'users'>;
  let policy: Tables<'vacation_policies'>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    admin = await workspace.addUser({ role: UserRole.Admin });
    policy = await workspace.addVacationPolicy({ name: 'Berlin' });
  });

  // Vacation Policies → the policy's menu → Edit Holidays.
  const openHolidaysTab = async () =>
    actOnTab(
      t,
      workspace,
      admin,
      await openAppHomeTab(t, workspace, admin, POLICIES_TAB),
      PolicyTabViewActionId.ManagePolicyMenu,
      `${PolicyTabViewActionId.EditHolidays}:${policy.id}`,
    );

  const addHoliday = (fields: Partial<Tables<'holidays'>> = {}) =>
    t.db
      .from('holidays')
      .insert({
        slack_team_id: workspace.id,
        vacation_policy_id: policy.id,
        name: 'Founders Day',
        date: '2026-07-10',
        year: 2026,
        is_company_custom: true,
        created_by: admin.id,
        ...fields,
      })
      .select()
      .single()
      .then(({ data }) => data!);

  const holidays = async () =>
    (await workspace.rows('holidays'))
      .map(
        ({
          name,
          date,
          year,
          is_company_custom,
          is_disabled,
          country_code,
        }) => ({
          name,
          date,
          year,
          is_company_custom,
          is_disabled,
          country_code,
        }),
      )
      .sort((a, b) => a.date.localeCompare(b.date));

  const named = (view: View, name: string) =>
    listItems(view).find(({ title }) => title === name);

  describe('custom holidays', () => {
    it('adds a holiday to the policy', async () => {
      const form = await openModalFrom(
        t,
        workspace,
        admin,
        await openHolidaysTab(),
        HolidaysTabViewActionId.AddHoliday,
      );

      const since = t.slackApi.mark();
      await t.slack
        .submitView(workspace, admin, form, {
          name: 'Founders Day',
          date: '2026-07-10',
        })
        .expect(200);

      expect(await holidays()).toEqual([
        {
          name: 'Founders Day',
          date: '2026-07-10',
          year: 2026,
          is_company_custom: true,
          is_disabled: false,
          country_code: null,
        },
      ]);
      expect(
        named(await publishedHome(t, workspace, admin, since), 'Founders Day'),
      ).toMatchObject({
        fields: { Date: '2026-07-10', Status: '🟢' },
        menuLabels: ['Edit Holiday', 'Deactivate Holiday', 'Delete Holiday'],
      });
    });

    it('switches a holiday off and on again', async () => {
      const holiday = await addHoliday();
      const toggle = async () => {
        const confirmation = await openModalFrom(
          t,
          workspace,
          admin,
          await openHolidaysTab(),
          HolidaysTabViewActionId.ManageHolidayMenu,
          `${HolidaysTabViewActionId.ToggleHolidayStatus}:${holiday.id}`,
        );
        await t.slack.submitView(workspace, admin, confirmation).expect(200);

        return confirmation;
      };

      expect(sectionTexts(await toggle())).toEqual([
        'Are you sure you want to deactivate the holiday *Founders Day*?',
      ]);
      expect((await workspace.row('holidays', holiday.id)).is_disabled).toBe(
        true,
      );

      await toggle();
      expect((await workspace.row('holidays', holiday.id)).is_disabled).toBe(
        false,
      );
    });

    it('deletes a holiday', async () => {
      const holiday = await addHoliday();
      const confirmation = await openModalFrom(
        t,
        workspace,
        admin,
        await openHolidaysTab(),
        HolidaysTabViewActionId.ManageHolidayMenu,
        `${HolidaysTabViewActionId.DeleteHoliday}:${holiday.id}`,
      );

      await t.slack.submitView(workspace, admin, confirmation).expect(200);

      expect(await holidays()).toEqual([]);
    });
  });

  describe("importing a country's holidays", () => {
    const importCountry = async (country: string) => {
      const form = await openModalFrom(
        t,
        workspace,
        admin,
        await openHolidaysTab(),
        HolidaysTabViewActionId.UploadHolidaysFromCountry,
      );

      return t.slack
        .submitView(workspace, admin, form, { country })
        .expect(200);
    };

    it('imports the holidays of the selected year', async () => {
      t.nager.addHolidays('DE', 2026, [
        ['2026-10-03', 'German Unity Day'],
        ['2026-12-25', 'Christmas Day'],
      ]);

      const since = t.slackApi.mark();
      const response = await importCountry('DE');

      expect(response.body).toEqual({ response_action: 'clear' });
      expect(noticeOf(await publishedHome(t, workspace, admin, since))).toBe(
        '✅ 2 holidays imported.',
      );
      expect(await holidays()).toEqual([
        expect.objectContaining({
          name: 'German Unity Day',
          date: '2026-10-03',
          year: 2026,
          is_company_custom: false,
          country_code: 'DE',
        }),
        expect.objectContaining({ name: 'Christmas Day', country_code: 'DE' }),
      ]);
      const holidaysTab = await publishedHome(t, workspace, admin, since);
      expect(named(holidaysTab, 'German Unity Day')?.menuLabels).toEqual([
        'Deactivate Holiday',
      ]);
    });

    it('replaces the country holidays imported before', async () => {
      await addHoliday({
        name: 'Old Holiday',
        date: '2026-05-01',
        is_company_custom: false,
        country_code: 'PL',
      });
      t.nager.addHolidays('PL', 2026, [['2026-11-11', 'Independence Day']]);

      await importCountry('PL');

      expect((await holidays()).map(({ name }) => name)).toEqual([
        'Independence Day',
      ]);
    });

    it('keeps the custom holidays', async () => {
      await addHoliday({ name: 'Founders Day' });
      t.nager.addHolidays('FR', 2026, [['2026-07-14', 'Bastille Day']]);

      await importCountry('FR');

      expect((await holidays()).map(({ name }) => name)).toEqual([
        'Founders Day',
        'Bastille Day',
      ]);
    });

    it('keeps the holidays when Nager.Date is down', async () => {
      await addHoliday({
        name: 'Old Holiday',
        date: '2026-05-01',
        is_company_custom: false,
        country_code: 'GB',
      });
      t.nager.failFor('GB');

      await importCountry('GB');

      expect((await holidays()).map(({ name }) => name)).toEqual([
        'Old Holiday',
      ]);
    });
  });

  it('shows the holidays of the year chosen', async () => {
    await addHoliday({ name: 'This Year', date: '2026-07-10', year: 2026 });
    await addHoliday({ name: 'Next Year', date: '2027-07-10', year: 2027 });
    const holidaysTab = await openHolidaysTab();

    const nextYear = await actOnTab(
      t,
      workspace,
      admin,
      holidaysTab,
      HolidaysTabViewActionId.ChangeYear,
      '2027',
    );

    expect(named(holidaysTab, 'This Year')).toBeDefined();
    expect(named(holidaysTab, 'Next Year')).toBeUndefined();
    expect(named(nextYear, 'Next Year')).toBeDefined();
    expect(named(nextYear, 'This Year')).toBeUndefined();
  });
});
