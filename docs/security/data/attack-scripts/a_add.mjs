import {client,short} from './lib.mjs'
import fs from 'fs'
const {ida,max}=JSON.parse(fs.readFileSync('accts.json'))
const I=client(ida)
const out=(k,r)=>console.log(k.padEnd(52),r.status,short(r.body),r.ms?`${r.ms}ms`:'')
const mk=(title,extra={})=>({p_book:{source:'apple',apple_id:String(9000000000+Math.floor(Math.random()*1e8)),title,authors:['A'],...extra},p_status:'want_to_read'})
out('normal',await I.rpc('add_to_library',mk('Sec Normal Title')))
out('title 100000 chars one word',await I.rpc('add_to_library',mk('Hugeword'+'a'.repeat(100000))))
out('title 60000 words',await I.rpc('add_to_library',mk(Array.from({length:60000},(_,i)=>'w'+i).join(' '))))
out('title 5 MB',await I.rpc('add_to_library',mk('x '.repeat(2500000))))
out('cover_url javascript:',await I.rpc('add_to_library',mk('Sec Cover JS',{cover_url:'javascript:alert(1)'})))
out('cover_url tracking host',await I.rpc('add_to_library',mk('Sec Cover Track',{cover_url:'https://evil.example/pixel.gif'})))
out('description html',await I.rpc('add_to_library',mk('Sec Desc',{description:'<img src=x onerror=alert(1)>'})))
const r=await I.get('books?title=like.Sec%20*&select=title,cover_url,description,source&limit=10'); out('stored',r)
