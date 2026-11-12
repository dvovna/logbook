import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { z } from 'zod';
import { runInBackground } from '@common/utils/run-in-background';
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

// An ID from the client may be anything.
const isId = (value: string) => z.guid().safeParse(value).success;

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
    const person = await this.findPerson(userId, slackTeamId);

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
    const failures: unknown[] = [];

    for (const recipient of recipients) {
      if (asked.has(recipient.slack_id)) {
        continue;
      }

      try {
        const { channel, ts } =
          await this.slackCommunicationService.postMessage(
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
      } catch (error) {
        failures.push(error);
      }
    }

    // Someone may have placed the person while the questions went out; their
    // placement found only the questions saved by then.
    const placed = await this.findPerson(userId, slackTeamId);

    if (placed?.team_id) {
      await this.closeAsPlaced(placed);
    }

    if (failures.length) {
      throw failures[0];
    }
  }

  // Whatever placed the person: a prompt, the team form, People or the team
  // file. A failure here is logged and not retried; a click on an old
  // question is answered by `choose`. Apply of a big file emits one event per
  // person, so what there is to close is found first.
  @OnEvent(USER_TEAM_CHANGED)
  public async onTeamChanged(event: UserTeamChangedEvent) {
    if (!event.teamId) {
      return;
    }

    const closed = await this.prompts.closeOpen(
      event.userId,
      event.slackTeamId,
    );

    if (closed.length === 0) {
      return;
    }

    const { slackTeamId } = event;
    const [person, team, actor] = await Promise.all([
      this.findPerson(event.userId, slackTeamId),
      this.teamsService.findOne({ slackTeamId, id: event.teamId }),
      event.changedBy ? this.findPerson(event.changedBy, slackTeamId) : null,
    ]);

    if (!person || !team) {
      return;
    }

    await this.show(
      closed,
      this.view.placed(
        actor ? personLabel(actor) : null,
        personLabel(person),
        team.name,
      ),
    );
  }

  public async notYet(userId: string, actor: IUserViewModel) {
    const person = isId(userId)
      ? await this.findPerson(userId, actor.slack_team_id)
      : null;

    if (!person) {
      return this.tell(actor, NO_LONGER_OPEN);
    }

    if (person.team_id) {
      return this.tellPlaced(person, actor);
    }

    const closed = await this.prompts.closeOpen(
      person.id,
      person.slack_team_id,
    );

    if (closed.length === 0) {
      return this.tell(actor, NO_LONGER_OPEN);
    }

    this.showInBackground(
      closed,
      this.view.notYet(personLabel(actor), personLabel(person)),
    );
  }

  // The value is `<user id>|<team id>` from the client: a person or a team
  // that isn't the workspace's is answered as a question that isn't open.
  public async choose(value: string, actor: IUserViewModel) {
    const [userId = '', teamId = ''] = value.split('|');

    if (!isId(userId) || !isId(teamId)) {
      return this.tell(actor, NO_LONGER_OPEN);
    }

    const [person, team] = await Promise.all([
      this.findPerson(userId, actor.slack_team_id),
      this.teamsService.findOne({
        slackTeamId: actor.slack_team_id,
        id: teamId,
      }),
    ]);

    if (!person) {
      return this.tell(actor, NO_LONGER_OPEN);
    }

    if (!team) {
      return this.tell(actor, 'That team no longer exists.');
    }

    if (!person.is_active) {
      this.closeInBackground(
        person,
        this.view.deactivated(personLabel(person)),
      );

      return this.tell(
        actor,
        `${escapeMrkdwn(personLabel(person))} is deactivated.`,
      );
    }

    if (await this.placeIfTeamless(person, team.id, actor)) {
      return;
    }

    // Someone answered first.
    const current = await this.findPerson(userId, actor.slack_team_id);

    if (current?.team_id) {
      return this.tellPlaced(current, actor);
    }

    return this.tell(actor, NO_LONGER_OPEN);
  }

  // The first answer wins: the move applies only while the person is still in
  // no team, so two answers at once can't both place them. The placement
  // emits USER_TEAM_CHANGED, which closes the questions.
  private async placeIfTeamless(
    person: IUserViewModel,
    teamId: string,
    actor: IUserViewModel,
  ) {
    const moved = await this.usersService.restoreTeams(
      [{ userId: person.id, from: null, to: teamId }],
      actor,
    );

    return moved.length > 0;
  }

  private async teamNameOf(person: IUserViewModel) {
    const team = person.team_id
      ? await this.teamsService.findOne({
          slackTeamId: person.slack_team_id,
          id: person.team_id,
        })
      : null;

    return team?.name ?? 'a team';
  }

  private async tellPlaced(person: IUserViewModel, actor: IUserViewModel) {
    const where = await this.teamNameOf(person);

    this.closeInBackground(
      person,
      this.view.placed(null, personLabel(person), where),
    );

    return this.tell(
      actor,
      `${escapeMrkdwn(personLabel(person))} is already in ${escapeMrkdwn(where)}.`,
    );
  }

  private async closeAsPlaced(person: IUserViewModel) {
    const closed = await this.prompts.closeOpen(
      person.id,
      person.slack_team_id,
    );

    await this.show(
      closed,
      this.view.placed(
        null,
        personLabel(person),
        await this.teamNameOf(person),
      ),
    );
  }

  private findPerson(userId: string, slackTeamId: string) {
    return this.usersService.findOne({
      slackTeamId,
      id: userId,
      includeInactive: true,
    });
  }

  // Marks the person's open questions closed first, then updates their
  // messages: a Slack failure never reopens one, and two events don't update
  // a message twice.
  private closeInBackground(person: IUserViewModel, message: ITeamFileMessage) {
    runInBackground(this.logger, 'close the new person questions', async () =>
      this.show(
        await this.prompts.closeOpen(person.id, person.slack_team_id),
        message,
      ),
    );
  }

  // The click is answered first: updating every HR's message takes Slack
  // calls.
  private showInBackground(
    closed: INewPersonPrompt[],
    message: ITeamFileMessage,
  ) {
    runInBackground(this.logger, 'update the new person questions', () =>
      this.show(closed, message),
    );
  }

  private async show(closed: INewPersonPrompt[], message: ITeamFileMessage) {
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
