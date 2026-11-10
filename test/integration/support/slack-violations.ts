// Calls to Slack and answers to Slack that Slack would have refused, or
// would show otherwise than the app meant. The fake and the test client add
// to it; setup-after-env.ts fails the test.
const violations: string[] = [];

export const reportSlackViolation = (where: string, problems: string[]) => {
  if (problems.length) {
    violations.push(`${where}, refused:\n  ${problems.join('\n  ')}`);
  }
};

// What Slack takes but shows wrongly (block-kit-display-rules.ts).
export const reportDisplayProblems = (where: string, problems: string[]) => {
  if (problems.length) {
    violations.push(`${where}, shown wrongly:\n  ${problems.join('\n  ')}`);
  }
};

export const takeSlackViolations = () => violations.splice(0);
