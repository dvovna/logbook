import { Logger } from '@nestjs/common';
import { ViewsPublishArguments } from '@slack/web-api/dist/types/request/views';
import BaseTabService, {
  IPublishBaseParams,
  ModalViewResolversMapType,
} from 'src/slack/common/services/base-tab.service';
import { IPendingApprovals } from 'src/slack/common/services/pending-approvals.service';
import { TabId } from 'src/slack/common/services/tab-navigation.service';
import UserRole from 'src/common/enums/user-role.enum';
import { IUserViewModel } from 'src/users/types/user.interface';
import { NavigationActionId } from 'src/slack/common/enums/navigation-action-id.enum';

const user: IUserViewModel = {
  id: 'user-1',
  email: 'admin@example.com',
  name: 'Admin',
  role: UserRole.Admin,
  is_active: true,
  team_id: null,
  slack_team_id: 'slack-team-1',
  slack_id: 'U_ADMIN',
  created_at: '2026-01-01T00:00:00Z',
};

const content = { type: 'section', text: { type: 'mrkdwn', text: 'Content' } };

class TestTabService extends BaseTabService<ModalViewResolversMapType> {
  public readonly shown: IPublishBaseParams[] = [];

  public constructor(tabId = TabId.Home) {
    super(tabId);
  }

  protected getTabView(
    params: IPublishBaseParams,
  ): Promise<ViewsPublishArguments> {
    this.shown.push(params);

    return Promise.resolve({
      user_id: user.slack_id,
      view: { type: 'home', blocks: [content] },
    });
  }
}

describe('BaseTabService', () => {
  let slackCommunicationService: { publishView: jest.Mock };
  let pendingApprovalsService: { count: jest.Mock };
  let tabNavigationService: { navigate: jest.Mock };
  let loggerError: jest.SpyInstance;

  const createService = (tabId?: TabId): TestTabService =>
    Object.assign(new TestTabService(tabId), {
      slackCommunicationService,
      pendingApprovalsService,
      tabNavigationService,
    });

  const published = () => {
    const [[tabView]] = slackCommunicationService.publishView.mock.calls;

    return tabView as ViewsPublishArguments;
  };

  // The navigation row: its buttons' labels, and the More menu with what
  // it shows.
  const navigationOf = (tabView: ViewsPublishArguments) =>
    (
      tabView.view.blocks as {
        block_id?: string;
        elements?: {
          text?: { text: string };
          placeholder?: { text: string };
          initial_option?: { text: { text: string } };
        }[];
      }[]
    )
      .find(({ block_id }) => block_id === 'navigation')!
      .elements!.map(({ text, placeholder, initial_option }) =>
        text ? text.text : `${(initial_option?.text ?? placeholder)!.text} ▾`,
      );

  beforeEach(() => {
    slackCommunicationService = {
      publishView: jest.fn().mockResolvedValue({ ok: true }),
    };
    pendingApprovalsService = {
      count: jest.fn().mockResolvedValue({ timeOff: 2, timeEntries: 1 }),
    };
    tabNavigationService = { navigate: jest.fn() };
    loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it("publishes the screen under its navigation to the user's workspace", async () => {
    await createService().publish({ user, notice: '✅ Saved.' });

    const tabView = published();
    expect(slackCommunicationService.publishView).toHaveBeenCalledWith(
      tabView,
      user.slack_team_id,
    );
    // One row: Slack folds an actions block past five elements.
    expect(navigationOf(tabView)).toEqual([
      '🏠 Home',
      '🕒 My time',
      '🌴 Time off',
      '✅ Approvals (3)',
      '☰ More ▾',
    ]);
    expect(tabView.view.blocks.slice(1)).toEqual([
      expect.objectContaining({ block_id: 'tab_notice' }),
      content,
    ]);
  });

  // Home shows the count too, and waits for it beside its own reads.
  it('counts what waits for approval beside the screen, not before it', async () => {
    let counted!: (pending: IPendingApprovals) => void;
    pendingApprovalsService.count.mockReturnValue(
      new Promise((resolve) => (counted = resolve)),
    );
    const service = createService();

    const publishing = service.publish({ user });

    expect(service.shown).toHaveLength(1);
    counted({ timeOff: 0, timeEntries: 1 });
    await publishing;
    await expect(service.shown[0].pendingApprovals).resolves.toEqual({
      timeOff: 0,
      timeEntries: 1,
    });
    expect(navigationOf(published())).toContain('✅ Approvals (1)');
  });

  it('still shows the screen when the approvals cannot be counted', async () => {
    pendingApprovalsService.count.mockRejectedValue(new Error('timeout'));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await createService().publish({ user });

    expect(navigationOf(published())).toContain('✅ Approvals');
  });

  it('sends a role to Home from a screen it may not open', async () => {
    const member = { ...user, role: UserRole.Member };
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await createService(TabId.Teams).publish({ user: member });

    expect(slackCommunicationService.publishView).not.toHaveBeenCalled();
    expect(tabNavigationService.navigate).toHaveBeenCalledWith(TabId.Home, {
      user: member,
    });
  });

  it('offers a member only their own screens', async () => {
    await createService().publish({
      user: { ...user, role: UserRole.Member },
    });

    expect(
      (
        published().view.blocks[0] as { elements: { action_id: string }[] }
      ).elements.map(({ action_id }) => action_id),
    ).toEqual([
      NavigationActionId.Home,
      NavigationActionId.MyTime,
      NavigationActionId.TimeOff,
      NavigationActionId.Reports,
    ]);
  });

  it('logs instead of rejecting when Slack refuses the view', async () => {
    slackCommunicationService.publishView.mockRejectedValue(
      new Error('An API error occurred: invalid_blocks'),
    );

    await expect(createService().publish({ user })).resolves.toBeUndefined();

    expect(loggerError).toHaveBeenCalledWith(
      'Failed to publish home_tab for U_ADMIN: An API error occurred: invalid_blocks',
      expect.any(String),
    );
  });
});
