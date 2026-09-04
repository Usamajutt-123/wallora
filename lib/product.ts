/* Single source of truth for public-facing site info.
   IMPORTANT: never put placeholder emails/links here — launch check is part of deploy. */
export const SITE = {
  name: 'Wallora',
  tagline: 'Find a wallpaper that feels like you.',
  description: 'A curated wallpaper catalog for different screens, moods and styles.',
  // Same inbox serves Contact, DMCA and Privacy (owner-confirmed).
  emailContact: 'usamajutt99877@gmail.com',
  emailDMCA: 'usamajutt99877@gmail.com',
  emailPrivacy: 'usamajutt99877@gmail.com',
  // Only add a social profile after the owner confirms that it exists.
  socials: [] as { label: string; url: string }[],
  lastUpdated: 'September 3, 2026',
};
