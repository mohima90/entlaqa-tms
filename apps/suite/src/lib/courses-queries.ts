import 'server-only';
import { defineQuery } from '@jadarat/platform-rbac';
import { coursesPageQueryDefinition } from '@jadarat/tms/courses/server';

/** The course library page (T-M3-03): courses, categories, counts, currency, what the member may do. */
export const coursesPageQuery = defineQuery(coursesPageQueryDefinition());
