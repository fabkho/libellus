import {client,short} from './lib.mjs'
import fs from 'fs'
const {ida,max}=JSON.parse(fs.readFileSync('accts.json'))
const I=client(ida),M=client(max),A=client(null)
const q='library_entries?select=id&order=added_at.desc,id'
const all=(await I.get(q)).body; console.log('no range:',all.length,'(cap)')
const p1=(await I.get(q,{Range:'0-999'})).body, p2=(await I.get(q,{Range:'1000-1999'})).body
const ids=new Set([...p1,...p2].map(r=>r.id)); console.log('pages',p1.length,p2.length,'unique',ids.size)
const r=await I.raw('GET','/rest/v1/'+q,undefined,{Range:'5000-5999','Range-Unit':'items',Prefer:'count=exact'}); console.log('far range',r.status,short(r.body),r.headers.get('content-range'))
const m=await M.raw('GET','/rest/v1/'+q,undefined,{Range:'0-999',Prefer:'count=exact'}); console.log('max sees',m.body.length,'content-range',m.headers.get('content-range'))
const a=await A.raw('GET','/rest/v1/'+q); console.log('anon',a.status)
const big=await I.raw('GET','/rest/v1/'+q+'&limit=100000&offset=0'); console.log('limit=100000 ->',big.body.length)
const e=await I.raw('GET','/rest/v1/library_entries?select=id&order=latest(started_on).desc.nullslast,id&limit=3'); console.log('order latest()',e.status,short(e.body))
const bad=await I.raw('GET','/rest/v1/library_entries?select=id&order=member_id.desc.nullsfirst;drop&limit=3'); console.log('order bad',bad.status,short(bad.body))
// order by a column of another table through embedding: can ordering leak?
const o=await I.raw('GET','/rest/v1/library_entries?select=id,books(title)&order=books(owner_id).asc&limit=2'); console.log('order by embedded owner',o.status,short(o.body))
