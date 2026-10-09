# GOAT to BANI project sync

All GOAT projects are the source of project identity in BANI LAB. The second-generation `syncProjectToBani` function listens to `projects/{projectId}` in GOAT's default database and writes into BANI's named database, under the configured workspace owner. It works without either app open.

## Ownership

- GOAT: source ID, name, client, company, brand, description, code and source production status.
- BANI: post-production phase, dates, budget versions, approval, team, hours, progress, credits and schedules.
- A new GOAT project creates a BANI project in `budget`, without amounts, budget versions or invented delivery/start dates.
- GOAT production status is reference metadata, never a BANI lifecycle transition.
- First-time linking preserves existing BANI names and clients. Later GOAT name/client changes update linked identity. The source metadata remains visible in the BANI summary.
- GOAT codes do not replace BANI's quotation document code.
- Deleting a GOAT project does not erase BANI history. Manual BANI projects remain independent exceptions.

## Reliability

The BANI document ID defaults to `goat-{GOAT_ID}`. Links to legacy BANI IDs use `goatProjectId`. Transactions reject duplicate links and prevent simultaneous duplicate creation. Every invocation reads the current GOAT document rather than trusting an old event payload. Source update versions prevent stale or repeated invocations from overwriting newer identity. Retries are enabled.

BANI client saves omit server-owned sync metadata and linked name/client fields, so unrelated edits cannot overwrite a concurrent GOAT update. Do not recreate a linked document manually with a different ID.

## Deployment

1. Install function dependencies: `npm ci --prefix functions`.
2. Authenticate the deployment account. Pass a short-lived OAuth access token via `GOOGLE_OAUTH_ACCESS_TOKEN` for the setup/import scripts; never commit tokens or service-account private keys.
3. Review `scripts/configure-bani-sync.ps1`, run without arguments to preview, then with `-Apply`. The dedicated account can read only GOAT's default database and create/update (not delete) within BANI's configured database. It has no Auth access. IAM cannot restrict Firestore to one collection; the function's code restricts writes to workspace project documents.
4. Set `BANI_OWNER_UID`, `BANI_PROJECT_ID`, `BANI_DATABASE_ID` in `functions/.env.gb-goat` (these identifiers are not secrets).
5. Reconcile legacy projects before enabling the trigger. Set `BANI_OWNER_UID` in the environment and run `node scripts/sync-bani-projects.cjs --link=GOAT_ID=BANI_ID ...` to preview. Review every link; repeat with `--apply`. Never infer links from fuzzy names. Each unlinked source becomes a distinct project, even when GOAT contains duplicate names.
6. Test: `npm test --prefix functions`.
7. Deploy only this function: `firebase deploy --only functions:syncProjectToBani --project gb-goat`. Do not redeploy unrelated rules or assistant functions.
8. Repeat the permission setup script with `-Apply` to grant the dedicated account invocation of this private Cloud Run service only. Do not make the service public. Verify a real resync reaches BANI.
9. Publish the BANI frontend separately.

For a new workspace owner, configure its UID explicitly and reconcile links again. A second import with the same source versions is a no-op. Monitor function logs for errors; investigate duplicate-link errors rather than merging or deleting project history automatically.

To request a real end-to-end resync without modifying production data, write a timestamp to `baniSyncRequestedAt` on an existing GOAT project. Its current identity is reread by the trigger; the target `goatSyncedVersion` must advance to the source document's new update time. The production/financial fields of the BANI document must remain unchanged.
