// Reads and writes KEY=value lines of a .env file, leaving every other line
// (comments, other keys, their order) as it is.

const lineOf = (key: string) => new RegExp(`^${key}=.*$`, 'm');

export const envValue = (content: string, key: string): string | undefined => {
  const line = lineOf(key).exec(content)?.[0];

  return line === undefined
    ? undefined
    : line.slice(key.length + 1).replace(/^(["'])(.*)\1$/, '$2');
};

// A value with a space, a quote or a # would be cut or misread without
// quotes; Slack's IDs and secrets have none, a URL may.
const quoted = (value: string) =>
  /[\s#"'$`\\]/.test(value) ? JSON.stringify(value) : value;

// Sets each key: in place when the file has it, else on a new line at the
// end.
export const withEnvValues = (
  content: string,
  values: Record<string, string>,
): string =>
  Object.entries(values).reduce((text, [key, value]) => {
    const line = `${key}=${quoted(value)}`;

    if (lineOf(key).test(text)) {
      // A function, so that `$` in a value isn't read as a replacement
      // pattern.
      return text.replace(lineOf(key), () => line);
    }

    return `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${line}\n`;
  }, content);
