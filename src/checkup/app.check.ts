import { ICheckResult } from 'src/checkup/check.types';

const TIMEOUT_MS = 5_000;

// Whether Slack can reach the app: /health over HTTPS on the configured
// domain, which also says the app reaches its database.
export async function checkApp(
  domain: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<ICheckResult[]> {
  const name = 'Logbook from outside';

  if (!domain) {
    return [
      {
        name,
        status: 'skip',
        detail: "SLACK_REDIRECT_URI doesn't name the domain yet",
      },
    ];
  }

  const url = `https://${domain}/health`;

  try {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // ngrok's free tunnels answer browsers with a warning page first.
      headers: { 'ngrok-skip-browser-warning': '1' },
    });

    return [
      response.status === 200
        ? { name, status: 'ok', detail: `${url} answers 200` }
        : {
            name,
            status: 'fail',
            detail: `${url} answers ${response.status}`,
            fix:
              response.status === 503
                ? "Logbook runs but can't reach its database: see its logs"
                : 'Check that the domain points at Logbook and not at something else (a proxy default page, a stopped tunnel)',
          },
    ];
  } catch (error) {
    return [
      {
        name,
        status: 'fail',
        detail: `${url} doesn't answer: ${(error as Error).message}`,
        fix: 'Start Logbook and put it behind HTTPS on that domain (a reverse proxy, a platform, or a tunnel for development)',
      },
    ];
  }
}
