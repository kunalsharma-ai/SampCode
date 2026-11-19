'use client';
/**
 * Structured survey editor. It edits the canonical survey definition directly; the JSON view and
 * this editor are two views of the same object.
 */
import { ConjointForm, MaxDiffForm } from './ChoiceForms';
import { useEffect, useState } from 'react';
import type { Option, Page, Question, QuestionType, SurveyDefinition } from '@zapx/survey-schema';
import { MediaLibraryProvider, OptionImagePicker, QuestionMediaEditor, useHasMediaLibrary } from './MediaLibrary';
import {
  BlocksEditor,
  CardSortForm,
  CleaningEditor,
  DynamicListEditor,
  HotspotForm,
  EyeTrackForm,
  LoopsEditor,
  QuotaTableBuilder,
  RecodesEditor,
  UrlVariablesEditor,
  VariablesEditor,
} from './FlowEditor';
import { InsertBlockFromBank, InsertFromBank, SavePageToBank, SaveQuestionToBank } from './QuestionBank';
import { InfoTip } from '@/components/neon/InfoTip';
import { buildFromLibrary, newTypeHelp, questionHelp, QuestionLibraryButton, TypeSelect, type NewTypeKey } from './QuestionLibrary';
import { catalogTypeOf } from '@zapx/survey-schema';
import { sanitizeQuestionHtml, textToHtml } from '@zapx/survey-renderer';
import { openPreviewTab, syncPreviewTab } from './PreviewTab';

type Selection = { kind: 'survey' } | { kind: 'page'; page: number } | { kind: 'question'; page: number; q: number };

const TYPE_LABELS: Record<QuestionType, string> = {
  single: 'Single choice',
  multi: 'Multiple choice',
  open: 'Open text',
  numeric: 'Numeric',
  grid: 'Grid',
  scale: 'Rating scale / NPS',
  ranking: 'Ranking',
  sum: 'Constant sum',
  cardsort: 'Card sort',
  hotspot: 'Image hot-spot',
  photo: 'Photo',
  signature: 'Signature',
  barcode: 'Barcode / QR code',
  maxdiff: 'MaxDiff (best-worst)',
  conjoint: 'Conjoint (choice-based)',
  eyetrack: 'Eye tracking (webcam, experimental)',
  info: 'Information',
};

function newQuestion(id: string, type: QuestionType): Question {
  const base = { id, text: 'New question', required: true, validations: [] };
  const opts: Option[] = [
    { code: 1, label: 'Option 1' },
    { code: 2, label: 'Option 2' },
  ];
  switch (type) {
    case 'single':
      return { ...base, type, options: opts, randomize: false };
    case 'multi':
      return { ...base, type, options: opts, randomize: false };
    case 'open':
      return { ...base, type, multiline: false, maxLength: 2000 };
    case 'numeric':
      return { ...base, type, integer: true, display: 'input' };
    case 'scale':
      return { ...base, type, min: 0, max: 10, nps: false, minLabel: 'Not at all likely', maxLabel: 'Extremely likely' };
    case 'ranking':
      return { ...base, type, options: [...opts, { code: 3, label: 'Option 3' }], randomize: true };
    case 'sum':
      return {
        ...base,
        type,
        options: [...opts, { code: 3, label: 'Option 3' }],
        randomize: false,
        total: 100,
        integer: true,
        unit: 'points',
      };
    case 'photo':
      return { ...base, type, text: 'Please take a photo' };
    case 'signature':
      return { ...base, type, text: 'Please sign to confirm' };
    case 'barcode':
      return { ...base, type, text: 'Scan the barcode on the pack', maxLength: 200 };
    case 'maxdiff':
      return {
        ...base,
        type,
        text: 'Which of these matters MOST and which LEAST to you?',
        options: Array.from({ length: 8 }, (_, i) => ({ code: i + 1, label: `Item ${i + 1}` })),
        itemsPerSet: 4,
        sets: 6,
        versions: 10,
        bestLabel: 'Most important',
        worstLabel: 'Least important',
      };
    case 'conjoint':
      return {
        ...base,
        type,
        text: 'If these were your only options, which would you choose?',
        attributes: [
          {
            id: 'price',
            label: 'Price',
            levels: [
              { code: 1, label: 'Low' },
              { code: 2, label: 'Medium' },
              { code: 3, label: 'High' },
            ],
          },
          {
            id: 'brand',
            label: 'Brand',
            levels: [
              { code: 1, label: 'Brand A' },
              { code: 2, label: 'Brand B' },
              { code: 3, label: 'Brand C' },
            ],
          },
        ],
        tasks: 8,
        conceptsPerTask: 3,
        versions: 10,
        noneOption: true,
        noneLabel: 'None of these',
      };
    case 'cardsort':
      return {
        ...base,
        type,
        text: 'Sort these cards into groups',
        options: [...opts.map((o, i) => ({ ...o, label: `Card ${i + 1}` })), { code: 3, label: 'Card 3' }],
        groups: [
          { code: 1, label: 'Group A' },
          { code: 2, label: 'Group B' },
        ],
        randomize: true,
        allowUnsorted: false,
      };
    case 'hotspot':
      return {
        ...base,
        type,
        text: 'Click the parts of the picture that catch your eye',
        imageAlt: '',
        regions: [{ code: 1, label: 'Area 1', x: 10, y: 10, w: 30, h: 20 }],
      };
    case 'eyetrack':
      return {
        ...base,
        type,
        text: 'Please look at the picture as you normally would',
        imageAlt: '',
        aois: [],
        durationSec: 8,
        maxErrorPct: 15,
        consentText:
          'This question uses your camera to estimate where you look at a picture. The video never leaves your device and is not recorded: only the estimated points on the picture are saved. You can skip it.',
      };
    case 'grid':
      return { ...base, type, rows: [{ id: 'r1', label: 'Item 1' }], columns: opts, randomizeRows: false };
    case 'info':
      return { id, type, text: 'Information text' };
  }
}

function move<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const copy = [...arr];
  const [x] = copy.splice(from, 1);
  copy.splice(to, 0, x!);
  return copy;
}

