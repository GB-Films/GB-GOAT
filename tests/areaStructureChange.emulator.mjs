import { execFileSync } from 'node:child_process';
if (!process.env.GCLOUD_PROJECT?.startsWith('demo-') || !process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Synthetic Firestore emulator required');
execFileSync(process.execPath, ['--test', 'functions/areaStructureChange.test.js'], { stdio: 'inherit', env: process.env });
