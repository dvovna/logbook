// The files in order, in parts of at most `maxBytes` each: a file that would
// not fit starts the next part, and one bigger than `maxBytes` is a part of
// its own. No files is one empty part (the CSVs still go).
export const splitIntoParts = <T extends { sizeBytes: number }>(
  files: T[],
  maxBytes: number,
): T[][] => {
  const parts: T[][] = [[]];
  let size = 0;

  for (const file of files) {
    const part = parts[parts.length - 1];

    if (part.length && size + file.sizeBytes > maxBytes) {
      parts.push([file]);
      size = file.sizeBytes;
    } else {
      part.push(file);
      size += file.sizeBytes;
    }
  }

  return parts;
};
