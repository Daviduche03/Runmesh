/**
 * Outbound URL validation (SSRF protection) for user-supplied fetch targets.
 * Hostnames are not DNS-resolved, so a public name that resolves to a private IP is not
 * caught here — same limitation as the Python implementation this replaces.
 */
import { isIP } from "node:net";
import { createError } from "./http/errors.js";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata",
  "metadata.google.internal",
]);

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".corp"];

type Range = [string, number];

const BLOCKED_IPV4: Range[] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

const BLOCKED_IPV6: Range[] = [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["100::", 64],
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2001:10::", 28],
  ["2001:20::", 28],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
];

function parseIpv4(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

const ipv4ToInt = (o: number[]): number =>
  (((o[0] << 24) >>> 0) + (o[1] << 16) + (o[2] << 8) + o[3]) >>> 0;

function isBlockedIpv4(value: string): boolean {
  const octets = parseIpv4(value);
  if (!octets) return false;
  const address = ipv4ToInt(octets);
  return BLOCKED_IPV4.some(([base, prefix]) => {
    const baseOctets = parseIpv4(base);
    if (!baseOctets) return false;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (address & mask) === (ipv4ToInt(baseOctets) & mask);
  });
}

function expandIpv6(value: string): number[] | null {
  const text = value.toLowerCase();
  if (text.includes(":::")) return null;
  const [head, tail] = text.split("::");
  const headGroups = head ? head.split(":").filter(Boolean) : [];
  const tailGroups = tail !== undefined ? tail.split(":").filter(Boolean) : [];

  const embedded = tailGroups[tailGroups.length - 1];
  if (embedded?.includes(".")) {
    const octets = parseIpv4(embedded);
    if (!octets) return null;
    tailGroups.splice(
      tailGroups.length - 1,
      1,
      ((octets[0] << 8) | octets[1]).toString(16),
      ((octets[2] << 8) | octets[3]).toString(16),
    );
  }

  let groups: string[];
  if (tail === undefined) {
    groups = headGroups;
    if (groups.length !== 8) return null;
  } else {
    const missing = 8 - headGroups.length - tailGroups.length;
    if (missing < 1) return null;
    groups = [...headGroups, ...Array<string>(missing).fill("0"), ...tailGroups];
  }

  const words: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    words.push(parseInt(group, 16));
  }
  return words.length === 8 ? words : null;
}

function isBlockedIpv6(value: string): boolean {
  const words = expandIpv6(value);
  if (!words) return false;
  return BLOCKED_IPV6.some(([base, prefix]) => {
    const baseWords = expandIpv6(base);
    if (!baseWords) return false;
    let remaining = prefix;
    for (let i = 0; i < 8 && remaining > 0; i++) {
      const bits = Math.min(16, remaining);
      const mask = bits === 16 ? 0xffff : (0xffff << (16 - bits)) & 0xffff;
      if ((words[i] & mask) !== (baseWords[i] & mask)) return false;
      remaining -= bits;
    }
    return true;
  });
}

function isBlockedIp(host: string): boolean {
  const family = isIP(host);
  if (family === 4) return isBlockedIpv4(host);
  if (family === 6) return isBlockedIpv6(host);
  return false;
}

export function validateOutboundUrl(url: string | null | undefined, fieldName = "url"): string {
  const value = (url ?? "").trim();
  if (!value) throw createError(400, `${fieldName} is required`);

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw createError(400, `${fieldName} is invalid`);
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw createError(400, `${fieldName} must use http or https`);
  }
  if (!parsed.hostname) throw createError(400, `${fieldName} is invalid`);
  if (parsed.username || parsed.password) {
    throw createError(400, `${fieldName} must not contain credentials`);
  }

  let host = parsed.hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  host = host.replace(/\.$/, "");

  if (isBlockedIp(host)) {
    throw createError(400, `${fieldName} must not target a private or reserved address`);
  }
  if (BLOCKED_HOSTNAMES.has(host) || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw createError(400, `${fieldName} must not target a local or internal hostname`);
  }
  return value;
}

export function isOutboundUrlAllowed(url: string | null | undefined): boolean {
  try {
    validateOutboundUrl(url);
    return true;
  } catch {
    return false;
  }
}
