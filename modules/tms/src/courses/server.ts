import 'server-only';

/** Server entry of the course library (T-M3-03): action and query definitions, the reusable service. */
export * from './actions';
export { type CourseSaved, createCourse, setCourseStatus, updateCourse } from './service';
