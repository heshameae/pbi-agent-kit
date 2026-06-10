# Row-Level & Object-Level Security Reference

Row-Level Security (RLS) restricts which *rows* a user can see; Object-Level Security (OLS) restricts which *tables and columns* a user can see at all. Both are defined on **roles** in the semantic model. This reference is dataset-agnostic: all table/column/value names below are placeholders. Substitute only names and values confirmed from the connected model or user policy.

## Overview

RLS filters data at the row level based on user identity, so users see only the data they are authorized to view. A role carries a model-level permission plus a set of DAX filter expressions, one per filtered table. When a user belongs to multiple roles the results are **additive** (union), not intersected.

## Design Principles

### 1. Filter on dimension tables, not facts

Apply RLS to dimensions and let the filter propagate to the fact table through relationships:

- More efficient — dimensions are smaller, so fewer rows are scanned.
- Filters propagate automatically through the relationship.
- Easier to maintain.

```dax
// On a security dimension — propagates through the relationship
[<SecurityAttribute>] = "<AllowedValue>"
```

If the filtered dimension already has a relationship to the fact table, you do **not** need to add a separate `tablePermission` on the fact table.

### 2. Create minimal, additive roles

- Each role is a separate cache, so avoid an explosion of role combinations.
- Roles are additive (union, not intersection) — design with union behavior in mind.
- Consolidate where possible; prefer dynamic RLS over one static role per group.

### 3. Prefer dynamic RLS

Data-driven rules scale better than fixed per-role rules:

- A user-to-data mapping lives in a table.
- `USERPRINCIPALNAME()` (or `USERNAME()`) supplies the identity.
- No role changes are needed when users join or leave a group.

## Static vs Dynamic RLS

### Static RLS

Fixed rules, one role per group:

```dax
// Role: <Allowed Group A>
[<SecurityAttribute>] = "<AllowedValueA>"

// Role: <Allowed Group B>
[<SecurityAttribute>] = "<AllowedValueB>"
```

**Pros:** simple, clear. **Cons:** does not scale, requires a role per group.

### Dynamic RLS

User identity drives the filter — a single role serves everyone:

```dax
// Single role filters based on the logged-in user
[Manager Email] = USERPRINCIPALNAME()
```

**Pros:** scales, self-maintaining. **Cons:** requires a user-mapping table.

## Identity Functions

| Function | Returns | Notes |
|----------|---------|-------|
| `USERPRINCIPALNAME()` | The user's UPN (email-style identity) | Preferred for dynamic RLS in the Power BI service. |
| `USERNAME()` | The logged-in user name | Common in dynamic filters; behaves like UPN in the service. |
| `CUSTOMDATA()` | A custom string passed at connection time | Used for embedded scenarios where the caller supplies context instead of a directory identity. |

## Implementation Patterns

### Pattern 1: Direct user mapping

The user's identifier lives directly in a secured dimension table:

```dax
// On secured dimension table
[<UserPrincipalColumn>] = USERPRINCIPALNAME()
```

### Pattern 2: Security table

A separate table maps users to the values they may see:

```
Security mapping table:
| <UserIdentifierColumn> | <SecurityAttribute> |
|--------------|--------|
| <user-a>     | <AllowedValueA> |
| <user-b>     | <AllowedValueB> |
```

```dax
// On the secured dimension
[<SecurityAttribute>] IN
    SELECTCOLUMNS(
        FILTER('<SecurityTable>', [<UserIdentifierColumn>] = USERPRINCIPALNAME()),
        "<SecurityAttribute>", [<SecurityAttribute>]
    )
```

Equivalent form using `CALCULATETABLE`:

```dax
'<FactTable>'[<SecurityKeyColumn>] IN
    CALCULATETABLE(
        VALUES('<SecurityTable>'[<SecurityKeyColumn>]),
        '<SecurityTable>'[<UserIdentifierColumn>] = USERNAME()
    )
```

### Pattern 3: Manager hierarchy

Users see their own data plus that of their subordinates, using `PATH` functions:

