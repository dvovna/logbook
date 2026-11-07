// Calls to Slack and answers to Slack that Slack would have refused. The
// fake and the test client add to it; setup-after-env.ts fails the test.
const violations: string[] = [];

export const reportSlackViolation = (where: string, problems: string[]) => {
  if (problems.length) {
    violations.push(`${where}:\n  ${problems.join('\n  ')}`);
  }
};

export const takeSlackViolations = () => violations.splice(0);
