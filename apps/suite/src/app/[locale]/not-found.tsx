import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

export default async function NotFound() {
  const t = await getTranslations('common');
  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-bold">404</h1>
      <p>
        <Link href="/">{t('productName')}</Link>
      </p>
    </main>
  );
}
