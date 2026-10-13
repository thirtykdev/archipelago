// Egress tripwire: nothing in the test suite may open a socket, resolve a name or fetch.
import net from 'node:net';
import dns from 'node:dns';
import tls from 'node:tls';
const deny = (what: string) => { throw new Error(`egress tripwire: ${what} attempted during tests`); };
(net.Socket.prototype as any).connect = function () { deny('net.Socket.connect'); };
(net as any).connect = () => deny('net.connect');
(net as any).createConnection = () => deny('net.createConnection');
(tls as any).connect = () => deny('tls.connect');
(dns as any).lookup = () => deny('dns.lookup');
(dns.promises as any).lookup = async () => deny('dns.promises.lookup');
(globalThis as any).fetch = async () => deny('fetch');
