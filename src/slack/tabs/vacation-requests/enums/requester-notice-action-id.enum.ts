// Buttons in a DM that keeps the requester posted on a pending request
// (VacationRequestProgressNoticesService). The button's value is
// `<action>:<request id>`.
export enum RequesterNoticeActionId {
  ViewDetails = 'requester_view_details',
  CancelRequest = 'requester_cancel_request',
}