```dax
PATHCONTAINS(
    'Employee'[Manager Path],
    LOOKUPVALUE(
        'Employee'[Employee Key],
        'Employee'[Email],
        USERNAME()
    )
)
```

A simpler variant when the path already stores the identity:

```dax
PATHCONTAINS('Employee'[Manager Path], USERNAME())
```

### Pattern 4: Multiple rules combined

Combine conditions, e.g. a mapped security value OR a global-viewer flag:

```dax
// Own mapped value OR global viewer
[<SecurityAttribute>] = LOOKUPVALUE('<SecurityTable>'[<SecurityAttribute>], '<SecurityTable>'[<UserIdentifierColumn>], USERPRINCIPALNAME())
    || LOOKUPVALUE('<SecurityTable>'[<GlobalFlagColumn>], '<SecurityTable>'[<UserIdentifierColumn>], USERPRINCIPALNAME()) = TRUE()
```

### Pattern 5: Role lookup with SWITCH (hierarchical security)

A manager sees everything, others see only their slice:

```dax
VAR CurrentUser = USERNAME()
VAR UserRole = LOOKUPVALUE('<UserRoleTable>'[<RoleColumn>], '<UserRoleTable>'[<UserIdentifierColumn>], CurrentUser)
RETURN
    SWITCH(
        UserRole,
        "<AllAccessRole>", TRUE(),
        "<OwnRowsRole>", [<OwnerIdentifierColumn>] = CurrentUser,
        "<MappedAccessRole>", [<SecurityAttribute>] IN (
            SELECTCOLUMNS(
                FILTER('<UserSecurityMapping>', '<UserSecurityMapping>'[<UserIdentifierColumn>] = CurrentUser),
                "<SecurityAttribute>", '<UserSecurityMapping>'[<SecurityAttribute>]
            )
        ),
        FALSE()  // default deny
    )
```

### Pattern 6: CUSTOMDATA-driven (embedded)

The caller passes a context string at connection time:

```dax
VAR UserRole = CUSTOMDATA()
RETURN
    SWITCH(
        UserRole,
        "<RestrictedRoleA>", [<SecurityAttribute>] = "<AllowedValueA>",
        "<RestrictedRoleB>", [<SecurityAttribute>] = "<AllowedValueB>",
        "<AllAccessRole>", TRUE(),
        FALSE()  // default deny
    )
```

### Pattern 7: Time-based security

Restrict how far back a user can see based on their role using governed policy dates from a security/policy table. Do not anchor RLS windows to the current system date unless the user explicitly asks for rolling-date security and accepts refresh/query-time semantics.

```dax
VAR UserRole =
    LOOKUPVALUE (
        '<UserRoleTable>'[<RoleColumn>],
        '<UserRoleTable>'[<UserIdentifierColumn>],
        USERNAME()
    )
VAR CutoffDate =
    LOOKUPVALUE (
        '<RolePolicyTable>'[<CutoffDateColumn>],
        '<RolePolicyTable>'[<RoleColumn>],
        UserRole
    )
RETURN
    '<FactOrDateTable>'[<DateColumn>] >= CutoffDate
```

## Best Practices: FilterExpression Library

Reusable DAX filter-expression shapes for `tablePermission` filters:

| Pattern | FilterExpression |
|---------|------------------|
| Static value | `'<SecuredTable>'[<SecurityAttribute>] = "<AllowedValue>"` |
| Dynamic by user name | `'<UserTable>'[<UserIdentifierColumn>] = USERNAME()` |
| Dynamic by UPN | `'<UserTable>'[<UserPrincipalColumn>] = USERPRINCIPALNAME()` |
| Multiple values | `'<SecuredTable>'[<SecurityAttribute>] IN { "<AllowedValueA>", "<AllowedValueB>" }` |
| Compound condition | `'<SecuredTable>'[<SecurityAttribute>] IN { "<AllowedValueA>", "<AllowedValueB>" } && '<PolicyTable>'[<PolicyAttribute>] <> "<ExcludedValue>"` |
| Security table | `'<FactTable>'[<SecurityKeyColumn>] IN CALCULATETABLE(VALUES('<SecurityTable>'[<SecurityKeyColumn>]), '<SecurityTable>'[<UserIdentifierColumn>] = USERNAME())` |
| Manager hierarchy | `PATHCONTAINS('<HierarchyTable>'[<PathColumn>], USERNAME())` |

