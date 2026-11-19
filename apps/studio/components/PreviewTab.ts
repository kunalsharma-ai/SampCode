/**
 * Full-page question preview in its own browser tab (client feedback 2026-11). The editor keeps the
 * unsaved draft in this browser's storage, and the preview tab (/surveys/:id/preview) follows it as
 * it changes. Nothing leaves the browser.
 */
import type { SurveyDefinition } from '@zapx/survey-schema';

export const previewKey = (surveyId: string) => `sampcode-preview:${surveyId}`;

export function syncPreviewTab(surveyId: string, def: SurveyDefinition) {
  try {
    localStorage.setItem(previewKey(surveyId), JSON.stringify({ def, at: Date.now() }));
  } catch {
    // Storage full or blocked: the preview tab falls back to the saved draft.
  }
}

export function openPreviewTab(surveyId: string, def: SurveyDefinition, questionId?: string) {
  syncPreviewTab(surveyId, def);
  const url = `/surveys/${encodeURIComponent(surveyId)}/preview${questionId ? `?q=${encodeURIComponent(questionId)}` : ''}`;
  window.open(url, '_blank', 'noopener');
}

export function readPreviewDraft(surveyId: string): SurveyDefinition | null {
  try {
    const raw = localStorage.getItem(previewKey(surveyId));
    return raw ? ((JSON.parse(raw) as { def: SurveyDefinition }).def ?? null) : null;
  } catch {
    return null;
  }
}
