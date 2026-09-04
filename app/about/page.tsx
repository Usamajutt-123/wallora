import type { Metadata } from 'next';
import Link from 'next/link';
import LegalPage from '@/components/LegalPage';

export const metadata: Metadata = {
  title: 'About Wallora',
  description:
    'Wallora is a modern wallpaper discovery platform built for people who want better-looking screens — fast search, curated categories and high-quality wallpapers.',
};

export default function AboutPage() {
  return (
    <LegalPage
      eyebrow="About us"
      title="About Wallora"
      intro="Wallora is a modern wallpaper discovery platform built for people who want better-looking screens."
    >
      <p>
        We make it easy to discover high-quality wallpapers across different styles, devices and resolutions — from
        minimal landscapes and AMOLED backgrounds to anime, gaming, cars, space and more.
      </p>
      <p><strong>Our goal is simple:</strong> make finding the right wallpaper fast, enjoyable and effortless.</p>
      <p>
        Wallora brings wallpapers together in an easy-to-explore experience with powerful search, categories,
        trending collections and wallpaper-specific detail pages.
      </p>
      <p>
        Whether you are looking for a new phone background, a desktop setup, a 4K display wallpaper or something
        that simply matches your mood, Wallora is designed to help you find it. We continuously improve the
        platform, discovery experience and organization of our wallpaper collection.
      </p>

      <h2>Our Mission</h2>
      <p>
        <strong>Make beautiful wallpapers easier to discover.</strong> We believe your screen is personal. The
        wallpaper you choose can change the entire feel of a device.
      </p>
      <p>Wallora focuses on:</p>
      <ul>
        <li>High-quality wallpaper discovery</li>
        <li>Fast and simple browsing</li>
        <li>Useful categories and search</li>
        <li>Mobile and desktop-friendly experiences</li>
        <li>Clear wallpaper information</li>
        <li>A clean, distraction-free interface</li>
      </ul>

      <h2>How Wallora Works</h2>
      <p>
        Wallora may use third-party image and wallpaper sources/APIs to discover and display wallpaper content.
        Depending on the source and applicable license, images may be delivered directly from the respective
        provider&apos;s infrastructure rather than being hosted by Wallora.
      </p>
      <p>
        Wallpaper availability, resolution and source information may vary. Wallora does not claim ownership of
        third-party copyrighted material unless explicitly stated.
      </p>

      <h2>Content Ownership</h2>
      <p>
        Wallora respects the intellectual property rights of artists, photographers, creators and copyright
        holders. Images displayed on Wallora may belong to their respective creators or source providers.
      </p>
      <p>
        If you believe that content displayed on Wallora infringes your copyright, please contact us through our{' '}
        <Link href="/dmca">DMCA / Copyright Removal</Link> page.
      </p>
    </LegalPage>
  );
}
