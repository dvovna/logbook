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

// A bot token as Slack issues it. A rotating one expires and comes with a
// refresh token; one from before rotation has neither.
export interface IBotTokens {
  token: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
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
  // deleteUninstalledBefore takes it.
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

  // Deletes the workspaces uninstalled before `cutoff`, with all their data
  // (every table cascades from slack_teams). Returns how many.
  public deleteUninstalledBefore(cutoff: Date): Promise<number> {
    return this.slackTeamsRepository.deleteMany({
      uninstalled_at: { operator: 'lt', value: cutoff.toISOString() },
    });
  }

  public async findAccessToken(id: string): Promise<string | null> {
    return (await this.findTokens(id))?.token ?? null;
  }

  // The workspace's bot token, decrypted, with its refresh token and expiry
  // when it rotates. Null for an unknown or uninstalled workspace.
  public async findTokens(id: string): Promise<IBotTokens | null> {
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
    };
  }

  public async saveTokens(id: string, tokens: IBotTokens) {
    await this.slackTeamsRepository.saveTokens(id, this.encrypt(tokens));
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

  public async delete(findParams: IFindParams) {
    return await this.slackTeamsRepository.deleteMany(
      this.getFilterQuery(findParams),
    );
  }

  private getFilterQuery(findParams: IFindParams): RepositoryFilter {
    return {
      ...(findParams.id ? { id: findParams.id } : {}),
      ...(findParams.slackId ? { slack_id: findParams.slackId } : {}),
    };
  }
}
