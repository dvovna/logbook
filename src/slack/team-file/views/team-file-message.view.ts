import { Injectable } from '@nestjs/common';
import { KnownBlock } from '@slack/types';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { TeamFileMessageActionId } from '@modules/slack/team-file/enums/team-file-message-action-id.enum';
import { IRuleSetViewModel } from '@modules/teams/types/rule-set.interface';
import { ITeamFilePlan } from 'src/team-file/types/team-file-plan.interface';

// Slack takes at most 3000 characters in a section.
const MAX_SECTION_CHARACTERS = 3000;
const MAX_LISTED = 10;
// Names and reasons are typed by people, so the longest ones are cut before
// they are escaped (cutting after could split an entity).
const MAX_NAME_CHARACTERS = 80;
const MAX_REASON_CHARACTERS = 200;

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;
const safe = (text: string, max = MAX_NAME_CHARACTERS) =>
  escapeMrkdwn(clip(text, max));
const people = (count: number) =>
  count === 1 ? '1 person' : `${count} people`;

const section = (text: string): KnownBlock => ({
  type: 'section',
  text: { type: 'mrkdwn', text },
});

// A title and its bullets: at most 10, fewer when they would not fit in one
// section, and what is left out is counted.
function list(title: string, items: string[], intro?: string): KnownBlock {
  const head = [title, ...(intro ? [intro] : [])].join('\n');
  const lines: string[] = [];
  let length = head.length;

  for (const item of items.slice(0, MAX_LISTED)) {
    const line = `• ${item}`;
    // Leaves room for the "…and N more" line.
    if (length + line.length + 30 > MAX_SECTION_CHARACTERS) break;
    lines.push(line);
    length += line.length + 1;
  }

  const more = items.length - lines.length;

  return section(
    [head, ...lines, ...(more > 0 ? [`…and ${more} more`] : [])].join('\n'),
  );
}

@Injectable()
export class TeamFileMessageView {
  // What the file will do, in the order HR needs to check it. `names` holds
  // the name of every person and team of the plan by ID.
  public preview(
    plan: ITeamFilePlan,
    names: Map<string, string>,
    companyRules: IRuleSetViewModel,
    uploadId: string,
    fileName: string,
  ): KnownBlock[] {
    const name = (id: string | null) =>
      id ? safe(names.get(id) ?? 'Unknown') : 'no team';
    const teamKeyNames = new Map(plan.createTeams.map((t) => [t.key, t.name]));
    const unusable = plan.unusable.length
      ? [
          list(
            `*Rows it can't use (${plan.unusable.length})*`,
            plan.unusable.map(
              ({ row, reason }) =>
                `Row ${row}: ${safe(reason, MAX_REASON_CHARACTERS)}`,
            ),
          ),
        ]
      : [];

    const changes =
      plan.createTeams.length +
      plan.assignments.length +
      plan.leadChanges.length +
      plan.promotions.length;

    if (!changes) {
      return [
        section('Nothing to change: the file matches Logbook.'),
        ...unusable,
      ];
    }

    const sections: KnownBlock[] = [
      section(`*Here's what ${safe(fileName)} will do*`),
    ];

    if (plan.createTeams.length) {
      sections.push(
        list(
          `*Teams to create (${plan.createTeams.length})*`,
          plan.createTeams.map((team) => {
            const leads = team.leadIds.map(name);
            const lead = leads.length
              ? `${leads.join(' and ')} ${leads.length === 1 ? 'leads' : 'lead'}`
              : 'no lead, so requests go straight to the second approval';

            return `*${safe(team.name)}* : ${lead}, ${people(team.memberIds.length)}`;
          }),
        ),
      );
    }

    if (plan.assignments.length) {
      sections.push(
        list(
          `*People changing team (${plan.assignments.length})*`,
          plan.assignments.map(
            ({ userId, fromTeamId, toTeamId, toTeamKey }) =>
              `${name(userId)}: ${name(fromTeamId)} → ${
                toTeamKey
                  ? safe(teamKeyNames.get(toTeamKey) ?? toTeamKey)
                  : name(toTeamId)
              }`,
          ),
        ),
      );
    }

    const leadLines = plan.leadChanges.flatMap(({ teamId, add, remove }) => [
      ...add.map((id) => `${name(id)} leads ${name(teamId)}`),
      ...remove.map((id) => `${name(id)} no longer leads ${name(teamId)}`),
    ]);

    if (leadLines.length) {
      sections.push(list('*Lead changes*', leadLines));
    }

    if (plan.promotions.length) {
      sections.push(
        list(
          '*Becoming Managers because they lead a team*',
          plan.promotions.map(name),
        ),
      );
    }

    if (plan.leftWithoutTeam.length) {
      sections.push(
        list(
          `*Left without a team (${plan.leftWithoutTeam.length})*`,
          plan.leftWithoutTeam.map(name),
        ),
      );
    }

    if (plan.teamsWithoutLead.length) {
      sections.push(
        list(
          `*Teams with no lead (${plan.teamsWithoutLead.length})*`,
          plan.teamsWithoutLead.map((team) => safe(team)),
          'Their requests go straight to the second approval.',
        ),
      );
    }

    if (plan.nameMatches.length) {
      sections.push(
        list(
          '*Team names matched*',
          plan.nameMatches.map(
            ({ written, teamName }) => `${safe(written)} → ${safe(teamName)}`,
          ),
        ),
      );
    }

    sections.push(...unusable, section(this.companyRulesLine(companyRules)), {
      type: 'actions',
      block_id: ViewCallbackId.TeamFileMessage,
      elements: [
        {
          type: 'button',
          action_id: TeamFileMessageActionId.Apply,
          text: { type: 'plain_text', text: 'Apply' },
          style: 'primary',
          value: `${TeamFileMessageActionId.Apply}:${uploadId}`,
        },
        {
          type: 'button',
          action_id: TeamFileMessageActionId.Cancel,
          text: { type: 'plain_text', text: 'Cancel' },
          value: `${TeamFileMessageActionId.Cancel}:${uploadId}`,
        },
        {
          type: 'button',
          action_id: TeamFileMessageActionId.Rules,
          text: { type: 'plain_text', text: 'Company rules' },
          value: `${TeamFileMessageActionId.Rules}:${uploadId}`,
        },
      ],
    });

    return sections;
  }

  public canceled(): KnownBlock[] {
    return [section('Canceled. Nothing changed.')];
  }

  private companyRulesLine(rules: IRuleSetViewModel) {
    const policy = rules.vacation_policy
      ? `vacation policy ${safe(rules.vacation_policy.name)}`
      : 'no vacation policy';
    const approvers = rules.hr_approvers.length
      ? `second approval by ${rules.hr_approvers.map((id) => `<@${id}>`).join(', ')}`
      : 'no second approvers yet';

    return `New teams follow the company rules (${policy}; ${approvers}).`;
  }
}
