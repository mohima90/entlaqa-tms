import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  Alert,
  AppShell,
  Badge,
  Button,
  Card,
  PoweredBy,
  TextField,
  buttonClasses,
  cn,
} from './index';

const PHYSICAL =
  /\b(ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|text-left|text-right)-/;

describe('cn', () => {
  it('joins truthy class names', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b');
  });
});

describe('Button', () => {
  it('defaults to type="button" and the primary variant', () => {
    const html = renderToStaticMarkup(<Button>حفظ</Button>);
    expect(html).toContain('type="button"');
    // Kawadir btn-brand: the brand gradient with its own text colour (checked on both ends) and a glow.
    expect(html).toContain('bg-brand-gradient');
    expect(html).toContain('text-on-nav-item-current');
    expect(html).toContain('shadow-brand-glow');
    expect(html).toContain('حفظ');
  });

  it('supports variants, sizes and submit type', () => {
    const html = renderToStaticMarkup(
      <Button type="submit" variant="danger" size="lg">
        حذف
      </Button>,
    );
    expect(html).toContain('type="submit"');
    expect(html).toContain('bg-danger');
    expect(html).toContain('min-h-12');
    expect(buttonClasses({ variant: 'ghost', size: 'sm', className: 'x' })).toContain('x');
    expect(buttonClasses({ variant: 'secondary' })).toContain('border-border-strong');
    expect(buttonClasses({ variant: 'danger-outline' })).toContain(
      'text-danger border border-danger',
    );
  });
});

describe('Card', () => {
  it('renders an optional heading at the requested level', () => {
    expect(renderToStaticMarkup(<Card title="عنوان">نص</Card>)).toContain('<h2');
    expect(
      renderToStaticMarkup(
        <Card title="عنوان" headingLevel={3}>
          نص
        </Card>,
      ),
    ).toContain('<h3');
    expect(renderToStaticMarkup(<Card>نص</Card>)).not.toContain('<h2');
  });
});

describe('AppShell', () => {
  const html = renderToStaticMarkup(
    <AppShell
      brand="جدارات · التدريب"
      organization="شركة الراية"
      headerEnd={<span>EN</span>}
      navigation={<a href="/ar/suite">الرئيسية</a>}
      navigationLabel="التنقل الرئيسي"
      skipToContentLabel="تخطَّ إلى المحتوى"
      menuLabel="القائمة"
      closeMenuLabel="إغلاق القائمة"
    >
      <h1>الرئيسية</h1>
    </AppShell>,
  );

  it('provides landmarks and a skip link targeting main', () => {
    expect(html).toContain('<header');
    expect(html).toContain('aria-label="التنقل الرئيسي"');
    expect(html).toContain('<main id="main"');
    expect(html).toMatch(/<a href="#main"[^>]*>تخطَّ إلى المحتوى<\/a>/);
  });

  it('shows the organization and product names on the white navigation, with the Jadarat mark', () => {
    expect(html).toContain('bg-nav-gradient');
    expect(html).toContain('bg-brand-gradient');
    expect(html).toContain('data-nav-scope');
    expect(html).toContain('جدارات · التدريب');
    expect(html).toContain('شركة الراية');
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
  });

  it('sets the organization name as a gradient wordmark in the logo area, or shows its logo', () => {
    expect(html).toMatch(/data-testid="nav-wordmark"/);
    expect(html).toMatch(/class="[^"]*text-brand-gradient[^"]*"[^>]*data-testid="nav-wordmark"/);
    const withLogo = renderToStaticMarkup(
      <AppShell
        brand="b"
        organization="شركة الراية"
        logo={<img src="/logo.png" alt="شعار شركة الراية" />}
        navigation={null}
        navigationLabel="n"
        skipToContentLabel="s"
        menuLabel="m"
        closeMenuLabel="c"
      >
        x
      </AppShell>,
    );
    expect(withLogo).toContain('alt="شعار شركة الراية"');
    expect(withLogo).toMatch(/class="[^"]*sr-only[^"]*"[^>]*data-testid="nav-wordmark"/);
    expect(withLogo).not.toContain('text-brand-gradient');
  });

  it('opens the navigation on narrow screens with a disclosure button (closed at first)', () => {
    expect(html).toMatch(
      /<button[^>]*aria-label="القائمة"[^>]*aria-expanded="false"[^>]*aria-controls="app-navigation"/,
    );
    expect(html).toContain('id="app-navigation"');
    expect(html).toMatch(/<button[^>]*aria-label="إغلاق القائمة"/);
    // Closed: the drawer is not displayed below 900 px, nothing is inert, and it is no dialog.
    expect(html).not.toContain('inert');
    expect(html).not.toContain('role="dialog"');
    // No nested complementary landmark around the <nav>.
    expect(html).not.toContain('<aside');
    // Both buttons are 44 px touch targets (size-11).
    expect([...html.matchAll(/<button[^>]*class="([^"]*)"/g)].map((m) => m[1])).toEqual([
      expect.stringContaining('size-11'),
      expect.stringContaining('size-11'),
    ]);
  });

  it('uses logical (direction-agnostic) utilities only', () => {
    const classes = [...html.matchAll(/class="([^"]*)"/g)].map((m) => m[1]).join(' ');
    expect(classes).not.toMatch(PHYSICAL);
    expect(classes).toContain('border-e');
    expect(classes).toContain('start-2');
  });

  it('omits the header end slot and the organization line when not provided', () => {
    const minimal = renderToStaticMarkup(
      <AppShell
        brand="b"
        navigation={null}
        navigationLabel="n"
        skipToContentLabel="s"
        menuLabel="m"
        closeMenuLabel="c"
      >
        x
      </AppShell>,
    );
    expect(minimal).not.toContain('ms-auto flex shrink-0');
    expect(minimal).not.toContain('text-sm font-semibold text-text');
    expect(minimal).not.toContain('data-testid="top-bar-title"');
    expect(minimal).not.toContain('data-testid="nav-collapse"');
  });

  it('collapses on a desktop from 260 to 72 px when given the labels, starting as remembered', () => {
    const props = {
      brand: 'جدارات · التدريب',
      title: 'أعضاء الفريق',
      navigation: <a href="/ar/suite">الرئيسية</a>,
      navigationFooter: <PoweredBy title="مدعوم من جدارات" subtitle="نظام إدارة التدريب" />,
      navigationLabel: 'التنقل الرئيسي',
      skipToContentLabel: 'تخطَّ إلى المحتوى',
      menuLabel: 'القائمة',
      closeMenuLabel: 'إغلاق القائمة',
      collapseLabels: { collapse: 'طيّ القائمة', expand: 'توسيع القائمة' },
    } as const;
    const expanded = renderToStaticMarkup(<AppShell {...props}>x</AppShell>);
    expect(expanded).toContain('lg:w-65');
    expect(expanded).not.toContain('data-nav-collapsed');
    expect(expanded).toMatch(
      /<button[^>]*aria-label="طيّ القائمة"[^>]*aria-controls="app-navigation"[^>]*aria-expanded="true"/,
    );
    expect(expanded).toContain('مدعوم من جدارات');
    expect(expanded).toMatch(/<p[^>]*data-testid="top-bar-title"[^>]*>أعضاء الفريق<\/p>/);
    const collapsed = renderToStaticMarkup(
      <AppShell {...props} initialCollapsed>
        x
      </AppShell>,
    );
    expect(collapsed).toContain('lg:w-18');
    expect(collapsed).toContain('data-nav-collapsed="true"');
    expect(collapsed).toMatch(/<button[^>]*aria-label="توسيع القائمة"[^>]*aria-expanded="false"/);
    // Collapsed: no footer, the names stay for screen readers.
    expect(collapsed).not.toContain('مدعوم من جدارات');
    expect(collapsed).toContain('sr-only');
    const classes = [...collapsed.matchAll(/class="([^"]*)"/g)].map((m) => m[1]).join(' ');
    expect(classes).not.toMatch(PHYSICAL);
  });
});

