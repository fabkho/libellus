import {client,short} from './lib.mjs'
import fs from 'fs'
const {ida,max,cleo}=JSON.parse(fs.readFileSync('accts.json')); const C=client(cleo),M=client(max)
const r=await C.rpc('import_books',{p_rows:[{key:'goodreads:cov'+Date.now(),book:{title:'Import Cover Probe',authors:['A'],isbn13:'9780140449136',source:'import',cover_url:'https://evil.example/imp.gif'},status:'want_to_read'}]}); console.log(short(r.body))
console.log(short((await M.rpc('search_books',{p_query:'9780140449136'})).body.map?.(b=>[b.title,b.cover_url])))
