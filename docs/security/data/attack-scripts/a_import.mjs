import {client,short} from './lib.mjs'
import fs from 'fs'
const {ida,max,cleo}=JSON.parse(fs.readFileSync('accts.json'))
const I=client(ida),M=client(max),C=client(cleo)
const maxBook=(await M.get('books?owner_id=eq.'+max.id+'&select=id,isbn13&limit=1')).body[0]; console.log('max manual book',maxBook)
const run=Date.now()
console.log('cleo import book_id=max manual:',short((await C.rpc('import_books',{p_rows:[{key:'goodreads:'+run+'1',book_id:maxBook.id,status:'want_to_read'}]})).body))
console.log('cleo import source=import isbn of max manual:',short((await C.rpc('import_books',{p_rows:[{key:'goodreads:'+run+'2',book:{title:'Zorbulax Geheim Tagebuch',authors:['Maximus Zorbulax'],isbn13:maxBook.isbn13,source:'import'},status:'want_to_read'}]})).body))
console.log('cleo import manual same title (own copy):',short((await C.rpc('import_books',{p_rows:[{key:'goodreads:'+run+'3',book:{title:'Zorbulax Geheim Tagebuch',authors:['Maximus Zorbulax'],source:'manual'},status:'want_to_read'}]})).body))
console.log('cleo library after:',short((await C.get('library_entries?select=book_id,books(title,owner_id)')).body))
console.log('max library unchanged:',(await M.get('library_entries?select=id')).body.length)
console.log('ida import 100 rows bad:',short((await I.rpc('import_books',{p_rows:Array.from({length:101},(_,i)=>({key:'x:'+i}))})).body))
console.log('ida import huge review:',short((await I.rpc('import_books',{p_rows:[{key:'goodreads:'+run+'9',book:{title:'Rv',authors:['A'],source:'manual'},status:'finished',rating:12,ended_on:'2020-01-01',review:'r'.repeat(2000000)}]})).body).slice(0,200))