describe('TextField', () => {
  it('labels the input and links hint and error for assistive technology', () => {
    const html = renderToStaticMarkup(
      <TextField
        id="email"
        label="البريد الإلكتروني"
        hint="مثال: name@example.com"
        error="مطلوب"
        dir="ltr"
      />,
    );
    expect(html).toContain('for="email"');
    expect(html).toContain('id="email"');
    expect(html).toContain('aria-describedby="email-hint email-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('id="email-error"');
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('border-danger');
  });

  it('shows the required marker in words and keeps the caller descriptions', () => {
    const html = renderToStaticMarkup(
      <TextField id="name" label="الاسم" marker="(مطلوب)" hint="h" aria-describedby="summary" />,
    );
    expect(html).toContain('(مطلوب)');
    expect(html).toContain('aria-describedby="summary name-hint"');
    expect(html).toContain('ms-1');
  });

  it('has no description or invalid state without hint and error', () => {
    const html = renderToStaticMarkup(<TextField id="name" label="الاسم" />);
    expect(html).not.toContain('aria-describedby');
    expect(html).not.toContain('aria-invalid');
    expect(html).toContain('border-border-strong');
  });
});

describe('Alert', () => {
  it('announces danger immediately and other tones politely', () => {
    expect(renderToStaticMarkup(<Alert tone="danger">خطأ</Alert>)).toContain('role="alert"');
    const info = renderToStaticMarkup(<Alert title="تم الحفظ">التفاصيل</Alert>);
    expect(info).toContain('role="status"');
    expect(info).toContain('bg-info-subtle');
    // Kawadir notes: rounded-xl with the tone's icon (decorative).
    expect(info).toContain('rounded-xl');
    expect(info).toMatch(/<svg[^>]*class="[^"]*text-info"[^>]*aria-hidden="true"/);
    expect(info).toContain('تم الحفظ');
    expect(renderToStaticMarkup(<Alert tone="success" title="تم" />)).not.toContain('mt-1');
  });
});

describe('Badge', () => {
  it('renders the label with its tone (neutral by default)', () => {
    expect(renderToStaticMarkup(<Badge>مسودة</Badge>)).toContain('bg-surface-sunken');
    expect(renderToStaticMarkup(<Badge tone="success">منشورة</Badge>)).toContain(
      'bg-success-subtle text-success',
    );
  });
});

describe('logical properties only (RTL-first)', () => {
  it('new primitives use no physical-direction classes', () => {
    const html = [
      renderToStaticMarkup(<TextField id="x" label="x" hint="h" error="e" />),
      renderToStaticMarkup(
        <Alert tone="warning" title="t">
          b
        </Alert>,
      ),
      renderToStaticMarkup(<Badge tone="danger">b</Badge>),
    ].join('');
    expect(html).not.toMatch(PHYSICAL);
  });
});
