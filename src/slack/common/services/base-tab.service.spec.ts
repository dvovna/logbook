import { Logger } from '@nestjs/common';
import { ViewsPublishArguments } from '@slack/web-api/dist/types/request/views';
import BaseTabService, {
  ModalViewResolversMapType,
} from 'src/slack/common/services/base-tab.service';
import { TabId } from 'src/slack/common/services/tab-navigation.service';
import UserRole from 'src/common/enums/user-role.enum';
import { IUserViewModel } from 'src/users/types/user.interface';

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

const homeView: ViewsPublishArguments = {
  user_id: user.slack_id,
  view: { type: 'home', blocks: [] },
};

class TestTabService extends BaseTabService<ModalViewResolversMapType> {
  public constructor() {
    super(TabId.Home);
  }

  protected getTabView() {
    return Promise.resolve(homeView);
  }
}

describe('BaseTabService', () => {
  let slackCommunicationService: { publishView: jest.Mock };
  let loggerError: jest.SpyInstance;
  let service: TestTabService;

  beforeEach(() => {
    slackCommunicationService = {
      publishView: jest.fn().mockResolvedValue({ ok: true }),
    };
    loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    service = Object.assign(new TestTabService(), {
      slackCommunicationService,
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it("publishes the tab view to the user's workspace", async () => {
    await service.publish({ user });

    expect(slackCommunicationService.publishView).toHaveBeenCalledWith(
      homeView,
      user.slack_team_id,
    );
  });

  it('logs instead of rejecting when Slack refuses the view', async () => {
    slackCommunicationService.publishView.mockRejectedValue(
      new Error('An API error occurred: invalid_blocks'),
    );

    await expect(service.publish({ user })).resolves.toBeUndefined();

    expect(loggerError).toHaveBeenCalledWith(
      'Failed to publish home_tab for U_ADMIN: An API error occurred: invalid_blocks',
      expect.any(String),
    );
  });
});
