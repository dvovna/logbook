import { readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];

async function initDatabase() {
  const connectionString = process.env.SUPABASE_DB_URL;

  if (!connectionString) {
    throw new Error('SUPABASE_DB_URL is not set');
  }

  const { hostname } = new URL(connectionString);
  const client = new Client({
    connectionString,
    ssl: LOCAL_HOSTS.includes(hostname) ? false : { rejectUnauthorized: false },
  });

  const sql = readFileSync(join(__dirname, 'init.sql'), 'utf8');

  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');

    process.stdout.write(`Schema applied to ${hostname}\n`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

initDatabase().catch((error: Error) => {
  process.stderr.write(`db:init failed: ${error.message}\n`);
  process.exit(1);
});
