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
function withCurrent(
  choices: readonly Choice[],
  current: string | null,
  label: (v: string) => string,
): readonly Choice[] {
  if (current && !choices.some((c) => c.value === current)) {
    return [{ value: current, label: label(current) }, ...choices];
  }
  return choices;
}

/** What does not depend on the instant: built once per language (the lists are ICU's, fixed per process). */
interface StaticChoices {
  readonly countries: readonly Choice[];
  readonly currencies: readonly Choice[];
  readonly months: readonly Choice[];
  readonly weekdays: OrganizationChoices['weekdays'];
}

const staticCache = new Map<AppLocale, StaticChoices>();
let suggestionCache: Readonly<Record<string, RegionalPreset>> | null = null;
/** Zone labels and order depend on the offsets (daylight saving): rebuilt each UTC hour. */
const zoneCache = new Map<string, readonly Choice[]>();

function staticChoices(locale: AppLocale): StaticChoices {
  const cached = staticCache.get(locale);
  if (cached) return cached;
  const collator = new Intl.Collator(locale);
  const monthName = new Intl.DateTimeFormat(`${locale}-u-ca-gregory-nu-latn`, {
    month: 'long',
    timeZone: 'UTC',
  });
  const dayFormat = (style: 'short' | 'long') =>
    new Intl.DateTimeFormat(`${locale}-u-ca-gregory-nu-latn`, { weekday: style, timeZone: 'UTC' });
  const short = dayFormat('short');
  const long = dayFormat('long');
  const built: StaticChoices = {
    countries: isoCountryCodes()
      .map((code) => ({ value: code, label: countryName(code, locale) }))
      .sort((a, b) => collator.compare(a.label, b.label)),
    currencies: isoCurrencyCodes().map((code) => ({
      value: code,
      label: currencyLabel(code, locale),
    })),
    months: Array.from({ length: 12 }, (_, index) => ({
      value: String(index + 1),
      label: monthName.format(new Date(Date.UTC(2026, index, 1))),
    })),
    // 4 Jan 2026 was a Sunday.
    weekdays: WEEKDAYS.map((day) => {
      const date = new Date(Date.UTC(2026, 0, 4 + day));
      return { value: day, short: short.format(date), long: long.format(date) };
    }),
  };
  staticCache.set(locale, built);
  return built;
}

function suggestions(): Readonly<Record<string, RegionalPreset>> {
  if (suggestionCache) return suggestionCache;
  const catalog = {
    currencies: isoCurrencyCodes(),
    timeZones: ianaTimeZones(),
    timeZonesOf: countryTimeZones,
  };
  const built: Record<string, RegionalPreset> = {};
  for (const code of isoCountryCodes()) {
    const preset = regionalPreset(code, catalog);
    if (Object.keys(preset).length > 0) built[code] = preset;
  }
  suggestionCache = built;
  return built;
}

function zoneChoices(locale: AppLocale, now: Date): readonly Choice[] {
  const key = `${locale}|${String(Math.floor(now.getTime() / 3_600_000))}`;
  const cached = zoneCache.get(key);
  if (cached) return cached;
  const collator = new Intl.Collator(locale);
  const built = ianaTimeZones()
    .map((zone) => ({
      value: zone,
      label: timeZoneLabel(zone, locale, now),
      offset: offsetMinutes(zone, now),
    }))
    .sort((a, b) => a.offset - b.offset || collator.compare(a.label, b.label))
    .map(({ value, label }) => ({ value, label }));
  // Keep the current hour's lists only (one per language).
  for (const old of zoneCache.keys())
    if (!old.endsWith(key.slice(key.indexOf('|')))) zoneCache.delete(old);
  zoneCache.set(key, built);
  return built;
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
  const fixed = staticChoices(locale);
  const previews = Object.fromEntries(
    DATE_DISPLAYS.map((display) => [
      display,
      formatDisplayDate(now, { locale, display, timeZone: current.timeZone, style: 'full' }),
    ]),
  ) as Record<DateDisplay, string>;
  return {
    countries: withCurrent(fixed.countries, current.countryCode, (code) =>
      countryName(code, locale),
    ),
    currencies: withCurrent(fixed.currencies, current.currencyCode, (code) =>
      currencyLabel(code, locale),
    ),
    timeZones: withCurrent(zoneChoices(locale, now), current.timeZone, (zone) =>
      timeZoneLabel(zone, locale, now),
    ),
    months: fixed.months,
    weekdays: fixed.weekdays,
    suggestions: suggestions(),
    previews,
    now: now.toISOString(),
  };
}
