enum VacationRequestEvent {
  Created = 'vacation_request.created',
  Updated = 'vacation_request.updated',
  Deleted = 'vacation_request.deleted',
  // Approved or rejected at the end of its workflow.
  Decided = 'vacation_request.decided',
}

export default VacationRequestEvent;
