import {client,short} from './lib.mjs'
import fs from 'fs'
const {ida}=JSON.parse(fs.readFileSync('accts.json')); const I=client(ida)
const words=n=>Array.from({length:n},(_,i)=>'w'+i.toString(36)+'x').join(' ')
for (const n of [1000,5000,20000,100000]) { const r=await I.rpc('search_books',{p_query:words(n)}); console.log(n,'distinct words',r.status,short(r.body),r.ms+'ms') }
const r=await I.rpc('search_books',{p_query:'a '.repeat(500000)}); console.log('500k repeated',r.status,short(r.body),r.ms+'ms')
