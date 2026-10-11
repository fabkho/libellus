import {client,short} from './lib.mjs'
import fs from 'fs'
const {ida}=JSON.parse(fs.readFileSync('accts.json')); const I=client(ida)
const r=await I.rpc('add_to_library',{p_book:{source:'openlibrary',openlibrary_edition_key:'../../search.json?q=libellus&limit=1#',title:'OL key traversal probe',authors:['A']},p_status:'want_to_read'})
console.log(r.status,short(r.body))
