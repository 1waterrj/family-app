const originSyntax =
  /^(https?):\/\/(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::([0-9]+))?\/?$/i;

export function normalizeLocalDevelopmentOrigin(value: string): string | null {
  const syntax = originSyntax.exec(value);
  if (!syntax) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    !isLocalHostname(url.hostname, syntax[2]!.toLowerCase())
  ) {
    return null;
  }

  return url.origin;
}

function isLocalHostname(hostname: string, rawHost: string): boolean {
  const normalized = hostname.toLowerCase();

  if (normalized === 'localhost') return rawHost === normalized;
  if (isCanonicalIpv4(normalized)) {
    return rawHost === normalized && isLocalIpv4(normalized);
  }
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    return rawHost.startsWith('[') && isLocalIpv6(normalized.slice(1, -1));
  }

  return rawHost === normalized && isLocalDnsHostname(normalized);
}

function isCanonicalIpv4(hostname: string): boolean {
  const octets = hostname.split('.');
  return (
    octets.length === 4 &&
    octets.every(
      (octet) => /^(?:0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255,
    )
  );
}

function isLocalIpv4(hostname: string): boolean {
  const [first, second] = hostname.split('.').map(Number);
  return (
    first === 127 ||
    first === 10 ||
    (first === 172 && second! >= 16 && second! <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}

function isLocalIpv6(hostname: string): boolean {
  if (hostname === '::1') return true;

  const firstHextet = Number.parseInt(hostname.split(':', 1)[0]!, 16);
  return (firstHextet & 0xfe00) === 0xfc00 || (firstHextet & 0xffc0) === 0xfe80;
}

function isLocalDnsHostname(hostname: string): boolean {
  if (hostname.length > 253 || !hostname.endsWith('.local')) return false;

  const labels = hostname.split('.');
  return (
    labels.length >= 2 &&
    labels.every(
      (label) =>
        label.length >= 1 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  );
}
