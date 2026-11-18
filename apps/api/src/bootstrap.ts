import { Logger } from './http/logger';
import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { config } from './config';
import { integration } from './platform/integrations';

type EdgeRequest = { headers: Record<string, string | string[] | undefined>; ip?: string };

/** "198.51.100.7:443" or "2001:db8::1:443" (CloudFront-Viewer-Address) to the address alone. */
export function addressOnly(v: string): string | null {
  const a = v.trim().replace(/^\[(.*)\](:\d+)?$/, '$1');
  if (isIP(a)) return a;
  const cut = a.lastIndexOf(':');
  const b = cut > 0 ? a.slice(0, cut) : a;
  return isIP(b) ? b : null;
}

/**
 * Edge trust (Milestone 13). Requests from the CDN carry the shared secret; for them the viewer's
 * address and country come from the CDN's headers. On any other request those headers are dropped,
 * so a respondent who reaches the API directly cannot choose their own address or country.
 */
export function edgeTrust(req: EdgeRequest) {
  const c = config();
  // The secret and the address header are set in Settings > Integrations > CDN (ADR 0043).
  const edge = integration('cdn');
  if (!edge.enabled) return;
  const sent = req.headers['x-zapx-edge'];
  delete req.headers['x-zapx-edge'];
  const a = Buffer.from(typeof sent === 'string' ? sent : '');
  const b = Buffer.from(edge.values.sharedSecret!);
  const fromEdge = a.length === b.length && timingSafeEqual(a, b);
  const addressHeader = (edge.values.clientAddressHeader ?? '').toLowerCase();
  if (!fromEdge) {
    if (addressHeader) delete req.headers[addressHeader];
    if (c.GEO_COUNTRY_HEADER) delete req.headers[c.GEO_COUNTRY_HEADER];
    return;
  }
  const viewer = addressHeader ? req.headers[addressHeader] : undefined;
  const ip = typeof viewer === 'string' ? addressOnly(viewer) : null;
  if (ip) Object.defineProperty(req, 'ip', { value: ip, configurable: true });
}

/**
 * Headers on every API response (Milestone 20). The API answers JSON, files and a few XML documents,
 * never pages, so the content security policy allows nothing: if a response is ever opened as a page
 * (for example an uploaded file), no script runs and it cannot be framed. Routes that serve media
 * to other origins override Cross-Origin-Resource-Policy themselves.
 */
export function securityHeaders(https: boolean): Array<[string, string]> {
  const h: Array<[string, string]> = [
    ['X-Content-Type-Options', 'nosniff'],
    ['Referrer-Policy', 'no-referrer'],
    ['Cache-Control', 'no-store'],
    ['Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"],
    ['X-Frame-Options', 'DENY'],
    ['Cross-Origin-Opener-Policy', 'same-origin'],
    ['Cross-Origin-Resource-Policy', 'same-origin'],
    ['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'],
    ['X-Permitted-Cross-Domain-Policies', 'none'],
  ];
  if (https) h.push(['Strict-Transport-Security', 'max-age=31536000; includeSubDomains']);
  return h;
}

export const logger = new Logger('SampCode');
