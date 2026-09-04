import type { Metadata } from 'next';
import LegalPage from '@/components/LegalPage';
import { SITE } from '@/lib/product';

export const metadata: Metadata = {
  title: 'DMCA & Copyright',
  description: 'How to submit a copyright removal request to Wallora.',
};

export default function DmcaPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="DMCA & Copyright"
      intro="Wallora respects copyright and intellectual property rights."
    >
      <p>
        If you are a copyright owner or an authorized representative and believe that material available through
        Wallora infringes your copyrighted work, you may submit a copyright removal request.
      </p>
      <p>Please send a copyright notice containing the following information:</p>
      <ol>
        <li>Your full name and contact information.</li>
        <li>Identification of the copyrighted work that you claim has been infringed.</li>
        <li>The URL or specific location of the material on Wallora that you believe infringes your copyright.</li>
        <li>A statement explaining why you believe the material infringes your copyright.</li>
        <li>
          A statement confirming that you have a good-faith belief that the disputed use is not authorized by the
          copyright owner, its agent or applicable law.
        </li>
        <li>
          A statement confirming that the information in your notice is accurate and that you are authorized to
          act on behalf of the copyright owner, where applicable.
        </li>
        <li>Your electronic or physical signature.</li>
      </ol>
      <p>Send copyright notices to:</p>
      <p>
        <a className="text-accent2 hover:underline" href={`mailto:${SITE.emailDMCA}?subject=${encodeURIComponent('DMCA Copyright Removal Request')}`}>
          {SITE.emailDMCA}
        </a>
        <br />Subject: <em>DMCA Copyright Removal Request</em>
      </p>
      <p>
        After receiving a valid copyright complaint, Wallora may review the reported material and take appropriate
        action, which may include removing or disabling access to the material.
      </p>
      <p><strong>Please do not submit false, misleading or fraudulent copyright claims.</strong></p>
    </LegalPage>
  );
}
