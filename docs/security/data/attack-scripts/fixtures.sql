create temp sequence n start 995000;
do $$
declare v_ida uuid := '<IDA_ID>'; v_s uuid; v_s2 uuid; v_w uuid; v_b uuid; v_e uuid; i int; v_n bigint;
begin
  insert into public.series (name, source) values ('SecSeries Alpha','wikidata') returning id into v_s;
  insert into public.series (name, source) values ('SecSeries Gamma Muted','wikidata') returning id into v_s2;
  for i in 1..3 loop
    v_n := nextval('n');
    insert into public.works (wikidata_id, title) values ('Q'||v_n, 'SecSeries Alpha '||i) returning id into v_w;
    insert into public.books (title, authors, source, apple_id) values ('SecSeries Alpha '||i, array['Sec Author'],'apple','9905'||v_n) returning id into v_b;
    insert into public.book_works (book_id, work_id, matched_by) values (v_b, v_w, 'title');
    insert into public.work_series (work_id, series_id, position, source) values (v_w, v_s, i, 'wikidata');
    if i=1 then
      insert into public.library_entries (member_id, book_id) values (v_ida, v_b) returning id into v_e;
      insert into public.reading_sessions (entry_id, started_on, ended_on, outcome) values (v_e, current_date-5, current_date-1,'finished');
    end if;
    v_n := nextval('n');
    insert into public.works (wikidata_id, title) values ('Q'||v_n, 'SecSeries Gamma '||i) returning id into v_w;
    insert into public.books (title, authors, source, apple_id) values ('SecSeries Gamma '||i, array['Sec Author'],'apple','9905'||v_n) returning id into v_b;
    insert into public.book_works (book_id, work_id, matched_by) values (v_b, v_w, 'title');
    insert into public.work_series (work_id, series_id, position, source) values (v_w, v_s2, i, 'wikidata');
    if i=1 then
      insert into public.library_entries (member_id, book_id) values (v_ida, v_b) returning id into v_e;
      insert into public.reading_sessions (entry_id, started_on, ended_on, outcome) values (v_e, current_date-9, current_date-8,'finished');
    end if;
  end loop;
  insert into public.muted_series (member_id, series_id) values (v_ida, v_s2);
end $$;
select name from public.series where name like 'SecSeries%';
