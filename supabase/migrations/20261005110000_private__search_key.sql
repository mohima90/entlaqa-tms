-- Search key for people names (T-M2-04, FR-IAM-01; Arabic-first): lower case, Arabic letter variants
-- folded (alef with hamza/madda/wasla -> alef, alef maqsura -> yeh, teh marbuta -> heh) and diacritics
-- (U+064B..U+0652) and tatweel (U+0640) removed, so "احمد" finds "أحمد". The letters are written with
-- chr() so the function contains no combining marks. Applied to both the name and the search text.

create or replace function private.search_key(p_value text)
returns text
language sql immutable strict parallel safe
set search_path = ''
as $$
  select translate(
    regexp_replace(lower(p_value), '[' || chr(1611) || '-' || chr(1618) || chr(1600) || ']', '', 'g'),
    chr(1571) || chr(1573) || chr(1570) || chr(1649) || chr(1609) || chr(1577),
    chr(1575) || chr(1575) || chr(1575) || chr(1575) || chr(1610) || chr(1607));
$$;

comment on function private.search_key(text) is
  'Normalized text for name search: lower case, Arabic letter variants folded, diacritics and tatweel removed.';

revoke all on function private.search_key(text) from public;
grant execute on function private.search_key(text) to authenticated;
