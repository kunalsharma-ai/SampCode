/** Client feedback 2026-11: open text formats, "Don't know" on text and numbers, custom question HTML. */
import { describe, expect, it } from 'vitest';
import { parseSurveyDefinition, questionSchema, type Question, type SurveyDefinition } from '@zapx/survey-schema';
import { normalizeAnswer, renderQuestion } from './index.js';

const q = (input: unknown): Question => questionSchema.parse(input);

describe('open text formats', () => {
  it('checks email, phone, date and time answers', () => {
    const email = q({ id: 'E', type: 'open', text: 'Email', format: 'email' });
    expect(normalizeAnswer(email, 'a@b.co')).toEqual({ value: 'a@b.co' });
    expect(normalizeAnswer(email, 'not an email')).toHaveProperty('error');
    const phone = q({ id: 'P', type: 'open', text: 'Phone', format: 'phone' });
    expect(normalizeAnswer(phone, '+44 20 7946 0000')).toHaveProperty('value');
    expect(normalizeAnswer(phone, 'call me')).toHaveProperty('error');
    const date = q({ id: 'D', type: 'open', text: 'Date', format: 'date' });
    expect(normalizeAnswer(date, '2026-11-18')).toEqual({ value: '2026-11-18' });
    expect(normalizeAnswer(date, '2026-13-45')).toHaveProperty('error');
    const time = q({ id: 'T', type: 'open', text: 'Time', format: 'time' });
    expect(normalizeAnswer(time, '07:30')).toEqual({ value: '07:30' });
    const loc = q({ id: 'L', type: 'open', text: 'Where', format: 'location' });
    expect(normalizeAnswer(loc, '51.5,-0.12')).toEqual({ value: '51.5,-0.12' });
  });
});

describe('exclusive "Don\'t know" on text and numbers', () => {
  it('stores the code instead of an answer', () => {
    const open = q({ id: 'O', type: 'open', text: 'Why?', dontKnow: { code: 99, label: "Don't know" } });
    expect(normalizeAnswer(open, 99)).toEqual({ value: 99 });
    expect(normalizeAnswer(open, 'Because')).toEqual({ value: 'Because' });
    const num = q({ id: 'N', type: 'numeric', text: 'Age', min: 18, max: 99, dontKnow: { code: -99, label: 'Prefer not to say' } });
    expect(normalizeAnswer(num, -99)).toEqual({ value: -99 });
    expect(normalizeAnswer(num, -5)).toHaveProperty('error');
  });
});

describe('custom question HTML', () => {
  it('escapes piped answers', () => {
    const r = parseSurveyDefinition({
      schemaVersion: 1,
      title: 'H',
      pages: [
        { id: 'P1', questions: [{ id: 'NAME', type: 'open', text: 'Name?' }] },
        {
          id: 'P2',
          questions: [{ id: 'Q2', type: 'single', text: 'Hi', html: '<p>Hi <b>{{NAME}}</b></p>', options: [{ code: 1, label: 'Ok' }] }],
        },
      ],
    });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const def: SurveyDefinition = r.definition;
    const rendered = renderQuestion(def.pages[1]!.questions[0]!, def, { NAME: '<img src=x onerror=alert(1)>' }, 's');
    expect(rendered.renderedHtml).toBe('<p>Hi <b>&#60;img src=x onerror=alert(1)&#62;</b></p>');
  });
});

describe('translation sheet', () => {
  it('downloads every text side by side and uploads the translations back', async () => {
    const { translationSheetCsv, applyTranslationSheet, parseCsv } = await import('./index.js');
    const { parsePresentation } = await import('@zapx/survey-schema');
    const r = parseSurveyDefinition({
      schemaVersion: 1,
      title: 'Sheet',
      pages: [
        {
          id: 'P1',
          questions: [
            {
              id: 'Q1',
              type: 'single',
              text: 'Do you like it, "really"?',
              options: [
                { code: 1, label: 'Yes' },
                { code: 2, label: 'No' },
              ],
            },
            { id: 'Q2', type: 'open', text: 'Why?', dontKnow: { code: 99, label: "Don't know" } },
          ],
        },
      ],
    });
    if (!r.ok) throw new Error('bad');
    const p = parsePresentation({ languages: [{ tag: 'fr', name: 'Français', texts: {} }] });
    if (!p.ok) throw new Error('bad');
    const csv = translationSheetCsv(r.definition, p.presentation, 'fr');
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual(['Key', 'Where', 'Existing text', 'Translation']);
    expect(rows.find((x) => x[0] === 'q.Q1.text')).toEqual(['q.Q1.text', 'Q1 question text', 'Do you like it, "really"?', '']);
    expect(rows.some((x) => x[0] === 'q.Q2.dontKnow')).toBe(true);
    // The translator fills the right column (Excel in some regions saves with semicolons).
    const filled = rows
      .map((x) => (x[0] === 'q.Q1.text' ? [...x.slice(0, 3), 'Vous aimez ?'] : x[0] === 'q.Q1.opt.1' ? [...x.slice(0, 3), 'Oui'] : x))
      .map((x) => x.map((c) => `"${c.replace(/"/g, '""')}"`).join(';'))
      .join('\n');
    const out = applyTranslationSheet(r.definition, p.presentation, 'fr', `${filled}\n"q.GONE.text";"";"";"x"`);
    expect(out.applied).toBe(2);
    expect(out.unknown).toEqual(['q.GONE.text']);
    const fr = out.presentation.languages[0]!.texts;
    expect(fr['q.Q1.text']).toEqual({ text: 'Vous aimez ?', source: 'Do you like it, "really"?', status: 'reviewed' });
    expect(fr['q.Q1.opt.1']?.text).toBe('Oui');
  });
});
