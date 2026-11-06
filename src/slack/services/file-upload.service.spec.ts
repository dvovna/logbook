import FileUploadService from 'src/slack/services/file-upload.service';
import { UserVacationsImportService } from 'src/user-data-import/user-vacations-import.service';
import { UserTeamsImportService } from 'src/user-data-import/user-teams-import.service';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import { IUserViewModel } from 'src/users/types/user.interface';
import UserRole from 'src/common/enums/user-role.enum';

const admin: IUserViewModel = {
  id: 'admin-1',
  email: 'admin@example.com',
  name: 'Admin',
  role: UserRole.Admin,
  is_active: true,
  team_id: null,
  slack_team_id: 'slack-team-1',
  slack_id: 'U_ADMIN',
  created_at: '2026-01-01T00:00:00Z',
};

describe('FileUploadService', () => {
  let slackCommunicationService: Record<
    'getFileInfo' | 'fetchFileContent' | 'postEphemeral',
    jest.Mock
  >;
  let userTeamsImportService: { handle: jest.Mock };
  let service: FileUploadService;

  beforeEach(() => {
    slackCommunicationService = {
      getFileInfo: jest.fn().mockResolvedValue({
        name: 'user-teams.csv',
        url_private_download: 'https://files.slack.com/user-teams.csv',
      }),
      fetchFileContent: jest
        .fn()
        .mockResolvedValue('email,team\nann@example.com,Core\n'),
      postEphemeral: jest.fn(),
    };
    userTeamsImportService = {
      handle: jest.fn().mockResolvedValue({
        updated: 2,
        unchanged: 1,
        skipped: 1,
        errors: ['User not found: ghost@example.com'],
      }),
    };

    service = new FileUploadService(
      {} as UserVacationsImportService,
      userTeamsImportService as unknown as UserTeamsImportService,
      slackCommunicationService as unknown as SlackCommunicationService,
    );
  });

  it('imports user-teams.csv and reports the result to the admin', async () => {
    await service.handleFileUpload('F123', admin);

    expect(userTeamsImportService.handle).toHaveBeenCalledWith(
      'email,team\nann@example.com,Core\n',
      admin,
    );
    expect(slackCommunicationService.postEphemeral).toHaveBeenCalledWith(
      admin.slack_id,
      {
        text: [
          'User teams import finished.',
          'Updated: 2',
          'Unchanged: 1',
          'Skipped: 1',
          '',
          'Problems:',
          '• User not found: ghost@example.com',
        ].join('\n'),
      },
      admin.slack_team_id,
    );
  });

  it('reports a file that could not be parsed as a failed import', () => {
    expect(
      service.getUserTeamsImportMessage({
        updated: 0,
        unchanged: 0,
        skipped: 0,
        errors: ['Failed to import user teams: CSV validation failed'],
      }),
    ).toEqual({
      text: 'Import was not successful:\nFailed to import user teams: CSV validation failed',
    });
  });

  it('shows at most 20 problems', () => {
    const errors = Array.from({ length: 25 }, (_, i) => `Problem ${i + 1}`);
    const { text } = service.getUserTeamsImportMessage({
      updated: 0,
      unchanged: 0,
      skipped: 25,
      errors,
    });

    expect(text).toContain('• Problem 20');
    expect(text).not.toContain('• Problem 21');
    expect(text).toContain('…and 5 more');
  });
});
