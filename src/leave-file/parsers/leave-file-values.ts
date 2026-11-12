export type DayCount =
  | { kind: 'empty' }
  | { kind: 'days'; value: number }
  | { kind: 'invalid' }
  | { kind: 'not-half' };

export type SlashOrder = 'none' | 'dmy' | 'mdy' | 'ambiguous' | 'inconsistent';

export type FileDate =
  | { kind: 'empty' }
  | { kind: 'date'; value: string }
  | { kind: 'invalid' }
  | { kind: 'ambiguous' }
  | { kind: 'inconsistent' };

const NUMBER = /^-?\d+([.,]\d+)?$/;
// An Excel date cell arrives as 2026-05-04T00:00:00.000Z; only the day counts.
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(T.*)?$/;
const DOT_DATE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
const SLASH_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})$/;

export const parseDays = (text: string): DayCount => {
  const trimmed = text.trim();
  if (trimmed === '') return { kind: 'empty' };
  if (!NUMBER.test(trimmed)) return { kind: 'invalid' };
  const value = Number(trimmed.replace(',', '.'));
  if ((value * 2) % 1 !== 0) return { kind: 'not-half' };
  return { kind: 'days', value };
};

export const slashOrderOf = (texts: string[]): SlashOrder => {
  let dayFirst = false;
  let monthFirst = false;
  let any = false;
  for (const text of texts) {
    const match = SLASH_DATE.exec(text.trim());
    if (!match) continue;
    any = true;
    if (Number(match[1]) > 12) dayFirst = true;
    if (Number(match[2]) > 12) monthFirst = true;
  }
  if (dayFirst && monthFirst) return 'inconsistent';
  if (dayFirst) return 'dmy';
  if (monthFirst) return 'mdy';
  return any ? 'ambiguous' : 'none';
};

const toDate = (year: number, month: number, day: number): FileDate => {
  if (month < 1 || month > 12 || day < 1) return { kind: 'invalid' };
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return { kind: 'invalid' };
  const pad = (n: number, width: number) => String(n).padStart(width, '0');
  return {
    kind: 'date',
    value: `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`,
  };
};

export const parseFileDate = (text: string, order: SlashOrder): FileDate => {
  const trimmed = text.trim();
  if (trimmed === '') return { kind: 'empty' };

  const iso = ISO_DATE.exec(trimmed);
  if (iso) return toDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dot = DOT_DATE.exec(trimmed);
  if (dot) return toDate(Number(dot[3]), Number(dot[2]), Number(dot[1]));

  const slash = SLASH_DATE.exec(trimmed);
  if (slash) {
    if (order === 'inconsistent') return { kind: 'inconsistent' };
    if (order !== 'dmy' && order !== 'mdy') return { kind: 'ambiguous' };
    const year =
      slash[3].length === 2 ? 2000 + Number(slash[3]) : Number(slash[3]);
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    return order === 'dmy'
      ? toDate(year, second, first)
      : toDate(year, first, second);
  }
  return { kind: 'invalid' };
};
