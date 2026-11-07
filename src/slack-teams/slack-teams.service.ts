import {
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { SlackTeamsRepository } from '@modules/slack-teams/slack-teams.repository';
import { SupabaseFilter } from '@common/repositories/base.repository';
import { TokenCipherService } from '@modules/slack-teams/token-cipher.service';

interface ICreateTeamParams {
  name: string;
  slack_id: string;
  slack_token: string;
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

  public async create({ name, slack_id, slack_token }: ICreateTeamParams) {
    return await this.slackTeamsRepository.create({
      slack_id,
      name,
      slack_token: this.tokenCipher.encrypt(slack_token),
      created_at: new Date().toISOString(),
    });
  }

  // A reinstall: Slack gives the workspace a new token, and its name may have
  // changed.
  public async updateInstall(
    id: string,
    {
      name,
      slackToken,
    }: {
      name: string;
      slackToken: string;
    },
  ) {
    await this.slackTeamsRepository.update({ id }, { name });
    await this.slackTeamsRepository.saveToken(
      id,
      this.tokenCipher.encrypt(slackToken),
    );
  }

  public async findAccessToken(id: string): Promise<string | null> {
    const stored = await this.slackTeamsRepository.findStoredToken(id);

    if (!stored) {
      return null;
    }

    if (!this.tokenCipher.isEncrypted(stored)) {
      await this.slackTeamsRepository.saveToken(
        id,
        this.tokenCipher.encrypt(stored),
      );
    }

    return this.tokenCipher.decrypt(stored);
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

  private getFilterQuery(findParams: IFindParams): SupabaseFilter {
    return {
      ...(findParams.id ? { id: findParams.id } : {}),
      ...(findParams.slackId ? { slack_id: findParams.slackId } : {}),
    };
  }
}
