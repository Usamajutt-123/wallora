import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/seo';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/api/img'],
        disallow: ['/admin', '/api/admin/', '/api/cron/', '/api/track', '/api/wallpapers'],
      },
    ],
    sitemap: siteUrl('/sitemap.xml'),
  };
}
