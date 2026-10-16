import 'server-only';
import { PlatformConsoleErrors } from '@jadarat/platform-identity';
import { getTranslations } from 'next-intl/server';

/** Raw texts of the console's own error codes (FR-ADM-17), by message key. */
export async function platformErrorTexts(locale: string): Promise<Record<string, string>> {
  const t = await getTranslations({ locale });
  return Object.fromEntries(
    Object.values(PlatformConsoleErrors).map((def) => [
      def.messageKey,
      String(t.raw(def.messageKey)),
    ]),
  );
}
