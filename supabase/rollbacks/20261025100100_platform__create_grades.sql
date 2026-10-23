-- Rollback of 20261025100100_platform__create_grades.sql.
drop table platform.person_grades;
drop table platform.grades;
drop function private.check_grade();
drop function private.stamp_person_grade();
drop function private.actor_sees_grade_of(uuid, uuid);
drop function private.actor_may_manage_grades(uuid);
comment on column platform.person_employment.grade is 'pii:indirect';
