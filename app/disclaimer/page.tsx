import type { Metadata } from 'next';
import Link from 'next/link';
import LegalPage from '@/components/LegalPage';
import { siteUrl } from '@/lib/seo';

export const metadata: Metadata = {
  title: 'Disclaimer',
  description: 'Disclaimer for the Wallora wallpaper discovery platform.',
  alternates: { canonical: siteUrl('/disclaimer') },
};

export default function DisclaimerPage() {
  return (
    <LegalPage eyebrow="Legal" title="Disclaimer">
      <p>
        Wallora provides wallpaper discovery and related information for informational and browsing purposes. Some
        content may be provided through third-party sources or APIs.
      </p>
      <p>
        Wallora does not necessarily own the copyright to third-party images displayed through the platform.
        Copyright remains with the respective creators, owners or licensors.
      </p>
      <p>
        If you believe content on Wallora violates your rights, please contact us through our{' '}
        <Link href="/dmca">DMCA / Copyright</Link> page.
      </p>
    </LegalPage>
  );
}
