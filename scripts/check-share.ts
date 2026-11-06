import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,lstatSync} from 'node:fs';
import {resolve} from 'node:path';

// Read only Git-eligible project text, never ignored environments, DB files or evidence.
// This is a focused publishing guard, not a comprehensive secret-detection service.
const git=(...args:string[])=>execFileSync('git',args,{encoding:'utf8'});
assert.equal(resolve(git('rev-parse','--show-toplevel').trim()),resolve('.'),'Run from the project repository root.');
const files=[...new Set(git('ls-files','--cached','--others','--exclude-standard','-z').split('\0').filter(Boolean))].sort();
const rootFiles=new Set(['.env.example','.gitattributes','.gitignore','.nvmrc','.vercelignore','neon.ts','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.json','run.sh','README.md','DECISIONS.md','DEPLOYMENT.md','REVIEW.md','CLARITY.md','SAFEGUARDS.md','VERIFICATION.md','SHARING.md']);
const required=['neon.ts','lib/hosting.ts','db/runtime_role_grants.sql','scripts/hosted-setup.ts','tests/hosting.test.ts','tests/neon-smoke.ts','.env.example','README.md','DEPLOYMENT.md','SHARING.md','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','run.sh','db/001_initial.sql','scripts/seed.ts','scripts/setup.ts','scripts/test.ts','lib/db.ts','lib/scheduling.ts','lib/auth.ts','app/page.tsx','app/ui.tsx','tests/booking.test.ts','tests/ui.test.tsx','tests/transport-harness.ts'];
for(const path of required)assert.ok(files.includes(path),`Required project file missing or ignored: ${path}`);
for(const path of files) {
  assert.ok(rootFiles.has(path)||/^(app|lib|scripts|tests)\/.*\.(ts|tsx|css)$/.test(path)||/^db\/.*\.sql$/.test(path),`Review unexpected Git candidate before sharing: ${path}`);
  assert.ok(lstatSync(path).isFile(),`Symlinks and non-files must not enter the sharing set: ${path}`);
  const source=readFileSync(path,'utf8');
  const markers=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16})\b/,/"(?:token_hash|recovery_session)"\s*:\s*"[^"]+"/,/\/(?:Users|home)\/[^/\s]+\//];
  assert.ok(!markers.some(pattern=>pattern.test(source)),`Potential private material in ${path}; inspect locally before sharing.`);
  for(const match of source.matchAll(/postgres(?:ql)?:\/\/[^\s`'"<>]+/g)) {
    const url=new URL(match[0]);
    // Only the documented public local defaults and explicitly fictional test values.
    if(url.password)assert.ok(['local-demo-admin','local-demo-app','fictional'].includes(url.password)&&(['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.hostname.endsWith('.example.com')),`Review connection credential in ${path}; value withheld.`);
  }
}
const ignored=['.neon','.agents/skills/neon/SKILL.md','skills-lock.json','.local/hosting/runtime.env','.local/hosting/neon-pulled.env','.local/postgres/PG_VERSION','.local/transport-evidence.json','node_modules/example.js','.next/server/app.js','next-env.d.ts','.env.local','.env.production','.env.production.local','.vercel/project.json','evidence/capture.jpg','backups/demo.sql.gz','demo.dump','private.key','service-account-demo.json','sessions.json','test-results/report.json'];
for(const path of ignored)assert.ok(git('check-ignore','--no-index','--',path).trim(),`Private/generated path is not ignored: ${path}`);
console.log(`Sharing check passed: ${files.length} eligible project files, required source/configuration present, private/generated paths excluded, focused credential/path scan clear.`);
console.log('No files staged, committed, copied or uploaded. Public local-demo passwords are intentional fictional defaults.');
