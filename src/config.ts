// Application config from environment variables, validated once at startup.
// A missing variable is an error, never a silent default (CLAUDE.md, "No silent fallback values").

export class MissingEnvironmentVariableError extends Error {
  constructor(readonly variableName: string) {
    super(`Environment variable ${variableName} is not set (see .env.example)`);
    this.name = 'MissingEnvironmentVariableError';
  }
}

export interface AppConfig {
  readonly port: number;
  readonly logLevel: string;
}

function readRequired(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === '') throw new MissingEnvironmentVariableError(name);

  return value;
}

function readPort(env: NodeJS.ProcessEnv): number {
  const raw = readRequired(env, 'PORT');
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`PORT must be an integer from 1 to 65535, got "${raw}"`);

  return port;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return { port: readPort(env), logLevel: readRequired(env, 'LOG_LEVEL') };
}
