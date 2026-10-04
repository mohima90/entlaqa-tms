/**
 * Browser start-up (Next.js client instrumentation): error reporting through our own scrubbing tunnel
 * (ADR 0009 §4, T-M1-D06). Nothing personal is collected; see lib/browser-error-tracking.ts.
 */
import { init } from '@sentry/browser';
import { browserErrorTrackingOptions } from './lib/browser-error-tracking';

init(browserErrorTrackingOptions());
