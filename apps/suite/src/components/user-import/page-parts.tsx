import 'server-only';
import type { AppLocale } from '@jadarat/platform-i18n';
import { Card, buttonClasses } from '@jadarat/ui';
import { getTranslations } from 'next-intl/server';
import { IMPORT_STEPS, type ImportStep } from '../../lib/user-import-view';
import type { StepperProps } from './stepper';

/** The stepper's texts for `current` (namespace `userImport.steps`). */
export async function stepperProps(locale: AppLocale, current: ImportStep): Promise<StepperProps> {
  const t = await getTranslations({ locale, namespace: 'userImport.steps' });
  const names = Object.fromEntries(IMPORT_STEPS.map((step) => [step, t(step)])) as Record<
    ImportStep,
    string
  >;
  return {
    current,
    names,
    label: t('label'),
    doneText: t('done'),
    shortText: t('short', {
      current: IMPORT_STEPS.indexOf(current) + 1,
      total: IMPORT_STEPS.length,
      name: names[current],
    }),
  };
}

/** «ليست لديك صلاحية لاستيراد المستخدمين» (approved screen 13, no permission). */
export async function importForbidden(locale: AppLocale) {
  const t = await getTranslations({ locale, namespace: 'userImport.forbidden' });
  const title = (await getTranslations({ locale, namespace: 'userImport' }))('title');
  return (
    <>
      <h1 className="m-0 text-[28px] font-bold md:text-5xl">{title}</h1>
      <Card title={t('title')} data-testid="import-forbidden">
        <p className="mt-0">{t('body')}</p>
        <a
          href={`/${locale}/suite`}
          className={buttonClasses({ variant: 'secondary', size: 'md' })}
        >
          {t('home')}
        </a>
      </Card>
    </>
  );
}
