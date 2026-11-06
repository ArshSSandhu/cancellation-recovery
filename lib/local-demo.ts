import {demoConfig} from './hosting';
// A build can be inspected locally in production mode. Hosting the passwordless
// identity switcher requires a separate, explicit deployment/authentication decision.
export function requireLocalDemo() {
  return demoConfig();
}
