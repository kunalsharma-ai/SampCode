'use client';
/**
 * Full-page preview in its own tab (client feedback 2026-11): one question (?q=Q3) or the whole
 * survey, with the editor's unsaved changes. It follows the editor live while both tabs are open.
 */
import { use, useEffect, useMemo, useState } from 'react';
import {
  defaultPresentation,
  parsePresentation,
  parseSurveyDefinition,
  type Presentation,
  type SurveyDefinition,
} from '@zapx/survey-schema';
import { api } from '@/lib/api';
import { Preview } from '@/components/Preview';
import { previewKey, readPreviewDraft } from '@/components/PreviewTab';
import { ErrorNote } from '@/components/Shell';

/** A survey with only this question, so it can be tried on its own (its own condition is ignored). */
function questionOnly(def: SurveyDefinition, qid: string): SurveyDefinition | null {
  const q = def.pages.flatMap((p) => p.questions).find((x) => x.id === qid);
  if (!q) return null;
  return {
    ...def,
    welcome: undefined,
    pages: [{ id: 'P1', questions: [{ ...q, condition: undefined }] }],
    terminations: [],
    quotas: [],
    loops: [],
    blocks: [],
    settings: { ...def.settings, showProgress: false },
  };
}

export default function PreviewTabPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [qid, setQid] = useState<string | null>(null);
  const [def, setDef] = useState<SurveyDefinition | null>(null);
  const [pres, setPres] = useState<Presentation>(defaultPresentation());
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setQid(new URLSearchParams(window.location.search).get('q'));
    const local = readPreviewDraft(id);
    api<{ version: { definition: unknown; presentation: unknown } }>(`/surveys/${id}/draft`)
      .then((d) => {
        const p = parsePresentation(d.version.presentation);
        if (p.ok) setPres(p.presentation);
        const parsed = parseSurveyDefinition(local ?? d.version.definition);
        if (parsed.ok) setDef(parsed.definition);
        else setError(new Error('The draft has errors: fix them in the editor to preview it.'));
      })
      .catch(setError);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== previewKey(id)) return;
      const next = readPreviewDraft(id);
      const parsed = next ? parseSurveyDefinition(next) : null;
      if (parsed?.ok) setDef(parsed.definition);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [id]);

  const shown = useMemo(() => (def ? (qid ? questionOnly(def, qid) : def) : null), [def, qid]);

  return (
    <main className="preview-tab">
      <header className="row preview-tab-bar">
        <strong>{qid ? `Question ${qid}` : 'Survey preview'}</strong>
        <span className="muted small">{def?.title}</span>
        <div style={{ flex: 1 }} />
        {qid ? (
          <button type="button" onClick={() => setQid(null)}>
            Whole survey
          </button>
        ) : null}
        <span className="muted small">Follows your unsaved edits. Nothing is recorded.</span>
      </header>
      <ErrorNote error={error} />
      {def && qid && !shown ? <p className="error-text">Question {qid} is no longer in the survey.</p> : null}
      {shown ? <Preview key={`${qid}-${JSON.stringify(shown).length}`} def={shown} presentation={pres} fullPage /> : null}
    </main>
  );
}
