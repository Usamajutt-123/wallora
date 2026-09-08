import { listPosts } from '@/lib/blog';
import { siteUrl } from '@/lib/seo';

export const revalidate = 3600; // the blog changes at most a few times a day

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** RSS 2.0 feed for the blog — readers and aggregators subscribe here. */
export async function GET(): Promise<Response> {
  const posts = (await listPosts()).slice(0, 50);
  const items = posts
    .map((p) => {
      const link = siteUrl(`/blog/${p.slug}`);
      const pubDate = (() => {
        const d = new Date(p.date);
        return Number.isFinite(d.getTime()) ? d.toUTCString() : new Date().toUTCString();
      })();
      return (
        `    <item>\n` +
        `      <title>${esc(p.title)}</title>\n` +
        `      <link>${esc(link)}</link>\n` +
        `      <guid isPermaLink="true">${esc(link)}</guid>\n` +
        `      <description>${esc(p.excerpt || p.description)}</description>\n` +
        `      <pubDate>${esc(pubDate)}</pubDate>\n` +
        (p.category ? `      <category>${esc(p.category)}</category>\n` : '') +
        `    </item>`
      );
    })
    .join('\n');
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rss version="2.0">\n` +
    `  <channel>\n` +
    `    <title>${esc('WALLORA Blog — Guides, Trends & 4K Collections')}</title>\n` +
    `    <link>${esc(siteUrl('/blog'))}</link>\n` +
    `    <description>${esc('Wallpaper guides, 4K collection round-ups and setup tips from WALLORA.')}</description>\n` +
    `    <language>en</language>\n` +
    (items ? `${items}\n` : '') +
    `  </channel>\n` +
    `</rss>\n`;
  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
}
