import 'server-only';
import { defineQuery } from '@jadarat/platform-rbac';
import {
  courseSettingsQueryDefinition,
  coursesPageQueryDefinition,
} from '@jadarat/tms/courses/server';

/** The course library page (T-M3-03): courses, categories, counts, currency, what the member may do. */
export const coursesPageQuery = defineQuery(coursesPageQueryDefinition());

/** One course's settings page (WP-UX-01 c): the course, the categories, the currency, the name rule. */
export const courseSettingsQuery = defineQuery(courseSettingsQueryDefinition());
