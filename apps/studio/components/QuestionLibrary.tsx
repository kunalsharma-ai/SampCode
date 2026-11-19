'use client';
/**
 * Question library (client feedback 2026-11): every question type grouped by category with its
 * description, to pick the type of a new question. Library types are built from the engine's core
 * types (see QUESTION_CATALOG in @zapx/survey-schema).
 */
import { useMemo, useState } from 'react';
import {
  CATALOG_CATEGORIES,
  QUESTION_CATALOG,
  buildCatalogQuestions,
  catalogTypeOf,
  questionSchema,
  type Question,
  type QuestionType,
  type SurveyDefinition,
} from '@zapx/survey-schema';
import { Library, X } from 'lucide-react';
import { InfoTip } from '@/components/neon/InfoTip';
import { catalogHelp, qtypeHelp, type HelpEntry } from '@/lib/help';

/** Core types the library has no entry for, offered under "More types". */
export const MORE_TYPES: Array<{ type: QuestionType; name: string; description: string }> = [
  { type: 'info', name: 'Information text', description: 'Text, a picture or a video shown without a question' },
  { type: 'cardsort', name: 'Card sort', description: 'Sort cards into groups' },
  { type: 'barcode', name: 'Barcode / QR code', description: 'Scan or type a product code' },
  { type: 'photo', name: 'Photo', description: 'Take or choose a photo' },
  { type: 'eyetrack', name: 'Eye tracking (webcam, experimental)', description: 'Estimate where people look at a picture' },
];

/** Picker value: `lib:<catalog key>` or `core:<question type>`. */
export type NewTypeKey = `lib:${string}` | `core:${QuestionType}`;

export function newTypeHelp(key: NewTypeKey): { k?: ReturnType<typeof qtypeHelp>; entry?: HelpEntry } {
  if (key.startsWith('lib:')) {
    const t = catalogTypeOf(key.slice(4));
    if (t) {
      const base = (t.build('Q1')[0]?.type ?? 'single') as string;
      return { entry: catalogHelp(t, base) };
    }
  }
  return { k: qtypeHelp(key.slice(5)) };
}

/** The info box of an existing question: its library type if it has one, else its core type. */
export function questionHelp(q: Pick<Question, 'type' | 'catalogType'>): { k?: ReturnType<typeof qtypeHelp>; entry?: HelpEntry } {
  const t = catalogTypeOf(q.catalogType);
  return t ? { entry: catalogHelp(t, q.type) } : { k: qtypeHelp(q.type) };
}

function usedIds(def: SurveyDefinition): Set<string> {
  return new Set(
    [
      ...def.pages.flatMap((p) => p.questions.map((q) => q.id)),
      ...(def.variables ?? []).map((v) => v.id),
      ...(def.loops ?? []).map((l) => l.id),
    ].map((x) => x.toLowerCase()),
  );
}

/**
 * Build the question(s) of a library type with variable names free in the survey (Q7, or Q7a, Q7b…
 * when the type is several questions shown together). `core` builds one core question via `makeCore`.
 */
export function buildFromLibrary(
  def: SurveyDefinition,
  key: NewTypeKey,
  makeCore: (type: QuestionType, id: string) => Question,
): Question[] {
  const used = usedIds(def);
  for (let i = 1; ; i++) {
    const id = `Q${i}`;
    if (used.has(id.toLowerCase())) continue;
    const built = key.startsWith('lib:') ? buildCatalogQuestions(key.slice(4), id) : [makeCore(key.slice(5) as QuestionType, id)];
    if (built.some((q) => used.has(q.id.toLowerCase()))) continue;
    return built.map((q) => questionSchema.parse(q));
  }
}

/** A select with the library's categories (and the remaining core types) as groups. */
export function TypeSelect({ value, onChange }: { value: NewTypeKey; onChange: (k: NewTypeKey) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as NewTypeKey)} aria-label="New question type">
      {CATALOG_CATEGORIES.map((c) => (
        <optgroup key={c.key} label={c.name}>
          {QUESTION_CATALOG.filter((t) => t.category === c.key).map((t) => (
            <option key={t.key} value={`lib:${t.key}`}>
              {t.no}. {t.name}
            </option>
          ))}
        </optgroup>
      ))}
      <optgroup label="More types">
        {MORE_TYPES.map((t) => (
          <option key={t.type} value={`core:${t.type}`}>
            {t.name}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

/** The whole library as a categorized table; "Add" puts the type's question(s) on the page. */
export function QuestionLibraryButton({ onPick }: { onPick: (k: NewTypeKey) => void }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? QUESTION_CATALOG.filter((t) => `${t.name} ${t.description}`.toLowerCase().includes(f)) : QUESTION_CATALOG;
  }, [filter]);
  return (
    <>
      <button type="button" className="link small" onClick={() => setOpen(true)}>
        <Library size={13} aria-hidden="true" /> Question library
      </button>
      {open ? (
        <div className="nx-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="nx-modal panel stack q-library" role="dialog" aria-modal="true" aria-labelledby="q-library-title">
            <div className="row">
              <h2 id="q-library-title" style={{ margin: 0 }}>
                Question library
              </h2>
              <div style={{ flex: 1 }} />
              <button type="button" className="icon" aria-label="Close" onClick={() => setOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <input
              placeholder="Search question types"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Search question types"
            />
            <div className="q-library-scroll">
              {CATALOG_CATEGORIES.map((c) => {
                const types = shown.filter((t) => t.category === c.key);
                if (!types.length) return null;
                return (
                  <section key={c.key}>
                    <h3>{c.name}</h3>
                    <table className="data">
                      <thead>
                        <tr>
                          <th style={{ width: 48 }}>No.</th>
                          <th>Question type</th>
                          <th>Description</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {types.map((t) => (
                          <tr key={t.key}>
                            <td>{t.no}</td>
                            <td>
                              <strong>{t.name}</strong>
                            </td>
                            <td>
                              {t.description}
                              {t.note ? <div className="muted small">{t.note}</div> : null}
                            </td>
                            <td>
                              <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                                <InfoTip entry={newTypeHelp(`lib:${t.key}`).entry} />
                                <button
                                  type="button"
                                  className="small"
                                  aria-label={`Add ${t.name}`}
                                  onClick={() => {
                                    onPick(`lib:${t.key}`);
                                    setOpen(false);
                                  }}
                                >
                                  Add
                                </button>
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
