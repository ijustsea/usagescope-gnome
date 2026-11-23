import {test} from 'node:test';
import assert from 'node:assert/strict';
test('runtime polling accepts 15 seconds and clamps to safe bounds',async()=>{
 const {normalPollSeconds}=await import('../build/core/polling.js');
 for(const [input,want]of [[15,15],[60,60],[180,180],[0,15],[-1,15],[4000,3600],[15.9,15]])
  assert.equal(normalPollSeconds(input),want);
});
test('invalid runtime intervals fall back to one minute rather than a busy loop',async()=>{
 const {normalPollSeconds}=await import('../build/core/polling.js');
 for(const input of [NaN,Infinity,-Infinity,undefined,null,'15',{}])assert.equal(normalPollSeconds(input),60);
});
