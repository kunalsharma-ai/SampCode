/**
 * Custom question HTML (client feedback 2026-11). Survey text is otherwise always plain text; HTML a
 * programmer writes for a question goes through this allow-list before it is shown, so it can format
 * the question but never run script, load outside content, link away or collect data.
 */
const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'small',
  'sub',
  'sup',
  'mark',
  'span',
  'div',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'hr',
  'pre',
  'code',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
]);
const ALLOWED_ATTRS = new Set(['class', 'style', 'colspan', 'rowspan', 'align', 'title', 'dir', 'lang']);
/** CSS that could load outside content or cover the page. */
const UNSAFE_STYLE = /url\s*\(|expression\s*\(|@import|position\s*:\s*(fixed|absolute|sticky)|javascript:|behavior\s*:|-moz-binding/i;

/** Sanitized HTML, or null where it cannot be checked (no DOM, e.g. server rendering): show the plain text then. */
export function sanitizeQuestionHtml(html: string): string | null {
  if (typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const clean = (node: Element) => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) {
        // Unknown but harmless containers keep their text; dangerous ones go entirely.
        if (
          [
            'script',
            'style',
            'iframe',
            'object',
            'embed',
            'form',
            'input',
            'button',
            'select',
            'textarea',
            'link',
            'meta',
            'template',
            'svg',
            'math',
            'img',
            'video',
            'audio',
            'source',
            'base',
            'frame',
            'frameset',
          ].includes(tag)
        ) {
          child.remove();
        } else {
          clean(child);
          child.replaceWith(...Array.from(child.childNodes));
        }
        continue;
      }
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase();
        if (!ALLOWED_ATTRS.has(name) || (name === 'style' && UNSAFE_STYLE.test(attr.value))) child.removeAttribute(attr.name);
      }
      clean(child);
    }
  };
  clean(doc.body);
  return doc.body.innerHTML;
}

/** Plain question text as a starting point for its HTML: escaped, paragraphs and line breaks kept. */
export function textToHtml(text: string): string {
  const esc = text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return esc
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}
