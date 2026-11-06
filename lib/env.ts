import {existsSync} from 'node:fs';
// Next loads this itself; standalone database/test commands must use the same file.
// Explicit environment variables take precedence over .env.local.
if(existsSync('.env.local'))process.loadEnvFile('.env.local');
