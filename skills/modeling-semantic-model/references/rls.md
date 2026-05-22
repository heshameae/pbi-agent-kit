# Row-Level & Object-Level Security Reference

Row-Level Security (RLS) restricts which *rows* a user can see; Object-Level Security (OLS) restricts which *tables and columns* a user can see at all. Both are defined on **roles** in the semantic model. This reference is dataset-agnostic — all table/column names below (`Sales`, `Customer`, `Region`, `Date`, `User Security`, `Email`) are generic placeholders. Substitute the real names from the connected model.

## Overview

RLS filters data at the row level based on user identity, so users see only the data they are authorized to view. A role carries a model-level permission plus a set of DAX filter expressions, one per filtered table. When a user belongs to multiple roles the results are **additive** (union), not intersected.

## Design Principles

### 1. Filter on dimension tables, not facts

Apply RLS to dimensions and let the filter propagate to the fact table through relationships:

- More efficient — dimensions are smaller, so fewer rows are scanned.
- Filters propagate automatically through the relationship.
- Easier to maintain.

```dax
// On Customer dimension — propagates to Sales through the relationship
[Region] = "West"
```

If a dimension (e.g. `Region`) already has a relationship to the fact table, you do **not** need to add a separate `tablePermission` on the fact table.

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
// Role: West Region
[Region] = "West"

// Role: East Region
[Region] = "East"
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

The user's email lives directly in a dimension table:

```dax
// On Customer table
[Customer Email] = USERPRINCIPALNAME()
```

### Pattern 2: Security table

A separate table maps users to the values they may see:

```
User Security table:
| Email        | Region |
|--------------|--------|
| joe@co.com   | West   |
| sue@co.com   | East   |
```

```dax
// On Region dimension
[Region] IN
    SELECTCOLUMNS(
        FILTER('User Security', [Email] = USERPRINCIPALNAME()),
        "Region", [Region]
    )
```

Equivalent form using `CALCULATETABLE`:

```dax
'Sales'[Region ID] IN
    CALCULATETABLE(
        VALUES('User Security'[Region ID]),
        'User Security'[Email] = USERNAME()
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

Combine conditions, e.g. own region OR a global-viewer flag:

```dax
// Own region OR global viewer
[Region] = LOOKUPVALUE('User Security'[Region], 'User Security'[Email], USERPRINCIPALNAME())
    || LOOKUPVALUE('User Security'[Is Global], 'User Security'[Email], USERPRINCIPALNAME()) = TRUE()
