export type SourceName = 'nexwall' | 'animepixels' | 'wallhaven' | 'manual' | 'demo';

export interface Wallpaper {
  /** composite id: `${source}:${source_id}` */
  id: string;
  source: SourceName;
  source_id: string;
  title: string;
  category: string | null;
  image_url: string;
  thumb_url: string;
  width: number;
  height: number;
  resolution: string | null;
  tags?: string | null;
  /** AI/template SEO fields (filled by scripts/generate-seo.js when Supabase connected) */
  seo_title?: string | null;
  seo_description?: string | null;
  seo_keywords?: string | null;
  seo_alt?: string | null;
  source_url?: string | null; // attribution / original post link
  views: number;
  downloads: number;
  is_featured: boolean;
  is_premium: boolean;
  created_at: string;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  cover_url: string | null;
  wallpaper_count: number;
  is_premium: boolean;
  source: string;
}

export interface Paged<T> {
  data: T[];
  page: number;
  lastPage: number;
  total: number;
}

export type SortMode = 'newest' | 'popular' | 'random';

export interface DashboardStats {
  demo: boolean;
  totals: {
    walls: number;
    views: number;
    downloads: number;
    todayViews: number;
    todayDownloads: number;
  };
  /** last 14 days, oldest → newest */
  series: { day: string; views: number; downloads: number }[];
  top: Wallpaper[];
  bySource: { nexwall: number; animepixels: number; wallhaven: number; manual: number; demo: number };
}

export interface SyncRun {
  id: number;
  source: string;
  inserted: number;
  note: string;
  created_at: string;
}
