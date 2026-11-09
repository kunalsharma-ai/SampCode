/**
 * Builds DATABASE_URL (a MongoDB connection string) from its parts when it is not set. On AWS the
 * database user and password live in Secrets Manager and reach the task as DB_USER and DB_PASSWORD, so
 * no one has to copy them into a connection string. Imported first by every entry point (API, worker, CLI).
 *
 *   DB_HOST       cluster host, e.g. sampcode.abcde.mongodb.net (Atlas) or mongo-0.internal
 *   DB_SCHEME     mongodb+srv (default when DB_PORT is not set, as Atlas uses) or mongodb
 *   DB_PORT       port for mongodb:// (default 27017)
 *   DB_NAME       database name (default zapx)
 *   DB_OPTIONS    extra query string, e.g. replicaSet=rs0&tls=true (Atlas needs none)
 */
export function databaseUrlFromParts(env: NodeJS.ProcessEnv): string | undefined {
  if (env.DATABASE_URL || !env.DB_HOST || !env.DB_USER || !env.DB_PASSWORD) return env.DATABASE_URL;
  const scheme = env.DB_SCHEME ?? (env.DB_PORT ? 'mongodb' : 'mongodb+srv');
  const host = scheme === 'mongodb' ? `${env.DB_HOST}:${env.DB_PORT ?? '27017'}` : env.DB_HOST;
  const auth = `${encodeURIComponent(env.DB_USER)}:${encodeURIComponent(env.DB_PASSWORD)}`;
  const params = new URLSearchParams(env.DB_OPTIONS ?? '');
  if (!params.has('retryWrites')) params.set('retryWrites', 'true');
  if (!params.has('w')) params.set('w', 'majority');
  return `${scheme}://${auth}@${host}/${encodeURIComponent(env.DB_NAME ?? 'zapx')}?${params.toString()}`;
}

const built = databaseUrlFromParts(process.env);
if (built) process.env.DATABASE_URL = built;
