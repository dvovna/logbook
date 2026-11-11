// The action_id of each control in the DM that asks which team a new person
// is on. `choose_team` has the value `<user id>|<team id>`; `not_yet` has
// `not_yet:<user id>`.
export enum NewPersonPromptActionId {
  ChooseTeam = 'choose_team',
  NotYet = 'not_yet',
}
