import type { DateDisplay, Weekday } from './regional';

/**
 * Country presets of the organization profile (T-M2-22, approved screen, PO 14 Oct 2026): when the
 * Organization Admin CHANGES the country, the page suggests its currency, time zone, working week and date
 * display. Suggestions only — applied in the form, never on load, never saved without the admin's "Save";
 * every value stays editable. Working hours are not part of a preset (the default 08:00–16:00 stays).
 */
export interface RegionalPreset {
  readonly currencyCode?: string;
  readonly timeZone?: string;
  readonly workingDays?: readonly Weekday[];
  readonly dateDisplay?: DateDisplay;
}

const SUN_THU: readonly Weekday[] = [0, 1, 2, 3, 4];
const MON_FRI: readonly Weekday[] = [1, 2, 3, 4, 5];

/** Countries with a full preset (the approved list). */
export const COUNTRY_PRESETS = {
  SA: { currencyCode: 'SAR', timeZone: 'Asia/Riyadh', workingDays: SUN_THU, dateDisplay: 'dual' },
  AE: {
    currencyCode: 'AED',
    timeZone: 'Asia/Dubai',
    workingDays: MON_FRI,
    dateDisplay: 'gregorian',
  },
  EG: {
    currencyCode: 'EGP',
    timeZone: 'Africa/Cairo',
    workingDays: SUN_THU,
    dateDisplay: 'gregorian',
  },
  KW: {
    currencyCode: 'KWD',
    timeZone: 'Asia/Kuwait',
    workingDays: SUN_THU,
    dateDisplay: 'gregorian',
  },
  QA: {
    currencyCode: 'QAR',
    timeZone: 'Asia/Qatar',
    workingDays: SUN_THU,
    dateDisplay: 'gregorian',
  },
  BH: {
    currencyCode: 'BHD',
    timeZone: 'Asia/Bahrain',
    workingDays: SUN_THU,
    dateDisplay: 'gregorian',
  },
  OM: {
    currencyCode: 'OMR',
    timeZone: 'Asia/Muscat',
    workingDays: SUN_THU,
    dateDisplay: 'gregorian',
  },
  JO: {
    currencyCode: 'JOD',
    timeZone: 'Asia/Amman',
    workingDays: SUN_THU,
    dateDisplay: 'gregorian',
  },
} as const satisfies Record<string, Required<RegionalPreset>>;

/** Default working hours (no preset changes them). */
export const DEFAULT_WORK_STARTS_AT = '08:00';
export const DEFAULT_WORK_ENDS_AT = '16:00';

/** What the runtime knows, passed in so the preset stays a pure function (and testable). */
export interface PresetCatalog {
  /** The ISO 4217 codes on offer. */
  readonly currencies: readonly string[];
  /** The IANA zones on offer. */
  readonly timeZones: readonly string[];
  /** The zones of a country (Intl.Locale#getTimeZones). */
  readonly timeZonesOf: (country: string) => readonly string[];
}

/**
 * The suggestion for a country. The approved countries get their full preset; any other country only what
 * is unambiguous: its currency when exactly one code on offer starts with its ISO code (ISO 4217 codes are
 * the country code plus a letter: USD, GBP, INR — none for euro countries, two for Cuba → none), and its
 * time zone when the country has exactly one. Nothing else changes ("otherwise leave as is").
 */
export function regionalPreset(country: string, catalog: PresetCatalog): RegionalPreset {
  if (Object.hasOwn(COUNTRY_PRESETS, country)) {
    return COUNTRY_PRESETS[country as keyof typeof COUNTRY_PRESETS];
  }
  if (!/^[A-Z]{2}$/.test(country)) return {};
  const currencies = catalog.currencies.filter((code) => code.startsWith(country));
  const zones = catalog.timeZonesOf(country).filter((zone) => catalog.timeZones.includes(zone));
  return {
    ...(currencies.length === 1 && currencies[0] ? { currencyCode: currencies[0] } : {}),
    ...(zones.length === 1 && zones[0] ? { timeZone: zones[0] } : {}),
  };
}

/** The form values after applying a preset: only the fields the preset names change. */
export function applyPreset<
  T extends {
    readonly currencyCode: string;
    readonly timeZone: string;
    readonly workingDays: readonly number[];
    readonly dateDisplay: DateDisplay;
  },
>(values: T, preset: RegionalPreset): T {
  return {
    ...values,
    ...(preset.currencyCode ? { currencyCode: preset.currencyCode } : {}),
    ...(preset.timeZone ? { timeZone: preset.timeZone } : {}),
    ...(preset.workingDays ? { workingDays: [...preset.workingDays] } : {}),
    ...(preset.dateDisplay ? { dateDisplay: preset.dateDisplay } : {}),
  };
}
