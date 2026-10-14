import 'server-only';
import {
  type AppLocale,
  DATE_DISPLAYS,
  type DateDisplay,
  type RegionalPreset,
  WEEKDAYS,
  countryName,
  countryTimeZones,
  currencyLabel,
  formatDisplayDate,
  ianaTimeZones,
  isoCountryCodes,
  isoCurrencyCodes,
  offsetMinutes,
  regionalPreset,
  timeZoneLabel,
} from '@jadarat/platform-i18n';

/**
 * The choices of the organization profile page (T-M2-22), built on the SERVER from its ICU data (the
 * same lists the action validates against) and passed to the form, so the browser never computes them
 * (no hydration differences between ICU versions). Names in the UI language.
 */
export interface Choice {
  readonly value: string;
  readonly label: string;
}

export interface OrganizationChoices {
  readonly countries: readonly Choice[];
  readonly currencies: readonly Choice[];
  readonly timeZones: readonly Choice[];
  /** 1–12 with the Gregorian month names. */
  readonly months: readonly Choice[];
  /** Sunday … Saturday: short label shown, full name for assistive technology. */
  readonly weekdays: readonly {
    readonly value: number;
    readonly short: string;
    readonly long: string;
  }[];
  /** What changing to a country suggests (only countries with a suggestion). */
  readonly suggestions: Readonly<Record<string, RegionalPreset>>;
  /** Today in each date display, in the organization's time zone (the preview before hydration). */
  readonly previews: Readonly<Record<DateDisplay, string>>;
  /** The instant of the previews (ISO): the browser formats it again for another display or zone. */
  readonly now: string;
}

/** A value saved earlier that this runtime no longer lists stays selectable (never silently changed). */
function withCurrent(choices: Choice[], current: string | null, label: (v: string) => string) {
  if (current && !choices.some((c) => c.value === current)) {
    choices.unshift({ value: current, label: label(current) });
  }
  return choices;
}

export function organizationChoices(
  locale: AppLocale,
  now: Date,
  current: {
    readonly countryCode: string | null;
    readonly currencyCode: string;
    readonly timeZone: string;
  },
): OrganizationChoices {
  const collator = new Intl.Collator(locale);
  const countries = withCurrent(
    isoCountryCodes()
      .map((code) => ({ value: code, label: countryName(code, locale) }))
      .sort((a, b) => collator.compare(a.label, b.label)),
    current.countryCode,
    (code) => countryName(code, locale),
  );
  const currencies = withCurrent(
    isoCurrencyCodes().map((code) => ({ value: code, label: currencyLabel(code, locale) })),
    current.currencyCode,
    (code) => currencyLabel(code, locale),
  );
  const zones = ianaTimeZones()
    .map((zone) => ({
      value: zone,
      label: timeZoneLabel(zone, locale, now),
      offset: offsetMinutes(zone, now),
    }))
    .sort((a, b) => a.offset - b.offset || collator.compare(a.label, b.label))
    .map(({ value, label }) => ({ value, label }));
  const timeZones = withCurrent(zones, current.timeZone, (zone) =>
    timeZoneLabel(zone, locale, now),
  );
  const monthName = new Intl.DateTimeFormat(`${locale}-u-ca-gregory-nu-latn`, {
    month: 'long',
    timeZone: 'UTC',
  });
  const months = Array.from({ length: 12 }, (_, index) => ({
    value: String(index + 1),
    label: monthName.format(new Date(Date.UTC(2026, index, 1))),
  }));
  const dayFormat = (style: 'short' | 'long') =>
    new Intl.DateTimeFormat(`${locale}-u-ca-gregory-nu-latn`, { weekday: style, timeZone: 'UTC' });
  // 4 Jan 2026 was a Sunday.
  const weekdays = WEEKDAYS.map((day) => {
    const date = new Date(Date.UTC(2026, 0, 4 + day));
    return {
      value: day,
      short: dayFormat('short').format(date),
      long: dayFormat('long').format(date),
    };
  });
  const catalog = {
    currencies: isoCurrencyCodes(),
    timeZones: ianaTimeZones(),
    timeZonesOf: countryTimeZones,
  };
  const suggestions: Record<string, RegionalPreset> = {};
  for (const code of isoCountryCodes()) {
    const preset = regionalPreset(code, catalog);
    if (Object.keys(preset).length > 0) suggestions[code] = preset;
  }
  const previews = Object.fromEntries(
    DATE_DISPLAYS.map((display) => [
      display,
      formatDisplayDate(now, { locale, display, timeZone: current.timeZone, style: 'full' }),
    ]),
  ) as Record<DateDisplay, string>;
  return {
    countries,
    currencies,
    timeZones,
    months,
    weekdays,
    suggestions,
    previews,
    now: now.toISOString(),
  };
}
