import {spawnSync} from 'node:child_process';
import {testEnvironment} from './local-safety';
const env=testEnvironment();
for(const args of [['--import','tsx','scripts/setup.ts'],['--import','tsx','--test','--test-concurrency=1','tests/booking.test.ts','tests/ui.test.tsx','tests/local-safety.test.ts']]) {
  const child=spawnSync(process.execPath,args,{stdio:'inherit',env});
  if(child.error)throw child.error;
  if(child.status!==0)process.exit(child.status??1);
}
