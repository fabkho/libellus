import {client,short} from './lib.mjs'
import fs from 'fs'
const {ida,max}=JSON.parse(fs.readFileSync('accts.json'))
const I=client(ida),M=client(max)
const out=(k,r)=>console.log(k.padEnd(52),r.status,short(r.body),r.ms?`${r.ms}ms`:'')
out('ida INSERT books owner null (catalogue)',await I.post('books',{title:'Injected Catalogue Book',authors:['x'],source:'manual',owner_id:null}))
out('ida INSERT books owner=max',await I.post('books',{title:'x',authors:['x'],source:'manual',owner_id:max.id}))
out('ida INSERT books owner=ida',await I.post('books',{title:'x',authors:['x'],source:'manual',owner_id:ida.id}))
out("ida PATCH max's manual book",await I.patch('books?owner_id=eq.'+max.id,{title:'pwned'}))
const mine=(await I.get('books?owner_id=eq.'+ida.id+'&select=id')).body[0]?.id
out('ida PATCH own manual owner_id=null (publish)',await I.patch('books?id=eq.'+mine,{owner_id:null}))
out('ida DELETE own book direct',await I.del('books?id=eq.'+mine))
out('ida PATCH catalogue book',await I.patch('books?owner_id=is.null&title=like.SecSeries*',{title:'pwned'}))
// huge titles
for (const n of [10000,200000,2000000]) out('add_manual_book title '+n,await I.rpc('add_manual_book',{p_title:'Hugeword '+'a'.repeat(n),p_authors:['A'],p_isbn:null,p_page_count:1,p_status:'want_to_read'}))
out('add_manual_book many-word title',await I.rpc('add_manual_book',{p_title:Array.from({length:60000},(_,i)=>'w'+i).join(' '),p_authors:['A'],p_isbn:null,p_page_count:1,p_status:'want_to_read'}))
out('add_manual_book catalog-isbn collision',await I.rpc('add_manual_book',{p_title:'Collider',p_authors:['A'],p_isbn:'9780306406157',p_page_count:1,p_status:'want_to_read'}))
out('ida search Collider (own)',await I.rpc('search_books',{p_query:'9780306406157'}))
out('max search same isbn (his own only)',await M.rpc('search_books',{p_query:'9780306406157'}))
