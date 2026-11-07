enum VacationRequestEvent {
  Created = 'vacation_request.created',
  Updated = 'vacation_request.updated',
  Deleted = 'vacation_request.deleted',
  // Approved or rejected at the end of its workflow.
  Decided = 'vacation_request.decided',
  // Nobody on the requester's team can approve it: it went to HR or admins.
  WithoutTeamApprovers = 'vacation_request.without_team_approvers',
}

export default VacationRequestEvent;
