import {client,short,ANON} from './lib.mjs'
import fs from 'fs'
const {ida,max,cleo}=JSON.parse(fs.readFileSync('accts.json'))
const I=client(ida),M=client(max),C=client(cleo),A=client(null)
const out=(k,r)=>console.log(k.padEnd(46),r.status,short(r.body),r.ms?`${r.ms}ms`:'')
// Manual books
const mb=await M.rpc('add_manual_book',{p_title:'Zorbulax Geheim Tagebuch',p_authors:['Maximus Zorbulax'],p_isbn:'9780306406157',p_page_count:100,p_status:'want_to_read'})
out('max add_manual_book',mb)
const ib=await I.rpc('add_manual_book',{p_title:'Quillfeather Idas Notizen',p_authors:['Ida Quillfeather'],p_isbn:null,p_page_count:10,p_status:'want_to_read'})
out('ida add_manual_book',ib)
// cross read
for (const [who,c] of [['ida',I],['cleo',C],['anon',A]]) {
 out(who+' search "Zorbulax"',await c.rpc('search_books',{p_query:'Zorbulax'}))
 out(who+' search "Zorb" prefix',await c.rpc('search_books',{p_query:'Zorb'}))
 out(who+' search isbn 9780306406157',await c.rpc('search_books',{p_query:'978-0-306-40615-7'}))
 out(who+' search Maximus',await c.rpc('search_books',{p_query:'Maximus'}))
}
out('max sees own',await M.rpc('search_books',{p_query:'Zorbulax'}))
out('max sees own by isbn',await M.rpc('search_books',{p_query:'9780306406157'}))
out('ida sees Max via REST books?title',await I.get('books?title=ilike.*Zorbulax*'))
out('ida sees Max via REST books?select=*',await I.get('books?select=id,title,owner_id&owner_id=eq.'+max.id))
out('ida table private.book_search (profile)',await I.get('book_search?select=*',{'Accept-Profile':'private'}))
out('ida table private.book_search (public)',await I.get('book_search?select=*'))
out('service table private.book_search profile',await client('service').get('book_search?select=*',{'Accept-Profile':'private'}))
out('ida cron profile',await I.get('job?select=*',{'Accept-Profile':'cron'}))
out('ida rpc private.book_search_sync',await I.rpc('book_search_sync',{},{'Content-Profile':'private'}))
out('ida rpc purge_cron_log',await I.rpc('purge_cron_log',{},{'Content-Profile':'private'}))
out('ida rpc purge_cron_log public',await I.rpc('purge_cron_log',{}))
// crafted queries
const crafted=["'","\"","'; drop table books;--","a:*","*:*","!","!a","a & b | !c","a <-> b","a <1> b","(a","a)","\\","\\'","&","|","()","'':*","a:*b","a:A","a:B","%","_","\u0000","ß","İ","日本","<script>","a'b","a\\b",":*:*", "' & ' | '"," ".repeat(100), "a ".repeat(5000), "Quarvelin ".repeat(2000), "x".repeat(100000), null]
for (const q of crafted){ const r=await I.rpc('search_books',{p_query:q}); const s=short(q??'null').replace(/\n/g,' ').slice(0,26); out('craft '+JSON.stringify(s),r) }
// limits
for (const l of [null,-5,0,1,50,51,1000000,2147483647,'abc']) out('limit '+l,await I.rpc('search_books',{p_query:'the',p_limit:l}))
// wrong types
out('query as number',await I.rpc('search_books',{p_query:123}))
out('query as array',await I.rpc('search_books',{p_query:['a']}))
out('no args',await I.rpc('search_books',{}))
// ts operators on word with 2000 "a"
let t0=performance.now(); let r=await I.rpc('search_books',{p_query:'a ' .repeat(20000)});out('20000 words',r)
// private search with ts_rank leakage: search for Max's private word with different prefixes; should be [] always
