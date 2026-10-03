-- Cleaning stored Catalogue rows of HTML entities (issue #47, item 4).
--
-- Apple's titles and artist names sometimes arrive HTML-escaped ("Klara y el
-- Sol &ldquo;Klara and the Sun&rdquo;"). The client decodes them before a Book
-- is stored now (web/app/data/entities.ts); this decodes what was stored before.
-- Catalogue Books only (a member's Manual books are what she typed), the title,
-- authors, publisher and description. The same named entities as the client
-- (the tests keep both lists equal) and every numeric one, in one pass: `&amp;`
-- last, so "&amp;ldquo;" becomes "&ldquo;", not a quote.
--
-- Idempotent: a row without an entity is not touched, so running it again (or
-- on a database already clean) changes nothing. The decoder lives in `pg_temp`
-- and is gone when the migration ends: nothing is added to the API.

create function pg_temp.decode_entities(p text)
returns text
language plpgsql
immutable
as $$
declare
  v text := p;
  r record;
  code text;
  cp integer;
begin
  if v is null or position('&' in v) = 0 then
    return v;
  end if;

  for code in
    select distinct m[1] from regexp_matches(v, '&#([xX][0-9a-fA-F]{1,6}|[0-9]{1,7});', 'g') as m
  loop
    cp := case
      when code ~ '^[xX]' then ('x' || lpad(substr(code, 2), 8, '0'))::bit(32)::integer
      else code::integer
    end;
    if cp between 1 and 1114111 and cp not between 55296 and 57343 then
      v := replace(v, '&#' || code || ';', chr(cp));
    end if;
  end loop;

  for r in
    select * from (values
      ('quot', '"'),
      ('apos', ''''),
      ('lt', '<'),
      ('gt', '>'),
      ('nbsp', ' '),
      ('lsquo', '‘'),
      ('rsquo', '’'),
      ('sbquo', '‚'),
      ('ldquo', '“'),
      ('rdquo', '”'),
      ('bdquo', '„'),
      ('ndash', '–'),
      ('mdash', '—'),
      ('hellip', '…'),
      ('bull', '•'),
      ('middot', '·'),
      ('prime', '′'),
      ('Prime', '″'),
      ('laquo', '«'),
      ('raquo', '»'),
      ('lsaquo', '‹'),
      ('rsaquo', '›'),
      ('copy', '©'),
      ('reg', '®'),
      ('trade', '™'),
      ('deg', '°'),
      ('sect', '§'),
      ('para', '¶'),
      ('euro', '€'),
      ('pound', '£'),
      ('iexcl', '¡'),
      ('iquest', '¿'),
      ('times', '×'),
      ('divide', '÷'),
      ('shy', ''),
      ('Agrave', 'À'),
      ('Aacute', 'Á'),
      ('Acirc', 'Â'),
      ('Atilde', 'Ã'),
      ('Auml', 'Ä'),
      ('Aring', 'Å'),
      ('AElig', 'Æ'),
      ('Ccedil', 'Ç'),
      ('Egrave', 'È'),
      ('Eacute', 'É'),
      ('Ecirc', 'Ê'),
      ('Euml', 'Ë'),
      ('Igrave', 'Ì'),
      ('Iacute', 'Í'),
      ('Icirc', 'Î'),
      ('Iuml', 'Ï'),
      ('ETH', 'Ð'),
      ('Ntilde', 'Ñ'),
      ('Ograve', 'Ò'),
      ('Oacute', 'Ó'),
      ('Ocirc', 'Ô'),
      ('Otilde', 'Õ'),
      ('Ouml', 'Ö'),
      ('Oslash', 'Ø'),
      ('Ugrave', 'Ù'),
      ('Uacute', 'Ú'),
      ('Ucirc', 'Û'),
      ('Uuml', 'Ü'),
      ('Yacute', 'Ý'),
      ('THORN', 'Þ'),
      ('szlig', 'ß'),
      ('agrave', 'à'),
      ('aacute', 'á'),
      ('acirc', 'â'),
      ('atilde', 'ã'),
      ('auml', 'ä'),
      ('aring', 'å'),
      ('aelig', 'æ'),
      ('ccedil', 'ç'),
      ('egrave', 'è'),
      ('eacute', 'é'),
      ('ecirc', 'ê'),
      ('euml', 'ë'),
      ('igrave', 'ì'),
      ('iacute', 'í'),
      ('icirc', 'î'),
      ('iuml', 'ï'),
      ('eth', 'ð'),
      ('ntilde', 'ñ'),
      ('ograve', 'ò'),
      ('oacute', 'ó'),
      ('ocirc', 'ô'),
      ('otilde', 'õ'),
      ('ouml', 'ö'),
      ('oslash', 'ø'),
      ('ugrave', 'ù'),
      ('uacute', 'ú'),
      ('ucirc', 'û'),
      ('uuml', 'ü'),
      ('yacute', 'ý'),
      ('thorn', 'þ'),
      ('yuml', 'ÿ'),
      ('OElig', 'Œ'),
      ('oelig', 'œ'),
      ('Scaron', 'Š'),
      ('scaron', 'š'),
      ('Zcaron', 'Ž'),
      ('zcaron', 'ž')
    ) as named(name, letter)
  loop
    if position('&' || r.name || ';' in v) > 0 then
      v := replace(v, '&' || r.name || ';', r.letter);
    end if;
  end loop;

  return replace(v, '&amp;', '&');
end;
$$;

update public.books
set title = pg_temp.decode_entities(title),
    authors = array(
      select pg_temp.decode_entities(author)
      from unnest(authors) with ordinality as a(author, position)
      order by position
    ),
    publisher = pg_temp.decode_entities(publisher),
    description = pg_temp.decode_entities(description)
where owner_id is null
  and (
    title ~ '&(#[0-9a-zA-Z]+|[a-zA-Z][a-zA-Z0-9]*);'
    or array_to_string(authors, E'\n') ~ '&(#[0-9a-zA-Z]+|[a-zA-Z][a-zA-Z0-9]*);'
    or publisher ~ '&(#[0-9a-zA-Z]+|[a-zA-Z][a-zA-Z0-9]*);'
    or description ~ '&(#[0-9a-zA-Z]+|[a-zA-Z][a-zA-Z0-9]*);'
  );

drop function pg_temp.decode_entities(text);
