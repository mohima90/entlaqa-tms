-- Rollback of 20261113120400_private__session_tenants_sorted_by_either_name.sql: the definition of
-- 20261027100200 (sorted by the Arabic name).

CREATE OR REPLACE FUNCTION private.session_tenants()
 RETURNS TABLE(tenant_id uuid, name_ar text, name_en text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_claims jsonb := private.request_claims();
  v_user uuid;
  v_session uuid;
begin
  if session_user <> 'app_server' or v_claims is null or coalesce(v_claims ->> 'role', '') <> 'authenticated' then
    return;
  end if;
  v_user := private.try_uuid(v_claims ->> 'sub');
  v_session := private.try_uuid(v_claims ->> 'session_id');
  if not private.user_session_is_valid(v_user, v_session) then
    return;
  end if;

  return query
    select t.id, t.name_ar, t.name_en
    from platform.tenant_memberships m
    join platform.tenants t on t.id = m.tenant_id
    where m.user_id = v_user
      and m.status = 'active'
      and (t.status in ('active', 'trial')
           or (t.status = 'suspended' and m.tenant_id in (select private.paused_admin_tenants(v_user))))
    order by t.name_ar, t.id;
end
$function$;
