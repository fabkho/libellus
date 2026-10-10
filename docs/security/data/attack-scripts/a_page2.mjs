import {client,short} from './lib.mjs'
import fs from 'fs'
const {ida}=JSON.parse(fs.readFileSync('accts.json')); const I=client(ida),A=client(null)
const on=await I.rpc('set_reading_page',{p_on:true}); console.log('set_reading_page',on.status,short(on.body))
const tok=on.body?.token ?? on.body?.link ?? (await I.rpc('renew_reading_page_link')).body; console.log('token',short(tok))
const t=typeof tok==='string'?tok:tok?.token
// make sure the evil-cover book is shared and also a finished one
const e=(await I.get('library_entries?select=id,books(title,cover_url)&books.title=like.Sec%20Cover*')).body; console.log(short(e))
const p=await A.rpc('public_reading_page',{p_token:t}); console.log('page',p.status,short(p.body).slice(0,600))
const all=JSON.stringify(p.body); console.log('contains evil.example?', all.includes('evil.example'), 'contains javascript:', all.includes('javascript:'))
