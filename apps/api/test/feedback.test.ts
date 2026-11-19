/**
 * Client feedback 2026-11: project status tabs, per-project redirect links, the survey link check,
 * generated passwords and the AI setup message.
 */
import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.ALLOW_SIGNUP = 'true';
  process.env.CALLBACK_WORKER = 'off';
  process.env.JOB_WORKER = 'off';
  process.env.PLATFORM_AUTOMATION = 'off';
  process.env.SIGNUP_RATE_PER_MINUTE = '100';
  delete process.env.ANTHROPIC_API_KEY;
});

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type ApiApp } from '../src/http/app';
import { projectStatus } from '../src/projects/projects.controller';
import { linkCheckHint } from '../src/health.controller';
import { generatePassword } from '../src/super-admin/super-admin.service';

const run = `fb${Date.now().toString(36)}`;
let app: ApiApp;
let http: ReturnType<typeof request>;
let auth: Record<string, string>;

beforeAll(async () => {
  app = createApp();
  await app.init();
  http = request(app.getHttpServer());
  const reg = await http
    .post('/api/auth/register')
    .send({ organization: `Org ${run}`, name: 'Admin', email: `a-${run}@test.zapx`, password: 'correct-horse-battery' })
    .expect(201);
  auth = { Authorization: `Bearer ${reg.body.token}` };
});

afterAll(async () => {
  await app?.close();
});

describe('project status', () => {
  it('follows field work, and the team sets draft, under approval and approved', () => {
    expect(projectStatus(null, [])).toBe('DRAFT');
    expect(projectStatus('APPROVED', [{ status: 'DRAFT' }])).toBe('APPROVED');
    expect(projectStatus('APPROVED', [{ status: 'LIVE' }, { status: 'DRAFT' }])).toBe('RUNNING');
    expect(projectStatus(null, [{ status: 'PAUSED' }])).toBe('PAUSED');
    expect(projectStatus(null, [{ status: 'CLOSED' }, { status: 'CLOSED' }])).toBe('COMPLETED');
    expect(projectStatus('COMPLETED', [{ status: 'LIVE' }])).toBe('COMPLETED');
  });

  it('is listed with each project and can be set', async () => {
    const p = (
      await http
        .post('/api/projects')
        .set(auth)
        .send({ name: `P ${run}` })
        .expect(201)
    ).body;
    let list = (await http.get('/api/projects').set(auth).expect(200)).body as Array<{ id: string; status: string; updatedAt: string }>;
    expect(list.find((x) => x.id === p.id)).toMatchObject({ status: 'DRAFT', updatedAt: expect.any(String) });
    const after = (await http.put(`/api/projects/${p.id}/status`).set(auth).send({ status: 'UNDER_APPROVAL' }).expect(200)).body;
    expect(after).toMatchObject({ status: 'UNDER_APPROVAL', statusSet: 'UNDER_APPROVAL' });
    list = (await http.get('/api/projects').set(auth).expect(200)).body;
    expect(list.find((x) => x.id === p.id)?.status).toBe('UNDER_APPROVAL');
    await http.put(`/api/projects/${p.id}/status`).set(auth).send({ status: 'NOPE' }).expect(400);
    await http.put(`/api/projects/${p.id}/status`).set(auth).send({ status: null }).expect(200);
  });

  it('every project keeps its own default redirect links', async () => {
    const p = (
      await http
        .post('/api/projects')
        .set(auth)
        .send({ name: `R ${run}` })
        .expect(201)
    ).body;
    const urls = { complete: 'https://panel.example.com/c?uid=[UID]', terminate: 'https://panel.example.com/t?uid=[UID]' };
    await http.put(`/api/projects/${p.id}/redirect-defaults`).set(auth).send({ urls, words: {}, countries: {} }).expect(200);
    expect((await http.get(`/api/projects/${p.id}/redirect-defaults`).set(auth).expect(200)).body.urls).toEqual(urls);
  });
});

describe('survey link check', () => {
  it('explains what to fix', async () => {
    expect(linkCheckHint('survey-zapx.sampledge.com', 'fetch failed ERR_SSL_TLSV1_UNRECOGNIZED_NAME')).toMatch(
      /RUNTIME_DOMAIN=survey-zapx\.sampledge\.com/,
    );
    expect(linkCheckHint('s.example.com', 'getaddrinfo ENOTFOUND s.example.com')).toMatch(/DNS record/);
    const r = (await http.get('/api/health/survey-links').set(auth).expect(200)).body;
    expect(r).toHaveProperty('ok');
    expect(r.url).toMatch(/^https?:\/\//);
  });
});

describe('generated passwords and AI setup', () => {
  it('makes strong, readable passwords', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const p = generatePassword();
      expect(p).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
      expect(p).not.toMatch(/[0O1lI]/);
      seen.add(p);
    }
    expect(seen.size).toBe(50);
  });

  it('says exactly what AI is missing and where to add it', async () => {
    const s = (await http.get('/api/ai/status').set(auth).expect(200)).body;
    expect(s.configured).toBe(false);
    expect(s.setup).toMatch(/API key has not been added yet: a super admin adds it in Super admin > Integrations/);
  });
});