### Least privilege (default-deny)

Always default to restrictive access; grant only when a mapping row exists:

```dax
VAR UserPermissions =
    FILTER('<UserAccessTable>', '<UserAccessTable>'[<UserIdentifierColumn>] = USERNAME())
RETURN
    IF(
        COUNTROWS(UserPermissions) > 0,
        [<SecurityAttribute>] IN SELECTCOLUMNS(UserPermissions, "<SecurityAttribute>", '<UserAccessTable>'[<SecurityAttribute>]),
        FALSE()  // no access if not explicitly granted
    )
```

### Explicit role validation

Validate the user's role against an allow-list before applying the filter, denying any unexpected role:

```dax
VAR UserRole = LOOKUPVALUE('<UserRoleTable>'[<RoleColumn>], '<UserRoleTable>'[<UserIdentifierColumn>], USERNAME())
VAR AllowedRoles = { "<RestrictedRole>", "<MappedAccessRole>", "<AllAccessRole>" }
RETURN
    IF(
        UserRole IN AllowedRoles,
        SWITCH(
            UserRole,
            "<RestrictedRole>", [<SecurityAttribute>] = LOOKUPVALUE('<UserSecurityMapping>'[<SecurityAttribute>], '<UserSecurityMapping>'[<UserIdentifierColumn>], USERNAME()),
            "<MappedAccessRole>", [<SecurityAttribute>] IN SELECTCOLUMNS(FILTER('<UserSecurityMapping>', '<UserSecurityMapping>'[<UserIdentifierColumn>] = USERNAME()), "<SecurityAttribute>", '<UserSecurityMapping>'[<SecurityAttribute>]),
            "<AllAccessRole>", TRUE()
        ),
        FALSE()  // deny unexpected roles
    )
```

## Common Mistakes

| Mistake | Problem | Fix |
|---------|---------|-----|
| RLS on fact tables only | Large table scans, poor performance | Filter dimension tables; let relationships propagate. |
| `LOOKUPVALUE` instead of relationships | Expensive, does not scale | Create proper relationships and let filters flow. |
| Expecting intersection behavior | Multiple roles UNION (are additive), not intersect | Design roles assuming union behavior. |
| Forgetting DirectQuery | RLS filters become SQL `WHERE` clauses | Ensure the source database can handle the query patterns. |
| Not testing edge cases | Users see unexpected data | Test valid users, invalid/unknown users, NULL/blank values, multiple roles. |
| Overly permissive default | A `TRUE()` fallback grants full access to unexpected users | Default to `FALSE()` (deny). |
| Overly complex filter logic | Hard to audit, slow | Keep filters simple and auditable. |

### Defensive (default-deny) test pattern

For dynamic RLS, return no data for unknown users:

```dax
IF(
    USERPRINCIPALNAME() IN VALUES('<SecurityTable>'[<UserPrincipalColumn>]),
    [<SecurityAttribute>] IN SELECTCOLUMNS( /* ... */ ),
    FALSE()
)
```

## Bidirectional RLS

For a bidirectional relationship under RLS, enable **Apply security filter in both directions**. Only use it when:

- RLS must filter through a many-to-many relationship, or
- Dimension-to-dimension security is needed.

**Caution:** only one bidirectional relationship per path is allowed.

## Object-Level Security (OLS)

OLS restricts access to whole tables or specific columns, hiding the object's metadata from the role entirely. It is not exposed in the Power BI Desktop UI — it is set via the model metadata (TMDL/TMSL or scripting). Use OLS for:

- Hiding sensitive columns confirmed by policy.
- Restricting whole tables confirmed by policy.
- Combining with RLS for comprehensive access control.

The metadata permission for a table or column under a role is one of:

