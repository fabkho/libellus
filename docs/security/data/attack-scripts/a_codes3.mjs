import {client,short} from './lib.mjs'
import fs from 'fs'
const {ida,max,cleo}=JSON.parse(fs.readFileSync('accts.json'))
const I=client(ida),M=client(max),C=client(cleo)
const ghost='11111111-2222-4333-8444-555555555555'
const out=(k,r)=>console.log(k.padEnd(40),r.status,short(r.body),r.ms+'ms')
const tok=(await M.rpc('my_social')).body.link
out('cleo follow_target(max token)',await C.rpc('follow_target',{p_token:tok}))
out('cleo follow max (private)',await C.rpc('follow',{p_member:max.id}))
out('max block cleo',await M.rpc('block',{p_member:cleo.id}))
console.log('Cleo is blocked by Max. Cleo calls, ghost vs Max (blocker) vs Ida (live, no link, no relation):')
for (const [n,fn,args] of [
 ['follow','follow',m=>({p_member:m})],['member_profile','member_profile',m=>({p_member:m})],
 ['member_want','member_want',m=>({p_member:m})],['member_reading_record','member_reading_record',m=>({p_member:m})],
 ['withdraw_request','withdraw_request',m=>({p_member:m})],['answer_request','answer_request',m=>({p_member:m,p_accept:true})],
 ['remove_follower','remove_follower',m=>({p_member:m})],['unfollow','unfollow',m=>({p_member:m})],
]) {
  const a=await C.rpc(fn,args(ghost)), b=await C.rpc(fn,args(max.id)), d=await C.rpc(fn,args(ida.id))
  const eq=(x,y)=>JSON.stringify([x.status,x.body])===JSON.stringify([y.status,y.body])
  console.log(n.padEnd(22),a.status,short(a.body).slice(0,52).padEnd(52),'ghost==blocker:',eq(a,b),' ghost==stranger:',eq(a,d))
}
out('cleo follow_target(max token)',await C.rpc('follow_target',{p_token:tok}))
out('cleo follow_target(garbage)',await C.rpc('follow_target',{p_token:'garbage'}))
out('max follow cleo (blocker->blocked)',await M.rpc('follow',{p_member:cleo.id}))
out('max follow ghost',await M.rpc('follow',{p_member:ghost}))
const t=async(m)=>{const a=[];for(let i=0;i<60;i++){a.push((await C.raw('POST','/rest/v1/rpc/follow',{p_member:m})).ms)}a.sort((x,y)=>x-y);return a[30]}
console.log('median ms follow: ghost',await t(ghost),'blocker',await t(max.id),'stranger',await t(ida.id))
// what does cleo learn from blocked by max? direct table reads
out('cleo GET blocks',await C.get('blocks?select=*'))
out('cleo GET follows',await C.get('follows?select=*'))
out('max GET blocks',await M.get('blocks?select=*'))
out('ida GET follows',await I.get('follows?select=*'))
out('cleo feed',await C.rpc('feed',{p_before:null,p_before_id:null,p_limit:30}))
out('cleo feed limit 1e9',await C.rpc('feed',{p_before:null,p_before_id:null,p_limit:1000000000}))
