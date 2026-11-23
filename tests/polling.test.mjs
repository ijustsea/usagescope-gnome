import {test} from 'node:test';
import assert from 'node:assert/strict';
test('runtime polling snaps to 15 s, 1 min or 5 min without polling more often than stored',async()=>{
 const {normalPollSeconds}=await import('../build/core/polling.js');
 for(const [input,want]of [[15,15],[60,60],[300,300],[0,15],[-1,15],[15.9,15],[16,60],[30,60],[61,300],[180,300],[900,300],[3600,300],[4000,300]])
  assert.equal(normalPollSeconds(input),want);
});
test('invalid runtime intervals fall back to one minute rather than a busy loop',async()=>{
 const {normalPollSeconds}=await import('../build/core/polling.js');
 for(const input of [NaN,Infinity,-Infinity,undefined,null,'15',{}])assert.equal(normalPollSeconds(input),60);
});
