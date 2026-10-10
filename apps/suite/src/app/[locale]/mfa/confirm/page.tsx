import type { Metadata } from 'next';
import { MfaLinkPage, mfaLinkMetadata } from '../../../../components/mfa/mfa-link-page';

/**
 * Confirm a new authenticator app (FR-IAM-12, T-M2-10; security review H1, TM-0003 T-IAM-11): the link of
 * the set-up e-mail, `#token=…` in the fragment. One click makes the app count; single use (72 hours).
 */
export function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  return mfaLinkMetadata(params, 'confirm');
}

export default function MfaConfirmPage({ params }: { params: Promise<{ locale: string }> }) {
  return <MfaLinkPage params={params} kind="confirm" />;
}
