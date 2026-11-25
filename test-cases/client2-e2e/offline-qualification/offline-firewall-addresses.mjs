import { isIP } from 'node:net';

const bits = {4: 32, 6: 128};
const widths = {4: 8, 6: 16};
const max = family => (1n << BigInt(bits[family])) - 1n;

function integer(s, family) {
  if (isIP(s) !== family || s.includes('%') || (family === 6 && s.includes('.')))
    throw new Error('Invalid address or address family');
  let parts;
  if (family === 4) parts = s.split('.').map(Number);
  else if (s.includes('::')) {
    const [left, right] = s.split('::').map(a => a ? a.split(':') : []);
    parts = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
      .map(a => Number.parseInt(a, 16));
  } else parts = s.split(':').map(a => Number.parseInt(a, 16));
  return parts.reduce((acc, part) => (acc << BigInt(widths[family])) | BigInt(part), 0n);
}

function interval(spec, family) {
  if (typeof spec !== 'string' || !spec || spec.trim() !== spec)
    throw new Error('Invalid address specification');
  if (spec.includes('-')) {
    const parts = spec.split('-');
    if (parts.length !== 2) throw new Error('Invalid IP range');
    const [lo, hi] = parts.map(x => integer(x, family));
    if (lo > hi) throw new Error('Reversed IP range');
    return [lo, hi];
  }
  const parts = spec.split('/');
  if (parts.length === 1) {
    const address = integer(parts[0], family);
    return [address, address];
  }
  if (parts.length !== 2) throw new Error('Invalid CIDR prefix');
  const mask = parts[1];
  let prefix;
  if (family === 4 && isIP(mask) === 4) {
    const host = max(4) ^ integer(mask, 4);
    if ((host & (host + 1n)) !== 0n) throw new Error('Noncontiguous IPv4 mask');
    prefix = bits[family] - (host ? host.toString(2).length : 0);
  } else {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(mask)) throw new Error('Invalid CIDR prefix');
    prefix = Number(mask);
  }
  if (prefix > bits[family]) throw new Error('CIDR prefix out of range');
  const lo = integer(parts[0], family);
  const host = (1n << BigInt(bits[family] - prefix)) - 1n;
  if ((lo & host) !== 0n) throw new Error('CIDR has host bits set');
  return [lo, lo | host];
}

export function requestedBlocks() {
  const allow = integer('127.0.0.1', 4);
  const ipv4 = Array.from({ length: 32 }, (_, i) => {
    const power = BigInt(31 - i);
    const address = (((allow >> power) ^ 1n) << power);
    const octets = [24n, 16n, 8n, 0n].map(shift => Number((address >> shift) & 255n));
    return octets.join('.') + '/' + (i + 1);
  });
  return {ipv4, ipv6: ['::/1', '8000::/1']};
}

export function verifyEffectiveBlocks(ipv4, ipv6) {
  const allow = integer('127.0.0.1', 4);
  const expected = {4: [[0n, allow - 1n], [allow + 1n, max(4)]], 6: [[0n, max(6)]]};
  for (const [family, list] of [[4, ipv4], [6, ipv6]]) {
    if (!Array.isArray(list) || list.length === 0 || list.length > 512)
      throw new Error('Missing or oversized effective block set');
    const ranges = list.map(x => interval(x, family)).sort((a,b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    const union = [];
    for (const [lo, hi] of ranges) {
      const last = union.at(-1);
      if (!last || lo > last[1] + 1n) union.push([lo, hi]);
      else if (hi > last[1]) last[1] = hi;
    }
    if (union.length !== expected[family].length ||
        union.some(([lo, hi], i) => lo !== expected[family][i][0] || hi !== expected[family][i][1]))
      throw new Error('Effective block coverage is not exact IPv' + family);
  }
}
