/**
 * A sign-in session's browser and system, from Auth's user agent (screen 3: «Chrome على Windows»; the
 * authenticator set-up e-mail and "an app was added from another sign-in", T-M2-10 re-review N1). Only
 * well-known names are recognised; anything else is "unknown" (never shown raw: the string is chosen by the
 * client). Client-safe, no dependencies.
 */
export interface DeviceDescription {
  readonly browser: string | null;
  readonly system: string | null;
  readonly mobile: boolean;
}

const BROWSERS: readonly (readonly [(ua: string) => boolean, string])[] = [
  [(ua) => /\bEdg(?:e|A|iOS)?\//.test(ua), 'Edge'],
  [(ua) => /\b(?:OPR|Opera)\//.test(ua), 'Opera'],
  [(ua) => /\bSamsungBrowser\//.test(ua), 'Samsung Internet'],
  [(ua) => /\b(?:Firefox|FxiOS)\//.test(ua), 'Firefox'],
  [(ua) => /\b(?:Chrome|CriOS|Chromium)\//.test(ua), 'Chrome'],
  [(ua) => /\bVersion\//.test(ua) && /\bSafari\//.test(ua), 'Safari'],
];

const SYSTEMS: readonly (readonly [RegExp, string])[] = [
  [/\b(?:iPhone|iPad|iPod)\b/, 'iOS'],
  [/\bAndroid\b/, 'Android'],
  [/\bWindows\b/, 'Windows'],
  [/\b(?:Macintosh|Mac OS X)\b/, 'macOS'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bLinux\b/, 'Linux'],
];

export function describeUserAgent(userAgent: string | null): DeviceDescription {
  // Bounded input: a user agent is short; anything longer is not a browser we know.
  const ua = userAgent && userAgent.length <= 512 ? userAgent : '';
  const browser = BROWSERS.find(([matches]) => matches(ua))?.[1] ?? null;
  const system = SYSTEMS.find(([pattern]) => pattern.test(ua))?.[1] ?? null;
  return { browser, system, mobile: /\bMobile\b|\b(?:iPhone|Android)\b/.test(ua) };
}
