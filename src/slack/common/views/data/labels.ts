import VacationType from '@common/enums/vacation-type.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { IOption } from '@common/types/option.interface';
import { WorkflowStepStatus } from '@modules/request-workflows/types/request-workflow-step.interface';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { ReceiptStatus } from 'src/receipts/enums/receipt-status.enum';
import { ProjectStatus } from 'src/projects/enums/project-status.enum';
import { TimesheetCellLock } from 'src/time-entries/types/timesheet.types';
import { BILLED_ENTRY_MESSAGE } from 'src/time-entries/constants/billed-time-entries';

// How the app names and marks every status and type, in lists, filters,
// forms and messages: one label and one icon per value, so that a value
// reads the same everywhere. Translations would go here too.
export interface ILabel {
  label: string;
  icon: string;
}

export const VACATION_TYPE_LABELS: Record<
  VacationType,
  // `balance`: what the days left of the type are called ("Bonus days: 2
  // available").
  ILabel & { balance: string }
> = {
  [VacationType.AnnualLeave]: {
    label: 'Annual leave',
    balance: 'Annual leave',
    icon: '🏖️',
  },
  [VacationType.BonusDay]: {
    label: 'Bonus day',
    balance: 'Bonus days',
    icon: '🎁',
  },
  [VacationType.SickLeave]: {
    label: 'Sick leave',
    balance: 'Sick leave',
    icon: '🤒',
  },
  [VacationType.UnpaidLeave]: {
    label: 'Unpaid leave',
    balance: 'Unpaid leave',
    icon: '💸',
  },
  [VacationType.Other]: { label: 'Other', balance: 'Other', icon: '📌' },
};

// A type's label; a value the app no longer knows (stored by an older
// version) shows as it is rather than breaking the message.
export const vacationTypeLabel = (type: VacationType): string =>
  VACATION_TYPE_LABELS[type]?.label ?? type;

// What the days left of a type are called, with its icon: '🎁 Bonus days'.
export const balanceTitle = (type: VacationType) =>
  `${VACATION_TYPE_LABELS[type].icon} ${VACATION_TYPE_LABELS[type].balance}`;

export const VACATION_STATUS_LABELS: Record<VacationRequestStatus, ILabel> = {
  [VacationRequestStatus.Pending]: { label: 'Pending', icon: '⏳' },
  [VacationRequestStatus.Approved]: { label: 'Approved', icon: '✅' },
  [VacationRequestStatus.Rejected]: { label: 'Rejected', icon: '❌' },
  [VacationRequestStatus.Canceled]: { label: 'Canceled', icon: '🚫' },
};

// An approver's step of a request: its decision.
export const STEP_STATUS_LABELS: Record<WorkflowStepStatus, ILabel> = {
  [WorkflowStepStatus.Pending]: { label: 'Pending', icon: '⏳' },
  [WorkflowStepStatus.Approved]: { label: 'Approved', icon: '✅' },
  [WorkflowStepStatus.Rejected]: { label: 'Rejected', icon: '❌' },
  [WorkflowStepStatus.Cancelled]: { label: 'Canceled', icon: '🚫' },
};

export const TIME_ENTRY_STATUS_LABELS: Record<TimeEntryStatus, ILabel> = {
  [TimeEntryStatus.Draft]: { label: 'Draft', icon: '📝' },
  [TimeEntryStatus.Submitted]: { label: 'Submitted', icon: '📤' },
  [TimeEntryStatus.Approved]: { label: 'Approved', icon: '✅' },
  [TimeEntryStatus.Rejected]: { label: 'Rejected', icon: '❌' },
  [TimeEntryStatus.Cancelled]: { label: 'Canceled', icon: '🚫' },
};

// Why a timesheet form can't change a cell. `label`: what the form shows
// after its day and hours instead of an input ('Wed 17 · 2h · submitted');
// `error`: the error at the cell when one is typed into anyway.
const TIMESHEET_CELL_LOCKS: Record<
  TimesheetCellLock,
  { label: (entryCount: number) => string; error: string }
> = {
  several: {
    label: (entryCount) => `${entryCount} entries`,
    error:
      'This day has more than one entry on this project: change them on My time.',
  },
  submitted: {
    label: () =>
      TIME_ENTRY_STATUS_LABELS[TimeEntryStatus.Submitted].label.toLowerCase(),
    error: 'Submitted time entries cannot be edited',
  },
  approved: {
    label: () =>
      TIME_ENTRY_STATUS_LABELS[TimeEntryStatus.Approved].label.toLowerCase(),
    error: 'Approved time entries cannot be edited',
  },
  billed: { label: () => 'billed', error: BILLED_ENTRY_MESSAGE },
  project: {
    label: () => 'closed for logging',
    error: 'This project is not available.',
  },
};

export const timesheetCellLockLabel = (
  lock: TimesheetCellLock,
  entryCount: number,
) => TIMESHEET_CELL_LOCKS[lock].label(entryCount);

export const timesheetCellLockError = (lock: TimesheetCellLock) =>
  TIMESHEET_CELL_LOCKS[lock].error;

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, ILabel> = {
  [ProjectStatus.Active]: { label: 'Active', icon: '🟢' },
  [ProjectStatus.OnHold]: { label: 'On hold', icon: '⏸️' },
  [ProjectStatus.Completed]: { label: 'Completed', icon: '🏁' },
};

export const RECEIPT_STATUS_LABELS: Record<ReceiptStatus, ILabel> = {
  [ReceiptStatus.Draft]: { label: 'Needs details', icon: '📝' },
  [ReceiptStatus.Submitted]: { label: 'Waiting', icon: '⏳' },
  [ReceiptStatus.Accepted]: { label: 'Accepted', icon: '✅' },
  [ReceiptStatus.Rejected]: { label: 'Rejected', icon: '❌' },
};

// A value as the app shows it: '⏳ Pending'.
export const withIcon = ({ label, icon }: ILabel) => `${icon} ${label}`;

// The options of a select or a filter: every value of `labels`, in its
// order, with its icon.
export const labelOptions = <Value extends string>(
  labels: Record<Value, ILabel>,
): (IOption & { id: Value })[] =>
  (Object.keys(labels) as Value[]).map((id) => ({
    id,
    name: withIcon(labels[id]),
  }));

// A person as the app names them: the name, else the email.
export const personLabel = (person: {
  name?: string | null;
  email?: string | null;
}) => person.name || person.email || 'Unknown';
