enum VacationRequestEvent {
  Created = 'vacation_request.created',
  Updated = 'vacation_request.updated',
  Deleted = 'vacation_request.deleted',
  // Approved or rejected at the end of its workflow.
  Decided = 'vacation_request.decided',
  // Its approval workflow started (or couldn't): the requester hears who it
  // went to.
  SentForApproval = 'vacation_request.sent_for_approval',
}

export default VacationRequestEvent;
