/**
 * Question library (client feedback 2026-11): the market research question types, grouped in
 * categories, each with the short description shown in the studio's info box. Every type is built
 * from the engine's core question types, so logic, quotas, exports and analysis work the same for all
 * of them. A few types are approximations of a method; their `note` says what to set up or what is
 * different, and the studio shows it next to the description.
 */
import type { QuestionInput } from './index.js';

export interface CatalogCategory {
  key: string;
  name: string;
}

export interface CatalogType {
  /** Stable id, stored on created questions as `catalogType`. */
  key: string;
  /** Number in the client's list. */
  no: number;
  category: string;
  name: string;
  description: string;
  /** What the person setting it up should know (approximations, media to upload). */
  note?: string;
  /** Build the question(s) with this variable name. Several questions get suffixes a, b, c… */
  build: (id: string) => QuestionInput[];
}

export const CATALOG_CATEGORIES: CatalogCategory[] = [
  { key: 'basic', name: '1. Basic question types' },
  { key: 'rating', name: '2. Rating and scale question types' },
  { key: 'ranking', name: '3. Ranking and comparative question types' },
  { key: 'matrix', name: '4. Matrix and grid question types' },
  { key: 'advanced', name: '5. Advanced market research question types' },
  { key: 'visual', name: '6. Visual and interactive question types' },
  { key: 'special', name: '7. Specialized survey question types' },
];

type Opt = { code: number; label: string; exclusive?: boolean; anchor?: boolean };
const opts = (...labels: string[]): Opt[] => labels.map((label, i) => ({ code: i + 1, label }));
const scaleOpts = (...labels: string[]): Opt[] => opts(...labels);
const items = (n: number, word = 'Option'): Opt[] => Array.from({ length: n }, (_, i) => ({ code: i + 1, label: `${word} ${i + 1}` }));
const rows = (...labels: string[]) => labels.map((label, i) => ({ id: `r${i + 1}`, label }));
const suffix = (id: string, i: number) => `${id}${String.fromCharCode(97 + i)}`;

const AGREE5 = scaleOpts('Strongly agree', 'Agree', 'Neither agree nor disagree', 'Disagree', 'Strongly disagree');
const AGREE7 = scaleOpts(
  'Completely agree',
  'Mostly agree',
  'Somewhat agree',
  'Neither agree nor disagree',
  'Somewhat disagree',
  'Mostly disagree',
  'Completely disagree',
);
const RATE5 = scaleOpts('1 - Very poor', '2', '3', '4', '5 - Excellent');

const single = (id: string, text: string, options: Opt[], extra: Record<string, unknown> = {}): QuestionInput =>
  ({ id, type: 'single', text, options, ...extra }) as QuestionInput;
const multi = (id: string, text: string, options: Opt[], extra: Record<string, unknown> = {}): QuestionInput =>
  ({ id, type: 'multi', text, options, ...extra }) as QuestionInput;
const open = (id: string, text: string, extra: Record<string, unknown> = {}): QuestionInput =>
  ({ id, type: 'open', text, ...extra }) as QuestionInput;
const numeric = (id: string, text: string, extra: Record<string, unknown> = {}): QuestionInput =>
  ({ id, type: 'numeric', text, ...extra }) as QuestionInput;
const scale = (id: string, text: string, extra: Record<string, unknown> = {}): QuestionInput =>
  ({ id, type: 'scale', text, ...extra }) as QuestionInput;
const grid = (id: string, text: string, r: Array<{ id: string; label: string }>, columns: Opt[]): QuestionInput =>
  ({ id, type: 'grid', text, rows: r, columns }) as QuestionInput;
const ranking = (id: string, text: string, options: Opt[], extra: Record<string, unknown> = {}): QuestionInput =>
  ({ id, type: 'ranking', text, options, randomize: true, ...extra }) as QuestionInput;
const sum = (id: string, text: string, options: Opt[], total: number, unit: string): QuestionInput =>
  ({ id, type: 'sum', text, options, total, unit }) as QuestionInput;