export function VisualEditor({
  def,
  onChange,
  readOnly,
  surveyId,
}: {
  def: SurveyDefinition;
  onChange: (d: SurveyDefinition) => void;
  readOnly?: boolean;
  /** Enables media uploads and pickers. */
  surveyId?: string;
}) {
  useEffect(() => {
    if (!surveyId) return;
    const t = setTimeout(() => syncPreviewTab(surveyId, def), 250);
    return () => clearTimeout(t);
  }, [surveyId, def]);
  const editor = <Editor def={def} onChange={onChange} readOnly={readOnly} surveyId={surveyId} />;
  return surveyId ? (
    <MediaLibraryProvider surveyId={surveyId} readOnly={!!readOnly}>
      {editor}
    </MediaLibraryProvider>
  ) : (
    editor
  );
}

function Editor({
  def,
  onChange,
  readOnly,
  surveyId,
}: {
  def: SurveyDefinition;
  onChange: (d: SurveyDefinition) => void;
  readOnly?: boolean;
  surveyId?: string;
}) {
  const [sel, setSel] = useState<Selection>({ kind: 'survey' });
  const [newType, setNewType] = useState<NewTypeKey>('lib:single');
  const build = (key: NewTypeKey = newType) => buildFromLibrary(def, key, (t, id) => newQuestion(id, t));

  const setPages = (pages: Page[]) => onChange({ ...def, pages });
  const setPage = (pi: number, page: Page) => setPages(def.pages.map((p, i) => (i === pi ? page : p)));
  const setQuestion = (pi: number, qi: number, q: Question) =>
    setPage(pi, { ...def.pages[pi]!, questions: def.pages[pi]!.questions.map((x, i) => (i === qi ? q : x)) });

  const addPage = () => {
    const ids = new Set(def.pages.map((p) => p.id));
    let n = def.pages.length + 1;
    while (ids.has(`P${n}`)) n++;
    setPages([...def.pages, { id: `P${n}`, questions: build() }]);
    setSel({ kind: 'question', page: def.pages.length, q: 0 });
  };
  const addQuestion = (pi: number, key: NewTypeKey = newType) => {
    const page = def.pages[pi]!;
    setPage(pi, { ...page, questions: [...page.questions, ...build(key)] });
    setSel({ kind: 'question', page: pi, q: page.questions.length });
  };
  /** The page a new question goes on: the selected one, else the last. */
  const currentPage = sel.kind === 'survey' ? def.pages.length - 1 : sel.page;

  const selected = sel.kind === 'question' ? def.pages[sel.page]?.questions[sel.q] : sel.kind === 'page' ? def.pages[sel.page] : undefined;

  // Drag and drop in the outline: pages reorder; questions move within or across pages.
  const [drag, setDrag] = useState<{ page: number; q?: number } | null>(null);
  const [dropAt, setDropAt] = useState<string | null>(null);
  const dropQuestion = (toPage: number, toIndex: number) => {
    if (!drag || drag.q === undefined) return;
    const q = def.pages[drag.page]!.questions[drag.q]!;
    if (drag.page === toPage && def.pages[drag.page]!.questions.length === 1) return;
    let pages = def.pages.map((p, i) => (i === drag.page ? { ...p, questions: p.questions.filter((_, j) => j !== drag.q) } : p));
    const target = drag.page === toPage && drag.q < toIndex ? toIndex - 1 : toIndex;
    pages = pages.map((p, i) =>
      i === toPage ? { ...p, questions: [...p.questions.slice(0, target), q, ...p.questions.slice(target)] } : p,
    );
    // A page left empty by the move is removed.
    const emptied = pages.findIndex((p) => p.questions.length === 0);
    if (emptied >= 0) pages = pages.filter((_, i) => i !== emptied);
    setPages(pages);
    const newPage = emptied >= 0 && emptied < toPage ? toPage - 1 : toPage;
    setSel({ kind: 'question', page: newPage, q: target });
  };
  const dndProps = (key: string, start: { page: number; q?: number }, onDrop: () => void) =>
    readOnly
      ? {}
      : {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', key);
            setDrag(start);
          },
          onDragEnd: () => {
            setDrag(null);
            setDropAt(null);
          },
          onDragOver: (e: React.DragEvent) => {
            if (!drag) return;
            e.preventDefault();
            setDropAt(key);
          },
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            onDrop();
            setDrag(null);
            setDropAt(null);
          },
        };

  return (
    <div className="editor" style={{ gridTemplateColumns: '260px minmax(0,1fr)' }}>
      <nav className="panel outline" aria-label="Survey outline">
        <button className={`item ${sel.kind === 'survey' ? 'selected' : ''}`} onClick={() => setSel({ kind: 'survey' })}>
          Survey settings, quotas, loops, variables
        </button>
        {!readOnly ? <p className="muted small outline-hint">Drag pages and questions to reorder them.</p> : null}
        {def.pages.map((p, pi) => (
          <div key={pi}>
            <button
              className={`item page ${sel.kind === 'page' && sel.page === pi ? 'selected' : ''}${dropAt === `p${pi}` ? ' drop-target' : ''}`}
              onClick={() => setSel({ kind: 'page', page: pi })}
              {...dndProps(`p${pi}`, { page: pi }, () => {
                if (!drag) return;
                if (drag.q === undefined) {
                  setPages(move(def.pages, drag.page, pi));
                  setSel({ kind: 'page', page: pi });
                } else dropQuestion(pi, def.pages[pi]!.questions.length);
              })}
            >
              {p.id}
              {p.title ? ` · ${p.title}` : ''}
              {p.condition ? <span className="type">if</span> : null}
            </button>
            {p.questions.map((q, qi) => (
              <button
                key={qi}
                className={`item q ${sel.kind === 'question' && sel.page === pi && sel.q === qi ? 'selected' : ''}${dropAt === `q${pi}.${qi}` ? ' drop-target' : ''}`}
                onClick={() => setSel({ kind: 'question', page: pi, q: qi })}
                {...dndProps(`q${pi}.${qi}`, { page: pi, q: qi }, () => {
                  if (drag?.q !== undefined) dropQuestion(pi, qi);
                })}
              >
                <span className="mono">{q.id}</span>
                <span className="type">{q.type}</span>
              </button>
            ))}
            {!readOnly ? (
              <div className="row" style={{ marginLeft: 18, gap: 10, flexWrap: 'wrap' }}>
                <button className="link small" onClick={() => addQuestion(pi)}>
                  + question
                </button>
                <InsertFromBank
                  def={def}
                  onInsert={(q) => {
                    setPage(pi, { ...p, questions: [...p.questions, q] });
                    setSel({ kind: 'question', page: pi, q: p.questions.length });
                  }}
                />
                <InsertBlockFromBank
                  def={def}
                  after={pi}
                  onInsert={(d) => {
                    onChange(d);
                    setSel({ kind: 'page', page: pi + 1 });
                  }}
                />
              </div>
            ) : null}
          </div>
        ))}
        {!readOnly ? (
          <div className="stack" style={{ marginTop: 12 }}>
            <div className="row" style={{ alignItems: 'flex-end', gap: 6, flexWrap: 'nowrap' }}>
              <label className="field" style={{ flex: 1, minWidth: 0 }}>
                New question type
                <TypeSelect value={newType} onChange={setNewType} />
              </label>
              <span style={{ paddingBottom: 8 }}>
                <InfoTip key={newType} {...newTypeHelp(newType)} />
              </span>
            </div>
            <QuestionLibraryButton
              onPick={(k) => {
                setNewType(k);
                addQuestion(currentPage, k);
              }}
            />
            <button onClick={addPage}>+ Add page</button>
          </div>
        ) : null}
      </nav>

      <section className="panel stack">
        <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
          {sel.kind === 'survey' ? <SurveySettings def={def} onChange={onChange} /> : null}
          {sel.kind === 'page' && selected ? (
            <PageForm
              page={selected as Page}
              onChange={(p) => setPage(sel.page, p)}
              onMove={(d) => {
                setPages(move(def.pages, sel.page, sel.page + d));
                setSel({ kind: 'page', page: Math.max(0, Math.min(def.pages.length - 1, sel.page + d)) });
              }}
              onDelete={
                def.pages.length > 1
                  ? () => {
                      setPages(def.pages.filter((_, i) => i !== sel.page));
                      setSel({ kind: 'survey' });
                    }
                  : undefined
              }
            />
          ) : null}
          {sel.kind === 'page' && selected && !readOnly ? <SavePageToBank page={selected as Page} /> : null}
          {sel.kind === 'question' && selected ? (
            <QuestionForm
              q={selected as Question}
              def={def}
              canSave={!readOnly}
              surveyId={surveyId}
              onChange={(q) => setQuestion(sel.page, sel.q, q)}
              onAddFollowUp={(q, follow) => {
                const page = def.pages[sel.page]!;
                const questions = page.questions.map((x, i) => (i === sel.q ? q : x));
                questions.splice(sel.q + 1, 0, follow);
                setPage(sel.page, { ...page, questions });
              }}
              onMove={(d) => {
                const page = def.pages[sel.page]!;
                setPage(sel.page, { ...page, questions: move(page.questions, sel.q, sel.q + d) });
                setSel({ ...sel, q: Math.max(0, Math.min(page.questions.length - 1, sel.q + d)) });
              }}
              onDelete={
                def.pages[sel.page]!.questions.length > 1
                  ? () => {
                      const page = def.pages[sel.page]!;
                      setPage(sel.page, { ...page, questions: page.questions.filter((_, i) => i !== sel.q) });
                      setSel({ kind: 'page', page: sel.page });
                    }
                  : undefined
              }
            />
          ) : null}
        </fieldset>
      </section>
    </div>
  );
}

