import {client,short} from './lib.mjs'
import fs from 'fs'
const {max}=JSON.parse(fs.readFileSync('accts.json'))
const M=client(max)
const r=await M.rpc('search_books',{p_query:'Sec Cover Track'}); console.log(r.status, r.body.map(b=>[b.title,b.cover_url,b.source,b.owner_id]))
const r2=await M.rpc('search_books',{p_query:'Sec Desc'}); console.log(r2.body.map(b=>[b.title,b.description]))
