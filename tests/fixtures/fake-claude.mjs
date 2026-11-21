#!/usr/bin/env node
if(process.argv.slice(2).join(' ')!=='auth status --json')process.exit(3);
console.log(JSON.stringify({subscriptionType:'pro',email:'test-only-never-store@example.invalid'}));
