-- Rollback of 20261015090100_private__storage_buckets_and_policies.sql. Objects are never deleted here:
-- a bucket that still holds objects is kept (and reported); empty buckets are removed. Storage refuses
-- direct deletes unless storage.allow_delete_query is set for the transaction (storage migration 0055).
drop policy if exists jadarat_files_read on storage.objects;
drop policy if exists jadarat_files_upload on storage.objects;
drop policy if exists jadarat_tenant_prefix on storage.objects;

select set_config('storage.allow_delete_query', 'true', true);
delete from storage.buckets b
where b.id in ('materials', 'images', 'evidence', 'imports', 'generated', 'quarantine')
  and not exists (select 1 from storage.objects o where o.bucket_id = b.id);

do $$
declare
  v_kept text := (select string_agg(id, ', ') from storage.buckets
                  where id in ('materials', 'images', 'evidence', 'imports', 'generated', 'quarantine'));
begin
  if v_kept is not null then
    raise notice 'buckets kept because they still hold objects: %', v_kept;
  end if;
end
$$;
