import { UsersService } from '@modules/users/services/users.service';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';

describe('Approvers who are away', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
  });

  describe('who is away', () => {
    it('counts approved time off of any type that covers the day', async () => {
      const onLeave = await workspace.addUser();
      const sick = await workspace.addUser();
      const endsToday = await workspace.addUser();
      const startsToday = await workspace.addUser();
      await workspace.addVacationRequest(onLeave, {
        start_date: '2026-06-15',
        end_date: '2026-06-24',
      });
      await workspace.addVacationRequest(sick, {
        start_date: '2026-06-17',
        end_date: '2026-06-17',
        type: 'sick_leave',
      });
      await workspace.addVacationRequest(endsToday, {
        start_date: '2026-06-10',
        end_date: '2026-06-17',
      });
      await workspace.addVacationRequest(startsToday, {
        start_date: '2026-06-17',
        end_date: '2026-06-19',
      });

      const away = await t.app
        .get(UsersService)
        .findAway(workspace.id, '2026-06-17');

      expect(Object.fromEntries(away)).toEqual({
        [onLeave.slack_id]: {
          userId: onLeave.id,
          since: '2026-06-15',
          until: '2026-06-24',
        },
        [sick.slack_id]: {
          userId: sick.id,
          since: '2026-06-17',
          until: '2026-06-17',
        },
        [endsToday.slack_id]: {
          userId: endsToday.id,
          since: '2026-06-10',
          until: '2026-06-17',
        },
        [startsToday.slack_id]: {
          userId: startsToday.id,
          since: '2026-06-17',
          until: '2026-06-19',
        },
      });
    });

    it('leaves out pending, rejected, past, future and other workspaces’ time off', async () => {
      const pending = await workspace.addUser();
      const rejected = await workspace.addUser();
      const past = await workspace.addUser();
      const future = await workspace.addUser();
      await workspace.addVacationRequest(pending, {
        start_date: '2026-06-17',
        end_date: '2026-06-18',
        status: 'pending',
      });
      await workspace.addVacationRequest(rejected, {
        start_date: '2026-06-17',
        end_date: '2026-06-18',
        status: 'rejected',
      });
      await workspace.addVacationRequest(past, {
        start_date: '2026-06-10',
        end_date: '2026-06-16',
      });
      await workspace.addVacationRequest(future, {
        start_date: '2026-06-18',
        end_date: '2026-06-19',
      });
      const other = await t.createWorkspace();
      await other.addVacationRequest(await other.addUser(), {
        start_date: '2026-06-17',
        end_date: '2026-06-17',
      });

      expect(
        (await t.app.get(UsersService).findAway(workspace.id, '2026-06-17'))
          .size,
      ).toBe(0);
    });
  });
});
