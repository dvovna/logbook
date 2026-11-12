// The action_id of each button in a leave file message; its value is
// `apply:<upload id>:<digest>`, `cancel:<upload id>` or `undo:<upload id>`.
export enum LeaveFileMessageActionId {
  Apply = 'apply',
  Cancel = 'cancel',
  Undo = 'undo',
}