```

### Pattern 5: Role lookup with SWITCH (hierarchical security)

A manager sees everything, others see only their slice:

```dax
VAR CurrentUser = USERNAME()
VAR UserRole = LOOKUPVALUE('User Roles'[Role], 'User Roles'[Email], CurrentUser)
RETURN
    SWITCH(
        UserRole,
        "Manager", TRUE(),
        "Salesperson", [Salesperson Email] = CurrentUser,
        "Regional Manager", [Region] IN (
            SELECTCOLUMNS(
                FILTER('User Regions', 'User Regions'[Email] = CurrentUser),
                "Region", 'User Regions'[Region]
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
        "RepA", [Sales Territory] = "West",
        "RepB", [Sales Territory] = "East",
        "Manager", TRUE(),
        FALSE()  // default deny
    )
```

### Pattern 7: Time-based security

Restrict how far back a user can see based on their role:

```dax
VAR UserRole = LOOKUPVALUE('User Roles'[Role], 'User Roles'[Email], USERNAME())
VAR CutoffDate =
    SWITCH(
        UserRole,
        "Executive", DATE(1900, 1, 1),  // all historical data
        "Manager", TODAY() - 365,       // last year
        "Analyst", TODAY() - 90,        // last 90 days
        TODAY()                         // current day only
    )
RETURN
    [Date] >= CutoffDate
```

## Best Practices: FilterExpression Library

Reusable DAX filter-expression shapes for `tablePermission` filters:

| Pattern | FilterExpression |
|---------|------------------|
| Static value | `'Region'[Region] = "West"` |
| Dynamic by user name | `'Employee'[Email] = USERNAME()` |
| Dynamic by UPN | `'Employee'[UPN] = USERPRINCIPALNAME()` |
| Multiple values | `'Region'[Region] IN { "West", "Central" }` |
| Compound condition | `'Region'[Region] IN { "West", "Central" } && 'Product'[Category] <> "Confidential"` |
| Security table | `'Sales'[Region ID] IN CALCULATETABLE(VALUES('User Security'[Region ID]), 'User Security'[Email] = USERNAME())` |
| Manager hierarchy | `PATHCONTAINS('Employee'[Manager Path], USERNAME())` |

### Least privilege (default-deny)

Always default to restrictive access; grant only when a mapping row exists:

```dax
VAR UserPermissions =
    FILTER('User Access', 'User Access'[Email] = USERNAME())
RETURN
    IF(
        COUNTROWS(UserPermissions) > 0,
        [Territory] IN SELECTCOLUMNS(UserPermissions, "Territory", 'User Access'[Territory]),
        FALSE()  // no access if not explicitly granted
    )
```

### Explicit role validation

Validate the user's role against an allow-list before applying the filter, denying any unexpected role:

```dax
VAR UserRole = LOOKUPVALUE('User Roles'[Role], 'User Roles'[Email], USERNAME())
VAR AllowedRoles = { "Analyst", "Manager", "Executive" }
RETURN
    IF(
        UserRole IN AllowedRoles,
        SWITCH(
            UserRole,
            "Analyst", [Department] = LOOKUPVALUE('User Departments'[Department], 'User Departments'[Email], USERNAME()),
            "Manager", [Region] = LOOKUPVALUE('User Regions'[Region], 'User Regions'[Email], USERNAME()),
            "Executive", TRUE()
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
    USERPRINCIPALNAME() IN VALUES('User Security'[Email]),
    [Region] IN SELECTCOLUMNS( /* ... */ ),
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

- Hiding sensitive columns (e.g. salary, SSN, `Email`, `Phone`).
- Restricting whole tables (e.g. a `Salary` table).
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
TablePermission('Salary').MetadataPermission = None

// Hide specific columns
TablePermission('Customer').ColumnPermissions['Email'].MetadataPermission = None
TablePermission('Customer').ColumnPermissions['Phone'].MetadataPermission = None
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

## TMDL Role-File Emission Shape

Each role is a separate file in the `roles/` folder. The file declares the model permission and one DAX filter expression per filtered table.

### File: `roles/Regional Manager.tmdl`

```tmdl
/// Access restricted to East region
role 'Regional Manager'
	modelPermission: read

	tablePermission Sales = [Region] = "East"
```

**Key rules:**

- `role <Name>` is the top-level declaration.
- `modelPermission:` is required — use `read` (most common) or `readRefresh`.
- `tablePermission <TableName> = <DAX filter>` — the DAX filter expression restricts rows for that table.
- One `tablePermission` per table; multiple tables can be filtered within the same role.
- For OLS, a table or column carries a metadata permission (`columnPermission`) set to `none` to hide it from the role.
- In `model.tmdl`, add `ref role <Name>` for each role.

### Role membership is NOT stored in TMDL

The role's *definition* (filters, permissions) lives in TMDL, but the *members* (which users and groups belong to the role) do not. After defining roles in TMDL, assign users and groups via the **Power BI Datasets API**:

```bash
# Add a user to a security role
PBI="https://api.powerbi.com/v1.0/myorg"
cat > /tmp/body.json << 'EOF'
{
  "identifier": "user@contoso.com",
  "principalType": "User",
  "datasetUserAccessRight": "Read",
  "roles": ["Regional Manager"]
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