const info = (id: string, text: string): QuestionInput => ({ id, type: 'info', text }) as QuestionInput;
const hotspot = (id: string, text: string, extra: Record<string, unknown> = {}): QuestionInput =>
  ({
    id,
    type: 'hotspot',
    text,
    imageAlt: '',
    regions: [{ code: 1, label: 'Area 1', x: 10, y: 10, w: 30, h: 20 }],
    ...extra,
  }) as QuestionInput;
const many = (id: string, texts: string[], make: (id: string, text: string) => QuestionInput): QuestionInput[] =>
  texts.map((t, i) => make(suffix(id, i), t));

const CONJOINT_ATTRS = [
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
];
const conjoint = (id: string): QuestionInput =>
  ({
    id,
    type: 'conjoint',
    text: 'If these were your only options, which would you choose?',
    attributes: CONJOINT_ATTRS,
  }) as QuestionInput;

export const QUESTION_CATALOG: CatalogType[] = [
  // ---- 1. Basic ----
  {
    key: 'single',
    no: 1,
    category: 'basic',
    name: 'Single Choice (SC)',
    description: 'Respondent selects only one answer',
    build: (id) => [single(id, 'Which of these best describes you?', items(3))],
  },
  {
    key: 'multi',
    no: 2,
    category: 'basic',
    name: 'Multiple Choice (MC / MA)',
    description: 'Respondent can select multiple answers',
    build: (id) => [multi(id, 'Which of these apply to you? Select all that apply.', items(4))],
  },
  {
    key: 'open-ended',
    no: 3,
    category: 'basic',
    name: 'Open Ended (OE)',
    description: 'Respondent enters an answer in their own words',
    build: (id) => [open(id, 'Please tell us why.', { multiline: true })],
  },
  {
    key: 'numeric-entry',
    no: 4,
    category: 'basic',
    name: 'Numeric Entry (NE)',
    description: 'Respondent enters a numerical value',
    build: (id) => [numeric(id, 'How many people live in your household?', { min: 1, max: 20 })],
  },
  {
    key: 'text-entry',
    no: 5,
    category: 'basic',
    name: 'Text Entry',
    description: 'Short text-based response',
    build: (id) => [open(id, 'What is the name of your favourite brand?', { maxLength: 200 })],
  },
  {
    key: 'long-text',
    no: 6,
    category: 'basic',
    name: 'Long Text Entry',
    description: 'Detailed written response',
    build: (id) => [open(id, 'Please describe your experience in detail.', { multiline: true, maxLength: 5000 })],
  },
  {
    key: 'dropdown',
    no: 7,
    category: 'basic',
    name: 'Dropdown',
    description: 'Select one option from a dropdown list',
    build: (id) => [single(id, 'Which region do you live in?', items(5, 'Region'), { display: 'dropdown' })],
  },
  {
    key: 'multi-dropdown',
    no: 8,
    category: 'basic',
    name: 'Multi-Select Dropdown',
    description: 'Select multiple options from a dropdown',
    build: (id) => [multi(id, 'Which of these brands have you heard of?', items(6, 'Brand'), { display: 'dropdown' })],
  },
  {
    key: 'yes-no',
    no: 9,
    category: 'basic',
    name: 'Yes/No',
    description: 'Binary response',
    build: (id) => [single(id, 'Have you bought this product in the last month?', opts('Yes', 'No'))],
  },
  {
    key: 'true-false',
    no: 10,
    category: 'basic',
    name: 'True/False',
    description: 'Select true or false',
    build: (id) => [single(id, 'The statement below is true for me.', opts('True', 'False'))],
  },

  // ---- 2. Rating and scale ----
  {
    key: 'likert',
    no: 14,
    category: 'rating',
    name: 'Likert Scale',
    description: 'Strongly Agree to Strongly Disagree',
    build: (id) => [single(id, 'How much do you agree with this statement?', AGREE5)],
  },
  {
    key: 'satisfaction',
    no: 15,
    category: 'rating',
    name: 'Satisfaction Scale',
    description: 'Very Satisfied to Very Dissatisfied',
    build: (id) => [
      single(
        id,
        'How satisfied are you with our service?',
        scaleOpts('Very satisfied', 'Satisfied', 'Neither satisfied nor dissatisfied', 'Dissatisfied', 'Very dissatisfied'),
      ),
    ],
  },
  {
    key: 'importance',
    no: 16,
    category: 'rating',
    name: 'Importance Scale',
    description: 'Extremely Important to Not Important',
    build: (id) => [
      single(
        id,
        'How important is price when you choose a brand?',
        scaleOpts('Extremely important', 'Very important', 'Moderately important', 'Slightly important', 'Not important'),
      ),
    ],
  },
  {
    key: 'agreement',
    no: 17,
    category: 'rating',
    name: 'Agreement Scale',
    description: 'Agreement measurement',
    build: (id) => [single(id, 'To what extent do you agree with this statement?', AGREE7)],
  },
  {
    key: 'frequency',
    no: 18,
    category: 'rating',
    name: 'Frequency Scale',
    description: 'Always to Never',
    build: (id) => [single(id, 'How often do you shop online?', scaleOpts('Always', 'Often', 'Sometimes', 'Rarely', 'Never'))],
  },
  {
    key: 'purchase-intent',
    no: 19,
    category: 'rating',
    name: 'Purchase Intent Scale',
    description: 'Definitely Would Buy to Definitely Would Not Buy',
    build: (id) => [
      single(
        id,
        'If this product were available, how likely would you be to buy it?',
        scaleOpts(
          'Definitely would buy',
          'Probably would buy',
          'Might or might not buy',
          'Probably would not buy',
          'Definitely would not buy',
        ),
      ),
    ],
  },
  {
    key: 'numeric-rating',
    no: 20,
    category: 'rating',
    name: 'Numeric Rating Scale',
    description: 'Rate from 1–5, 1–7, 1–10, etc.',
    build: (id) => [
      scale(id, 'On a scale of 1 to 10, how would you rate it?', { min: 1, max: 10, minLabel: 'Very poor', maxLabel: 'Excellent' }),
    ],
  },
  {
    key: 'star-rating',
    no: 21,
    category: 'rating',
    name: 'Star Rating',
    description: 'Rate using stars',
    build: (id) => [scale(id, 'How many stars would you give it?', { min: 1, max: 5, display: 'stars' })],
  },
  {
    key: 'semantic-differential',
    no: 22,
    category: 'rating',
    name: 'Semantic Differential Scale',
    description: 'Opposing attributes, e.g. Modern vs Traditional',
    build: (id) => [
      grid(
        id,
        'Where would you place the brand between each pair of words?',
        rows('Modern … Traditional', 'Expensive … Affordable', 'Serious … Fun'),
        scaleOpts('1', '2', '3', '4', '5', '6', '7'),
      ),
    ],
  },
  {
    key: 'bipolar',
    no: 23,
    category: 'rating',
    name: 'Bipolar Scale',
    description: 'Measure between two opposing characteristics',
    build: (id) => [scale(id, 'How would you describe the product?', { min: -3, max: 3, minLabel: 'Very weak', maxLabel: 'Very strong' })],
  },
  {
    key: 'slider',
    no: 24,
    category: 'rating',
    name: 'Slider Scale',
    description: 'Drag a slider to indicate a value',
    build: (id) => [
      numeric(id, 'Move the slider to show how much you like it.', {
        min: 0,
        max: 100,
        display: 'slider',
        step: 1,
        minLabel: 'Not at all',
        maxLabel: 'Very much',
      }),
    ],
  },
  {
    key: 'vas',
    no: 25,
    category: 'rating',
    name: 'Visual Analogue Scale (VAS)',
    description: 'Respondent marks a point on a continuous line',
    build: (id) => [
      numeric(id, 'Mark a point on the line that shows how you feel.', {
        min: 0,
        max: 100,
        integer: false,
        display: 'slider',
        step: 0.1,
        minLabel: 'Not at all',
        maxLabel: 'Extremely',
      }),
    ],
  },

  // ---- 3. Ranking and comparative ----
  {
    key: 'ranking',
    no: 26,
    category: 'ranking',
    name: 'Ranking',
    description: 'Rank options in order of preference',
    build: (id) => [ranking(id, 'Please rank these in order of preference.', items(4))],
  },
  {
    key: 'drag-ranking',
    no: 27,
    category: 'ranking',
    name: 'Drag & Drop Ranking',
    description: 'Reorder options by dragging',
    build: (id) => [ranking(id, 'Drag the items into your order of preference.', items(5, 'Item'))],
  },
  {
    key: 'first-preference',
    no: 28,
    category: 'ranking',
    name: 'First Preference',
    description: 'Select the most preferred option',
    build: (id) => [single(id, 'Which one do you prefer most?', items(4))],
  },
  {
    key: 'top3',
    no: 29,
    category: 'ranking',
    name: 'Top 3 Selection',
    description: 'Select the top three options',
    build: (id) => [multi(id, 'Select your top three.', items(6), { minSelected: 3, maxSelected: 3 })],
  },
  {
    key: 'pairwise',
    no: 30,
    category: 'ranking',
    name: 'Pairwise Comparison',
    description: 'Compare two options',
    build: (id) => [single(id, 'Which of these two do you prefer?', opts('Option A', 'Option B'))],
  },
  {
    key: 'maxdiff',
    no: 31,
    category: 'ranking',
    name: 'Best-Worst Scaling (MaxDiff)',
    description: 'Select best and worst options',
    build: (id) => [
      { id, type: 'maxdiff', text: 'Which of these matters MOST and which LEAST to you?', options: items(8, 'Item') } as QuestionInput,
    ],
  },
  {
    key: 'constant-sum',
    no: 32,
    category: 'ranking',
    name: 'Constant Sum',
    description: 'Distribute 100 points across options',
    build: (id) => [sum(id, 'Share 100 points across these according to their importance.', items(4), 100, 'points')],
  },
  {
    key: 'allocation',
    no: 33,
    category: 'ranking',
    name: 'Allocation Question',
    description: 'Allocate a fixed number of points or units',
    build: (id) => [sum(id, 'Of your next 10 purchases, how many would go to each brand?', items(4, 'Brand'), 10, 'purchases')],
  },
  {
    key: 'preference-test',
    no: 34,
    category: 'ranking',
    name: 'Preference Testing',
    description: 'Choose between alternative products or brands',
    note: 'Add a picture to each option to compare designs or packs.',
    build: (id) => [single(id, 'Which of these would you choose?', opts('Product A', 'Product B', 'Product C'))],
  },

  // ---- 4. Matrix and grid ----
  {
    key: 'single-matrix',
    no: 35,
    category: 'matrix',
    name: 'Single Answer Matrix',
    description: 'One answer per row',
    build: (id) => [grid(id, 'Please answer for each item.', rows('Item 1', 'Item 2', 'Item 3'), opts('Yes', 'No', 'Not sure'))],
  },
  {
    key: 'multi-matrix',
    no: 36,
    category: 'matrix',
    name: 'Multiple Answer Matrix',
    description: 'Multiple answers per row',
    note: 'Built as one multiple choice question per row, shown together on the page.',
    build: (id) =>
      many(id, ['Item 1: which of these apply?', 'Item 2: which of these apply?', 'Item 3: which of these apply?'], (q, t) =>
        multi(q, t, opts('Quality', 'Price', 'Design', 'Service')),
      ),
  },
  {
    key: 'likert-matrix',
    no: 37,
    category: 'matrix',
    name: 'Likert Matrix',
    description: 'Agreement scale across multiple statements',
    build: (id) => [grid(id, 'How much do you agree with each statement?', rows('Statement 1', 'Statement 2', 'Statement 3'), AGREE5)],
  },
  {
    key: 'rating-matrix',
    no: 38,
    category: 'matrix',
    name: 'Rating Matrix',
    description: 'Rate multiple items using the same scale',
    build: (id) => [grid(id, 'Please rate each of the following.', rows('Item 1', 'Item 2', 'Item 3'), RATE5)],
  },
  {
    key: 'numeric-matrix',
    no: 39,
    category: 'matrix',
    name: 'Numeric Matrix',
    description: 'Enter numbers for multiple items',
    note: 'Built as one numeric question per item, shown together on the page.',
    build: (id) => many(id, ['Item 1: how many?', 'Item 2: how many?', 'Item 3: how many?'], (q, t) => numeric(q, t, { min: 0 })),
  },
  {
    key: 'text-matrix',
    no: 40,
    category: 'matrix',
    name: 'Text Matrix',
    description: 'Enter text against multiple attributes',
    note: 'Built as one text question per attribute, shown together on the page.',
    build: (id) => many(id, ['Attribute 1', 'Attribute 2', 'Attribute 3'], (q, t) => open(q, t, { maxLength: 500 })),
  },
  {
    key: 'dropdown-matrix',
    no: 41,
    category: 'matrix',
    name: 'Dropdown Matrix',
    description: 'Dropdown selection for each row',
    note: 'Built as one dropdown per row, shown together on the page.',
    build: (id) => many(id, ['Item 1', 'Item 2', 'Item 3'], (q, t) => single(q, t, RATE5, { display: 'dropdown' })),
  },
  {
    key: 'ranking-matrix',
    no: 42,
    category: 'matrix',
    name: 'Ranking Matrix',
    description: 'Rank multiple items within a grid',
    build: (id) => [ranking(id, 'Rank these items from first to last.', items(5, 'Item'))],
  },

  // ---- 5. Advanced market research ----
  {
    key: 'grid',
    no: 43,
    category: 'advanced',
    name: 'Grid Question',
    description: 'Multiple statements with common response options',
    build: (id) => [grid(id, 'Please answer for each statement.', rows('Statement 1', 'Statement 2', 'Statement 3'), AGREE5)],
  },
  {
    key: 'looping',
    no: 44,
    category: 'advanced',
    name: 'Looping Question',
    description: 'Repeat a question for each selected item',
    note: 'Put the questions to repeat on their own page, then add a loop with this question as its source in Survey settings > Loops.',
    build: (id) => [multi(id, 'Which of these brands have you used?', items(4, 'Brand'))],
  },
  {
    key: 'conjoint',
    no: 45,
    category: 'advanced',
    name: 'Conjoint Analysis',
    description: 'Evaluate product attribute combinations',
    build: (id) => [conjoint(id)],
  },
  {
    key: 'cbc',
    no: 46,
    category: 'advanced',
    name: 'Choice-Based Conjoint (CBC)',
    description: 'Choose between product concepts',
    build: (id) => [conjoint(id)],
  },
  {
    key: 'adaptive-conjoint',
    no: 47,
    category: 'advanced',
    name: 'Adaptive Conjoint',
    description: 'Dynamic conjoint based on previous responses',
    note: 'Runs as choice-based conjoint with a balanced design; tasks do not yet adapt to earlier answers.',
    build: (id) => [conjoint(id)],
  },
  {
    key: 'van-westendorp',
    no: 48,
    category: 'advanced',
    name: 'Van Westendorp Pricing',
    description: 'Measure acceptable price ranges',
    build: (id) =>
      many(
        id,
        [
          'At what price would it be so cheap that you would doubt its quality?',
          'At what price would it be a bargain?',
          'At what price would it start to seem expensive?',
          'At what price would it be too expensive to consider?',
        ],
        (q, t) => numeric(q, t, { min: 0, integer: false, unit: '$' }),
      ),
  },
  {
    key: 'gabor-granger',
    no: 49,
    category: 'advanced',
    name: 'Gabor-Granger Pricing',
    description: 'Measure purchase intention at different prices',
    build: (id) => [
      grid(
        id,
        'How likely would you be to buy it at each of these prices?',
        rows('$5', '$10', '$15', '$20'),
        scaleOpts('Definitely would buy', 'Probably would buy', 'Might or might not', 'Probably would not', 'Definitely would not'),
      ),
    ],
  },
  {
    key: 'turf',
    no: 50,
    category: 'advanced',
    name: 'TURF Analysis Input',
    description: 'Measure combinations of product or brand appeal',
    build: (id) => [multi(id, 'Which of these flavours would you buy? Select all that apply.', items(8, 'Flavour'))],
  },
  {
    key: 'monadic',
    no: 51,
    category: 'advanced',
    name: 'Monadic Testing',
    description: 'Evaluate one concept independently',
    note: 'Add the concept picture or video to the information element.',
    build: (id) => [
      info(suffix(id, 0), 'Please read the following idea carefully.'),
      single(
        suffix(id, 1),
        'How likely would you be to buy it?',
        scaleOpts(
          'Definitely would buy',
          'Probably would buy',
          'Might or might not buy',
          'Probably would not buy',
          'Definitely would not buy',
        ),
      ),
    ],
  },
  {
    key: 'sequential-monadic',
    no: 52,
    category: 'advanced',
    name: 'Sequential Monadic',
    description: 'Evaluate multiple concepts sequentially',
    note: 'Repeat this on one page per concept and put those pages in a randomized block (Survey settings > Blocks).',
    build: (id) => [
      info(suffix(id, 0), 'Here is the next idea.'),
      scale(suffix(id, 1), 'Overall, how much do you like this idea?', { min: 1, max: 10, minLabel: 'Not at all', maxLabel: 'Very much' }),
    ],
  },
  {
    key: 'concept-test',
    no: 53,
    category: 'advanced',
    name: 'Concept Testing',
    description: 'Evaluate product or service concepts',
    build: (id) => [
      info(suffix(id, 0), 'Please read the following concept.'),
      grid(
        suffix(id, 1),
        'How would you rate this concept on each of the following?',
        rows('Appeal', 'Uniqueness', 'Believability', 'Relevance to me'),
        RATE5,
      ),
    ],
  },
  {
    key: 'brand-funnel',
    no: 54,
    category: 'advanced',
    name: 'Brand Funnel',
    description: 'Awareness, consideration, trial and usage',
    build: (id) => [
      grid(
        id,
        'Which statement best describes each brand for you?',
        rows('Brand A', 'Brand B', 'Brand C'),
        opts('Never heard of it', 'Heard of it only', 'Would consider it', 'Have tried it', 'Use it regularly'),
      ),
    ],
  },
  {
    key: 'nps',
    no: 55,
    category: 'advanced',
    name: 'NPS Question',
    description: 'Likelihood to recommend on a 0–10 scale',
    build: (id) => [
      scale(id, 'How likely are you to recommend us to a friend or colleague?', {
        min: 0,
        max: 10,
        nps: true,
        minLabel: 'Not at all likely',
        maxLabel: 'Extremely likely',
      }),
    ],
  },
  {
    key: 'ces',
    no: 56,
    category: 'advanced',
    name: 'CES Question',
    description: 'Customer Effort Score',
    build: (id) => [
      scale(id, 'How easy was it to get your issue resolved?', { min: 1, max: 7, minLabel: 'Very difficult', maxLabel: 'Very easy' }),
    ],
  },
  {
    key: 'csat',
    no: 57,
    category: 'advanced',
    name: 'CSAT Question',
    description: 'Customer Satisfaction Score',
    build: (id) => [
      scale(id, 'How satisfied were you with your experience?', {
        min: 1,
        max: 5,
        minLabel: 'Very dissatisfied',
        maxLabel: 'Very satisfied',
      }),
    ],
  },

  // ---- 6. Visual and interactive ----
  {
    key: 'image-select',
    no: 58,
    category: 'visual',
    name: 'Image Selection',
    description: 'Select an answer using images',
    note: 'Upload a picture for each option.',
    build: (id) => [single(id, 'Which design do you like best?', opts('Design A', 'Design B', 'Design C'))],
  },
  {
    key: 'image-rating',
    no: 59,
    category: 'visual',
    name: 'Image Rating',
    description: 'Rate images',
    note: 'Upload the picture as the question media.',
    build: (id) => [scale(id, 'How much do you like this picture?', { min: 1, max: 5, display: 'stars' })],
  },
  {
    key: 'image-ranking',
    no: 60,
    category: 'visual',
    name: 'Image Ranking',
    description: 'Rank images',
    note: 'Upload a picture for each item.',
    build: (id) => [ranking(id, 'Rank these designs from best to worst.', opts('Design A', 'Design B', 'Design C'))],
  },
  {
    key: 'video-eval',
    no: 61,
    category: 'visual',
    name: 'Video Evaluation',
    description: 'Watch and evaluate a video',
    note: 'Upload the video as the question media; tick "must play to the end" if needed.',
    build: (id) => [
      scale(id, 'Please watch the video. How much did you like it?', { min: 1, max: 10, minLabel: 'Not at all', maxLabel: 'Very much' }),
    ],
  },
  {
    key: 'audio-eval',
    no: 62,
    category: 'visual',
    name: 'Audio Evaluation',
    description: 'Listen and evaluate audio',
    note: 'Upload the audio clip as the question media.',
    build: (id) => [
      scale(id, 'Please listen to the clip. How much did you like it?', { min: 1, max: 10, minLabel: 'Not at all', maxLabel: 'Very much' }),
    ],
  },
  {
    key: 'hotspot',
    no: 63,
    category: 'visual',
    name: 'Hotspot',
    description: 'Click a specific area of an image',
    note: 'Upload the picture and draw the areas.',
    build: (id) => [hotspot(id, 'Click the part of the picture that catches your eye first.', { maxSelected: 1 })],
  },
  {
    key: 'heatmap',
    no: 64,
    category: 'visual',
    name: 'Heatmap',
    description: 'Select areas of interest on an image',
    note: 'Upload the picture and draw the areas; results show how often each area was chosen.',
    build: (id) => [hotspot(id, 'Click all the areas of the picture you find interesting.')],
  },
  {
    key: 'click-map',
    no: 65,
    category: 'visual',
    name: 'Click Map',
    description: 'Click a location on a map or image',
    note: 'Upload the map and draw the clickable areas.',
    build: (id) => [hotspot(id, 'Click where you usually shop.', { maxSelected: 1 })],
  },
  {
    key: 'image-annotation',
    no: 66,
    category: 'visual',
    name: 'Image Annotation',
    description: 'Mark or annotate an image',
    note: 'Respondents mark areas; the comment box captures their notes.',
    build: (id) => [
      hotspot(suffix(id, 0), 'Mark the parts of the picture you would change.'),
      open(suffix(id, 1), 'What would you change about them?', { multiline: true }),
    ],
  },
  {
    key: 'highlight',
    no: 67,
    category: 'visual',
    name: 'Highlight Selection',
    description: 'Highlight relevant text',
    note: 'Each phrase of the text is an option the respondent can highlight.',
    build: (id) => [multi(id, 'Select the phrases that appeal to you.', opts('Phrase 1', 'Phrase 2', 'Phrase 3', 'Phrase 4'))],
  },
  {
    key: 'swipe',
    no: 68,
    category: 'visual',
    name: 'Swipe Selection',
    description: 'Swipe to choose between alternatives',
    build: (id) => [single(id, 'Would you choose this?', opts('Yes, I like it', 'No, not for me'))],
  },

  // ---- 7. Specialized ----
  {
    key: 'date',
    no: 69,
    category: 'special',
    name: 'Date Entry',
    description: 'Enter a date',
    build: (id) => [open(id, 'When did you last buy it?', { format: 'date', maxLength: 10 })],
  },
  {
    key: 'time',
    no: 70,
    category: 'special',
    name: 'Time Entry',
    description: 'Enter a time',
    build: (id) => [open(id, 'At what time do you usually have breakfast?', { format: 'time', maxLength: 5 })],
  },
  {
    key: 'datetime',
    no: 71,
    category: 'special',
    name: 'Date & Time',
    description: 'Enter date and time',
    build: (id) => [open(id, 'When did the visit take place?', { format: 'datetime', maxLength: 16 })],
  },
  {
    key: 'address',
    no: 72,
    category: 'special',
    name: 'Address Entry',
    description: 'Capture address details',
    build: (id) => many(id, ['Street address', 'City', 'Postal code', 'Country'], (q, t) => open(q, t, { maxLength: 200 })),
  },
  {
    key: 'location',
    no: 73,
    category: 'special',
    name: 'Location / GPS',
    description: 'Capture geographic location',
    note: 'The browser asks the respondent to share their location; they can also type it.',
    build: (id) => [open(id, 'Please share your current location.', { format: 'location', maxLength: 100 })],
  },
  {
    key: 'email',
    no: 74,
    category: 'special',
    name: 'Email Entry',
    description: 'Collect email address',
    build: (id) => [open(id, 'What is your email address?', { format: 'email', maxLength: 254 })],
  },
  {
    key: 'phone',
    no: 75,
    category: 'special',
    name: 'Phone Entry',
    description: 'Collect phone number',
    build: (id) => [open(id, 'What is your phone number?', { format: 'phone', maxLength: 30 })],
  },
  {
    key: 'file-upload',
    no: 76,
    category: 'special',
    name: 'File Upload',
    description: 'Upload a document or file',
    note: 'Accepts pictures and photos of documents (shrunk and stripped of location data on the device).',
    build: (id) => [{ id, type: 'photo', text: 'Please upload a photo of your receipt.' } as QuestionInput],
  },
  {
    key: 'signature',
    no: 77,
    category: 'special',
    name: 'Signature',
    description: 'Capture respondent signature',
    build: (id) => [{ id, type: 'signature', text: 'Please sign to confirm' } as QuestionInput],
  },
  {
    key: 'contact',
    no: 78,
    category: 'special',
    name: 'Contact Information',
    description: 'Capture multiple personal details',
    build: (id) => [
      open(suffix(id, 0), 'Full name', { maxLength: 200 }),
      open(suffix(id, 1), 'Email address', { format: 'email', maxLength: 254 }),
      open(suffix(id, 2), 'Phone number', { format: 'phone', maxLength: 30 }),
    ],
  },
  {
    key: 'calendar',
    no: 79,
    category: 'special',
    name: 'Calendar Selection',
    description: 'Select a date from a calendar',
    build: (id) => [open(id, 'Please pick a date for the appointment.', { format: 'date', maxLength: 10 })],
  },
  {
    key: 'table-entry',
    no: 80,
    category: 'special',
    name: 'Table Entry',
    description: 'Enter information in tabular format',
    note: 'Built as one entry per column, shown together on the page.',
    build: (id) => many(id, ['Product', 'Quantity', 'Price paid'], (q, t) => open(q, t, { maxLength: 200 })),
  },
];

/** The library entry a question was created from, if any. */
export function catalogTypeOf(key: string | undefined): CatalogType | undefined {
  return key ? QUESTION_CATALOG.find((t) => t.key === key) : undefined;
}

/** Build a library type's question(s) with free variable names, tagged with the type. */
export function buildCatalogQuestions(key: string, id: string): QuestionInput[] {
  const t = catalogTypeOf(key);
  if (!t) return [];
  return t.build(id).map((q) => ({ ...q, catalogType: t.key }) as QuestionInput);
}
