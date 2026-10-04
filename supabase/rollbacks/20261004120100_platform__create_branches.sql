-- Rollback of 20261004120100_platform__create_branches.sql.
drop table platform.branches;
drop function private.check_branch_timezone();
