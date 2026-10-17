'use server';
/**
 * Course library (T-M3-03; FR-CAT-01): add and edit courses (tms.course.manage — L&D Manager, Training
 * Coordinator), archive and restore them (tms.course.archive — L&D Manager). Definitions and tests in
 * @jadarat/tms (courses/actions.ts); the database guards check the same permissions.
 */
import { defineAction } from '@jadarat/platform-rbac';
import {
  createCourseActionDefinition,
  setCourseStatusActionDefinition,
  updateCourseActionDefinition,
} from '@jadarat/tms/courses/server';

export const createCourseAction = defineAction(createCourseActionDefinition());

export const updateCourseAction = defineAction(updateCourseActionDefinition());

/** Archive (`archived`) or restore (`active`). */
export const setCourseStatusAction = defineAction(setCourseStatusActionDefinition());