| MetadataPermission | Effect |
|--------------------|--------|
| `Default` | Inherit from parent (visible). |
| `Read` | Object is visible to the role. |
| `None` | Object is hidden from the role. |

Conceptually, hiding objects for a role:

```
// Hide a whole table from the role
TablePermission('<SensitiveTable>').MetadataPermission = None

// Hide specific columns
TablePermission('<SensitiveTable>').ColumnPermissions['<SensitiveColumnA>'].MetadataPermission = None
TablePermission('<SensitiveTable>').ColumnPermissions['<SensitiveColumnB>'].MetadataPermission = None
```

## Model Permissions

Each role carries a model-level permission:

| Permission | Description |
|------------|-------------|
| `None` | No access. |
| `Read` | Read data only (most common). |
| `ReadRefresh` | Read and refresh data. |
| `Refresh` | Refresh only (no read). |
| `Administrator` | Full access. |

## Role Definition Tooling

Create/update roles only through supported security-role/modeling tools. If unavailable, mark the operation unsupported/manual and do not author `roles/*.tmdl` files or `model.tmdl` refs in a live workflow.

For offline CI generation only, each role is serialized as a separate file in the `roles/` folder. The file declares the model permission and one DAX filter expression per filtered table.

### File: `roles/<RoleName>.tmdl`

```tmdl
/// Access restricted by confirmed policy
role '<RoleName>'
	modelPermission: read

	tablePermission '<SecuredTable>' = [<SecurityAttribute>] = "<AllowedValue>"
```

**Key rules:**

- `role <Name>` is the top-level declaration.
- `modelPermission:` is required — use `read` (most common) or `readRefresh`.
- `tablePermission <TableName> = <DAX filter>` — the DAX filter expression restricts rows for that table.
- One `tablePermission` per table; multiple tables can be filtered within the same role.
- For OLS, a table or column carries a metadata permission (`columnPermission`) set to `none` to hide it from the role.
- In offline CI-generated `model.tmdl`, add `ref role <Name>` for each role. Do not hand-edit this ref in production/live workflows.

### Role membership is NOT stored in TMDL

The role's *definition* (filters, permissions) lives in TMDL, but the *members* (which users and groups belong to the role) do not. After defining roles in TMDL, assign users and groups via the **Power BI Datasets API**:

```bash
# Add a user to a security role
PBI="https://api.powerbi.com/v1.0/myorg"
cat > /tmp/body.json << 'EOF'
{
  "identifier": "<user-or-group-identifier>",
  "principalType": "User",
  "datasetUserAccessRight": "Read",
  "roles": ["<RoleName>"]
}
EOF
az rest --method post \
  --resource "https://analysis.windows.net/powerbi/api" \
  --url "$PBI/groups/$WS_ID/datasets/$DATASET_ID/users" \
  --headers "Content-Type=application/json" \
  --body @/tmp/body.json
```

The `roles` array accepts one or more role names that must match the roles defined in TMDL. The principal must have at least `Read` on the dataset. `principalType` can be `User`, `Group`, or `App`. Workspace admins bypass RLS.

## Testing RLS

In Power BI Desktop, use **Modeling > View As**, select the role(s), optionally specify a user identity, and verify the data filters as expected. For dynamic RLS, test:

- Valid users.
- Unknown users (should see nothing, not error out).
- NULL / blank values.
- Multiple roles at once (confirm union behavior).

## Validation Checklist

- [ ] RLS applied to dimension tables, not fact tables.
- [ ] Filters propagate correctly through relationships.
- [ ] Dynamic RLS uses `USERPRINCIPALNAME()` (or `USERNAME()`).
- [ ] Filters default to deny (`FALSE()`), never to a permissive `TRUE()`.
- [ ] Tested with valid and invalid users.
- [ ] Edge cases handled (NULL, unknown users, multiple roles).
- [ ] Performance tested under realistic user counts.
- [ ] Role definitions documented (`///` descriptions on roles).
- [ ] OLS applied to sensitive tables/columns where needed.
- [ ] Role memberships assigned via the Datasets API (not TMDL).
- [ ] Workspace roles understood (admins bypass RLS).
