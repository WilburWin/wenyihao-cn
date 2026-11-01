import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Guestbook,validateNote} from '../worker/community.js';
import worker from '../worker/index.js';

function setup(){
  const data=new Map(),pending=[];
  const storage={
    async get(key){return data.get(key);},
    async put(values){for(const [key,value] of Object.entries(values))data.set(key,value);},
    async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])data.delete(key);},
    async list(options){let rows=[...data].filter(([key])=>key.startsWith(options.prefix)&&(!options.end||key<options.end)).sort(([a],[b])=>a.localeCompare(b));if(options.reverse)rows.reverse();return new Map(rows.slice(0,options.limit));},
    async transaction(callback){return callback(storage);}
  };
  return {data,pending,book:new Guestbook({storage,waitUntil:p=>pending.push(p)})};
}
function post(body,ip='127.0.0.1'){return new Request('https://example.com/api/guestbook',{method:'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':ip},body:JSON.stringify(body)});}
test('note validation rejects whitespace, oversize names, spam honeypot and malformed values',()=>{
  assert.deepEqual(validateNote({message:' hello '}),{name:'匿名旅人',message:'hello'});
  for(const body of [{message:' '},{message:'x'.repeat(201)},{message:'ok',name:'n'.repeat(25)},{message:'ok',website:'spam'},{message:123},{message:'ok',name:{}}])assert.throws(()=>validateNote(body));
});
test('notes persist, markup stays plain data, and same visitor is throttled',async()=>{
  const {book,pending}=setup();
  const response=await book.fetch(post({message:'<img onerror=alert(1)>'}));assert.equal(response.status,201);
  const list=await (await book.fetch(new Request('https://example.com/api/guestbook'))).json();
  assert.equal(list.notes[0].message,'<img onerror=alert(1)>');
  assert.equal((await book.fetch(post({message:'again'}))).status,429);
  assert.equal((await book.fetch(post({message:'another visitor'},'127.0.0.2'))).status,201);
  await Promise.all(pending);
});
test('cursor pagination has no duplicates and invalid cursor is rejected',async()=>{
  const {book,data}=setup();
  for(let i=0;i<30;i++)data.set(`note:${1700000000000+i}:00000000-0000-0000-0000-000000000000`,{name:'test',message:String(i),createdAt:new Date().toISOString()});
  const first=await (await book.fetch(new Request('https://example.com/api/guestbook'))).json();
  const second=await (await book.fetch(new Request('https://example.com/api/guestbook?cursor='+encodeURIComponent(first.cursor)))).json();
  assert.equal(first.notes.length,25);assert.equal(second.notes.length,5);assert.equal(new Set([...first.notes,...second.notes].map(n=>n.id)).size,30);
  assert.equal((await book.fetch(new Request('https://example.com/api/guestbook?cursor=bad'))).status,400);
});
test('body byte limit applies without Content-Length',async()=>{
  const {book}=setup();assert.equal((await book.fetch(post({message:'中'.repeat(2000)}))).status,413);
});
test('public endpoint rejects cross-origin writes and unauthorized deletion before storage',async()=>{
  assert.equal((await worker.fetch(new Request('https://example.com/api/guestbook',{method:'POST',headers:{Origin:'https://other.com'}}),{},{})).status,403);
  assert.equal((await worker.fetch(new Request('https://example.com/api/guestbook',{method:'DELETE',headers:{Origin:'https://example.com'}}),{},{})).status,403);
});
