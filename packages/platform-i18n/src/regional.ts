import type { AppLocale } from './locales';

/**
 * Regional reference data of an organization's profile (FR-ADM-02, FR-SCH-07; T-M2-22): the codes the
 * profile accepts and how they are named in the UI language. Nothing here is a hand-typed list of
 * countries, currencies or time zones — they come from the runtime's ICU data (`Intl`), filtered by
 * documented ISO rules — so the lists follow ICU updates. Lists differ slightly between ICU versions:
 * the server builds them (validation and the page's options); the browser never recomputes them.
 */

/** The organization's industry: the fixed list of the approved screen (labels in the message catalogs). */
export const INDUSTRIES = [
  'government',
  'banking_financial',
  'insurance',
  'healthcare',
  'education',
  'oil_gas_energy',
  'manufacturing',
  'retail_consumer',
  'telecom_technology',
  'construction_real_estate',
  'transport_logistics',
  'hospitality_tourism',
  'professional_services',
  'non_profit',
  'other',
] as const;
export type Industry = (typeof INDUSTRIES)[number];

/** How dates are shown (FR-SCH-07, ADR 0007 §6): Gregorian, Hijri (Umm al-Qura) or both. */
export const DATE_DISPLAYS = ['gregorian', 'hijri', 'dual'] as const;
export type DateDisplay = (typeof DATE_DISPLAYS)[number];

