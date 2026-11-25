import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { requestedBlocks, verifyEffectiveBlocks } from './offline-firewall-addresses.mjs';
const fresh = requestedBlocks;
test('the generated CIDRs cover exactly the required complement', () => {
  const { ipv4, ipv6 } = fresh();
  assert.equal(new Set(ipv4).size, 32);
  assert.doesNotThrow(() => verifyEffectiveBlocks(ipv4.reverse(), ipv6.reverse()));
});
test('normalized summaries or ranges from a policy readback are equivalent', () => {
  assert.doesNotThrow(() => verifyEffectiveBlocks(
    ['0.0.0.0-127.0.0.0', '127.0.0.2-255.255.255.255'],
    ['0:0:0:0:0:0:0:0/0']));
});
test('removing any of the network prefixes fails closed', () => {
  const { ipv4, ipv6 } = fresh();
  for (let i = 0; i < ipv4.length; i++) assert.throws(() =>
    verifyEffectiveBlocks(ipv4.filter((_, j) => i !== j), ipv6), /not exact/);
  for (const prefix of ipv6) assert.throws(() =>
    verifyEffectiveBlocks(ipv4, [prefix]), /not exact/);
});
test('blocking the one permitted IPv4 address fails closed', () => {
  const { ipv4, ipv6 } = fresh();
  assert.throws(() => verifyEffectiveBlocks([...ipv4, '127.0.0.1'], ipv6), /not exact/);
});
test('unknown policy keywords, family mismatch, malformed and noncanonical addresses fail closed', () => {
  const { ipv4, ipv6 } = fresh();
  for (const entry of ['Any','LocalSubnet','DNS',' 1.0.0.0/8','::/1','1.1.2.3/8','01.2.0.0',
    '1.0.0.0/33','1.0.0.0/01','2.0.0.0-1.0.0.0','1.0.0.0/1/1']) assert.throws(() =>
      verifyEffectiveBlocks([...ipv4, entry], ipv6));
  for (const entry of ['::%1','::ffff:127.0.0.1','3.2.1.0','::/129','::1/32']) assert.throws(() =>
      verifyEffectiveBlocks(ipv4,[...ipv6, entry]));
});
