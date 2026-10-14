import { describe, expect, it } from 'vitest';

import { loadConfig, MissingEnvironmentVariableError } from '../src/config.js';

describe('loadConfig', () => {
  it('reads every variable from the environment', () => {
    expect(loadConfig({ PORT: '3000', LOG_LEVEL: 'info' })).toEqual({ port: 3000, logLevel: 'info' });
  });

  it('fails on a missing variable instead of using a default', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'info' })).toThrow(MissingEnvironmentVariableError);
    expect(() => loadConfig({ PORT: '3000', LOG_LEVEL: ' ' })).toThrow(/LOG_LEVEL/);
  });

  it('rejects a port that is not a valid TCP port', () => {
    expect(() => loadConfig({ PORT: '70000', LOG_LEVEL: 'info' })).toThrow(/PORT/);
    expect(() => loadConfig({ PORT: 'abc', LOG_LEVEL: 'info' })).toThrow(/PORT/);
  });
});
