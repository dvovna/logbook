// Slack shows five elements of an actions block and folds the rest into
// "+ N more" (it once hid Reports and Settings). More elements than that
// go into rows of even length, at most five each.
export const MAX_ELEMENTS_IN_A_ROW = 5;

export const splitIntoRows = <Element>(elements: Element[]): Element[][] => {
  const rows = Math.ceil(elements.length / MAX_ELEMENTS_IN_A_ROW);
  const size = Math.ceil(elements.length / rows);

  return Array.from({ length: rows }, (_, i) =>
    elements.slice(i * size, (i + 1) * size),
  );
};
