import { seedOf } from './utils';

export interface WallpaperCopyInput {
  source?: string | null;
  source_id?: string | null;
  title?: string | null;
  category?: string | null;
  tags?: string | null;
  width?: number | null;
  height?: number | null;
  resolution?: string | null;
}

function clean(value: string | null | undefined, fallback = ''): string {
  return String(value ?? fallback).replace(/\s+/g, ' ').trim();
}

function sentenceCut(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) {
    if (/[.!?]$/.test(normalized) || normalized.length === max) return normalized;
    return `${normalized}.`;
  }
  const clipped = normalized.slice(0, Math.max(1, max - 1));
  const boundary = clipped.lastIndexOf(' ');
  return `${(boundary > max * 0.68 ? clipped.slice(0, boundary) : clipped).replace(/[\s,;:—-]+$/, '')}.`;
}

function tagList(tags: string | null | undefined): string[] {
  const seen = new Set<string>();
  return clean(tags)
    .split(/[,|;/]+/)
    .map((tag) => tag.trim())
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (!key || key.length < 3 || key.length > 28 || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}

function detailPhrase(tags: string[], category: string): string {
  if (tags.length >= 2) return `${tags[0]} and ${tags[1]}`;
  if (tags.length === 1) return `${tags[0]} details`;
  return `${category.toLowerCase()} styling`;
}

/**
 * Deterministic, metadata-aware wallpaper copy.
 *
 * It deliberately does not use a single name-swapping SEO template. The source
 * id selects different sentence structures while the category, tags, exact
 * dimensions, orientation and intended screen fit supply the actual details.
 * The result is stable between renders and does not consume any external API.
 */
export function uniqueWallpaperDescription(w: WallpaperCopyInput, max = 158): string {
  const title = clean(w.title, 'Untitled wallpaper').slice(0, 140) || 'Untitled wallpaper';
  const category = clean(w.category, 'Aesthetic').slice(0, 80) || 'Aesthetic';
  const rawWidth = Math.round(Number(w.width));
  const rawHeight = Math.round(Number(w.height));
  const width = Number.isFinite(rawWidth) && rawWidth > 0 && rawWidth <= 20000 ? rawWidth : 0;
  const height = Number.isFinite(rawHeight) && rawHeight > 0 && rawHeight <= 20000 ? rawHeight : 0;
  const resolutionMatch = clean(w.resolution).match(/^(\d{3,5})x(\d{3,5})$/i);
  const explicitWidth = resolutionMatch ? Number(resolutionMatch[1]) : 0;
  const explicitHeight = resolutionMatch ? Number(resolutionMatch[2]) : 0;
  const explicitResolution = explicitWidth > 0 && explicitWidth <= 20000 && explicitHeight > 0 && explicitHeight <= 20000
    ? `${explicitWidth}x${explicitHeight}`
    : null;
  const resolution = width && height ? `${width}x${height}` : explicitResolution;
  const orientation = width && height ? (height > width ? 'portrait' : width > height ? 'landscape' : 'square') : 'versatile';
  const screen = orientation === 'portrait' ? 'phone lock screen' : orientation === 'landscape' ? 'desktop or laptop' : 'phone, tablet or desktop';
  const tags = tagList(w.tags);
  const details = detailPhrase(tags, category);
  const highRes = Math.max(width, height) >= 3840 && Math.min(width, height) >= 2160;
  const clarity = highRes ? '4K-level detail' : 'clear visual detail';
  const key = `${clean(w.source)}:${clean(w.source_id)}:${title}:${resolution ?? 'original'}`;
  const seed = seedOf(key);

  const openings = [
    `${title} brings ${details} into a balanced ${orientation} composition.`,
    `Built around ${details}, ${title} is a polished ${category.toLowerCase()} background.`,
    `Give your ${screen} a fresh look with ${title}, featuring ${details}.`,
    `${title} pairs a ${orientation} layout with ${details} for a focused screen refresh.`,
    `For fans of ${category.toLowerCase()} imagery, ${title} highlights ${details}.`,
    `A strong ${orientation} pick, ${title} keeps ${details} clear without crowding your screen.`,
    `${title} offers a refined take on ${category.toLowerCase()} art, shaped by ${details}.`,
    `Refresh your display with ${title}, a ${orientation} design centred on ${details}.`,
    `The ${details} in ${title} make it a distinctive ${category.toLowerCase()} wallpaper.`,
    `${title} turns ${details} into a screen-ready ${orientation} background.`,
    `Designed for a clean visual impact, ${title} combines ${details} with a ${orientation} frame.`,
    `Explore ${title}, a carefully selected ${category.toLowerCase()} image with ${details}.`,
  ];

  const endings = resolution
    ? [
        `Open the ${resolution} image for your ${screen}.`,
        `Its ${resolution} file keeps ${clarity} across compatible screens.`,
        `The ${resolution} format is ready for a crisp ${screen} setup.`,
        `Save the ${resolution} image for a sharp, uncluttered background.`,
        `Use the ${resolution} version to update your ${screen}.`,
        `Available in ${resolution}, it is an easy fit for a modern ${screen}.`,
        `The ${resolution} download preserves detail for everyday screen use.`,
        `Set the ${resolution} image as a clear backdrop on your ${screen}.`,
      ]
    : [
        `Open the original image for your ${screen}.`,
        `Use the source image as a backdrop on a compatible screen.`,
        `Save the original file and check its fit on your display.`,
        `Preview the full image before setting it on your screen.`,
      ];

  const opening = openings[seed % openings.length];
  const ending = endings[Math.floor(seed / openings.length) % endings.length];
  const rawId = clean(w.source_id, String(seed)).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100) || String(seed);
  // The full bounded source id makes the catalog reference unique even when
  // two long ids happen to share the same prefix, suffix and length.
  const reference = `Catalog ref ${clean(w.source, 'wall').slice(0, 4).toUpperCase()}-${rawId}.`;
  const body = sentenceCut(`${opening} ${ending}`, Math.max(24, max - reference.length - 1));
  return `${body} ${reference}`;
}

/** Recognises the old one-size-fits-all fallback so it can be replaced live. */
export function isLegacyWallpaperDescription(value: string | null | undefined): boolean {
  const text = clean(value).toLowerCase();
  return (
    (text.startsWith('download "') && text.includes('free, no signup, instant download')) ||
    (text.includes('a stunning ') && text.includes('wallpaper for desktop & mobile'))
  );
}
