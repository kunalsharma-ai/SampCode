'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderKanban, FolderPlus } from 'lucide-react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { ErrorNote } from '@/components/Shell';
import { InfoTip } from '@/components/neon/InfoTip';

export const PROJECT_STATUS_TABS = [
  ['ALL', 'All'],
  ['DRAFT', 'Draft'],
  ['UNDER_APPROVAL', 'Under approval'],
  ['APPROVED', 'Approved'],
  ['RUNNING', 'Running'],
  ['PAUSED', 'Paused'],
  ['COMPLETED', 'Completed'],
] as const;
export type ProjectStatus = Exclude<(typeof PROJECT_STATUS_TABS)[number][0], 'ALL'>;
export const projectStatusLabel = (s: string) => PROJECT_STATUS_TABS.find(([k]) => k === s)?.[1] ?? s;

interface Project {
  id: string;
  name: string;
  client: string | null;
  createdAt: string;
  updatedAt?: string;
  status?: ProjectStatus;
  _count: { surveys: number; vendors: number };
}

type Sort = 'newest' | 'oldest' | 'updated' | 'name';

/** Redirect links asked for when a project is created; the rest are set on the project page. */
const NEW_PROJECT_REDIRECTS = [
  ['complete', 'Complete'],
  ['terminate', 'Terminate'],
  ['quota_full', 'Quota full'],
  ['security_reject', 'Security reject'],
] as const;

/**
 * The projects table and the "New project" form. On the dashboard it shows the latest projects with
 * a "View all" link (`limit`); on the Projects page it shows all of them.
 */
export function ProjectsSection({ limit, heading, onCreated }: { limit?: number; heading?: string; onCreated?: () => void }) {
  const me = useMe();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [redirects, setRedirects] = useState<Record<string, string>>({});
  const [showRedirects, setShowRedirects] = useState(false);
  const [tab, setTab] = useState<(typeof PROJECT_STATUS_TABS)[number][0]>('ALL');
  const [sort, setSort] = useState<Sort>('newest');
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(() => api<Project[]>('/projects').then(setProjects).catch(setError), []);
  useEffect(() => {
    void load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const p = await api<{ id: string }>('/projects', { body: { name, client: client || undefined } });
      const urls = Object.fromEntries(Object.entries(redirects).filter(([, v]) => v.trim()));
      if (Object.keys(urls).length)
        await api(`/projects/${p.id}/redirect-defaults`, { method: 'PUT', body: { urls, words: {}, countries: {} } });
      setName('');
      setClient('');
      setRedirects({});
      await load();
      onCreated?.();
    } catch (err) {
      setError(err);
    }
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: projects?.length ?? 0 };
    for (const p of projects ?? []) c[p.status ?? 'DRAFT'] = (c[p.status ?? 'DRAFT'] ?? 0) + 1;
    return c;
  }, [projects]);
  const sorted = useMemo(() => {
    if (!projects) return null;
    const list = tab === 'ALL' ? [...projects] : projects.filter((p) => (p.status ?? 'DRAFT') === tab);
    const time = (d?: string) => (d ? new Date(d).getTime() : 0);
    list.sort((a, b) =>
      sort === 'oldest'
        ? time(a.createdAt) - time(b.createdAt)
        : sort === 'updated'
          ? time(b.updatedAt ?? b.createdAt) - time(a.updatedAt ?? a.createdAt)
          : sort === 'name'
            ? a.name.localeCompare(b.name)
            : time(b.createdAt) - time(a.createdAt),
    );
    return list;
  }, [projects, tab, sort]);
  const shown = sorted && limit ? sorted.slice(0, limit) : sorted;
  const canCreate = me?.role !== 'VIEWER';

  return (
    <div className="nx-projects">
      <section className="panel nx-card">
        <div className="nx-card-head">
          {heading ? (
            <h2>
              <FolderKanban size={17} aria-hidden="true" /> {heading}
            </h2>
          ) : (
            <h2 className="sr-only">Project list</h2>
          )}
          {limit && projects && projects.length > limit ? (
            <Link href="/projects" className="small">
              View all ({projects.length})
            </Link>
          ) : null}
        </div>
        {projects && projects.length > 0 ? (
          <div className="nx-project-filters">
            <div className="tabs nx-tabs nx-status-tabs" role="tablist" aria-label="Project status">
              {PROJECT_STATUS_TABS.map(([k, label]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
                  {label}
                  <span className="nx-tab-count">{counts[k] ?? 0}</span>
                </button>
              ))}
            </div>
            <label className="field nx-sort">
              Sort
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort projects">
                <option value="newest">Newest on top</option>
                <option value="oldest">Oldest on top</option>
                <option value="updated">Recently updated</option>
                <option value="name">Name (A–Z)</option>
              </select>
            </label>
          </div>
        ) : null}
        {projects === null ? (
          <p className="muted">Loading…</p>
        ) : projects.length === 0 ? (
          <p className="muted">No projects yet. Create your first one.</p>
        ) : shown!.length === 0 ? (
          <p className="muted">No {projectStatusLabel(tab).toLowerCase()} projects.</p>
        ) : (
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Client</th>
                  <th>Status</th>
                  <th className="num">Surveys</th>
                  <th className="num">Vendors</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {shown!.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/projects/${p.id}`}>{p.name}</Link>
                    </td>
                    <td>{p.client ?? '—'}</td>
                    <td>
                      <span className={`badge project-${(p.status ?? 'DRAFT').toLowerCase()}`}>
                        {projectStatusLabel(p.status ?? 'DRAFT')}
                      </span>
                    </td>
                    <td className="num">{p._count.surveys}</td>
                    <td className="num">{p._count.vendors}</td>
                    <td className="muted small">{new Date(p.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {canCreate ? (
        <form className="panel stack nx-card" onSubmit={create}>
          <h2>
            <FolderPlus size={17} aria-hidden="true" /> New project
            <InfoTip k="section.newProject" />
          </h2>
          <label className="field">
            Name
            <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cardiologist brand tracker W1" />
          </label>
          <label className="field">
            Client (optional)
            <input value={client} onChange={(e) => setClient(e.target.value)} />
          </label>
          <button type="button" className="link small" aria-expanded={showRedirects} onClick={() => setShowRedirects(!showRedirects)}>
            {showRedirects ? 'Hide default redirect links' : '+ Default redirect links (optional)'}
          </button>
          {showRedirects ? (
            <div className="stack" data-testid="new-project-redirects">
              <span className="muted small">
                Where respondents go at the end, for every vendor that does not set its own. Use [UID] for the respondent id.
              </span>
              {NEW_PROJECT_REDIRECTS.map(([k, label]) => (
                <label key={k} className="field">
                  {label} redirect URL
                  <input
                    type="url"
                    value={redirects[k] ?? ''}
                    placeholder="https://panel.example.com/end?status=complete&uid=[UID]"
                    onChange={(e) => setRedirects({ ...redirects, [k]: e.target.value })}
                  />
                </label>
              ))}
            </div>
          ) : null}
          <ErrorNote error={error} />
          <button className="primary">Create project</button>
        </form>
      ) : (
        <ErrorNote error={error} />
      )}
    </div>
  );
}
