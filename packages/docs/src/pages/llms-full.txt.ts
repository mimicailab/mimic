import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

function stripMdx(raw: string): string {
  // Remove frontmatter
  let content = raw.replace(/^---[\s\S]*?---\n/, '');

  // Remove import lines
  content = content.replace(/^import .+$/gm, '');

  // Convert CodeBlock components to markdown code fences
  content = content.replace(
    /<CodeBlock\s+lang="([^"]*)"(?:\s+label="([^"]*)")?>\n?([\s\S]*?)<\/CodeBlock>/g,
    (_match, lang, label, code) => {
      const header = label ? `${lang} — ${label}` : lang;
      // Strip span tags but keep text content
      const clean = code.replace(/<span[^>]*>/g, '').replace(/<\/span>/g, '');
      return '```' + header + '\n' + clean.trim() + '\n```';
    },
  );

  // Convert Callout components
  content = content.replace(
    /<Callout\s+type="([^"]*)">\n?([\s\S]*?)<\/Callout>/g,
    (_match, type, inner) => {
      const prefix = type === 'tip' ? 'Tip' : type === 'warn' ? 'Warning' : 'Note';
      const clean = inner
        .replace(/<p>/g, '')
        .replace(/<\/p>/g, '')
        .replace(/<[^>]+>/g, '')
        .trim();
      return `> **${prefix}:** ${clean}`;
    },
  );

  // Convert DocTable — strip wrapper, keep table content as text
  content = content.replace(/<DocTable>/g, '').replace(/<\/DocTable>/g, '');

  // Convert AdapterGrid to simple list
  content = content.replace(
    /<AdapterGrid\s+items=\{(\[[\s\S]*?\])\}\s*\/>/g,
    (_match, items) => {
      try {
        // Simple extraction of name and routes from the items array literal
        const entries: string[] = [];
        const re = /name:\s*"([^"]*)"[^}]*routes:\s*"([^"]*)"/g;
        let m;
        while ((m = re.exec(items)) !== null) {
          entries.push(`- ${m[1]} (${m[2]})`);
        }
        return entries.join('\n');
      } catch {
        return '';
      }
    },
  );

  // Convert Checklist to simple list
  content = content.replace(
    /<Checklist\s+items=\{(\[[\s\S]*?\])\}\s*\/>/g,
    (_match, items) => {
      try {
        const entries: string[] = [];
        const re = /'([^']*)'/g;
        let m;
        while ((m = re.exec(items)) !== null) {
          const clean = m[1].replace(/<[^>]+>/g, '');
          entries.push(`- [ ] ${clean}`);
        }
        return entries.join('\n');
      } catch {
        return '';
      }
    },
  );

  // Strip remaining HTML tags but keep text
  content = content.replace(/<[^>]+>/g, '');

  // Clean up excessive blank lines
  content = content.replace(/\n{3,}/g, '\n\n');

  return content.trim();
}

export const GET: APIRoute = async () => {
  const docs = await getCollection('docs');
  const sorted = docs.sort((a, b) => a.data.order - b.data.order);

  const sections: string[] = [];

  sections.push('# Mimic Documentation\n');
  sections.push(
    '> Mimic is an open-source synthetic environment engine for AI agent development.',
  );
  sections.push(
    '> One persona generates coherent data across every database, API, and MCP server your agent touches.\n',
  );

  for (const entry of sorted) {
    sections.push(`\n---\n\n## ${entry.data.title}\n`);
    sections.push(stripMdx(entry.body ?? ''));
  }

  const body = sections.join('\n');

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
