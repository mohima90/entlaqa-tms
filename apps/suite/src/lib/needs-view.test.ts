import { describe, expect, it } from 'vitest';
import {
  NEEDS_PATHS,
  cycleDepartmentHref,
  myNeedsHref,
  needsFieldErrorKey,
  taskAction,
} from './needs-view';

describe('department needs pages (WP-LD-01)', () => {
  it('links the head’s page and the manager’s view of a department', () => {
    expect(myNeedsHref('en', 'c1', 'd1')).toBe('/en/suite/my-team/needs/c1/d1');
    expect(cycleDepartmentHref('ar', 'c1', 'd1')).toBe(
      '/ar/suite/planning/cycles/c1/departments/d1',
    );
    expect(NEEDS_PATHS.mine).toBe('/suite/my-team/needs');
  });

  it('names the task’s action: start, continue, or look once submitted or closed', () => {
    expect(taskAction('not_started', true)).toBe('enter');
    expect(taskAction('draft', true)).toBe('continue');
    expect(taskAction('returned', true)).toBe('continue');
    expect(taskAction('submitted', true)).toBe('view');
    expect(taskAction('late', false)).toBe('view');
  });

  it('maps field error codes to the catalog, unknown ones to the general message', () => {
    expect(needsFieldErrorKey('PERSON_NOT_ALLOWED')).toBe('fieldErrors.personNotAllowed');
    expect(needsFieldErrorKey('FEWER_THAN_NAMED')).toBe('fieldErrors.fewerThanNamed');
    expect(needsFieldErrorKey('NOT_AN_OPTION')).toBe('fieldErrors.invalid');
  });
});
