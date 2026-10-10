import type { Metadata } from 'next';
import { MfaLinkPage, mfaLinkMetadata } from '../../../../components/mfa/mfa-link-page';

/**
 * "Not you? Remove this app" (FR-IAM-12, T-M2-10; security review H1, TM-0003 T-IAM-11): the second link
 * of the set-up e-mail, `#token=…` in the fragment. One click removes that app and ends every sign-in
 * session of the account; single use (7 days).
 */
export function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  return mfaLinkMetadata(params);
}

export default function MfaRemovePage({ params }: { params: Promise<{ locale: string }> }) {
  return <MfaLinkPage params={params} />;
}
