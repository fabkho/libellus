import {client,short} from './lib.mjs'
import fs from 'fs'
const {ida,max,cleo}=JSON.parse(fs.readFileSync('accts.json'))
const I=client(ida),M=client(max),A=client(null),S=client('service')
const out=(k,r)=>console.log(k.padEnd(52),r.status,short(r.body),r.ms?`${r.ms}ms`:'')
out('ida started_and_muted_series',await I.rpc('started_and_muted_series',{}))
out('ida muted_series_list',await I.rpc('muted_series_list',{}))
for (const [n,c] of [['max',M],['anon',A]]) {
  out(n+' started_and_muted_series',await c.rpc('started_and_muted_series',{}))
  out(n+' muted_series_list',await c.rpc('muted_series_list',{}))
  out(n+' started_series_core(true,true)',await c.rpc('started_series_core',{p_limit:50,p_language:'en',p_open:true,p_muted:true}))
  out(n+' started_series_items',await c.rpc('started_series_items',{p_limit:50,p_language:'en',p_muted:true}))
}
out('max GET muted_series',await M.get('muted_series?select=*'))
out('max GET muted_series member=ida',await M.get('muted_series?member_id=eq.'+ida.id))
out('max INSERT muted_series as ida',await M.post('muted_series',{member_id:ida.id,series_id:'00000000-0000-0000-0000-000000000000'}))
const ser=(await S.get('series?name=eq.SecSeries%20Alpha&select=id')).body[0].id
out('max INSERT muted_series as ida real series',await M.post('muted_series',{member_id:ida.id,series_id:ser}))
out('max mute_series self',await M.rpc('mute_series',{p_series:ser}))
out('max started (own mute alpha)',await M.rpc('started_and_muted_series',{}))
out('max unmute ida row? DELETE muted_series ida',await M.del('muted_series?member_id=eq.'+ida.id))
out('ida still muted (gamma)',await I.rpc('muted_series_list',{}))
// params
for (const l of [null,-1,0,1,200,201,2147483647]) { const r=await I.rpc('started_and_muted_series',{p_limit:l}); console.log('limit',l,r.status,JSON.stringify(r.body).length+'B') }
for (const lang of [null,'',"de'; drop table works;--",'x'.repeat(10000),'zz']) { const r=await I.rpc('started_and_muted_series',{p_language:lang}); console.log('lang',short(String(lang)).slice(0,30),r.status,short(r.body).slice(0,80)) }
out('ida work_card other lang',await I.rpc('work_card',{p_work:'00000000-0000-0000-0000-000000000000',p_language:'en',p_position:1}))
out('max GET series (catalogue)',await M.get('series?name=like.SecSeries*&select=name'))
out('anon GET series',await A.get('series?select=name&limit=1'))
