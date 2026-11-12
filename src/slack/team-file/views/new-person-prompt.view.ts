import { Injectable } from '@nestjs/common';
import { truncate } from 'lodash';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { MAX_SELECT_OPTIONS } from '@modules/slack/common/utils/view.utils';
import { MAX_OPTION_CHARACTERS } from '@modules/slack/team-file/constants/new-person-prompt';
import { NewPersonPromptActionId } from '@modules/slack/team-file/enums/new-person-prompt-action-id.enum';
import { ITeamFileMessage } from '@modules/slack/team-file/types/team-file-message.interface';

@Injectable()
export class NewPersonPromptView {
  // `secondApproval`: the company rules name a second approval level, where
  // the requests of someone in no team go.
  public prompt(
    person: { id: string; name: string },
    teams: { id: string; name: string }[],
    secondApproval: boolean,
  ): ITeamFileMessage {
    const name = escapeMrkdwn(person.name);
    const text = `👋 *${name}* joined Slack. Which team is ${name} on?`;
    const options = [...teams]
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, MAX_SELECT_OPTIONS)
      .map((team) => ({
        text: {
          type: 'plain_text' as const,
          text: truncate(team.name, { length: MAX_OPTION_CHARACTERS }),
        },
        value: `${person.id}|${team.id}`,
      }));

    return {
      text,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text } },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Until then, ${name}'s requests go to ${
                secondApproval
                  ? "the company's second approval"
                  : 'HR or an admin'
              }.`,
            },
          ],
        },
        {
          type: 'actions',
          block_id: ViewCallbackId.NewPersonPrompt,
          elements: [
            {
              type: 'static_select',
              action_id: NewPersonPromptActionId.ChooseTeam,
              placeholder: { type: 'plain_text', text: 'Choose a team' },
              options,
            },
            {
              type: 'button',
              action_id: NewPersonPromptActionId.NotYet,
              text: { type: 'plain_text', text: 'Not yet' },
              value: `${NewPersonPromptActionId.NotYet}:${person.id}`,
            },
          ],
        },
      ],
    };
  }

  // What a question becomes once it is answered; `line` is already mrkdwn.
  public closed(line: string): ITeamFileMessage {
    return {
      text: line,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: line } }],
    };
  }

  public placed(actor: string | null, person: string, team: string) {
    const who = escapeMrkdwn(person);
    const where = escapeMrkdwn(team);

    return this.closed(
      actor
        ? `✅ ${escapeMrkdwn(actor)} placed ${who} in ${where}.`
        : `✅ ${who} is in ${where}.`,
    );
  }

  public notYet(actor: string, person: string) {
    return this.closed(
      `⏸ ${escapeMrkdwn(actor)} left ${escapeMrkdwn(person)} without a team for now.`,
    );
  }

  public deactivated(person: string) {
    return this.closed(`⏸ ${escapeMrkdwn(person)} is deactivated.`);
  }
}
