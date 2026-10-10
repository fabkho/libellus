import {client,short,API,ANON} from './lib.mjs'
import fs from 'fs'
const {ida}=JSON.parse(fs.readFileSync('accts.json'))
const A=client(null),I=client(ida)
console.log('invite_code_status valid',short((await A.rpc('invite_code_status',{p_code:'LIBELLUS-DEV'})).body))
console.log('invite_code_status bogus',short((await A.rpc('invite_code_status',{p_code:'nope'})).body))
console.log('log_client_error anon',(await A.rpc('log_client_error',{p_kind:'error',p_message:'x'.repeat(100000),p_stack:null,p_route:'/',p_app_version:'1',p_user_agent:'ua',p_standalone:false,p_online:true,p_count:1})).status)
for (const p of ['storage/v1/bucket','storage/v1/object/list/avatars']) { const r=await fetch(API+'/'+p,{method:p.includes('list')?'POST':'GET',headers:{apikey:ANON,authorization:'Bearer '+ida.token,'content-type':'application/json'},body:p.includes('list')?JSON.stringify({prefix:'',limit:10}):undefined}); console.log(p,r.status,(await r.text()).slice(0,200)) }
const r=await fetch(API+'/rest/v1/',{headers:{apikey:ANON}}); console.log('openapi root anon',r.status,(await r.text()).length)
const g=await fetch(API+'/graphql/v1',{method:'POST',headers:{apikey:ANON,'content-type':'application/json'},body:JSON.stringify({query:'{__typename}'})}); console.log('graphql',g.status,(await g.text()).slice(0,100))
