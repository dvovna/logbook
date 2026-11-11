import { Injectable } from '@nestjs/common';
import { KnownBlock } from '@slack/types';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { TeamFileMessageActionId } from '@modules/slack/team-file/enums/team-file-message-action-id.enum';
import { ITeamFileMessage } from '@modules/slack/team-file/types/team-file-message.interface';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { IRuleSetViewModel } from '@modules/teams/types/rule-set.interface';
import { TeamFileUploadStatus } from 'src/team-file/enums/team-file-upload-status.enum';
import {
  planChangesNothing,
  planDigest,
} from 'src/team-file/services/team-file-planner';
import { ITeamFileClosedStatus } from 'src/team-file/types/team-file-apply-result.interface';
import { ITeamFilePlan } from 'src/team-file/types/team-file-plan.interface';

// Slack takes at most 3000 characters in a section.
const MAX_SECTION_CHARACTERS = 3000;
const MAX_LISTED = 10;
// Names and reasons are typed by people, so the longest ones are cut before
// they are escaped (cutting after could split an entity).
const MAX_NAME_CHARACTERS = 80;
const MAX_REASON_CHARACTERS = 200;
// People named in the result's "no team yet" line; the rest are counted.
const MAX_NAMED_WITHOUT_TEAM = 3;

const CHANGED_SINCE_PREVIEW =
  "Logbook changed since this preview, so here's what the file will do now.";
const CLOSED_TEXTS: Partial<Record<ITeamFileClosedStatus, string>> = {
  [TeamFileUploadStatus.Superseded]:
    'A newer file replaced this one. Nothing changed.',
  [TeamFileUploadStatus.Canceled]: 'Canceled. Nothing changed.',
  expired: 'This preview has expired. Send the file again.',
};

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;
const safe = (text: string, max = MAX_NAME_CHARACTERS) =>
  escapeMrkdwn(clip(text, max));
const counted = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;
const people = (count: number) => counted(count, 'person', 'people');
const capitalize = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);

