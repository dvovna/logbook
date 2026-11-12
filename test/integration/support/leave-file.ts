import { Tables } from '@common/types/database.types';
import { SlackJson } from './block-kit';
import { shareTeamFile } from './team-file';
import { ITestApp } from './test-app';
import { TestWorkspace } from './test-workspace';

// A CSV the app wrote, as its lines: without the byte order mark and the
// last line break.
export const csvLines = (content: string) =>
  content.replace('﻿', '').replace(/\r\n$/, '').split('\r\n');

export const BALANCES_TEMPLATE_HEADER =
  'Name,Email,Contract start,Balance on,Days left,Working days left,Bonus days left';

export const HISTORY_TEMPLATE_HEADER = 'Name,Email,Leave type,From,To,Comment';

export const balancesCsv = (...lines: string[]) =>
  [BALANCES_TEMPLATE_HEADER, ...lines].join('\n');

export const historyCsv = (...lines: string[]) =>
  [HISTORY_TEMPLATE_HEADER, ...lines].join('\n');

// Shares the file in the DM with the app and returns what the app posted
// back to the sharer.
export const shareLeaveFile = (
  t: ITestApp,
  workspace: TestWorkspace,
  user: Tables<'users'>,
  content: string | Buffer,
  fileName: string,
) => shareTeamFile(t, workspace, user, content, fileName);

// The texts of a leave file message's sections and context lines, in order.
export const leaveFileTexts = (message?: { blocks?: unknown[] }) =>
  ((message?.blocks ?? []) as SlackJson[]).flatMap((block) =>
    block.type === 'section'
      ? [block.text.text as string]
      : block.type === 'context'
        ? [block.elements[0].text as string]
        : [],
  );

// A table's rows of the workspace in a fixed order, to compare before and
// after: Postgres returns them in no order.
export const rowsById = async <T extends { id: string }>(rows: Promise<T[]>) =>
  (await rows).sort((a, b) => a.id.localeCompare(b.id));
