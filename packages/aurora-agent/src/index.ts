import './load-env';
import { startServer } from './server';

const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
let port = 4096;

if (portIdx !== -1 && args[portIdx + 1]) {
  const parsedPort = parseInt(args[portIdx + 1], 10);
  if (!isNaN(parsedPort)) {
    port = parsedPort;
  }
}

console.log(`Starting Aura agent on port ${port}...`);
startServer(port);
