/** Edit user form helpers (T-M2-13) — shared by the page (server) and the form (client). */

export interface ManagerChoice {
  readonly personId: string;
  readonly name: string;
  readonly active: boolean;
  readonly departmentIds: readonly string[];
}

/**
 * Managers offered for a department (approved screen 2: the managing roles of the chosen
 * department; "all departments" on request). With no department chosen every manager is offered.
 * The selected manager always stays in the list so the choice is never dropped silently.
 */
export function managersFor(
  managers: readonly ManagerChoice[],
  departmentId: string,
  showAll: boolean,
  selectedId: string,
): readonly ManagerChoice[] {
  if (showAll || departmentId === '') return managers;
  return managers.filter(
    (m) => m.personId === selectedId || m.departmentIds.includes(departmentId),
  );
}

/** Field error code per path → the text key of the edit form (codes only; never values). */
export function editFieldErrorKey(path: string, code: string): string {
  switch (path) {
    case 'email':
      return code === 'TAKEN' ? 'emailTaken' : 'email';
    case 'employeeNumber':
      return code === 'TAKEN' ? 'employeeNumberTaken' : 'employeeNumber';
    case 'managerPersonId':
      if (code === 'LOOP') return 'managerLoop';
      if (code === 'INACTIVE') return 'managerInactive';
      return 'managerSelf';
    case 'departmentId':
    case 'branchId':
      return code === 'DELETED' ? 'unitDeleted' : 'unit';
    case 'jobTitleAr':
    case 'jobTitleEn':
      return 'jobTitle';
    case 'hireOn':
      return code === 'AFTER_END' ? 'hireOnAfterEnd' : 'hireOn';
    case 'mobile':
      return 'mobile';
    default:
      return 'name';
  }
}
