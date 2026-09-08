import type { Metadata } from 'next';
import LegalPage from '@/components/LegalPage';
import { SITE } from '@/lib/product';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'What information Wallora may collect when you use the website and how that information may be used.',
};

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Privacy Policy"
      updated={SITE.lastUpdated}
      intro="Wallora respects your privacy. This Privacy Policy explains what information may be collected when you use the Wallora website and how that information may be used. By using Wallora, you agree to the practices described in this Privacy Policy."
    >
      <h2>Information We Collect</h2>
      <p>Wallora may collect limited information necessary to operate, secure and improve the website. This may include:</p>
      <ul>
        <li>Basic technical information</li>
        <li>Browser and device information</li>
        <li>Pages visited</li>
        <li>Approximate geographic information</li>
        <li>Referring pages</li>
        <li>Website interaction data</li>
        <li>Search queries</li>
        <li>Anonymous or aggregated analytics information</li>
      </ul>
      <p>
        Wallora does not require public user accounts for browsing wallpapers. We do not intentionally collect
        sensitive personal information through the normal wallpaper browsing experience.
      </p>

      <h2>Analytics</h2>
      <p>
        We may use analytics technologies to understand how visitors use Wallora. Analytics may help us understand
        page views, popular wallpapers, popular categories, traffic sources, device types, general geographic
        traffic and website performance. Analytics information may be aggregated or processed by third-party
        analytics providers.
      </p>

                <h2>Advertising</h2>
      <p>
        Currently, Wallora does not display any third-party advertisements. In the future, we may use advertising services like Google AdSense, which may use cookies to serve relevant ads. When we do, this policy will be updated accordingly.
      </p>

      <h2>Cookies</h2>
      <p>
        Wallora and third-party services may use cookies or similar technologies. Cookies may be used for website
        functionality, preferences, analytics, security and advertising. You can control or disable cookies
        through your browser settings; disabling certain cookies may affect some website functionality.
      </p>

      <h2>Third-Party Services</h2>
      <p>
        Wallora may rely on third-party services for functions such as wallpaper/image APIs, image delivery,
        analytics, advertising and website infrastructure. These services may process information according to
        their own privacy policies and terms. Wallora does not control the privacy practices of third-party
        services.
      </p>

      <h2>Children&apos;s Privacy</h2>
      <p>
        Wallora is not specifically directed toward children. We do not knowingly collect personal information from
        children through a public account-registration system. If you believe that a child has provided personal
        information to us, please contact us so that we can review and take appropriate action.
      </p>

      <h2>Data Security</h2>
      <p>
        We use reasonable technical and organizational measures to protect information processed through the
        website. However, no internet service can guarantee complete security.
      </p>

      <h2>Your Rights</h2>
      <p>
        Depending on your location and applicable law, you may have rights concerning your personal information.
        For privacy-related questions or requests, contact:{' '}
        <a className="text-accent2 hover:underline" href={`mailto:${SITE.emailPrivacy}`}>{SITE.emailPrivacy}</a>
      </p>

      <h2>Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy when necessary. The updated version will be published on this page with
        a revised &quot;Last Updated&quot; date.
      </p>
    </LegalPage>
  );
}
