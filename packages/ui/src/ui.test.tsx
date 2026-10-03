import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Alert, AppShell, Badge, Button, Card, TextField, buttonClasses, cn } from './index';

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
    expect(html).toContain('bg-primary');
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
      headerEnd={<span>EN</span>}
      navigation={<a href="/ar/suite">الرئيسية</a>}
      navigationLabel="التنقل الرئيسي"
      skipToContentLabel="تخطَّ إلى المحتوى"
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

  it('uses logical (direction-agnostic) utilities only', () => {
    const classes = [...html.matchAll(/class="([^"]*)"/g)].map((m) => m[1]).join(' ');
    expect(classes).not.toMatch(PHYSICAL);
    expect(classes).toContain('border-e');
    expect(classes).toContain('start-2');
  });

  it('omits the header end slot when not provided', () => {
    const minimal = renderToStaticMarkup(
      <AppShell brand="b" navigation={null} navigationLabel="n" skipToContentLabel="s">
        x
      </AppShell>,
    );
    expect(minimal).not.toContain('shrink-0 items-center gap-3');
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
    expect(info).toContain('تم الحفظ');
    expect(renderToStaticMarkup(<Alert tone="success" title="تم" />)).not.toContain('mt-1');
  });
});

describe('Badge', () => {
  it('renders the label with its tone (neutral by default)', () => {
    expect(renderToStaticMarkup(<Badge>مسودة</Badge>)).toContain('bg-surface-sunken');
    expect(renderToStaticMarkup(<Badge tone="success">منشورة</Badge>)).toContain(
      'bg-success-subtle',
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
