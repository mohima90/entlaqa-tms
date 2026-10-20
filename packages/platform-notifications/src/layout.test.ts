import { describe, expect, it } from 'vitest';
import { EMAIL_COLORS, actionButton, link, withEmailBrand } from './layout';
import { renderEmail } from './templates/index';

const variables = {
  recipientName: { ar: 'نورة', en: 'Noura' },
  inviterName: { ar: 'محمد', en: 'Mohammed' },
  organizationName: { ar: 'شركة الراية', en: 'Al Raya' },
  roleName: { ar: 'متدرب', en: 'Learner' },
  acceptUrl: 'https://raya.example/ar/invite/accept?token=t',
  expiresAt: '2026-10-11T09:00:00+03:00',
  timeZone: 'Asia/Riyadh',
  loginEmail: 'sara@example.com',
};
const LOGO = 'https://tms.example.com/api/brand/3c4d5e6f-7081-4a9b-8c1d-2e3f4a5b6c7d';

describe("the organization's e-mail look (WP-ADM-02, FR-NTF-02)", () => {
  it('without a brand: the Jadarat colours and the name as text', () => {
    const { html } = renderEmail('platform.invitation', 'en', variables);
    expect(html).toContain(`background: ${EMAIL_COLORS.action}`);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('border-top: 4px solid');
  });

  it('with a brand: the logo (alt = the name), the button and link colours and an accent line', () => {
    const { html, text } = renderEmail('platform.invitation', 'ar', variables, {
      actionColor: '#0F5E4E',
      linkColor: '#0B4A3D',
      logoUrl: LOGO,
    });
    expect(html).toContain(`src="${LOGO}"`);
    expect(html).toContain('alt="شركة الراية"');
    expect(html).toContain('background: #0F5E4E');
    expect(html).toContain('border-top: 4px solid #0F5E4E');
    expect(text).not.toContain(LOGO);
  });

  it('ignores anything but #RRGGBB colours and an https logo address', () => {
    const { html } = renderEmail('platform.invitation', 'en', variables, {
      actionColor: 'red;background:url(x)',
      linkColor: '#0B4A3D',
      logoUrl: 'javascript:alert(1)',
    });
    expect(html).toContain(`background: ${EMAIL_COLORS.action}`);
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<img');
    const plainHttp = renderEmail('platform.invitation', 'en', variables, {
      logoUrl: 'http://tms.example.com/logo.png',
    });
    expect(plainHttp.html).not.toContain('<img');
  });

  it('applies to one render only, and is restored after an error', () => {
    const branded = withEmailBrand(
      { actionColor: '#7A1F2B', linkColor: '#6E1C27' },
      () => actionButton('Go', 'https://x.example').value,
    );
    expect(branded).toContain('#7A1F2B');
    expect(actionButton('Go', 'https://x.example').value).toContain(EMAIL_COLORS.action);
    expect(() =>
      withEmailBrand({ actionColor: '#7A1F2B', linkColor: '#6E1C27' }, () => {
        throw new Error('render failed');
      }),
    ).toThrow('render failed');
    expect(link('x', 'https://x.example').value).toContain(EMAIL_COLORS.link);
  });
});