/** Days of the week as JavaScript's getDay(): 0 = Sunday … 6 = Saturday (the database's working_days). */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** What the app did before organizations had settings (and the database's defaults). */
export const DEFAULT_TIME_ZONE = 'Asia/Riyadh';
export const DEFAULT_DATE_DISPLAY: DateDisplay = 'gregorian';

/**
 * Two-letter codes that ICU names but ISO 3166-1 does not assign to a country: the exceptionally reserved
 * codes (Ascension, Clipperton, Sark, Diego Garcia, Ceuta & Melilla, Canary Islands, Tristan da Cunha) and
 * the groupings EU, EZ, UN. User-assigned codes (AA, QM–QZ, XA–XZ, ZZ — e.g. ICU's Kosovo XK or "Outlying
 * Oceania" QO) are excluded by rule; withdrawn codes (e.g. YU, ZR) are dropped because ICU maps them to
 * their successor.
 */
const NOT_COUNTRIES: ReadonlySet<string> = new Set([
  'AC',
  'CP',
  'CQ',
  'DG',
  'EA',
  'IC',
  'TA',
  'EU',
  'EZ',
  'UN',
]);

function userAssigned(code: string): boolean {
  return code === 'AA' || code === 'ZZ' || /^Q[M-Z]$/.test(code) || code.startsWith('X');
}

let countryCache: readonly string[] | null = null;

/** ISO 3166-1 alpha-2 codes of current countries and territories that this runtime's ICU names. */
export function isoCountryCodes(): readonly string[] {
  if (countryCache) return countryCache;
  const names = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
  const codes: string[] = [];
  for (let a = 65; a <= 90; a += 1) {
    for (let b = 65; b <= 90; b += 1) {
      const code = String.fromCharCode(a, b);
      if (userAssigned(code) || NOT_COUNTRIES.has(code) || !names.of(code)) continue;
      // Withdrawn codes are canonicalized to their successor (BU → MM): not a country of their own.
      if (new Intl.Locale('und', { region: code }).region !== code) continue;
      codes.push(code);
    }
  }
  countryCache = codes;
  return codes;
}

/**
 * ISO 4217 codes that are not money an organization keeps its amounts in: precious metals, the IMF's SDR,
 * the regional Sucre, bond-market units, the testing and "no currency" codes.
 */
const NOT_CURRENCIES: ReadonlySet<string> = new Set([
  'XAG',
  'XAU',
  'XBA',
  'XBB',
  'XBC',
  'XBD',
  'XDR',
  'XPD',
  'XPT',
  'XSU',
  'XTS',
  'XUA',
  'XXX',
]);

let currencyCache: readonly string[] | null = null;

/** ISO 4217 currency codes this runtime knows (Intl.supportedValuesOf), without the special codes. */
export function isoCurrencyCodes(): readonly string[] {
  currencyCache ??= Intl.supportedValuesOf('currency').filter(
    (code) => /^[A-Z]{3}$/.test(code) && !NOT_CURRENCIES.has(code),
  );
  return currencyCache;
}

let zoneCache: readonly string[] | null = null;

/** IANA time zones this runtime knows (Intl.supportedValuesOf('timeZone')). */
export function ianaTimeZones(): readonly string[] {
  zoneCache ??= Intl.supportedValuesOf('timeZone');
  return zoneCache;
}

/** Can Intl format in this time zone? (The database checks its own list too.) */
export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The country's name in the UI language (the code when ICU has none). */
export function countryName(code: string, locale: AppLocale): string {
  return new Intl.DisplayNames([locale], { type: 'region', fallback: 'code' }).of(code) ?? code;
}

/** "SAR — Saudi riyal" / «SAR — ريال سعودي». */
export function currencyLabel(code: string, locale: AppLocale): string {
  const name = new Intl.DisplayNames([locale], { type: 'currency', fallback: 'none' }).of(code);
  return name ? `${code} — ${name}` : code;
}

/** The zone's offset from UTC at `at`, as "UTC+03:00" (Western digits in both languages). */
export function utcOffset(zone: string, at: Date): string {
  const part = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'longOffset' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')?.value;
  // ICU writes "GMT+03:00", and plain "GMT" for a zero offset.
  if (!part || part === 'GMT') return 'UTC+00:00';
  return part.replace('GMT', 'UTC');
}

/**
 * Arabic names of the cities of the zones the country presets suggest, and of nearby capitals (ICU has no
 * localized city names). Other zones show the city of their IANA name in Latin letters.
 */
const ARABIC_CITIES: Readonly<Record<string, string>> = {
  'Asia/Riyadh': 'الرياض',
  'Asia/Dubai': 'دبي',
  'Africa/Cairo': 'القاهرة',
  'Asia/Kuwait': 'الكويت',
  'Asia/Qatar': 'قطر',
  'Asia/Bahrain': 'البحرين',
  'Asia/Muscat': 'مسقط',
  'Asia/Amman': 'عمّان',
  'Asia/Baghdad': 'بغداد',
  'Asia/Beirut': 'بيروت',
  'Asia/Aden': 'عدن',
  'Africa/Khartoum': 'الخرطوم',
  'Africa/Casablanca': 'الدار البيضاء',
  'Africa/Tunis': 'تونس',
  'Africa/Algiers': 'الجزائر',
  'Africa/Tripoli': 'طرابلس',
  'Europe/London': 'لندن',
  UTC: 'التوقيت العالمي',
};

/** The friendly city of a zone: "Riyadh" for Asia/Riyadh, "Buenos Aires" for America/Argentina/Buenos_Aires. */
export function timeZoneCity(zone: string, locale: AppLocale): string {
  if (locale === 'ar' && ARABIC_CITIES[zone]) return ARABIC_CITIES[zone];
  const last = zone.split('/').pop() ?? zone;
  return last.replace(/_/g, ' ');
}

/** "Riyadh (UTC+03:00)" / «الرياض (UTC+03:00)». */
export function timeZoneLabel(zone: string, locale: AppLocale, at: Date): string {
  return `${timeZoneCity(zone, locale)} (${utcOffset(zone, at)})`;
}

/** Minutes east of UTC at `at` (for sorting zones by offset). */
export function offsetMinutes(zone: string, at: Date): number {
  const match = /^UTC([+-])(\d{2}):(\d{2})$/.exec(utcOffset(zone, at));
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

/** The time zones the runtime associates with a country (Intl.Locale#getTimeZones; empty when unknown). */
export function countryTimeZones(country: string): readonly string[] {
  const locale = new Intl.Locale('und', { region: country }) as Intl.Locale & {
    getTimeZones?: () => string[];
    timeZones?: string[];
  };
  try {
    return locale.getTimeZones?.() ?? locale.timeZones ?? [];
  } catch {
    return [];
  }
}