function Text({
  label,
  value,
  onChange,
  mono,
  placeholder,
  area,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  mono?: boolean;
  placeholder?: string;
  area?: boolean;
}) {
  return (
    <label className="field">
      {label}
      {area ? (
        <textarea
          rows={3}
          value={value ?? ''}
          placeholder={placeholder}
          style={mono ? undefined : { fontFamily: 'inherit', fontSize: 14 }}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        />
      ) : (
        <input
          className={mono ? 'mono' : undefined}
          value={value ?? ''}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        />
      )}
    </label>
  );
}

function Num({ label, value, onChange }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void }) {
  return (
    <label className="field">
      {label}
      <input
        type="number"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        style={{ width: 120 }}
      />
    </label>
  );
}

function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

const CONDITION_HELP = 'Logic, e.g. Q1 == 2 and AGE >= 18 · selected(Q3, 1, 2) · Q5.r1 >= 4 · RANK.2 == 1 · answered(Q2)';

function SurveySettings({ def, onChange }: { def: SurveyDefinition; onChange: (d: SurveyDefinition) => void }) {
  return (
    <>
      <h2>
        Survey settings
        <InfoTip k="section.surveySettings" />
      </h2>
      <Text label="Title" value={def.title} onChange={(v) => onChange({ ...def, title: v ?? '' })} />
      <Text label="Welcome text (first page)" area value={def.welcome} onChange={(v) => onChange({ ...def, welcome: v })} />
      <Text label="Thank-you text (completes)" area value={def.thankYou} onChange={(v) => onChange({ ...def, thankYou: v })} />
      <div className="row">
        <Check
          label="Allow respondents to go back"
          value={def.settings.allowBack}
          onChange={(v) => onChange({ ...def, settings: { ...def.settings, allowBack: v } })}
        />
        <Check
          label="Show progress bar"
          value={def.settings.showProgress}
          onChange={(v) => onChange({ ...def, settings: { ...def.settings, showProgress: v } })}
        />
      </div>
      <h2 style={{ marginTop: 12 }}>
        Terminations
        <InfoTip k="section.terminations" />
      </h2>
      <p className="muted small">Checked after every page. The first matching rule ends the interview. {CONDITION_HELP}</p>
      <table className="data list-editor">
        <thead>
          <tr>
            <th>ID</th>
            <th>Condition</th>
            <th>Status</th>
            <th>Label</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {def.terminations.map((t, i) => (
            <tr key={i}>
              <td>
                <input
                  className="mono"
                  value={t.id}
                  onChange={(e) =>
                    onChange({ ...def, terminations: def.terminations.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)) })
                  }
                />
              </td>
              <td>
                <input
                  className="mono"
                  value={t.condition}
                  onChange={(e) =>
                    onChange({ ...def, terminations: def.terminations.map((x, j) => (j === i ? { ...x, condition: e.target.value } : x)) })
                  }
                />
              </td>
              <td>
                <select
                  value={t.status}
                  onChange={(e) =>
                    onChange({
                      ...def,
                      terminations: def.terminations.map((x, j) => (j === i ? { ...x, status: e.target.value as 'terminate' } : x)),
                    })
                  }
                >
                  <option value="terminate">terminate</option>
                  <option value="quality_fail">quality fail</option>
                </select>
              </td>
              <td>
                <input
                  value={t.label ?? ''}
                  onChange={(e) =>
                    onChange({
                      ...def,
                      terminations: def.terminations.map((x, j) => (j === i ? { ...x, label: e.target.value || undefined } : x)),
                    })
                  }
                />
              </td>
              <td>
                <button
                  className="link danger"
                  onClick={() => onChange({ ...def, terminations: def.terminations.filter((_, j) => j !== i) })}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div>
        <button
          onClick={() =>
            onChange({
              ...def,
              terminations: [...def.terminations, { id: `T${def.terminations.length + 1}`, condition: 'Q1 == 1', status: 'terminate' }],
            })
          }
        >
          + Termination
        </button>
      </div>
      <h2 style={{ marginTop: 12 }}>
        Quotas
        <InfoTip k="section.quotas" />
      </h2>
      <p className="muted small">
        Respondents matching the condition count toward the target when they complete. Over-target respondents get the quota-full redirect.
        Quotas with the same least-fill group are alternatives: someone who matches several (aware of three brands, say) counts toward only
        the least filled one, and is over quota only when all of them are full.
      </p>
      <table className="data list-editor">
        <thead>
          <tr>
            <th>ID</th>
            <th>Label</th>
            <th>Condition</th>
            <th>Target</th>
            <th>Least-fill group</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {def.quotas.map((q, i) => (
            <tr key={i}>
              <td>
                <input
                  className="mono"
                  value={q.id}
                  onChange={(e) => onChange({ ...def, quotas: def.quotas.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)) })}
                />
              </td>
              <td>
                <input
                  value={q.label ?? ''}
                  onChange={(e) =>
                    onChange({ ...def, quotas: def.quotas.map((x, j) => (j === i ? { ...x, label: e.target.value || undefined } : x)) })
                  }
                />
              </td>
              <td>
                <input
                  className="mono"
                  value={q.condition}
                  onChange={(e) =>
                    onChange({ ...def, quotas: def.quotas.map((x, j) => (j === i ? { ...x, condition: e.target.value } : x)) })
                  }
                />
              </td>
              <td>
                <input
                  type="number"
                  min={0}
                  value={q.target}
                  style={{ width: 90 }}
                  onChange={(e) =>
                    onChange({ ...def, quotas: def.quotas.map((x, j) => (j === i ? { ...x, target: Number(e.target.value) } : x)) })
                  }
                />
              </td>
              <td>
                <input
                  className="mono"
                  aria-label={`Least-fill group of ${q.id}`}
                  value={q.group ?? ''}
                  placeholder="none"
                  style={{ width: 110 }}
                  onChange={(e) =>
                    onChange({ ...def, quotas: def.quotas.map((x, j) => (j === i ? { ...x, group: e.target.value || undefined } : x)) })
                  }
                />
              </td>
              <td>
                <button className="link danger" onClick={() => onChange({ ...def, quotas: def.quotas.filter((_, j) => j !== i) })}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div>
        <button
          onClick={() =>
            onChange({ ...def, quotas: [...def.quotas, { id: `QT${def.quotas.length + 1}`, condition: 'Q1 == 1', target: 100 }] })
          }
        >
          + Quota
        </button>
      </div>
      <QuotaTableBuilder def={def} onChange={onChange} />
      <UrlVariablesEditor def={def} onChange={onChange} />
      <VariablesEditor def={def} onChange={onChange} />
      <RecodesEditor def={def} onChange={onChange} />
      <CleaningEditor def={def} onChange={onChange} />
      <LoopsEditor def={def} onChange={onChange} />
      <BlocksEditor def={def} onChange={onChange} />
    </>
  );
}

function PageForm({
  page,
  onChange,
  onMove,
  onDelete,
}: {
  page: Page;
  onChange: (p: Page) => void;
  onMove: (d: number) => void;
  onDelete?: () => void;
}) {
  return (
    <>
      <div className="row">
        <h2 style={{ margin: 0 }}>
          Page {page.id}
          <InfoTip k="section.page" />
        </h2>
        <div style={{ flex: 1 }} />
        <button onClick={() => onMove(-1)} aria-label="Move page up">
          ↑
        </button>
        <button onClick={() => onMove(1)} aria-label="Move page down">
          ↓
        </button>
        {onDelete ? (
          <button className="danger" onClick={onDelete}>
            Delete page
          </button>
        ) : null}
      </div>
      <Text label="Page ID" mono value={page.id} onChange={(v) => onChange({ ...page, id: v ?? '' })} />
      <Text label="Title (optional)" value={page.title} onChange={(v) => onChange({ ...page, title: v })} />
      <Text
        label="Show this page only if (optional)"
        mono
        value={page.condition}
        placeholder="e.g. Q1 == 1"
        onChange={(v) => onChange({ ...page, condition: v })}
      />
      <p className="muted small">{CONDITION_HELP}. Page conditions can only use questions from earlier pages.</p>
    </>
  );
}

/** Parse pasted answers: one per line, either "label" or "code<tab, ; = or .>label" (e.g. from Excel or Word). */
export function parsePastedOptions(text: string, existing: Option[] = []): Option[] {
  const out: Option[] = [];
  const used = new Set(existing.map((o) => o.code));
  let next = Math.max(0, ...existing.filter((o) => o.code < 90).map((o) => o.code)) + 1;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*[-*•]\s*/, '').trim();
    if (!line) continue;
    const m = /^(-?\d{1,6})\s*(?:\t|[;=.)]|\s{2,}|\s-\s)\s*(.+)$/.exec(line);
    let code: number;
    let label: string;
    if (m && !used.has(Number(m[1]))) {
      code = Number(m[1]);
      label = m[2]!.trim();
    } else {
      while (used.has(next)) next++;
      code = next;
      label = line;
    }
    used.add(code);
    out.push({ code, label });
  }
  return out;
}

