import HolidaysService from '@modules/holidays/services/holidays.service';
import { UsersService } from '@modules/users/services/users.service';
import { View } from '@slack/types/dist/views';
import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
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
const POLICIES_TAB = [NavigationActionId.Policies];

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
      .insertInto('holidays')
      .values({
        slack_team_id: workspace.id,
        vacation_policy_id: policy.id,
        name: 'Founders Day',
        date: '2026-07-10',
        year: 2026,
        is_company_custom: true,
        created_by: admin.id,
        ...fields,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

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

  // The texts of the options of a modal's select.
  const selectOptionsOf = (view: View, actionId: string) =>
    view.blocks
      .flatMap((block) =>
        'element' in block &&
        block.element &&
        'action_id' in block.element &&
        block.element.action_id === actionId &&
        'options' in block.element
          ? (block.element.options ?? [])
          : [],
      )
      .map((option) => option.text.text);

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
        fields: { Date: '10 Jul 2026', Status: '🟢 On' },
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

    // Old ones out and new ones in are one transaction: a holiday the
    // database refuses leaves the policy as it was.
    it('keeps the holidays imported before when the database refuses a new one', async () => {
      await addHoliday({
        name: 'Old Holiday',
        date: '2026-05-01',
        is_company_custom: false,
        country_code: 'PL',
      });
      const adminUser = await t.app
        .get(UsersService)
        .findBySlackId(admin.slack_id, workspace.id);

      await expect(
        t.app.get(HolidaysService).replaceCountryHolidays(
          {
            slackTeamId: workspace.id,
            vacationPolicyId: policy.id,
            year: 2026,
          },
          [
            { name: 'Independence Day', date: '2026-11-11', countryCode: 'PL' },
            {
              name: null as unknown as string,
              date: '2026-11-12',
              countryCode: 'PL',
            },
          ],
          adminUser!,
        ),
      ).rejects.toThrow(
        '[holidays] createMany error: null value in column "name"',
      );

      expect((await holidays()).map(({ name }) => name)).toEqual([
        'Old Holiday',
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

    it("imports only the whole country's days off, one a day, without a region", async () => {
      t.nager.addHolidays('ES', 2026, [
        ['2026-01-01', "New Year's Day"],
        ['2026-03-19', "Saint Joseph's Day", { counties: ['ES-VC'] }],
        ['2026-05-04', 'Bank Day', { types: ['Bank'] }],
        ['2026-10-12', 'Fiesta Nacional', { types: ['Public', 'Bank'] }],
        ['2026-12-25', 'Christmas Day'],
        ['2026-12-25', 'Navidad'],
      ]);

      await importCountry('ES');

      expect((await holidays()).map(({ name }) => name)).toEqual([
        "New Year's Day",
        'Fiesta Nacional',
        'Christmas Day',
      ]);
    });

    describe('with a region', () => {
      beforeEach(() => {
        t.nager.addHolidays('CH', 2026, [
          ['2026-01-02', "Berchtold's Day", { counties: ['CH-ZH', 'CH-BE'] }],
          ['2026-08-01', 'Swiss National Day'],
          ['2026-09-10', 'Jeûne genevois', { counties: ['CH-GE'] }],
        ]);
        t.nager.addHolidays('AT', 2026, [['2026-10-26', 'National Day']]);
      });

      // The form once the country is chosen: Slack sends the choice, the app
      // rebuilds the form with the country's regions after its answer.
      const chooseCountry = async (country: string) => {
        const form = await openModalFrom(
          t,
          workspace,
          admin,
          await openHolidaysTab(),
          HolidaysTabViewActionId.UploadHolidaysFromCountry,
        );
        const since = t.slackApi.mark();

        await t.slack
          .actOnView(workspace, admin, form, 'country', country)
          .expect(200);
        await t.idle();

        return t.slackApi.updatedModal(workspace.token, { since });
      };

      it('offers the regions of the country chosen', async () => {
        const form = await chooseCountry('CH');

        expect(selectOptionsOf(form, 'region')).toEqual([
          'Only the whole country',
          'CH-BE',
          'CH-GE',
          'CH-ZH',
        ]);
      });

      it("imports the region's holidays with the whole country's", async () => {
        const form = await chooseCountry('CH');

        await t.slack
          .submitView(workspace, admin, form, {
            country: 'CH',
            region: 'CH-ZH',
          })
          .expect(200);

        expect((await holidays()).map(({ name }) => name)).toEqual([
          "Berchtold's Day",
          'Swiss National Day',
        ]);
      });

      it('refuses a region of the country chosen before', async () => {
        const form = await chooseCountry('CH');

        const response = await t.slack
          .submitView(workspace, admin, form, {
            country: 'AT',
            region: 'CH-ZH',
          })
          .expect(200);

        expect(response.body.response_action).toBe('errors');
        expect(Object.values(response.body.errors)).toEqual([
          'This region has no holidays of its own in this country. Choose the region again.',
        ]);
        expect(await holidays()).toEqual([]);
      });
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
