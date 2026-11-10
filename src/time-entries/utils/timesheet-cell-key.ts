// A cell of a project and a day: the block_id and action_id of its input in
// the forms, and the field of an error about it.
export const cellKey = (projectId: string, date: string) =>
  `${projectId}_${date}`;
