const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export const assertLocalUrl = (name: string, value: string | undefined) => {
  let host: string | undefined;

  try {
    host = value ? new URL(value).hostname : undefined;
  } catch {
    host = undefined;
  }

  if (!host || !LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Integration tests only run against a local Supabase stack, but ${name} points to ${host ?? 'nothing'}.`,
    );
  }
};
