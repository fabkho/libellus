export const API=process.env.LIBELLUS_API||'http://127.0.0.1:55761'
export const ANON=process.env.LIBELLUS_ANON_KEY||''
export const SERVICE=process.env.LIBELLUS_SERVICE_KEY||''
export async function mk(email){
  const pw='Sup3r-secret-'+Math.random().toString(36).slice(2)
  let r=await fetch(API+'/auth/v1/admin/users',{method:'POST',headers:{apikey:SERVICE,authorization:'Bearer '+SERVICE,'content-type':'application/json'},body:JSON.stringify({email,password:pw,email_confirm:true,user_metadata:{invite_code:'LIBELLUS-DEV'}})})
  const u=await r.json(); if(!u.id) throw new Error('mk '+JSON.stringify(u))
  r=await fetch(API+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:ANON,'content-type':'application/json'},body:JSON.stringify({email,password:pw})})
  const t=await r.json(); if(!t.access_token) throw new Error('login '+JSON.stringify(t))
  return {id:u.id,token:t.access_token,email}
}
export function client(who){ // who: {token}|null(anon)|'service'
  const tok= who==='service'?SERVICE: who?.token ?? ANON
  const h=(extra={})=>({apikey:who==='service'?SERVICE:ANON,authorization:'Bearer '+tok,'content-type':'application/json',...extra})
  const call=async(method,path,body,extra)=>{
    const t0=performance.now()
    const r=await fetch(API+path,{method,headers:h(extra),body:body===undefined?undefined:JSON.stringify(body)})
    const txt=await r.text(); let j; try{j=JSON.parse(txt)}catch{j=txt}
    return {status:r.status,body:j,ms:Math.round(performance.now()-t0),headers:r.headers}
  }
  return {
    rpc:(fn,args={},extra)=>call('POST','/rest/v1/rpc/'+fn,args,extra),
    get:(p,extra)=>call('GET','/rest/v1/'+p,undefined,extra),
    post:(t,b,extra)=>call('POST','/rest/v1/'+t,b,{Prefer:'return=representation',...extra}),
    patch:(p,b,extra)=>call('PATCH','/rest/v1/'+p,b,{Prefer:'return=representation',...extra}),
    del:(p,extra)=>call('DELETE','/rest/v1/'+p,undefined,{Prefer:'return=representation',...extra}),
    raw:call,
  }
}
export const short=(x)=>{const s=typeof x==='string'?x:JSON.stringify(x);return s.length>160?s.slice(0,160)+'…':s}
