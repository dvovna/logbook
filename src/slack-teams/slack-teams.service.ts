import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import { ValidationError } from '@common/errors/validation.error';
import { isCurrencyCode } from '@common/utils/money.utils';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { SlackTeamsRepository } from '@modules/slack-teams/slack-teams.repository';
import { RepositoryFilter } from '@common/repositories/repository.types';
import { TokenCipherService } from '@modules/slack-teams/token-cipher.service';
import { TransactionService } from 'src/database/transaction.service';

// How long deleting one workspace may take. 500k time entries take about
// 3 s on a local database.
const WORKSPACE_DELETE_TIMEOUT_SECONDS = 300;

// A bot token as Slack issues it. A rotating one expires and comes with a
// refresh token; one from before rotation has neither.
export interface IBotTokens {
  token: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
}

// The bot token as findTokens() read it. `storedRefreshToken` is its
// refresh token as stored, encrypted: saveRefreshedTokens() replaces the
// pair only while it is still this one.
export interface IStoredBotTokens extends IBotTokens {
  storedRefreshToken: string | null;
}

interface ICreateWorkspaceParams {
  slackId: string;
  name: string;
  tokens: IBotTokens;
  admin: { slackId: string; email: string; name: string };
}

interface IFindParams {
  id?: string;
  slackId?: string;
}

