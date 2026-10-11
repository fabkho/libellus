import {mk,client} from './lib.mjs'
import fs from 'fs'
const run=Date.now().toString(36)
const ida=await mk(`ida-${run}@atk.test`), max=await mk(`max-${run}@atk.test`), cleo=await mk(`cleo-${run}@atk.test`)
fs.writeFileSync('accts.json',JSON.stringify({ida,max,cleo}))
console.log(ida.id,max.id,cleo.id)
