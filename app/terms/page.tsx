import type { Metadata } from 'next';
import Link from 'next/link';
import LegalPage from '@/components/LegalPage';
import { SITE } from '@/lib/product';
import { siteUrl } from '@/lib/seo';

export const metadata: Metadata = {
  title: 'Terms of Use',
  description: 'The terms that govern your use of the Wallora website.',
  alternates: { canonical: siteUrl('/terms') },
};

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Terms of Use"
      updated={SITE.lastUpdated}
      intro="By accessing or using Wallora, you agree to these Terms of Use. If you do not agree with these terms, please do not use the website."
    >
      <h2>Use of the Website</h2>
      <p>
        Wallora provides a platform for discovering wallpaper content and related information. You may use the
        website for lawful personal purposes. You must not:
      </p>
      <ul>
        <li>Use the website for unlawful activities.</li>
        <li>Attempt to interfere with website security.</li>
        <li>Abuse or overload our systems.</li>
        <li>Attempt unauthorized access to administrative systems.</li>
        <li>Scrape the website in a manner that violates applicable rules or causes unreasonable load.</li>
        <li>Misrepresent content or its ownership.</li>
        <li>Circumvent security or access restrictions.</li>
      </ul>

      <h2>Wallpaper Content</h2>
      <p>
        Wallpaper content may originate from third-party providers, APIs or creators. Copyright and other rights in
        such content remain with the respective copyright holders. Wallora does not claim ownership of third-party
        content unless explicitly stated. Availability of a wallpaper on Wallora does not necessarily mean that
        Wallora owns the underlying copyright. Users are responsible for ensuring that their intended use of
        third-party content complies with applicable licenses and laws.
      </p>

      <h2>Downloads</h2>
      <p>
        Where a wallpaper download is provided, availability and permitted use may depend on the source
        provider&apos;s applicable license and terms. Users should review the relevant source/license information
        before using downloaded content commercially or redistributing it.
      </p>

      <h2>Third-Party Links</h2>
      <p>
        Wallora may contain links to third-party websites or services. We are not responsible for the content,
        availability, security or privacy practices of third-party websites.
      </p>

      <h2>Service Availability</h2>
      <p>
        We aim to keep Wallora available and reliable, but we do not guarantee uninterrupted or error-free
        operation. Features, wallpapers, APIs and third-party services may occasionally become unavailable or
        change.
      </p>

      <h2>Changes to Wallora</h2>
      <p>We may modify, improve, suspend or discontinue parts of the website when necessary.</p>

      <h2>Contact</h2>
      <p>For general questions, copyright requests or privacy concerns, contact us at:</p>
      <ul>
        <li>General: <a className="text-accent2 hover:underline" href={`mailto:${SITE.emailContact}`}>{SITE.emailContact}</a></li>
        <li>Copyright / DMCA: <a className="text-accent2 hover:underline" href={`mailto:${SITE.emailDMCA}`}>{SITE.emailDMCA}</a></li>
        <li>Privacy: <a className="text-accent2 hover:underline" href={`mailto:${SITE.emailPrivacy}`}>{SITE.emailPrivacy}</a></li>
      </ul>
      <p>
        Copyright-related requests can also be filed through our <Link href="/dmca">DMCA &amp; Copyright</Link>{' '}
        page.
      </p>
    </LegalPage>
  );
}