@Injectable()
export class SlackTeamsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SlackTeamsService.name);

  public constructor(
    private readonly slackTeamsRepository: SlackTeamsRepository,
    private readonly tokenCipher: TokenCipherService,
    private readonly transactions: TransactionService,
  ) {}

  // Tokens stored before they were encrypted get encrypted once the app
  // starts, so none stays in plain text.
  public async onApplicationBootstrap() {
    const plainTextTokens =
      await this.slackTeamsRepository.findPlainTextTokens();

    for (const { id, slack_token } of plainTextTokens) {
      await this.slackTeamsRepository.saveToken(
        id,
        this.tokenCipher.encrypt(slack_token),
      );
    }

    if (plainTextTokens.length) {
      this.logger.log(`Encrypted ${plainTextTokens.length} bot tokens`);
    }
  }

  // A new install: the workspace and its installing admin, in one
  // transaction.
  public createWorkspace({
    slackId,
    name,
    tokens,
    admin,
  }: ICreateWorkspaceParams) {
    const encrypted = this.encrypt(tokens);

    return this.transactions.transaction(() =>
      this.slackTeamsRepository.createWorkspace({
        slackId,
        name,
        tokens: encrypted,
        admin,
      }),
    );
  }

  // A reinstall: Slack gives the workspace a new token, and its name may have
  // changed. A workspace that was uninstalled is back, with its data.
  public async updateInstall(
    id: string,
    { name, tokens }: { name: string; tokens: IBotTokens },
  ) {
    await this.slackTeamsRepository.update(
      { id },
      { name, uninstalled_at: null },
    );
    await this.slackTeamsRepository.saveTokens(id, this.encrypt(tokens));
  }

  // The token goes; the data waits for a reinstall until
  // WorkspaceRetentionService deletes it.
  public async markUninstalled(id: string) {
    await this.slackTeamsRepository.update(
      { id },
      { uninstalled_at: new Date().toISOString() },
    );
    await this.slackTeamsRepository.saveTokens(id, {
      slack_token: null,
      slack_refresh_token: null,
      slack_token_expires_at: null,
    });
  }

  // The workspaces the app is installed in now: not uninstalled.
  public async findInstalledIds(): Promise<string[]> {
    const workspaces = await this.slackTeamsRepository.findMany({
      uninstalled_at: null,
    });

    return workspaces.map(({ id }) => id);
  }

  // See SlackTeamsRepository.claimMemberSync.
  public claimMemberSync(id: string, since: Date, now: Date): Promise<boolean> {
    return this.slackTeamsRepository.claimMemberSync(id, since, now);
  }

  // See SlackTeamsRepository.claimReminderWeek.
  public claimReminderWeek(id: string, monday: string): Promise<boolean> {
    return this.slackTeamsRepository.claimReminderWeek(id, monday);
  }

  // See SlackTeamsRepository.claimReminderDay.
  public claimReminderDay(id: string, day: string): Promise<boolean> {
    return this.slackTeamsRepository.claimReminderDay(id, day);
  }

  // See SlackTeamsRepository.claimAbsenceCheck.
  public claimAbsenceCheck(id: string, date: string): Promise<boolean> {
    return this.slackTeamsRepository.claimAbsenceCheck(id, date);
  }

  // The installed workspaces whose approvers' reminder of the week starting
  // `monday`, or of `day`, hasn't gone out yet, with which: read before
  // anything else, so that a tick that finds them all sent reads nothing
  // more.
  public async findApproverRemindersDue(
    monday: string | null,
    day: string | null,
  ): Promise<{ id: string; week: boolean; day: boolean }[]> {
    const workspaces =
      await this.slackTeamsRepository.findApproverRemindersSent();
    const unsent = (sent: string | null, due: string | null) =>
      !!due && (!sent || sent < due);

    return workspaces
      .map((workspace) => ({
        id: workspace.id,
        week: unsent(workspace.approver_reminder_week, monday),
        day: unsent(workspace.approver_reminder_day, day),
      }))
      .filter((workspace) => workspace.week || workspace.day);
  }

  // See SlackTeamsRepository.claimApproverReminderWeek.
  public claimApproverReminderWeek(
    id: string,
    monday: string,
  ): Promise<boolean> {
    return this.slackTeamsRepository.claimApproverReminderWeek(id, monday);
  }

  // See SlackTeamsRepository.claimApproverReminderDay.
  public claimApproverReminderDay(id: string, day: string): Promise<boolean> {
    return this.slackTeamsRepository.claimApproverReminderDay(id, day);
  }

  public async findUninstalledBefore(cutoff: Date): Promise<string[]> {
    const workspaces = await this.slackTeamsRepository.findMany({
      uninstalled_at: { operator: 'lt', value: cutoff.toISOString() },
    });

    return workspaces.map(({ id }) => id);
  }

  // Every table cascades from slack_teams. With `uninstalledBefore`, a
  // workspace installed again meanwhile stays. Years of a big workspace's
  // time outlast the pool's statement timeout, hence its own.
  public deleteWorkspace(
    id: string,
    uninstalledBefore?: Date,
  ): Promise<boolean> {
    return this.transactions.transaction(async () => {
      await this.transactions.allowLongStatements(
        WORKSPACE_DELETE_TIMEOUT_SECONDS,
      );

      const deleted = await this.slackTeamsRepository.deleteMany({
        id,
        ...(uninstalledBefore
          ? {
              uninstalled_at: {
                operator: 'lt',
                value: uninstalledBefore.toISOString(),
              },
            }
          : {}),
      });

      return deleted > 0;
    });
  }

  // True when this call set it: the first import is done, and the one that
  // did it asks about nobody. It never overwrites.
  public async markMembersImported(slackTeamId: string): Promise<boolean> {
    const marked = await this.slackTeamsRepository.updateMany(
      { id: slackTeamId, members_imported_at: null },
      { members_imported_at: new Date().toISOString() },
    );

    return marked.length > 0;
  }

  public async findAccessToken(id: string): Promise<string | null> {
    return (await this.findTokens(id))?.token ?? null;
  }

  // The workspace's bot token, decrypted, with its refresh token and expiry
  // when it rotates. Null for an unknown or uninstalled workspace.
  public async findTokens(id: string): Promise<IStoredBotTokens | null> {
    const stored = await this.slackTeamsRepository.findStoredTokens(id);

    if (!stored?.slack_token) {
      return null;
    }

    if (!this.tokenCipher.isEncrypted(stored.slack_token)) {
      await this.slackTeamsRepository.saveToken(
        id,
        this.tokenCipher.encrypt(stored.slack_token),
      );
    }

    return {
      token: this.tokenCipher.decrypt(stored.slack_token),
      refreshToken: stored.slack_refresh_token
        ? this.tokenCipher.decrypt(stored.slack_refresh_token)
        : null,
      expiresAt: stored.slack_token_expires_at
        ? new Date(stored.slack_token_expires_at)
        : null,
      storedRefreshToken: stored.slack_refresh_token,
    };
  }

  public async saveTokens(id: string, tokens: IBotTokens) {
    await this.slackTeamsRepository.saveTokens(id, this.encrypt(tokens));
  }

  // The pair a refresh of `previous` got, unless the stored pair changed
  // since findTokens() read it (see SlackTeamsRepository.replaceTokens).
  // False when it did, and nothing was saved.
  public async saveRefreshedTokens(
    id: string,
    previous: IStoredBotTokens,
    refreshed: IBotTokens,
  ): Promise<boolean> {
    if (!previous.storedRefreshToken) {
      return false;
    }

    return this.slackTeamsRepository.replaceTokens(
      id,
      previous.storedRefreshToken,
      this.encrypt(refreshed),
    );
  }

  private encrypt({ token, refreshToken, expiresAt }: IBotTokens) {
    return {
      slack_token: this.tokenCipher.encrypt(token),
      slack_refresh_token: refreshToken
        ? this.tokenCipher.encrypt(refreshToken)
        : null,
      slack_token_expires_at: expiresAt ? expiresAt.toISOString() : null,
    };
  }

  // Whether the setup checklist's last step, telling people about Logbook,
  // was taken.
  public async isTeamTold(id: string): Promise<boolean> {
    return !!(await this.findOneWithValidation({ id })).team_told_at;
  }

  public async markTeamTold(id: string): Promise<void> {
    await this.slackTeamsRepository.update(
      { id },
      { team_told_at: new Date().toISOString() },
    );
  }

  // The currency of the workspace's rates and amounts.
  public async getCurrency(id: string): Promise<string> {
    return (await this.findOneWithValidation({ id })).currency;
  }

  // An admin sets their workspace's currency, as an ISO 4217 code. The rates
  // keep their numbers: they are not converted.
  public async setCurrency(
    currency: string,
    user: IUserViewModel,
  ): Promise<string> {
    if (user.role !== UserRole.Admin) {
      throw new ForbiddenException('Only an admin sets the currency.');
    }

    const code = currency.trim().toUpperCase();

    if (!isCurrencyCode(code)) {
      throw new ValidationError(
        'Enter a currency code such as USD, EUR or GBP.',
        'currency',
      );
    }

    await this.slackTeamsRepository.update(
      { id: user.slack_team_id },
      { currency: code },
    );

    return code;
  }

  public async getTimeOffMinutesPerDay(id: string): Promise<number> {
    return (await this.findOneWithValidation({ id })).time_off_minutes_per_day;
  }

  public async setTimeOffMinutesPerDay(
    id: string,
    minutes: number,
  ): Promise<void> {
    await this.slackTeamsRepository.update(
      { id },
      { time_off_minutes_per_day: minutes },
    );
  }

  public async findOne(findParams: IFindParams) {
    return await this.slackTeamsRepository.findOne(
      this.getFilterQuery(findParams),
    );
  }

  public async findOneWithValidation(findParams: IFindParams) {
    const team = await this.slackTeamsRepository.findOne(
      this.getFilterQuery(findParams),
    );

    if (!team) {
      throw new NotFoundException(`Slack team not found`);
    }

    return team;
  }

  private getFilterQuery(findParams: IFindParams): RepositoryFilter {
    return {
      ...(findParams.id ? { id: findParams.id } : {}),
      ...(findParams.slackId ? { slack_id: findParams.slackId } : {}),
    };
  }
}
