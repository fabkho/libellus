import {client,short,ANON,SERVICE,API} from './lib.mjs'
import fs from 'fs'
const {ida}=JSON.parse(fs.readFileSync('accts.json'))
const F=API+'/functions/v1/goodreads-rating'
const call=async(label,{method='POST',auth,body,url=F,ct='application/json',extra={}})=>{
  const t0=performance.now()
  const r=await fetch(url,{method,headers:{...(auth?{authorization:'Bearer '+auth}:{}),apikey:ANON,'content-type':ct,...extra},body})
  const t=await r.text(); console.log(label.padEnd(44),r.status,short(t),Math.round(performance.now()-t0)+'ms', r.headers.get('access-control-allow-origin')||'')
}
await call('no auth header',{body:'{}'})
await call('anon key as bearer',{auth:ANON,body:'{"isbn13":"9780306406157"}'})
await call('garbage bearer',{auth:'abc.def.ghi',body:'{}'})
await call('expired-looking jwt (tampered sig)',{auth:ida.token.slice(0,-3)+'AAA',body:'{}'})
await call('PUT with member',{method:'PUT',auth:ida.token,body:'{}'})
await call('member: body not json',{auth:ida.token,body:'not json'})
await call('member: empty {}',{auth:ida.token,body:'{}'})
await call('member: bad isbn',{auth:ida.token,body:'{"isbn13":"123"}'})
await call('member: isbn injection',{auth:ida.token,body:'{"isbn13":"9780306406157&isbns=1#"}'})
await call('member: isbn is object',{auth:ida.token,body:'{"isbn13":{"a":1}}'})
await call('member: title only (no author)',{auth:ida.token,body:'{"title":"Dune"}'})
await call('member: title array',{auth:ida.token,body:'{"title":["a"],"authors":"x"}'})
await call('member: GET no params',{method:'GET',auth:ida.token,body:undefined})
await call('member: 8MB body',{auth:ida.token,body:JSON.stringify({title:'x',authors:['a'.repeat(8*1024*1024)]})})
await call('service key (allowed by design)',{auth:SERVICE,body:'{}'})