// "Anna", "Anna and Bo", "Anna, Bo and Cy".
const joinNames = (names: string[]) =>
  names.length < 2
    ? names.join('')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

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
    return planChangesNothing(plan)
      ? this.nothingToChange(plan).blocks
      : [
          section(`*Here's what ${safe(fileName)} will do*`),
          ...this.changes(plan, names, companyRules, uploadId),
        ];
  }

  // Apply found the workspace changed since the preview: what the file will
  // do now, to check again.
  public changedPreview(
    plan: ITeamFilePlan,
    names: Map<string, string>,
    companyRules: IRuleSetViewModel,
    uploadId: string,
  ): ITeamFileMessage {
    return {
      text: CHANGED_SINCE_PREVIEW,
      blocks: [
        section(CHANGED_SINCE_PREVIEW),
        ...(planChangesNothing(plan)
          ? this.nothingToChange(plan).blocks
          : this.changes(plan, names, companyRules, uploadId)),
      ],
    };
  }

  public previewText(fileName: string) {
    return `Here's what ${safe(fileName)} will do`;
  }

  public nothingToChange(plan: ITeamFilePlan): ITeamFileMessage {
    const unusable = this.unusable(plan, "Rows it can't use");
    const text = unusable.length
      ? 'Nothing to change.'
      : 'Nothing to change: the file matches Logbook.';

    return { text, blocks: [section(text), ...unusable] };
  }

  public canceled(): ITeamFileMessage {
    return this.closed(TeamFileUploadStatus.Canceled)!;
  }

  // Why Apply did nothing, or null when the message already says what
  // happened (a second click on an applied file).
  public closed(status: ITeamFileClosedStatus): ITeamFileMessage | null {
    const text = CLOSED_TEXTS[status];

    return text ? { text, blocks: [section(text)] } : null;
  }

  // What Apply did, in counts, with the rows it left out, since the preview
  // that listed them is replaced.
  public applied(
    plan: ITeamFilePlan,
    names: Map<string, string>,
    uploadId: string,
  ): ITeamFileMessage {
    const text = this.appliedText(plan, names);

    return {
      text,
      blocks: [
        section(text),
        ...this.unusable(plan, "Rows it didn't use"),
        {
          type: 'actions',
          block_id: ViewCallbackId.TeamFileMessage,
          elements: [
            {
              type: 'button',
              action_id: NavigationActionId.Teams,
              text: { type: 'plain_text', text: 'Open Teams' },
            },
            {
              type: 'button',
              action_id: TeamFileMessageActionId.Undo,
              text: { type: 'plain_text', text: 'Undo' },
              value: `${TeamFileMessageActionId.Undo}:${uploadId}`,
            },
          ],
        },
      ],
    };
  }

  // What Undo put back, and what it left because it changed since.
  public undone(restored: number, kept: string[]): ITeamFileMessage {
    const text = `↩️ Undone: ${restored} ${restored === 1 ? 'change' : 'changes'} restored.`;

    return {
      text,
      blocks: [
        kept.length
          ? list(
              text,
              kept.map((line) => safe(line, MAX_REASON_CHARACTERS)),
              'Kept as they are:',
            )
          : section(text),
      ],
    };
  }

  // E.g. "✅ Created 3 teams and placed 14 people. Maria Volkova has no team
  // yet.", with the parts that are zero left out.
  public appliedText(plan: ITeamFilePlan, names: Map<string, string>) {
    const placed = plan.assignments.filter(
      (a) => a.toTeamId || a.toTeamKey,
    ).length;
    const takenOut = plan.assignments.length - placed;
    const added = plan.leadChanges.flatMap(({ add }) => add).length;
    const removed = plan.leadChanges.flatMap(({ remove }) => remove).length;
    const promoted = plan.promotions.length;
    const done = [
      plan.createTeams.length > 0 &&
        `created ${counted(plan.createTeams.length, 'team', 'teams')}`,
      placed > 0 && `placed ${people(placed)}`,
      takenOut > 0 &&
        `took ${people(takenOut)} out of ${takenOut === 1 ? 'a team' : 'their teams'}`,
      added > 0 && `added ${counted(added, 'lead', 'leads')}`,
      removed > 0 && `removed ${counted(removed, 'lead', 'leads')}`,
      promoted > 0 &&
        (promoted === 1
          ? 'made 1 person a Manager'
          : `made ${promoted} people Managers`),
    ].filter((part): part is string => !!part);
    const summary = `✅ ${capitalize(joinNames(done))}.`;

    const withoutTeam = plan.leftWithoutTeam.map((id) =>
      safe(names.get(id) ?? 'Unknown'),
    );

    if (!withoutTeam.length) {
      return summary;
    }

    const named = withoutTeam.slice(0, MAX_NAMED_WITHOUT_TEAM);
    const more = withoutTeam.length - named.length;
    const who = more
      ? `${named.join(', ')} and ${more} more`
      : joinNames(named);

    return `${summary} ${who} ${withoutTeam.length === 1 ? 'has' : 'have'} no team yet.`;
  }

  private unusable(plan: ITeamFilePlan, title: string): KnownBlock[] {
    return plan.unusable.length
      ? [
          list(
            `⚠️ *${title} (${plan.unusable.length})*`,
            plan.unusable.map(
              ({ row, reason }) =>
                `Row ${row}: ${safe(reason, MAX_REASON_CHARACTERS)}`,
            ),
          ),
        ]
      : [];
  }

  // The preview after its heading, of a plan that changes something.
  private changes(
    plan: ITeamFilePlan,
    names: Map<string, string>,
    companyRules: IRuleSetViewModel,
    uploadId: string,
  ): KnownBlock[] {
    const name = (id: string | null) =>
      id ? safe(names.get(id) ?? 'Unknown') : 'no team';
    const teamKeyNames = new Map(plan.createTeams.map((t) => [t.key, t.name]));
    const sections: KnownBlock[] = [];

    if (plan.createTeams.length) {
      sections.push(
        list(
          `*Teams to create (${plan.createTeams.length})*`,
          plan.createTeams.map((team) => {
            const leads = team.leadIds.map(name);
            const count = people(team.memberIds.length);

            return leads.length
              ? `*${safe(team.name)}*: ${joinNames(leads)} ${leads.length === 1 ? 'leads' : 'lead'}, ${count}`
              : `*${safe(team.name)}*: ${count}, no lead, so requests go straight to the second approval`;
          }),
        ),
      );
    }

    const target = (a: ITeamFilePlan['assignments'][number]) =>
      a.toTeamKey
        ? safe(teamKeyNames.get(a.toTeamKey) ?? a.toTeamKey)
        : name(a.toTeamId);
    const moves = plan.assignments.filter(
      (a) => a.fromTeamId && (a.toTeamId || a.toTeamKey),
    );
    const placements = plan.assignments.filter(
      (a) => !a.fromTeamId && (a.toTeamId || a.toTeamKey),
    );

    if (moves.length) {
      sections.push(
        list(
          `*Moves between teams (${moves.length})*`,
          moves.map(
            (a) => `${name(a.userId)}: ${name(a.fromTeamId)} → ${target(a)}`,
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

    if (placements.length) {
      sections.push(
        list(
          `*Placed in a team (${placements.length})*`,
          placements.map((a) => `${name(a.userId)}: ${target(a)}`),
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

    sections.push(
      ...this.unusable(plan, "Rows it can't use"),
      section(this.companyRulesLine(companyRules)),
      {
        type: 'actions',
        block_id: ViewCallbackId.TeamFileMessage,
        elements: [
          {
            type: 'button',
            action_id: TeamFileMessageActionId.Apply,
            text: { type: 'plain_text', text: 'Apply' },
            style: 'primary',
            // Apply does only the plan this preview shows.
            value: `${TeamFileMessageActionId.Apply}:${uploadId}:${planDigest(plan)}`,
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
      },
    );

    return sections;
  }

  private companyRulesLine(rules: IRuleSetViewModel) {
    const policy = rules.vacation_policy
      ? `vacation policy ${safe(rules.vacation_policy.name)}`
      : 'no vacation policy';
    const mentions = (ids: string[]) => ids.map((id) => `<@${id}>`).join(', ');
    const approvers = rules.hr_approvers.length
      ? `second approval by ${mentions(rules.hr_approvers)} (${rules.hr_approvers_rule === ApprovalRule.All ? 'all of them' : 'any one'})`
      : 'no second approvers yet';
    const notified = rules.approval_notification_recipients.length
      ? `${mentions(rules.approval_notification_recipients)} notified of decisions`
      : 'nobody notified of decisions';

    return `New teams follow the company rules (${policy}; ${approvers}; ${notified}).`;
  }
}
