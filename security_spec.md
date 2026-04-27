# Security Specification - GB GOAT

## 1. Data Invariants
- A **Project** must always have a `createdBy` field matching the UID of the creator.
- **BudgetItems** must belong to a valid `projectId`.
- **CollaboratorPermissions** (subcollection of Project) must be identified by the collaborator's email.
- Access to any sub-resource of a Project is strictly gated by the Project's `createdBy` or `collaboratorEmails` fields.

## 2. The "Dirty Dozen" Payloads (Attack Vectors)

| ID | Attack Description | Expected Result |
|----|--------------------|-----------------|
| 1  | Read project without being owner or listed collaborator | PERMISSION_DENIED |
| 2  | Create project with `createdBy` NOT matching current UID | PERMISSION_DENIED |
| 3  | Update project's `createdBy` field (Identity Spoofing) | PERMISSION_DENIED |
| 4  | Add self to `collaboratorEmails` without being project owner | PERMISSION_DENIED |
| 5  | Read `budgetItems` of a project the user doesn't have access to | PERMISSION_DENIED |
| 6  | Update `budgetItems` in a project as a non-owner/non-collaborator | PERMISSION_DENIED |
| 7  | Delete a project as a collaborator (not owner) | PERMISSION_DENIED |
| 8  | Assign permissions to a collaborator as another collaborator | PERMISSION_DENIED |
| 9  | Inject 1MB string into `projectId` or `email` path | PERMISSION_DENIED (via isValidId) |
| 10 | Update `createdAt` timestamp (Temporal Integrity) | PERMISSION_DENIED |
| 11 | List projects without filtering by owner/collaborator | PERMISSION_DENIED (Secure List Queries) |
| 12 | Read user profile of another user without being signed in | PERMISSION_DENIED |

## 3. Implementation Verification
The `firestore.rules` file implements these gates through:
- **Master Gate Pattern**: `hasProjectAccess(projectId)` helper used for all project sub-resources.
- **Secure List Queries**: `allow list` explicitly evaluates `resource.data` against `request.auth.uid` and `request.auth.token.email`.
- **Validation Blueprints**: `isValidProject`, `isValidBudgetItem`, etc., enforce schema and identity integrity.

## 4. Conflict Report

| Collection | Identity Spoofing | State Shortcutting | Resource Poisoning |
|------------|-------------------|--------------------|--------------------|
| projects | Protected (createdBy check) | Protected (status enum) | Protected (isValidId) |
| budgetItems| Protected (hasProjectAccess)| N/A | Protected (isValidId) |
| users | Protected (uid check) | N/A | Protected (isValidId) |
| collaborators| Protected (isProjectOwner) | N/A | Protected (isValidId) |
