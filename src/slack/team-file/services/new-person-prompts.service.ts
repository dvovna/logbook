import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { JobsService } from '@common/jobs/jobs.service';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { personLabel } from '@modules/slack/common/views/data/labels';
import { ITeamFileMessage } from '@modules/slack/team-file/types/team-file-message.interface';
import { NewPersonPromptView } from '@modules/slack/team-file/views/new-person-prompt.view';
import { CompanyRulesService } from '@modules/teams/services/company-rules.service';
import TeamsService from '@modules/teams/services/teams.service';
import {
  USER_TEAM_CHANGED,
  UserTeamChangedEvent,
} from '@modules/users/events/users.events';
import { UsersService } from '@modules/users/services/users.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { fallbackApprovers } from '@modules/users/utils/fallback-approvers.utils';
import UserRole from '@common/enums/user-role.enum';
import { NEW_PERSON_PROMPT_JOB } from 'src/team-file/constants/jobs';
import { NewPersonPromptsRepository } from 'src/team-file/repositories/new-person-prompts.repository';
import { INewPersonPrompt } from 'src/team-file/types/new-person-prompt.interface';
import { INewPersonPromptJob } from 'src/team-file/types/new-person-prompt-job.interface';

const NO_LONGER_OPEN = 'This question is no longer open. Nothing changed.';

@Injectable()
export class NewPersonPromptsService implements OnModuleInit {
  private readonly logger = new Logger(NewPersonPromptsService.name);

  public constructor(
    private readonly jobs: JobsService,
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly usersService: UsersService,
    private readonly teamsService: TeamsService,
    private readonly companyRulesService: CompanyRulesService,
    private readonly prompts: NewPersonPromptsRepository,
    private readonly view: NewPersonPromptView,
  ) {}

  public onModuleInit() {
    this.jobs.define<INewPersonPromptJob>(NEW_PERSON_PROMPT_JOB, (job) =>
      this.ask(job.slackTeamId, job.userId),
    );
  }

  // One DM to each of HR, or the admins when nobody has the HR role. Safe to
  // run twice: a recipient who has a question about the person is skipped,
  // so a retry after a Slack failure sends only the missing ones.
  private async ask(slackTeamId: string, userId: string) {
    const person = await this.usersService.findOne({
      slackTeamId,
      id: userId,
    });

    if (!person || person.team_id || !person.is_active) {
      return;
    }

    const [teams, people, rules, saved] = await Promise.all([
      this.teamsService.findMany({ slackTeamId }),
      this.usersService.findMany({
        slackTeamId,
        roles: [UserRole.HR, UserRole.Admin],
      }),
      this.companyRulesService.get(slackTeamId),
      this.prompts.findMany({ slack_team_id: slackTeamId, user_id: userId }),
    ]);
    const recipients =
      fallbackApprovers<IUserViewModel>(people, person.id)?.approvers ?? [];

    if (teams.length === 0 || recipients.length === 0) {
      return;
    }

    const asked = new Set(
      saved.map(({ recipient_slack_id }) => recipient_slack_id),
    );
    const message = this.view.prompt(
      { id: person.id, name: personLabel(person) },
      teams,
      rules.hr_approvers.length > 0,
    );

    for (const recipient of recipients) {
      if (asked.has(recipient.slack_id)) {
        continue;
      }

      const { channel, ts } = await this.slackCommunicationService.postMessage(
        recipient.slack_id,
        message,
        slackTeamId,
      );

      await this.prompts.save({
        slackTeamId,
        userId,
        recipientSlackId: recipient.slack_id,
        channel: channel!,
        ts: ts!,
      });
    }
  }

  // Whatever placed the person: a prompt, the team form, People or the team
  // file. A failure here is logged and not retried; a click on an old
  // question is answered by `choose`.
  @OnEvent(USER_TEAM_CHANGED)
  public async onTeamChanged(event: UserTeamChangedEvent) {
    if (!event.teamId) {
      return;
    }

    const { slackTeamId } = event;
    const [person, team, actor] = await Promise.all([
      this.usersService.findOne({
        slackTeamId,
        id: event.userId,
        includeInactive: true,
      }),
      this.teamsService.findOne({ slackTeamId, id: event.teamId }),
      event.changedBy
        ? this.usersService.findOne({
            slackTeamId,
            id: event.changedBy,
            includeInactive: true,
          })
        : null,
    ]);

    if (!person || !team) {
      return;
    }

    await this.closeFor(
      person,
      this.view.placed(
        actor ? personLabel(actor) : null,
        personLabel(person),
        team.name,
      ),
    );
  }

  public async notYet(userId: string, actor: IUserViewModel) {
    const person = await this.findPerson(userId, actor);

    if (!person) {
      return this.tell(actor, NO_LONGER_OPEN);
    }

    await this.closeFor(
      person,
      this.view.notYet(personLabel(actor), personLabel(person)),
    );
  }

  // The value is `<user id>|<team id>` from the client: a person or a team
  // that isn't the workspace's is answered as a question that isn't open.
  public async choose(value: string, actor: IUserViewModel) {
    const [userId = '', teamId = ''] = value.split('|');
    const [person, team] = await Promise.all([
      this.findPerson(userId, actor),
      this.teamsService.findOne({
        slackTeamId: actor.slack_team_id,
        id: teamId,
      }),
    ]);

    if (!person || !team) {
      return this.tell(actor, NO_LONGER_OPEN);
    }

    const name = escapeMrkdwn(personLabel(person));

    if (!person.is_active) {
      await this.closeFor(person, this.view.deactivated(personLabel(person)));

      return this.tell(actor, `${name} is deactivated.`);
    }

    if (person.team_id) {
      const current = await this.teamsService.findOne({
        slackTeamId: actor.slack_team_id,
        id: person.team_id,
      });
      const where = current?.name ?? 'a team';

      await this.closeFor(
        person,
        this.view.placed(null, personLabel(person), where),
      );

      return this.tell(actor, `${name} is already in ${escapeMrkdwn(where)}.`);
    }

    // The placement emits USER_TEAM_CHANGED, which closes the questions.
    await this.usersService.assignTeams(
      [{ userId: person.id, teamId: team.id }],
      actor,
    );
  }

  private findPerson(userId: string, actor: IUserViewModel) {
    return this.usersService.findOne({
      slackTeamId: actor.slack_team_id,
      id: userId,
      includeInactive: true,
    });
  }

  // Marks the person's open questions closed first, then updates their
  // messages: a Slack failure never reopens one, and two events don't update
  // a message twice.
  private async closeFor(person: IUserViewModel, message: ITeamFileMessage) {
    const closed = await this.prompts.closeOpen(
      person.id,
      person.slack_team_id,
    );

    await Promise.all(
      closed.map((prompt) => this.updateQuietly(prompt, message)),
    );
  }

  private async updateQuietly(
    prompt: INewPersonPrompt,
    message: ITeamFileMessage,
  ) {
    try {
      await this.slackCommunicationService.updateMessage(
        prompt.channel,
        prompt.ts,
        message,
        prompt.slack_team_id,
      );
    } catch (error) {
      this.logger.warn(
        `Could not update the question ${prompt.id}: ${(error as Error).message}`,
      );
    }
  }

  private tell(user: IUserViewModel, text: string) {
    return this.slackCommunicationService.postEphemeral(
      user.slack_id,
      { text },
      user.slack_team_id,
    );
  }
}
