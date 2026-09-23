# Financial integrity audit

## Incident and failure mode

The September 2026 incident showed that one paid area expense could be repurposed into a different expense while its payment and cash movement remained attached. The historical document versions establish the before and after states, but available logs do not establish which account made the later write. The likely failure mode was a stale client editing a row after another session recorded its payment. The affected live records were repaired separately before this audit; this branch contains no data migration.

## Invariants in this branch

- Once an expense has a payment history, a payment lock, or a legacy `paid` flag, its area, subcategory, provider, description, unit, quantity, price, and total cannot change. This applies to project administrators too.
- Paid expense rows cannot be deleted, replaced during budget copy, moved to a different area, or silently migrated from the main budget to area management.
- Row deletion, category rename, subcategory rename/removal, and area movement reread affected rows in a transaction. A concurrent payment or changed row aborts the operation instead of applying part of it.
- Payment correction and deletion reread the selected payment and linked cash movement in a transaction. The same transaction updates the expense, the cash movement, and a new activity record. A removed final payment keeps `paymentLocked: true`.
- Security rules require newly created cash payments to match the expense's appended payment. Cash payment corrections and deletions require the corresponding audit record and expense update in the same commit. Payment appends preserve the prior list order; corrections and deletions preserve every other payment in order. Activity records cannot be edited or deleted.
- Budget items use a live listener, so an administrator sees payments recorded from other sessions without reloading the page.
- Every creation, deletion, replacement, or area change of a main budget item advances a revision on the project in the same commit. Area activation reads a fresh budget snapshot and checks that revision in its transaction. A concurrent item creation or move causes activation to stop instead of omitting the row.
- Main budget category rename, deletion, and replacement reread the project and budget from the server. An active area cannot be renamed or deleted through the main budget category controls, avoiding a hidden area-expense tab.

## Route review

| Route | Protection |
| --- | --- |
| Area and main budget row edits | Transaction and paid identity check; server rule for every role |
| Area and main budget row deletion | Transaction, paid check, and linked cash check; server rule |
| Main budget copy and category deletion | Transactional replacement/deletion; aborts on stale or paid rows |
| Main category and area subcategory changes | Transactional row checks; paid rows block identity changes |
| Area activation | Fresh server read, transactional row and revision checks; activation stops if one has a payment or a row enters the area concurrently |
| New payment | Transactional expense and cash write; server validates cash link |
| Payment correction and deletion | Transactional recheck of payment and cash link; coupled audit |
| Provider invite assignment | Server rejects changing a paid expense's provider |

## Verification and limits

Type checking, rule syntax parsing, unit tests, and the production build pass. Local Firestore emulator tests with a SHA-256-verified, portable Temurin JDK 21 pass for administrator and collaborator writes, payment/cash coupling, exact payment-history preservation, active-area budget creation, and concurrent budget creation and area moves during activation. Run them with `npm run test:rules` after setting `JAVA_HOME` to JDK 21 and installing Firebase CLI 15.22.1. The emulator uses a `demo-` project and synthetic data. Some intended denials hit Firestore's 1,000-expression evaluation cap and fail closed; the matching permitted operations pass. These tests cover critical routes, but they do not prove every possible legacy document shape. This branch has not been deployed.

Historical records without stable payment IDs remain addressable by their original list index and selected payment fields. Such a record will fail closed if another session changes those fields. Very large category or subcategory operations are rejected instead of exceeding Firestore transaction limits.

Project deletion now stops before removing anything when financial or audit documents exist. Deleting a financed project requires a separate archival or retention design. The current audit intentionally does not alter live project data or deploy the new rules.
