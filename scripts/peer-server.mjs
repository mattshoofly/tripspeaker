// Local PeerJS signaling server for tests and offline LAN experiments.
// Production uses PeerJS's public server (or one you configure); Netlify only
// hosts static files.
import { PeerServer } from 'peer';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : process.env[`PEER_${name.toUpperCase()}`] ?? fallback;
};

const port = Number(arg('port', 9417));
const path = arg('path', '/ts');
const host = arg('host', '0.0.0.0');

const server = PeerServer({ port, host, path, allow_discovery: false, expire_timeout: 4000, alive_timeout: 60000 }, () => {
  console.log(`PeerServer listening on ws://${host}:${port}${path}`);
});

server.on('connection', (client) => console.log(`peer connected ${client.getId()}`));
server.on('disconnect', (client) => console.log(`peer disconnected ${client.getId()}`));

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