function PasteOptions({ options, onChange }: { options: Option[]; onChange: (o: Option[]) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)}>
        Paste answer list
      </button>
    );
  const parsed = parsePastedOptions(text);
  return (
    <div className="panel stack paste-options">
      <label className="field">
        Paste one answer per line. Codes are optional: &quot;1&lt;tab&gt;Yes&quot;, &quot;1; Yes&quot; or &quot;1. Yes&quot;.
        <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} aria-label="Pasted answers" autoFocus />
      </label>
      <span className="muted small">{parsed.length} answer(s) found.</span>
      <div className="row">
        <button
          type="button"
          className="primary"
          disabled={!parsed.length}
          onClick={() => {
            onChange(parsed);
            setOpen(false);
            setText('');
          }}
        >
          Replace the answers
        </button>
        <button
          type="button"
          disabled={!parsed.length}
          onClick={() => {
            onChange([...options, ...parsePastedOptions(text, options)]);
            setOpen(false);
            setText('');
          }}
        >
          Add to the answers
        </button>
        <button type="button" className="link" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** "Other (please specify)" and "None of these" style answers with the label the programmer chooses. */
function SpecialOptions({
  options,
  onChange,
  multi,
  onAddOpenEnd,
}: {
  options: Option[];
  onChange: (o: Option[]) => void;
  multi?: boolean;
  /** Add an open-end answer: the editor adds the follow-up text question. */
  onAddOpenEnd?: (option: Option) => void;
}) {
  const [oeLabel, setOeLabel] = useState('Other (please specify)');
  const [exLabel, setExLabel] = useState(multi ? 'None of these' : "Don't know");
  const freeCode = (preferred: number[]) => {
    const used = new Set(options.map((o) => o.code));
    return preferred.find((c) => !used.has(c)) ?? Math.max(0, ...options.map((o) => o.code)) + 1;
  };
  return (
    <div className="row special-options" style={{ alignItems: 'flex-end' }}>
      {onAddOpenEnd ? (
        <span className="row" style={{ gap: 6, alignItems: 'flex-end' }}>
          <label className="field">
            Open-end answer label
            <input value={oeLabel} onChange={(e) => setOeLabel(e.target.value)} aria-label="Open-end answer label" />
          </label>
          <button
            type="button"
            disabled={!oeLabel.trim()}
            onClick={() => {
              const opt: Option = { code: freeCode([97, 96, 95]), label: oeLabel.trim(), anchor: true };
              onAddOpenEnd(opt);
            }}
          >
            + Open-end answer
          </button>
        </span>
      ) : null}
      <span className="row" style={{ gap: 6, alignItems: 'flex-end' }}>
        <label className="field">
          Exclusive answer label
          <input value={exLabel} onChange={(e) => setExLabel(e.target.value)} aria-label="Exclusive answer label" />
        </label>
        <button
          type="button"
          disabled={!exLabel.trim()}
          onClick={() =>
            onChange([
              ...options,
              { code: freeCode([99, 98, 96]), label: exLabel.trim(), anchor: true, ...(multi ? { exclusive: true } : {}) },
            ])
          }
        >
          + Exclusive answer
        </button>
      </span>
    </div>
  );
}

