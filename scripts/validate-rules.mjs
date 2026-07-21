import { readFileSync } from 'node:fs';
import { parseForESLint } from '@firebase/eslint-plugin-security-rules/parser';

const ruleFiles = ['firestore.rules', 'storage.rules'];

for (const ruleFile of ruleFiles) {
  parseForESLint(readFileSync(ruleFile, 'utf8'));
  console.log(`${ruleFile}: syntax OK`);
}

