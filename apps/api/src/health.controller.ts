import type { Router } from 'express';
import type { RouteKit } from './http/routes';
import { type PrismaService } from './common/prisma.service';
import { config } from './config';

export interface LinkCheck {
  ok: boolean;
  url: string;
  status?: number;
  error?: string;
  /** What to change, in plain words, when the survey address does not work. */
  hint?: string;
}

/** Turn a network error into what an operator has to fix (client feedback 2026-11: survey links did not open). */
export function linkCheckHint(host: string, message: string): string {
  const m = message.toLowerCase();
  if (m.includes('unrecognized_name') || m.includes('unrecognized name') || m.includes('alert number 112'))
    return `The server answering for ${host} has no HTTPS certificate for that name. Set RUNTIME_DOMAIN=${host} in .env.production, point the DNS record of ${host} to this server and restart the stack (docker compose -f docker-compose.prod.yml up -d) so Caddy gets the certificate.`;
  if (m.includes('enotfound') || m.includes('eai_again') || m.includes('getaddrinfo'))
    return `${host} has no DNS record. Add an A (or AAAA) record for ${host} pointing to this server.`;
  if (m.includes('certificate') || m.includes('cert_') || m.includes('self signed') || m.includes('self-signed'))
    return `The HTTPS certificate for ${host} is not valid. Check that RUNTIME_DOMAIN=${host} and that ports 80 and 443 reach Caddy so it can get one.`;
  if (m.includes('econnrefused')) return `Nothing answers on ${host}. Check that the stack is running and ports 80 and 443 are open.`;
  if (m.includes('timeout') || m.includes('aborted') || m.includes('etimedout'))
    return `${host} did not answer in time. Check the firewall and that the DNS record points to this server.`;
  return `Respondents cannot open ${host}: ${message}`;
}

export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  async health() {
    await this.prisma.ping();
    return { ok: true };
  }

  /** Does the respondent address (RUNTIME_BASE_URL) answer from here? Only the configured address is ever fetched. */
  async runtimeCheck(): Promise<LinkCheck> {
    const url = config().RUNTIME_BASE_URL.replace(/\/$/, '');
    const host = (() => {
      try {
        return new URL(url).host;
      } catch {
        return url;
      }
    })();
    try {
      const res = await fetch(`${url}/`, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(8000) });
      return res.status < 500
        ? { ok: true, url, status: res.status }
        : { ok: false, url, status: res.status, hint: `${host} answers with an error (${res.status}). Check the runtime container.` };
    } catch (e) {
      const err = e as Error & { cause?: { code?: string; message?: string } };
      const message = [err.message, err.cause?.code, err.cause?.message].filter(Boolean).join(' ');
      return { ok: false, url, error: message, hint: linkCheckHint(host, message) };
    }
  }
}

/** Express routes of HealthController (mounted by src/http/app.ts). */
export function healthControllerRoutes(r: Router, c: HealthController, kit: RouteKit) {
  r.get('/api/health', ...kit.route({ controller: 'HealthController', handler: 'health', method: 'get', public: true }, () => c.health()));
  r.get(
    '/api/health/survey-links',
    ...kit.route({ controller: 'HealthController', handler: 'runtimeCheck', method: 'get', roles: ['ADMIN', 'PROGRAMMER'] }, () =>
      c.runtimeCheck(),
    ),
  );
}
