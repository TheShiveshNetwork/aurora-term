import './load-env';
import { startServer } from './server';
import { configureLogger, rootLogger } from './logger';

const logLevel = (process.env.LOG_LEVEL || 'debug') as any;
const logPretty = process.env.LOG_PRETTY === '1' || process.env.LOG_PRETTY === 'true';
const logFilePath = process.env.LOG_FILE_PATH || undefined;
configureLogger({ level: logLevel, pretty: logPretty, logFilePath });

const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
let port = 4096;

if (portIdx !== -1 && args[portIdx + 1]) {
  const parsedPort = parseInt(args[portIdx + 1], 10);
  if (!isNaN(parsedPort)) {
    port = parsedPort;
  }
}

rootLogger.info('Starting Aura agent', { port, logLevel, logFilePath, nodeVersion: process.version, platform: process.platform });
startServer(port);
