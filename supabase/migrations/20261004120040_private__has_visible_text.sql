-- Text validation shared by M2 tables (T-M2-01). A required name must contain at least one VISIBLE
-- character: not only white space, and not only invisible or formatting marks (zero-width characters,
-- bidi marks, embeddings, overrides and isolates, the Arabic letter mark, soft hyphen, combining
-- grapheme joiner, fillers, variation selectors, braille blank, object replacement, tag characters). The characters are written as escapes (backslash-u
-- plus 4 hex digits) so the rule itself contains no invisible characters (Trojan-source hazard).

create or replace function private.has_visible_text(p_value text)
returns boolean
language sql immutable strict parallel safe
set search_path = ''
as $$
  select p_value ~ '[^[:space:]\u00A0\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u2028-\u202F\u205F-\u206F\u3000\u3164\uFE00-\uFE0F\uFEFF\uFFA0\u2800\uFFFC\U000E0000-\U000E007F]';
$$;

comment on function private.has_visible_text(text) is
  'True when the text has at least one visible character (not only spaces or invisible/format marks).';

revoke all on function private.has_visible_text(text) from public;
grant execute on function private.has_visible_text(text) to authenticated;
