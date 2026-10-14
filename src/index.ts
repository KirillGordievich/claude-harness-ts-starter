import { loadConfig } from './config.js';

const config = loadConfig();
process.stdout.write(`Started on port ${config.port}\n`);
