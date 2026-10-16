import 'server-only';
import type { AppLocale } from '@jadarat/platform-i18n';
import { getTranslations } from 'next-intl/server';
import type { InviteCopyTexts } from '../components/users/invite-code-copy';

/** Texts of the invitation code chip and copy buttons (namespace `invitations.copy`, Kawadir). */
export async function inviteCopyTexts(locale: AppLocale): Promise<InviteCopyTexts> {
  const t = await getTranslations({ locale, namespace: 'invitations.copy' });
  return {
    codeLabel: t('codeLabel'),
    copyCode: t('copyCode'),
    copyLink: t('copyLink'),
    codeCopied: t('codeCopied'),
    linkCopied: t('linkCopied'),
    copyFailed: t('copyFailed'),
    loading: t('loading'),
  };
}
