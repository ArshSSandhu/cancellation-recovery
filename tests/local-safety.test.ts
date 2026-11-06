import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertSeedAllowed,testEnvironment} from '../scripts/local-safety';
import {requireLocalDemo} from '../lib/local-demo';

test('reset refuses demo without explicit opt-in, wrong names and all hosted targets',()=>{
  const local='postgres://postgres:fictional@127.0.0.1:55433/';
  assert.throws(()=>assertSeedAllowed(local+'recovery'),/RESET_FICTIONAL_DATA/);
  assert.doesNotThrow(()=>assertSeedAllowed(local+'recovery',true));
  assert.doesNotThrow(()=>assertSeedAllowed(local+'recovery_test'));
  assert.throws(()=>assertSeedAllowed(local+'valuable',true),/only manages/);
  assert.throws(()=>assertSeedAllowed('postgres://owner:fictional@db.example.com/recovery',true),/hosted databases are refused/);
  assert.throws(()=>assertSeedAllowed(local+'recovery?host=db.example.com',true),/override the database target/);
  assert.throws(()=>assertSeedAllowed(local+'recovery?database=valuable',true),/override the database target/);
});
test('test runner refuses a demo database even when a test URL is misconfigured',()=>{
  const before=process.env.TEST_DATABASE_URL;
  try{process.env.TEST_DATABASE_URL='postgres://app:fictional@127.0.0.1:55433/recovery';assert.throws(()=>testEnvironment(),/recovery_test/);}
  finally{if(before===undefined)delete process.env.TEST_DATABASE_URL;else process.env.TEST_DATABASE_URL=before;}
});
test('Vercel runtime disables demo authentication and local destructive tools',()=>{
  const before=process.env.VERCEL;
  try{
    process.env.VERCEL='1';
    assert.throws(()=>requireLocalDemo(),/disabled on Vercel/);
    assert.throws(()=>assertSeedAllowed('postgres://postgres:fictional@127.0.0.1:55433/recovery',true),/hosted databases are refused/);
  }finally{if(before===undefined)delete process.env.VERCEL;else process.env.VERCEL=before;}
});
