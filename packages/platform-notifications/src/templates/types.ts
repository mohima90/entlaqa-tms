import type { AppLocale } from '@jadarat/platform-i18n';
import type { z } from 'zod';

export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  /** Plain-text alternative (same content, both languages). */
  readonly text: string;
}

/**
 * A system e-mail template (ADR 0008 §3): versioned in code, variables validated by a schema, both
 * languages in one message — the primary language first (the recipient's, or the invitation's),
 * the other below (approved invitation e-mail, screen 7).
 */
export interface EmailTemplate<S extends z.ZodType> {
  readonly key: string;
  readonly version: number;
  readonly variables: S;
  render(variables: z.output<S>, primary: AppLocale): RenderedEmail;
}
