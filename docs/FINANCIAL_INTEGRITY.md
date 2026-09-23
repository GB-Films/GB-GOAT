# Financial integrity audit

## Incident and failure mode

The September 2026 incident showed that one paid area expense could be repurposed into a different expense while its payment and cash movement remained attached. The historical document versions establish the before and after states, but available logs do not establish which account made the later write. The likely failure mode was a stale client editing a row after another session recorded its payment. The affected live records were repaired separately before this audit; this branch contains no data migration.

## Invariants in this branch

- Once an expense has a payment history, a payment lock, or a legacy `paid` flag, its area, subcategory, provider, description, unit, quantity, price, and total cannot change. This applies to project administrators too.
- Paid expense rows cannot be deleted, replaced during budget copy, moved to a different area, or silently migrated from the main budget to area management.
- Row deletion, category rename, subcategory rename/removal, and area movement reread affected rows in a transaction. A concurrent payment or changed row aborts the operation instead of applying part of it.
- Payment correction and deletion reread the selected payment and linked cash movement in a transaction. The same transaction updates the expense, the cash movement, and a new activity record. A removed final payment keeps `paymentLocked: true`.
- Security rules require newly created cash payments to match the expense's appended payment. Cash payment corrections and deletions require the corresponding audit record and expense update in the same commit. Activity records cannot be edited or deleted.
- Budget items use a live listener, so an administrator sees payments recorded from other sessions without reloading the page.

## Route review

| Route | Protection |
| --- | --- |
| Area and main budget row edits | Transaction and paid identity check; server rule for every role |
| Area and main budget row deletion | Transaction, paid check, and linked cash check; server rule |
| Main budget copy and category deletion | Transactional replacement/deletion; aborts on stale or paid rows |
| Main category and area subcategory changes | Transactional row checks; paid rows block identity changes |
| Area activation | Transactional read of budget rows; activation stops if one has a payment |
| New payment | Transactional expense and cash write; server validates cash link |
| Payment correction and deletion | Transactional recheck of payment and cash link; coupled audit |
| Provider invite assignment | Server rejects changing a paid expense's provider |

## Verification and limits

Type checking, rule syntax parsing, unit tests, and the production build pass. The rule parser proves syntax only; it does not evaluate Firestore allow decisions. A local Firestore emulator test with Java 21 is still required before deploying these rules. The remote rules simulator was unavailable under the current approval policy, and this branch has not been deployed.

Historical records without stable payment IDs remain addressable by their original list index and full payment comparison. Such a record will fail closed if another session changes it. Very large category or subcategory operations are rejected instead of exceeding Firestore transaction limits.

Project deletion now stops before removing anything when financial or audit documents exist. Deleting a financed project requires a separate archival or retention design. The current audit intentionally does not alter live project data or deploy the new rules.
