// WALLORA content policy:
// - devotional/religious content stays out of discovery feeds, but an explicit
//   typed search may bypass that discovery-only filter;
// - real-person/glamour imagery is always blocked;
// - clearly illustrated/anime characters are allowed unless sexualised.

const DEVOTIONAL_BLOCKED = [
  'shiva', 'shiv', 'mahadev', 'mahakal', 'bholenath', 'shivling',
  'hanuman', 'bajrang', 'maruti',
  'krishna', 'radha', 'kanha',
  'ganesh', 'ganesha', 'vinayaka',
  'durga', 'lakshmi', 'saraswati', 'kali mata', 'vaishno',
  'vishnu', 'rama', 'sita', 'ayodhya', 'ram mandir',
  'devotional', 'spiritual', 'deity', 'god ', 'gods', 'goddess',
  'temple', 'mandir', 'bhakti', 'bhajan', 'aarti', 'pooja', 'puja',
  'sai baba', 'gurudwara', 'jyotirlinga', 'kedarnath', 'badrinath',
];

/** Person/glamour vocabulary. It is blocked unless illustration context is clear. */
export const PERSON_HARD_BLOCK = [
  'woman', 'women', 'girl', 'girls', 'lady', 'ladies', 'female', 'girlfriend',
  'actress', 'actresses', 'celebrity', 'celebrities', 'supermodel', 'fashion model',
  'portrait', 'portraits', 'fashion photography', 'beauty photography', 'wedding photography',
  'real girl', 'cosplay', 'photoshoot', 'photo shoot', 'selfie', 'bride', 'bridal',
  'pin-up', 'pinup', 'vogue', 'beach body', 'makeup look', 'blonde', 'redhead girl',
  'couple kissing', 'romantic couple', 'portrait photography', 'fashion photography',
];

/** Terms that strongly indicate real-person/glamour photography, even with an anime/costume word nearby. */
const REAL_PHOTO_HARD_BLOCK = [
  'real girl', 'cosplay', 'selfie', 'photoshoot', 'photo shoot', 'actress', 'actresses',
  'celebrity', 'celebrities', 'supermodel', 'fashion model', 'bride', 'bridal', 'vogue',
  'makeup look', 'portrait photography', 'fashion photography', 'beauty photography', 'wedding photography',
  'glamour photography',
];

/** Blocked even when artwork is illustrated. */
const SEXUAL_HARD_BLOCK = [
  'bikini', 'lingerie', 'swimsuit', 'hot girl', 'sexy', 'sensual', 'erotic',
  'nsfw', 'ecchi', 'hentai', 'nude', 'nudity', 'adult content',
];

const ILLUSTRATION_HINTS = [
  'anime', 'manga', 'illustration', 'illustrated', 'digital art', 'concept art',
  'cartoon', '2d art', '3d render', 'cgi', 'comic', 'character art', 'fantasy art',
  'vector art', 'drawing', 'painted', 'painting',
];

function extraBlocked(): string[] {
  return (process.env.WALLORA_EXCLUDE_EXTRA ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function haystack(parts: (string | null | undefined)[]): string {
  return ` ${parts.filter(Boolean).join(' ').toLowerCase()} `;
}

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function isHardBlockedText(text: string): boolean {
  if (includesAny(text, [...SEXUAL_HARD_BLOCK, ...REAL_PHOTO_HARD_BLOCK])) return true;
  const mentionsPerson = includesAny(text, PERSON_HARD_BLOCK);
  const clearlyIllustrated = includesAny(text, ILLUSTRATION_HINTS);
  return mentionsPerson && !clearlyIllustrated;
}

function isPersonCategory(value: string | null | undefined): boolean {
  const text = haystack([value]);
  const personCategory = /\b(people|portraits?|fashion|beauty|models?|celebrities|photography)\b/.test(text);
  return personCategory && !includesAny(text, ILLUSTRATION_HINTS);
}

/** True for real-person/glamour or sexualised content; never bypassed by search. */
export function isHardBlockedWallpaper(w: {
  title?: string | null;
  category?: string | null;
  tags?: string | null;
}): boolean {
  return isPersonCategory(w.category) || isHardBlockedText(haystack([w.title, w.category, w.tags]));
}

/** True when a wallpaper should be hidden from normal discovery feeds. */
export function isExcludedWallpaper(w: {
  title?: string | null;
  category?: string | null;
  tags?: string | null;
}): boolean {
  const text = haystack([w.title, w.category, w.tags]);
  if (isPersonCategory(w.category) || isHardBlockedText(text)) return true;
  return includesAny(text, [...DEVOTIONAL_BLOCKED, ...extraBlocked()]);
}

/** True when an entire category should stay out of discovery. */
export function isExcludedCategory(name: string | null | undefined): boolean {
  if (!name) return false;
  const text = haystack([name]);
  if (isPersonCategory(name) || isHardBlockedText(text)) return true;
  return includesAny(text, [...DEVOTIONAL_BLOCKED, ...extraBlocked()]);
}

export function filterWallpapers<T extends { title?: string | null; category?: string | null; tags?: string | null }>(
  list: T[],
): T[] {
  return list.filter((wallpaper) => !isExcludedWallpaper(wallpaper));
}

export function filterCategories<T extends { name: string }>(list: T[]): T[] {
  return list.filter((category) => !isExcludedCategory(category.name));
}
