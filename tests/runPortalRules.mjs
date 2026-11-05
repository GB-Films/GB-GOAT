import { spawnSync, execFileSync } from "node:child_process";
import { join } from "node:path";
const cli =
  process.env.FIREBASE_CLI_JS ||
  (process.platform === "win32"
    ? join(
        process.env.APPDATA,
        "npm/node_modules/firebase-tools/lib/bin/firebase.js",
      )
    : join(
        execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(),
        "firebase-tools/lib/bin/firebase.js",
      ));
const cases = [
  ["categoryBudgets", "demo-goat-category-budgets", "firestore"],
  ["projectPins", "demo-goat-project-pins", "firestore"],
  ["providerIntake", "demo-goat-provider-intake", "firestore"],
  ["projectCommercialRules", "demo-gb-goat-commercial", "firestore"],
  ["projectAdministrationRules", "demo-gb-goat-administration", "firestore"],
  [
    "administrativeDocumentsRules",
    "demo-gb-goat-admin-documents",
    "firestore,storage",
  ],
  ["areaExpenseAccessRules", "demo-goat-area-access", "firestore"],
  ["financialRules", "demo-gb-goat-financial-rules", "firestore"],
  ["providerFinance", "demo-goat-provider-finance", "firestore,storage"],
  ["providerWorkAuthorizations", "demo-goat-work-authorizations", "firestore"],
  [
    "storagePaymentReceipts",
    "demo-gb-goat-storage-receipts",
    "firestore,storage",
  ],
  ["generalCashAccess", "demo-goat-general-cash", "firestore"],
  ["cashSubdeliveryRules", "demo-goat-cash-subdeliveries", "firestore"],
  ["teamOnboarding", "demo-goat-team-onboarding", "firestore,storage"],
  ["providerPortal", "demo-goat-provider-portal", "firestore,storage,auth"],
];
// Storage's Firestore lookups must use the same project as its emulator process.
for (const [name, project, services] of cases) {
  const result = spawnSync(
    process.execPath,
    [
      cli,
      "emulators:exec",
      "--config",
      "firebase.portal-test.json",
      "--only",
      services,
      "--project",
      project,
      `node ${['categoryBudgets', 'projectPins', 'generalCashAccess'].includes(name) ? '--import tsx ' : ''}tests/${name}.emulator.mjs`,
    ],
    { encoding: "utf8", timeout: 240000, env: process.env, maxBuffer: 8e6 },
  );
  if (result.status !== 0) {
    console.error(
      result.stdout?.slice(-12000),
      result.stderr?.slice(-12000),
      result.error || "",
    );
    process.exit(1);
  }
  console.log(`PASS ${name}`);
}
