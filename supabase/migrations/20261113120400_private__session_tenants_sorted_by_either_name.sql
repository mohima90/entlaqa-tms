-- The organizations a session may choose, sorted by the name each has (review of WP-UX-01 d, 14 Nov 2026):
-- an organization may be named in English only since 20261113120000, and `order by t.name_ar` put those last
-- (NULL sorts last). Now `coalesce(t.name_ar, t.name_en)`. Nothing else changes: the definition is
-- 20261027100200's (CREATE OR REPLACE keeps its owner tenant_guard, SECURITY DEFINER, search_path and grants).
-- PII: none.

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
    order by coalesce(t.name_ar, t.name_en), t.id;
end
$function$;
