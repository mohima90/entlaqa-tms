-- File status `accepted` (WP-ADM-02, FR-ADM-07; PO decision 20 Oct 2026; ADR 0006 amendment): the honest
-- state of an upload whose purpose needs no malware scan (platform.file_purposes.scan_required = false,
-- 20261023100400 — the branding images). It says "checked by content and accepted WITHOUT a virus scan,
-- by the purpose's policy" — never `clean`, which keeps meaning "the scanner found nothing":
--   uploaded → accepted  only for purposes with scan_required = false, by the branding publishing paths
--                        (private.publish_brand_image, 20261023100600): the type detected by content, the
--                        size read and the SHA-256 of the stored bytes are recorded (files_accepted_check),
--                        like a scan records them; nothing about a scan (engine, signatures, scanned_at).
--   accepted → deleted   the owner (a replaced or removed image is released by the Branding save).
-- What `accepted` does NOT give: every generic path still requires `clean` — download grants
-- (private.grant_file_download), the Storage read policy for downloads, module jobs' openScannedFile, use
-- marks — so an accepted file is usable by the branding paths alone. The scan result's immutability rule
-- covers what acceptance recorded too.
-- Expand-first: older code never sees the status (only branding images reach it, through new functions).
set lock_timeout = '5s';

alter table platform.files drop constraint files_status_check;
alter table platform.files add constraint files_status_check check (
  status in ('pending_upload', 'uploaded', 'scanning', 'clean', 'accepted', 'infected', 'rejected', 'error', 'deleted'))
  not valid;
alter table platform.files validate constraint files_status_check;

-- An accepted file has what its acceptance established (like files_clean_check for a scan).
alter table platform.files add constraint files_accepted_check check (
  status <> 'accepted' or (detected_mime is not null and size_bytes is not null and sha256 is not null)) not valid;
alter table platform.files validate constraint files_accepted_check;

-- The write guard (20261015090000) with the two moves of `accepted`; everything else as before.
create or replace function private.files_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending_upload' or new.scan_attempts <> 0 or new.scan_failures <> 0 or new.scan_crashes <> 0
       or new.scan_claimed_at is not null or new.used_at is not null or new.deleted_at is not null
       or new.uploaded_at is not null or new.quarantined_at is not null or new.object_removed_at is not null
       or new.purged_at is not null or new.detected_mime is not null or new.sha256 is not null or new.size_bytes is not null then
      raise exception 'a file starts as pending_upload' using errcode = 'insufficient_privilege';
    end if;
    new.created_at := now();
    new.updated_at := new.created_at;
    return new;
  end if;
  if new.id <> old.id or new.tenant_id <> old.tenant_id or new.object_key <> old.object_key or new.purpose <> old.purpose
     or new.owner_module <> old.owner_module or new.owner_entity_type <> old.owner_entity_type
     or new.owner_entity_id <> old.owner_entity_id or new.declared_mime <> old.declared_mime
     or new.declared_size <> old.declared_size or new.retention_class <> old.retention_class
     or new.created_by_user is distinct from old.created_by_user or new.created_by_person is distinct from old.created_by_person
     or new.created_at <> old.created_at or new.upload_expires_at <> old.upload_expires_at then
    raise exception 'the identity of a file cannot change' using errcode = 'insufficient_privilege';
  end if;
  -- The object moves only into quarantine, once, for an infected file.
  if new.bucket <> old.bucket and not (old.status = 'infected' and new.status = 'infected' and new.bucket = 'quarantine') then
    raise exception 'a file changes bucket only into quarantine' using errcode = 'insufficient_privilege';
  end if;
  if new.status <> old.status then
    v_ok := case old.status
      when 'pending_upload' then new.status in ('uploaded', 'rejected', 'deleted')
        or (new.status = 'clean' and exists (select 1 from platform.file_purposes p
                                             where p.purpose = new.purpose and p.upload_by = 'worker'))
      -- → accepted: only a purpose that needs no malware scan (20261023100400; PO, 20 Oct 2026).
      when 'uploaded' then new.status in ('scanning', 'deleted')
        or (new.status = 'accepted' and exists (select 1 from platform.file_purposes p
                                                where p.purpose = new.purpose and not p.scan_required))
      -- → deleted: a file waiting for the scanner (its owner gives up; delete_file checks no worker holds
      -- the scan lease). Never readable or usable before a verdict, so nothing is lost but the wait.
      when 'scanning' then new.status in ('clean', 'infected', 'rejected', 'error', 'deleted')
      when 'clean' then new.status = 'deleted'
      when 'accepted' then new.status = 'deleted'
      when 'rejected' then new.status = 'deleted'
      when 'error' then new.status = 'deleted'
      else false
    end;
    if not v_ok then
      raise exception 'file status % cannot become %', old.status, new.status using errcode = 'insufficient_privilege';
    end if;
  end if;
  -- What the scan (or the acceptance) established does not change afterwards.
  if old.status in ('clean', 'accepted', 'infected') and (new.sha256 is distinct from old.sha256
       or new.detected_mime is distinct from old.detected_mime or new.size_bytes is distinct from old.size_bytes) then
    raise exception 'the scan result of a file cannot change' using errcode = 'insufficient_privilege';
  end if;
  new.updated_at := now();
  return new;
end
$$;
comment on function private.files_transition() is
  'SECURITY-RELEVANT (T-M2-18, WP-ADM-02). platform.files write guard: new files start pending_upload; allowed status transitions only (uploaded → accepted only for purposes without a malware scan); identity immutable; bucket changes only into quarantine.';
revoke all on function private.files_transition() from public;
