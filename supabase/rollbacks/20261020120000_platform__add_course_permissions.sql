-- Rollback of 20261020120000_platform__add_course_permissions.sql.
-- Custom roles lose the course permissions first (their rows reference the catalogue); a platform operation
-- passes the custom-role guard. The change is recorded per role in the audit log.
insert into platform.audit_events (tenant_id, action, entity_type, entity_id, data)
select crp.tenant_id, 'platform.role.updated', 'custom_role', crp.custom_role_id::text,
       jsonb_build_object('removed', array_agg(crp.permission_code order by crp.permission_code),
                          'reason', 'rollback of 20261020120000 (course permissions removed)')
from platform.custom_role_permissions crp
where crp.permission_code in ('tms.course.read', 'tms.course_cost.read', 'tms.course.manage', 'tms.course.archive')
group by crp.tenant_id, crp.custom_role_id;
delete from platform.custom_role_permissions
where permission_code in ('tms.course.read', 'tms.course_cost.read', 'tms.course.manage', 'tms.course.archive');

delete from platform.ref_role_permissions
where permission_code in ('tms.course.read', 'tms.course_cost.read', 'tms.course.manage', 'tms.course.archive');
delete from platform.ref_permissions
where code in ('tms.course.read', 'tms.course_cost.read', 'tms.course.manage', 'tms.course.archive');
