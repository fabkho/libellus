import {client,short} from './lib.mjs'
import fs from 'fs'
const {ida,max,cleo}=JSON.parse(fs.readFileSync('accts.json'))
const I=client(ida),M=client(max),A=client(null),S=client('service')
const out=(k,r)=>console.log(k.padEnd(52),r.status,short(r.body),r.ms?`${r.ms}ms`:'')
const row={title_key:'poison title|author',status:'found',matched_by:'title',goodreads_id:'1',rating:5,ratings_count:1,checked_at:new Date().toISOString()}
out('anon GET goodreads_title_ratings',await A.get('goodreads_title_ratings?select=*'))
out('anon GET goodreads_ratings',await A.get('goodreads_ratings?select=*'))
out('ida INSERT goodreads_title_ratings',await I.post('goodreads_title_ratings',row))
out('ida UPSERT (merge-duplicates)',await I.post('goodreads_title_ratings',row,{Prefer:'resolution=merge-duplicates,return=representation'}))
out('ida PATCH goodreads_title_ratings',await I.patch('goodreads_title_ratings?title_key=like.*',{rating:5}))
out('ida DELETE goodreads_title_ratings',await I.del('goodreads_title_ratings?title_key=like.*'))
out('ida INSERT goodreads_ratings',await I.post('goodreads_ratings',{isbn13:'9780306406157',status:'not_found',checked_at:new Date().toISOString()}))
out('ida DELETE goodreads_ratings',await I.del('goodreads_ratings?isbn13=like.*'))
out('ida TRUNCATE via rpc? n/a ida GET (rows)',await I.get('goodreads_title_ratings?select=title_key,status,checked_at&limit=5'))
out('service insert bad key (no pipe)',await S.post('goodreads_title_ratings',{title_key:'nopipe',status:'not_found',checked_at:new Date().toISOString()}))
out('service insert key >1000',await S.post('goodreads_title_ratings',{title_key:'a'.repeat(600)+'|'+'b'.repeat(600),status:'not_found',checked_at:new Date().toISOString()}))
out('service insert rating 6',await S.post('goodreads_title_ratings',{title_key:'x|y',status:'found',matched_by:'title',goodreads_id:'1',rating:6,ratings_count:1,checked_at:new Date().toISOString()}))
out('service insert html id',await S.post('goodreads_title_ratings',{title_key:'x|y',status:'found',matched_by:'title',goodreads_id:'<img src=x>',rating:4,ratings_count:1,checked_at:new Date().toISOString()}))
// Manual book -> function would store title key readable by every member: show what a member can see
out('service insert a not_found key as a Manual title would produce',await S.post('goodreads_title_ratings',{title_key:'zorbulax geheim tagebuch|zorbulax',status:'not_found',checked_at:new Date().toISOString()}))
out('max reads all keys (shared cache)',await M.get('goodreads_title_ratings?select=title_key,status,checked_at'))
out('max filter by prefix ilike zorb*',await M.get('goodreads_title_ratings?title_key=ilike.zorb*&select=title_key'))
out('goodreads_rating(books) computed rel, ida',await I.get('books?select=id,title,goodreads:goodreads_rating(*)&limit=2'))
