import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as normalization from '../build/core/normalize.js';
const read=(value)=>normalization.parseClaudeCliUsage(value,'cli-test',1800000000000);
test('Team CLI quota projects only known windows and tier, preserving zero usage',()=>{
 const s=read({subscription_type:'team',rate_limits_available:true,rate_limits:{five_hour:{utilization:0,resets_at:'2027-01-15T08:00:00Z'},seven_day:{utilization:41.5,resets_at:null}},email:'private@example.test',session:{total_cost_usd:1000}});
 assert.equal(s.planType,'team');assert.equal(s.windows.length,2);
 assert.equal(s.windows[0].usedPercent,0);assert.equal(s.windows[0].durationSeconds,18000);
 assert.equal(s.windows[0].resetsAt,1800000000);assert.equal(s.windows[1].usedPercent,41.5);
 assert.equal(s.windows[1].resetsAt,null);assert.equal(JSON.stringify(s).includes('private@'),false);
});
test('CLI missing quotas stay unknown and modern general meters use their reported kind',()=>{
 assert.deepEqual(read({subscription_type:'team',rate_limits_available:false,rate_limits:null}).windows,[]);
 assert.deepEqual(read({subscription_type:'team',rate_limits_available:true,rate_limits:null}).windows,[]);
 const s=read({subscription_type:'team',rate_limits_available:true,rate_limits:{limits:[{kind:'weekly_scoped',group:'weekly',percent:99,resets_at:null},{kind:'session',group:'session',percent:27,resets_at:null},{kind:'weekly_all',group:'weekly',percent:62,resets_at:null}]}});
 assert.equal(s.windows.length,2);assert.equal(s.windows[0].label,'세션');assert.equal(s.windows[0].durationSeconds,null);
 assert.equal(s.windows[1].usedPercent,62);assert.equal(s.windows[1].label,'주간');
});
test('CLI resets with sub-millisecond precision are read for legacy windows and general meters',()=>{
 // Claude Code 2.1.323 reported resets_at with microseconds and a numeric offset.
 const resets_at='2027-01-15T08:00:00.947265+00:00';
 const legacy=read({subscription_type:'team',rate_limits_available:true,rate_limits:{five_hour:{utilization:11,resets_at},seven_day:{utilization:2,resets_at:'2027-01-15T17:00:00.947265+09:00'}}});
 assert.deepEqual(legacy.windows.map(w=>w.resetsAt),[1800000000,1800000000]);
 const meters=read({subscription_type:'team',rate_limits_available:true,rate_limits:{limits:[{kind:'session',percent:11,resets_at}]}});
 assert.equal(meters.windows[0].resetsAt,1800000000);
 assert.equal(read({rate_limits_available:true,rate_limits:{five_hour:{utilization:1,resets_at:'2027-01-15T08:00:00.123456789Z'}}}).windows[0].resetsAt,1800000000);
 assert.throws(()=>read({rate_limits_available:true,rate_limits:{five_hour:{utilization:1,resets_at:'2027-01-15T08:00:00.1234567890Z'}}}),/Invalid CLI reset/);
});
test('CLI schema changes cannot turn bad percentages or dates into valid quotas',()=>{
 for(const utilization of ['0',-1,101,Infinity])assert.throws(()=>read({rate_limits_available:true,rate_limits:{five_hour:{utilization}}}));
 for(const resets_at of ['tomorrow','1800000000','not-a-date'])assert.throws(()=>read({rate_limits_available:true,rate_limits:{five_hour:{utilization:1,resets_at}}}));
 assert.deepEqual(read({rate_limits_available:true,rate_limits:{five_hour:{utilization:null,resets_at:null}}}).windows,[]);
 assert.throws(()=>read({rate_limits_available:true,rate_limits:{limits:Array.from({length:65},()=>({kind:'session',percent:1}))}}));
});
