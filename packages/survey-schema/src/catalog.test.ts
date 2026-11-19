import { describe, expect, it } from 'vitest';
import { CATALOG_CATEGORIES, QUESTION_CATALOG, buildCatalogQuestions, questionSchema } from './index.js';

describe('question library', () => {
  it('has the 77 types of the client list, each with a category and a description', () => {
    expect(QUESTION_CATALOG).toHaveLength(77);
    expect(new Set(QUESTION_CATALOG.map((t) => t.key)).size).toBe(77);
    const cats = new Set(CATALOG_CATEGORIES.map((c) => c.key));
    for (const t of QUESTION_CATALOG) {
      expect(cats.has(t.category)).toBe(true);
      expect(t.description.length).toBeGreaterThan(3);
    }
  });

  it('builds valid questions for every type, tagged with the type', () => {
    for (const t of QUESTION_CATALOG) {
      const qs = buildCatalogQuestions(t.key, 'Q7');
      expect(qs.length).toBeGreaterThan(0);
      for (const q of qs) {
        const r = questionSchema.safeParse(q);
        expect(r.success, `${t.key}: ${JSON.stringify(r.error?.issues)}`).toBe(true);
        expect(r.data?.catalogType).toBe(t.key);
      }
      expect(new Set(qs.map((q) => q.id)).size).toBe(qs.length);
    }
  });
});
