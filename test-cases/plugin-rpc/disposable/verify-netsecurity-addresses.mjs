import { readFileSync } from 'node:fs';
import { netSecurityRequest, verifyEffectiveBlocks } from './offline-firewall-addresses.mjs';

if (process.argv[2] === '--request') {
  console.log(JSON.stringify(netSecurityRequest()));
  process.exit(0);
}
const input = JSON.parse(readFileSync(0, 'utf8'));
if (!Array.isArray(input.ipv4) || !Array.isArray(input.ipv6)) {
  throw new Error('Expected separate normalized IPv4 and IPv6 readback');
}
// NetSecurity's explicit unicast range starts at 0.0.0.1, not at the
// unspecified address. Add just that non-destination for the set comparison.
verifyEffectiveBlocks([...input.ipv4, '0.0.0.0'], input.ipv6);
