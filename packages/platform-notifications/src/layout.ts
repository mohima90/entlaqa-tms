import { type AppLocale, getDirection } from '@jadarat/platform-i18n';
import { type SafeHtml, markup } from './html';

/**
 * Bilingual e-mail layout of the approved invitation e-mail (docs/design/screens/m2-users-roles/
 * InviteEmail.dc.html): organization header, the message in the primary language (with the action
 * button), the same message in the other language below, and a footer. Table layout and inline styles
 * for e-mail clients; colors from the design tokens.
 */
export const EMAIL_COLORS = {
  page: '#E3E9EA',
  surface: '#FFFFFF',
  subtle: '#F8FAFA',
  border: '#E3E9EA',
  text: '#121A1C',
  muted: '#333E41',
  faint: '#465357',
  action: '#0F665F',
  link: '#0C534D',
} as const;

const FONTS: Readonly<Record<AppLocale, string>> = {
  ar: "'IBM Plex Sans Arabic', 'Noto Sans Arabic', Tahoma, Arial, sans-serif",
  en: "'IBM Plex Sans', 'Segoe UI', Arial, sans-serif",
};

export interface LayoutBlock {
  readonly locale: AppLocale;
  readonly content: SafeHtml;
}

export interface EmailLayout {
  readonly title: string;
  readonly organizationName: string;
  readonly productLabel: string;
  readonly primary: LayoutBlock;
  readonly secondary: LayoutBlock;
  /** One line per language, each set in its own direction. */
  readonly footer: readonly LayoutBlock[];
}

function block(b: LayoutBlock, secondary: boolean): SafeHtml {
  const dir = getDirection(b.locale);
  const style = [
    `padding: ${secondary ? '24px 32px' : '28px 32px'}`,
    `font-family: ${FONTS[b.locale]}`,
    `font-size: ${secondary ? '15px' : '16px'}`,
    `line-height: ${b.locale === 'ar' ? '1.75' : '1.55'}`,
    `color: ${EMAIL_COLORS.text}`,
    `text-align: ${dir === 'rtl' ? 'right' : 'left'}`,
    secondary
      ? `background: ${EMAIL_COLORS.subtle}; border-top: 1px solid ${EMAIL_COLORS.border}`
      : '',
  ]
    .filter(Boolean)
    .join('; ');
  return markup`<tr>
    <td lang="${b.locale}" dir="${dir}" style="${style}">${b.content}</td>
  </tr>`;
}

export function renderLayout(layout: EmailLayout): string {
  const dir = getDirection(layout.primary.locale);
  const font = FONTS[layout.primary.locale];
  const doc = markup`<!doctype html>
    <html lang="${layout.primary.locale}" dir="${dir}">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light" />
        <title>${layout.title}</title>
      </head>
      <body style="margin: 0; padding: 0; background: ${EMAIL_COLORS.page}">
        <table
          role="presentation"
          width="100%"
          cellpadding="0"
          cellspacing="0"
          style="background: ${EMAIL_COLORS.page}"
        >
          <tr>
            <td align="center" style="padding: 24px 12px">
              <table
                role="presentation"
                width="100%"
                cellpadding="0"
                cellspacing="0"
                style="max-width: 600px; background: ${EMAIL_COLORS.surface}; border-radius: 10px; border-collapse: separate"
              >
                <tr>
                  <td
                    dir="${dir}"
                    style="padding: 20px 32px; border-bottom: 1px solid ${EMAIL_COLORS.border}; font-family: ${font}"
                  >
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-weight: 700; font-size: 19px; color: ${EMAIL_COLORS.text}">
                          ${layout.organizationName}
                        </td>
                        <td
                          align="${dir === 'rtl' ? 'left' : 'right'}"
                          style="font-size: 13px; color: ${EMAIL_COLORS.faint}"
                        >
                          ${layout.productLabel}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                ${block(layout.primary, false)} ${block(layout.secondary, true)}
                <tr>
                  <td
                    dir="${dir}"
                    style="padding: 16px 32px; border-top: 1px solid ${EMAIL_COLORS.border}; font-family: ${font}; font-size: 13px; line-height: 1.6; color: ${EMAIL_COLORS.faint}"
                  >
                    ${layout.footer.map((line) => {
                      const lineDir = getDirection(line.locale);
                      return markup`<div
                        lang="${line.locale}"
                        dir="${lineDir}"
                        style="text-align: ${lineDir === 'rtl' ? 'right' : 'left'}; font-family: ${FONTS[line.locale]}"
                      >
                        ${line.content}
                      </div>`;
                    })}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>`;
  return doc.value;
}

/** A button-styled link (the primary block's action). */
export function actionButton(label: string, href: string): SafeHtml {
  return markup`<table role="presentation" cellpadding="0" cellspacing="0" style="margin: 6px 0">
    <tr>
      <td style="border-radius: 6px; background: ${EMAIL_COLORS.action}">
        <a
          href="${href}"
          style="display: inline-block; padding: 12px 28px; color: #FFFFFF; font-weight: 700; text-decoration: none; border-radius: 6px"
          >${label}</a
        >
      </td>
    </tr>
  </table>`;
}

export function paragraph(content: SafeHtml, muted = false, small = false): SafeHtml {
  const style = `margin: 0 0 14px 0; color: ${muted ? EMAIL_COLORS.muted : EMAIL_COLORS.text}${small ? '; font-size: 14px' : ''}`;
  return markup`<p style="${style}">${content}</p>`;
}

/** An address or other left-to-right value inside Arabic text. */
export function ltr(value: string): SafeHtml {
  return markup`<span dir="ltr" style="unicode-bidi: isolate">${value}</span>`;
}

export function link(label: string, href: string): SafeHtml {
  return markup`<a href="${href}" style="color: ${EMAIL_COLORS.link}; font-weight: 600">${label}</a>`;
}