function OptionsEditor({
  options,
  onChange,
  multi,
  images,
  anchors = true,
  onAddOpenEnd,
}: {
  options: Option[];
  onChange: (o: Option[]) => void;
  multi?: boolean;
  /** Offer a picture per option (image choice). */
  images?: boolean;
  anchors?: boolean;
  onAddOpenEnd?: (option: Option) => void;
}) {
  const set = (i: number, o: Option) => onChange(options.map((x, j) => (j === i ? o : x)));
  const withImages = useHasMediaLibrary() && images;
  return (
    <table className="data list-editor">
      <thead>
        <tr>
          <th style={{ width: 80 }}>Code</th>
          <th>Label</th>
          {withImages ? <th>Picture</th> : null}
          {anchors ? <th>Anchor</th> : null}
          {multi ? <th>Exclusive</th> : null}
          <th />
        </tr>
      </thead>
      <tbody>
        {options.map((o, i) => (
          <tr key={i}>
            <td>
              <input
                type="number"
                value={o.code}
                style={{ width: 70 }}
                onChange={(e) => set(i, { ...o, code: Number(e.target.value) })}
                aria-label="Answer code"
              />
            </td>
            <td>
              <input
                value={o.label}
                style={{ minWidth: 160 }}
                onChange={(e) => set(i, { ...o, label: e.target.value })}
                aria-label="Answer label"
              />
            </td>
            {withImages ? (
              <td>
                <OptionImagePicker image={o.image} label={o.label} onChange={(image) => set(i, { ...o, image })} />
              </td>
            ) : null}
            {anchors ? (
              <td>
                <input
                  type="checkbox"
                  checked={!!o.anchor}
                  onChange={(e) => set(i, { ...o, anchor: e.target.checked || undefined })}
                  aria-label="Keep in place when randomizing"
                />
              </td>
            ) : null}
            {multi ? (
              <td>
                <input
                  type="checkbox"
                  checked={!!o.exclusive}
                  onChange={(e) => set(i, { ...o, exclusive: e.target.checked || undefined })}
                  aria-label="Exclusive"
                />
              </td>
            ) : null}
            <td>
              <button className="link danger" onClick={() => onChange(options.filter((_, j) => j !== i))} disabled={options.length <= 1}>
                Remove
              </button>
            </td>
          </tr>
        ))}
        <tr>
          <td colSpan={6}>
            <div className="row">
              <button
                onClick={() => {
                  const code = Math.max(0, ...options.filter((o) => o.code < 90).map((o) => o.code)) + 1;
                  onChange([...options, { code, label: `Option ${code}` }]);
                }}
              >
                + Option
              </button>
              <PasteOptions options={options} onChange={onChange} />
            </div>
          </td>
        </tr>
        <tr>
          <td colSpan={6}>
            <SpecialOptions options={options} onChange={onChange} multi={multi} onAddOpenEnd={onAddOpenEnd} />
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function QuestionForm({
  q,
  def,
  onChange,
  onMove,
  onDelete,
  canSave,
  surveyId,
  onAddFollowUp,
}: {
  q: Question;
  def: SurveyDefinition;
  /** Offer "Save to question bank". */
  canSave?: boolean;
  surveyId?: string;
  onChange: (q: Question) => void;
  onMove: (d: number) => void;
  onDelete?: () => void;
  /** Change this question and put a follow-up question right after it (open-end answers). */
  onAddFollowUp?: (q: Question, follow: Question) => void;
}) {
  const libType = catalogTypeOf(q.catalogType);
  const addOpenEnd =
    onAddFollowUp && (q.type === 'single' || q.type === 'multi' || q.type === 'ranking')
      ? (opt: Option) => {
          const used = new Set(def.pages.flatMap((p) => p.questions.map((x) => x.id.toLowerCase())));
          let id = `${q.id}_OE`;
          for (let n = 2; used.has(id.toLowerCase()); n++) id = `${q.id}_OE${n}`;
          const follow: Question = {
            id,
            type: 'open',
            text: `${opt.label.replace(/\s*\(?please specify\)?\s*$/i, '') || 'Other'}: please specify`,
            condition: q.type === 'single' ? `${q.id} == ${opt.code}` : `selected(${q.id}, ${opt.code})`,
            required: true,
            validations: [],
            multiline: false,
            maxLength: 500,
          };
          onAddFollowUp({ ...q, options: [...q.options, opt] } as Question, follow);
        }
      : undefined;
  return (
    <>
      <div className="row q-head">
        <h2 style={{ margin: 0 }}>
          <span className="mono">{q.id}</span> <span className="badge">{libType ? libType.name : TYPE_LABELS[q.type]}</span>
          <InfoTip key={`${q.type}-${q.catalogType}`} {...questionHelp(q)} />
        </h2>
        <div style={{ flex: 1 }} />
        {surveyId ? (
          <button type="button" onClick={() => openPreviewTab(surveyId, def, q.id)} title="Open this question full page in a new tab">
            Preview in new tab
          </button>
        ) : null}
        <button onClick={() => onMove(-1)} aria-label="Move question up">
          ↑
        </button>
        <button onClick={() => onMove(1)} aria-label="Move question down">
          ↓
        </button>
        {onDelete ? (
          <button className="danger" onClick={onDelete}>
            Delete
          </button>
        ) : null}
      </div>
      {libType?.note ? <p className="muted small">{libType.note}</p> : null}
      {canSave ? <SaveQuestionToBank q={q} /> : null}
      <Text label="Variable name" mono value={q.id} onChange={(v) => onChange({ ...q, id: v ?? '' })} />
      <Text
        label="Question text (use {{VAR}} to pipe an earlier answer)"
        area
        value={q.text}
        onChange={(v) => onChange({ ...q, text: v ?? '' })}
      />
      <HtmlEditor q={q} onChange={onChange} />
      <Text
        label="Show only if (optional)"
        mono
        value={q.condition}
        placeholder="e.g. selected(Q2, 98)"
        onChange={(v) => onChange({ ...q, condition: v })}
      />
      {q.type !== 'info' ? (
        <>
          <Text label="Help text (optional)" value={q.help} onChange={(v) => onChange({ ...q, help: v })} />
          <Check label="Answer required" value={q.required} onChange={(v) => onChange({ ...q, required: v })} />
        </>
      ) : null}
      <QuestionMediaEditor media={q.media} onChange={(media) => onChange({ ...q, media })} />
      {q.type === 'single' || q.type === 'multi' ? (
        <>
          <h3>Answer options</h3>
          <OptionsEditor
            options={q.options}
            multi={q.type === 'multi'}
            images
            onChange={(options) => onChange({ ...q, options })}
            onAddOpenEnd={addOpenEnd}
          />
          <label className="field" style={{ maxWidth: 320 }}>
            Shown as
            <select
              value={q.display ?? 'list'}
              onChange={(e) => onChange({ ...q, display: e.target.value === 'dropdown' ? 'dropdown' : undefined })}
            >
              <option value="list">{q.type === 'multi' ? 'Checkboxes' : 'Radio buttons'}</option>
              <option value="dropdown">{q.type === 'multi' ? 'Multi-select dropdown' : 'Dropdown'}</option>
            </select>
          </label>
          <Check
            label="Randomize order (anchored options stay in place)"
            value={q.randomize}
            onChange={(v) => onChange({ ...q, randomize: v })}
          />
          <DynamicListEditor q={q} def={def} onChange={onChange} />
        </>
      ) : null}
      {q.type === 'maxdiff' ? <MaxDiffForm q={q} onChange={onChange} OptionsEditor={OptionsEditor} /> : null}
      {q.type === 'conjoint' ? <ConjointForm q={q} onChange={onChange} /> : null}
      {q.type === 'cardsort' ? <CardSortForm q={q} onChange={onChange} OptionsEditor={OptionsEditor} /> : null}
      {q.type === 'hotspot' ? <HotspotForm q={q} onChange={onChange} /> : null}
      {q.type === 'eyetrack' ? <EyeTrackForm q={q} onChange={onChange} /> : null}
      {q.type === 'multi' ? (
        <div className="row">
          <Num label="Minimum selections" value={q.minSelected} onChange={(v) => onChange({ ...q, minSelected: v })} />
          <Num label="Maximum selections" value={q.maxSelected} onChange={(v) => onChange({ ...q, maxSelected: v })} />
        </div>
      ) : null}
      {q.type === 'numeric' ? (
        <>
          <div className="row">
            <Num label="Minimum" value={q.min} onChange={(v) => onChange({ ...q, min: v })} />
            <Num label="Maximum" value={q.max} onChange={(v) => onChange({ ...q, max: v })} />
            <Text label="Unit" value={q.unit} onChange={(v) => onChange({ ...q, unit: v })} />
            <Check label="Whole numbers only" value={q.integer} onChange={(v) => onChange({ ...q, integer: v })} />
          </div>
          <div className="row">
            <label className="field">
              Shown as
              <select value={q.display} onChange={(e) => onChange({ ...q, display: e.target.value as 'input' | 'slider' })}>
                <option value="input">Number box</option>
                <option value="slider">Slider (needs a minimum and maximum)</option>
              </select>
            </label>
            {q.display === 'slider' ? (
              <>
                <Num label="Step" value={q.step} onChange={(v) => onChange({ ...q, step: v && v > 0 ? v : undefined })} />
                <Text label="Low end label" value={q.minLabel} onChange={(v) => onChange({ ...q, minLabel: v })} />
                <Text label="High end label" value={q.maxLabel} onChange={(v) => onChange({ ...q, maxLabel: v })} />
              </>
            ) : null}
          </div>
          <DontKnowEditor value={q.dontKnow} defaultCode={-99} onChange={(dontKnow) => onChange({ ...q, dontKnow })} />
        </>
      ) : null}
      {q.type === 'scale' ? (
        <>
          <div className="row">
            <Check
              label="Net Promoter Score (0 to 10; analysis reports the NPS)"
              value={q.nps}
              onChange={(v) => onChange(v ? { ...q, nps: true, min: 0, max: 10 } : { ...q, nps: false })}
            />
          </div>
          <div className="row">
            <Num label="From" value={q.min} onChange={(v) => onChange({ ...q, min: v ?? 0 })} />
            <Num label="To" value={q.max} onChange={(v) => onChange({ ...q, max: v ?? 10 })} />
            <Text label="Low end label" value={q.minLabel} onChange={(v) => onChange({ ...q, minLabel: v })} />
            <Text label="High end label" value={q.maxLabel} onChange={(v) => onChange({ ...q, maxLabel: v })} />
            <label className="field">
              Shown as
              <select
                value={q.display ?? 'buttons'}
                onChange={(e) => onChange({ ...q, display: e.target.value === 'stars' ? 'stars' : undefined })}
              >
                <option value="buttons">Numbered buttons</option>
                <option value="stars">Stars</option>
              </select>
            </label>
          </div>
          <div className="row">
            <Check
              label="Exclusive answer outside the scale (e.g. Don't know)"
              value={!!q.dontKnow}
              onChange={(v) => onChange({ ...q, dontKnow: v ? { code: 99, label: "Don't know" } : undefined })}
            />
            {q.dontKnow ? (
              <>
                <Num
                  label="Its code"
                  value={q.dontKnow.code}
                  onChange={(v) => onChange({ ...q, dontKnow: { ...q.dontKnow!, code: v ?? 99 } })}
                />
                <Text
                  label="Its label"
                  value={q.dontKnow.label}
                  onChange={(v) => onChange({ ...q, dontKnow: { ...q.dontKnow!, label: v ?? '' } })}
                />
              </>
            ) : null}
          </div>
        </>
      ) : null}
      {q.type === 'ranking' ? (
        <>
          <h3>Items to rank</h3>
          <p className="muted small">Stored as the codes in rank order. In logic, {q.id}.2 is the rank given to item 2 (1 = first).</p>
          <OptionsEditor options={q.options} images onChange={(options) => onChange({ ...q, options })} onAddOpenEnd={addOpenEnd} />
          <div className="row">
            <Check
              label="Randomize order (anchored items stay in place)"
              value={q.randomize}
              onChange={(v) => onChange({ ...q, randomize: v })}
            />
            <Num
              label="Rank only the top (empty: all)"
              value={q.rankCount}
              onChange={(v) => onChange({ ...q, rankCount: v && v > 0 ? v : undefined })}
            />
          </div>
          <DynamicListEditor q={q} def={def} onChange={onChange} />
        </>
      ) : null}
      {q.type === 'sum' ? (
        <>
          <h3>Items</h3>
          <p className="muted small">Respondents share the total across the items. In logic, {q.id}.1 is the amount given to item 1.</p>
          <OptionsEditor options={q.options} onChange={(options) => onChange({ ...q, options })} />
          <div className="row">
            <Num label="Total" value={q.total} onChange={(v) => onChange({ ...q, total: v ?? 100 })} />
            <Text label="Unit" value={q.unit} onChange={(v) => onChange({ ...q, unit: v })} />
            <Check label="Whole numbers only" value={q.integer} onChange={(v) => onChange({ ...q, integer: v })} />
            <Check label="Randomize order" value={q.randomize} onChange={(v) => onChange({ ...q, randomize: v })} />
          </div>
        </>
      ) : null}
      {q.type === 'photo' ? (
        <p className="muted small">
          Respondents take a photo with their camera or choose one; interviewers take it with the device. Photos are shrunk and their
          location metadata removed on the device, and they are private: only your team can open them, from the review queue. In logic, use{' '}
          {q.id} != null to check one was given.
        </p>
      ) : null}
      {q.type === 'signature' ? (
        <p className="muted small">
          The respondent signs on screen; the drawing is kept with the answers and shown in exports as &quot;signed&quot;. It shows that
          someone signed on the device, not who they are: it is not a qualified electronic signature.
        </p>
      ) : null}
      {q.type === 'barcode' ? (
        <>
          <div className="row">
            <Text
              label="Code format (regular expression)"
              value={q.pattern}
              onChange={(v) => onChange({ ...q, pattern: v || undefined })}
            />
            <Num label="Max characters" value={q.maxLength} onChange={(v) => onChange({ ...q, maxLength: v ?? 200 })} />
          </div>
          <p className="muted small">
            Scanning uses the camera where the browser can read codes (Chrome on Android, for example); everywhere else the code is typed.
            Example format for a 13-digit EAN: ^\d{'{'}13{'}'}$
          </p>
        </>
      ) : null}
      {q.type === 'open' ? (
        <>
          <div className="row">
            <label className="field">
              Answer format
              <select
                value={q.format ?? 'text'}
                onChange={(e) => onChange({ ...q, format: e.target.value === 'text' ? undefined : (e.target.value as typeof q.format) })}
              >
                <option value="text">Free text</option>
                <option value="email">Email address</option>
                <option value="phone">Phone number</option>
                <option value="date">Date</option>
                <option value="time">Time</option>
                <option value="datetime">Date and time</option>
                <option value="location">Location (GPS)</option>
              </select>
            </label>
            {!q.format || q.format === 'text' ? (
              <Check label="Multi-line" value={q.multiline} onChange={(v) => onChange({ ...q, multiline: v })} />
            ) : null}
            <Num label="Max characters" value={q.maxLength} onChange={(v) => onChange({ ...q, maxLength: v ?? 2000 })} />
          </div>
          <DontKnowEditor value={q.dontKnow} defaultCode={99} onChange={(dontKnow) => onChange({ ...q, dontKnow })} />
        </>
      ) : null}
      {q.type === 'grid' ? (
        <>
          <h3>Rows (variables are {q.id}_rowid)</h3>
          <table className="data list-editor">
            <tbody>
              {q.rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ width: 100 }}>
                    <input
                      className="mono"
                      value={r.id}
                      aria-label="Row id"
                      onChange={(e) => onChange({ ...q, rows: q.rows.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)) })}
                    />
                  </td>
                  <td>
                    <input
                      value={r.label}
                      aria-label="Row label"
                      onChange={(e) => onChange({ ...q, rows: q.rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
                    />
                  </td>
                  <td>
                    <button
                      className="link danger"
                      disabled={q.rows.length <= 1}
                      onClick={() => onChange({ ...q, rows: q.rows.filter((_, j) => j !== i) })}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div>
            <button
              onClick={() => onChange({ ...q, rows: [...q.rows, { id: `r${q.rows.length + 1}`, label: `Item ${q.rows.length + 1}` }] })}
            >
              + Row
            </button>{' '}
            <PasteOptions
              options={q.rows.map((r, i) => ({ code: i + 1, label: r.label }))}
              onChange={(opts) => onChange({ ...q, rows: opts.map((o, i) => ({ id: `r${i + 1}`, label: o.label })) })}
            />
          </div>
          <Check label="Randomize rows" value={q.randomizeRows} onChange={(v) => onChange({ ...q, randomizeRows: v })} />
          <h3>Scale columns</h3>
          <OptionsEditor options={q.columns} onChange={(columns) => onChange({ ...q, columns })} />
        </>
      ) : null}
      {q.type !== 'info' ? (
        <>
          <h3>Custom validations</h3>
          <p className="muted small">Each rule must be true for the answer to be accepted.</p>
          <table className="data list-editor">
            <tbody>
              {q.validations.map((v, i) => (
                <tr key={i}>
                  <td>
                    <input
                      className="mono"
                      value={v.expr}
                      aria-label="Rule"
                      onChange={(e) =>
                        onChange({ ...q, validations: q.validations.map((x, j) => (j === i ? { ...x, expr: e.target.value } : x)) })
                      }
                    />
                  </td>
                  <td>
                    <input
                      value={v.message}
                      aria-label="Message"
                      onChange={(e) =>
                        onChange({ ...q, validations: q.validations.map((x, j) => (j === i ? { ...x, message: e.target.value } : x)) })
                      }
                    />
                  </td>
                  <td>
                    <button
                      className="link danger"
                      onClick={() => onChange({ ...q, validations: q.validations.filter((_, j) => j !== i) })}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div>
            <button
              onClick={() =>
                onChange({ ...q, validations: [...q.validations, { expr: `${q.id} > 0`, message: 'Please check your answer.' }] })
              }
            >
              + Validation
            </button>
          </div>
        </>
      ) : null}
    </>
  );
}

/** Exclusive "Don't know" answer for text and number questions, with its own code and label. */
function DontKnowEditor({
  value,
  defaultCode,
  onChange,
}: {
  value: { code: number; label: string } | undefined;
  defaultCode: number;
  onChange: (v: { code: number; label: string } | undefined) => void;
}) {
  return (
    <div className="row">
      <Check
        label="Exclusive answer instead of typing (e.g. Don't know)"
        value={!!value}
        onChange={(v) => onChange(v ? { code: defaultCode, label: "Don't know" } : undefined)}
      />
      {value ? (
        <>
          <Num label="Its code" value={value.code} onChange={(v) => onChange({ ...value, code: v ?? defaultCode })} />
          <Text label="Its label" value={value.label} onChange={(v) => onChange({ ...value, label: v ?? '' })} />
        </>
      ) : null}
    </div>
  );
}

/**
 * Client feedback 2026-11: show the question as HTML and let the programmer change it. Saved HTML is
 * shown to respondents through the renderer's allow-list (no scripts, links, forms or outside images).
 */
function HtmlEditor({ q, onChange }: { q: Question; onChange: (q: Question) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const preview = open ? sanitizeQuestionHtml(draft) : null;
  if (!open)
    return (
      <div className="row">
        <button
          type="button"
          onClick={() => {
            setDraft(q.html ?? textToHtml(q.text));
            setOpen(true);
          }}
        >
          {'</>'} {q.html ? 'Edit HTML' : 'Show HTML code'}
        </button>
        {q.html ? (
          <>
            <span className="badge">custom HTML</span>
            <button type="button" className="link danger small" onClick={() => onChange({ ...q, html: undefined })}>
              Remove HTML (use plain text)
            </button>
          </>
        ) : null}
      </div>
    );
  return (
    <div className="panel stack html-editor">
      <label className="field">
        Question HTML
        <textarea
          className="mono"
          rows={8}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          aria-label="Question HTML"
        />
      </label>
      <p className="muted small">
        Formatting, lists, tables and line breaks are allowed; scripts, links, forms, frames and outside pictures are removed. Use{' '}
        {'{{VAR}}'} to pipe an answer. The plain question text above stays the text for screen readers and translations.
      </p>
      {preview !== null ? (
        <div className="html-preview">
          <span className="muted small">Shown to respondents as:</span>
          <div className="zx-html" dangerouslySetInnerHTML={{ __html: preview }} />
        </div>
      ) : null}
      <div className="row">
        <button
          type="button"
          className="primary"
          onClick={() => {
            const html = draft.trim();
            onChange({ ...q, html: html && html !== textToHtml(q.text) ? html : undefined });
            setOpen(false);
          }}
        >
          Apply HTML
        </button>
        <button type="button" className="link" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
