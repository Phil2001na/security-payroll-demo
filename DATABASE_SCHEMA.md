# Database Schema Reference

**App:** Dog Force Payroll & Scheduling ERP  
**Generated:** 2026-05-16  
**Code source:** `src/integrations/supabase/types.ts` + `supabase/migrations/`

---

## ⚠️ Critical: Project Identity Mismatch

The `.env` file points to Supabase project **`ajgmyvxgnozehavbygda`** (`https://ajgmyvxgnozehavbygda.supabase.co`), but this project does **not appear** in the MCP-accessible project list for this organization. The projects accessible via the Supabase MCP are:

| Project ID | Name | Status |
|---|---|---|
| `gpxnqutiyepfcmdjqvyl` | security erp | INACTIVE (timeout) |
| `nmakcenwpztbxtsmofyw` | Phil2001na's Project | INACTIVE (timeout) |
| `gmhkxtpmqxgonwoqxypc` | AI-CHIEF-OF-OPERATIONS | ACTIVE — completely different schema (clients/tasks/conversations) |

**The live Supabase state of `ajgmyvxgnozehavbygda` cannot be directly queried.** Everything below is derived from the code. Use this doc to verify what needs to be applied or re-applied if you spin up a new project or if migrations got out of sync.

---

## Migration History

9 migration files in `supabase/migrations/` — **all must be applied in order**:

| # | File timestamp | What it adds |
|---|---|---|
| 1 | `20260426143830` | Foundational schema: all core enums + 18 tables |
| 2 | `20260426143850` | RLS policies batch 1 |
| 3 | `20260426143904` | RLS policies batch 2 |
| 4 | `20260426162519` | `ps_exemptions` table, `attendance_logs` view, helper functions |
| 5 | `20260426162534` | RLS policies batch 3 |
| 6 | `20260427214608` | `shift_kind` + `shift_preference` enums, `site_requirements` table, `employees.preferred_shift` |
| 7 | `20260430152940` | `employee_position` gets `driver` value, `employees.monthly_salary` column |
| 8 | `20260430154955` | `tenants.default_contract_terms`, `sites.contract_terms_text`, `signed_agreements` table, `onboarding` storage bucket |
| 9 | `20260502140255` | `tenants.contract_template_officer/driver/management`, `employees.contract_signed_at/pdf_url/template_kind` |

---

## Enums (14 types)

| Enum | Values |
|---|---|
| `app_role` | `admin`, `operations`, `supervisor`, `viewer` |
| `day_of_week` | `mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun`, `any` |
| `deduction_category` | `statutory`, `recurring`, `offence_fine`, `offence_suspension`, `loan`, `other` |
| `disciplinary_action_type` | `verbal_warning`, `written_warning`, `final_warning`, `unpaid_suspension`, `fine_with_ca`, `dismissal` |
| `employee_category` | `officer`, `management` |
| `employee_position` | `security_officer`, `supervisor`, `site_manager`, `operations_manager`, `admin`, `other`, `driver` ⟵ added migration 7 |
| `employee_status` | `active`, `suspended`, `terminated` |
| `installment_status` | `active`, `paid_off`, `paused`, `written_off` |
| `pay_period_status` | `open`, `locked`, `paid` |
| `pay_rule` | `standard`, `sunday_default`, `sunday_ordinary`, `public_holiday_ordinary`, `public_holiday_non_ordinary`, `leave`, `off` |
| `payroll_run_status` | `draft`, `finalized`, `paid` |
| `shift_kind` | `day`, `night` — added migration 6 |
| `shift_log_status` | `pending`, `approved`, `no_show`, `replaced_by_other`, `suspended_unpaid` |
| `shift_period` | `morning`, `day`, `night`, `full_day` |
| `shift_preference` | `day`, `night`, `both` — added migration 6 |

---

## Tables (21 total)

### `tenants`
Multi-tenant root. Every other table references this.  
Added in: migration 1 (core) + migration 8 (`default_contract_terms`) + migration 9 (3 contract templates)

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | PK |
| `name` | text | NO | | |
| `legal_name` | text | YES | | |
| `pay_period_start_day` | integer | NO | `1` | |
| `pay_date_day` | integer | NO | `25` | |
| `default_hourly_rate` | numeric | NO | `0` | |
| `default_transport_allowance` | numeric | NO | `0` | |
| `sesorb_registration_number` | text | YES | | |
| `s17_3_exemption_reference` | text | YES | | |
| `s17_3_exemption_document_url` | text | YES | | |
| `default_contract_terms` | text | YES | | ⟵ migration 8 |
| `contract_template_officer` | text | YES | | ⟵ migration 9 |
| `contract_template_driver` | text | YES | | ⟵ migration 9 |
| `contract_template_management` | text | YES | | ⟵ migration 9 |
| `created_at` | timestamptz | NO | `now()` | |
| `updated_at` | timestamptz | NO | `now()` | |

---

### `profiles`
Auth users mapped to tenants with roles.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid | NO | PK — matches `auth.users.id` |
| `tenant_id` | uuid | NO | FK → `tenants.id` |
| `full_name` | text | NO | default `''` |
| `email` | text | YES | |
| `role` | `app_role` | NO | default `viewer` |
| `assigned_site_ids` | uuid[] | NO | default `{}` |
| `is_active` | boolean | NO | default `true` |
| `created_at` | timestamptz | NO | |
| `updated_at` | timestamptz | NO | |

---

### `sites`
Work locations / client sites.  
Added in: migration 1 + migration 8 (`contract_terms_text`)

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid | NO | PK |
| `tenant_id` | uuid | NO | FK → `tenants.id` |
| `name` | text | NO | |
| `code` | text | YES | |
| `client_name` | text | YES | |
| `address` | text | YES | |
| `active` | boolean | NO | default `true` |
| `default_shifts` | jsonb | NO | default `{}` |
| `notes` | text | YES | |
| `contract_terms_text` | text | YES | ⟵ migration 8 |
| `created_at` | timestamptz | NO | |
| `updated_at` | timestamptz | NO | |

---

### `employees`
Guards, drivers, and management staff.  
Added in: migration 1 + migration 6 (`preferred_shift`) + migration 7 (`monthly_salary`) + migration 9 (contract tracking)

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid | NO | PK |
| `tenant_id` | uuid | NO | FK → `tenants.id` |
| `employee_code` | text | NO | |
| `first_names` | text | NO | |
| `surname` | text | NO | |
| `display_name` | text | YES | |
| `email` | text | YES | |
| `phone` | text | YES | |
| `national_id` | text | YES | |
| `photo_url` | text | YES | |
| `position` | `employee_position` | NO | default `security_officer` |
| `category` | `employee_category` | NO | default `officer` |
| `status` | `employee_status` | NO | default `active` |
| `home_site_id` | uuid | YES | FK → `sites.id` |
| `start_date` | date | YES | |
| `hourly_rate` | numeric | NO | default `0` |
| `monthly_salary` | numeric | NO | default `0` | ⟵ migration 7 |
| `transport_allowance` | numeric | NO | default `0` |
| `bank_name` | text | YES | |
| `bank_account_number` | text | YES | |
| `union_member` | boolean | NO | default `false` |
| `ordinarily_works_sundays` | boolean | NO | default `false` |
| `sunday_agreement_url` | text | YES | |
| `sesorb_registration_number` | text | YES | |
| `preferred_shift` | `shift_preference` | NO | default `both` | ⟵ migration 6 |
| `contract_signed_at` | timestamptz | YES | | ⟵ migration 9 |
| `contract_signed_pdf_url` | text | YES | | ⟵ migration 9 |
| `contract_template_kind` | text | YES | | ⟵ migration 9 |
| `created_at` | timestamptz | NO | |
| `updated_at` | timestamptz | NO | |

---

### `shift_types`
Shift definitions with pay rules and multipliers.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid | NO | PK |
| `tenant_id` | uuid | NO | FK → `tenants.id` |
| `code` | text | NO | |
| `label` | text | NO | |
| `period` | `shift_period` | NO | default `day` |
| `day_of_week` | `day_of_week` | NO | default `any` |
| `pay_rule` | `pay_rule` | NO | default `standard` |
| `rate_multiplier` | numeric | NO | default `1` |
| `default_hours` | numeric | NO | default `8` |
| `is_premium` | boolean | NO | default `false` |
| `is_leave` | boolean | NO | default `false` |
| `active` | boolean | NO | default `true` |
| `created_at` | timestamptz | NO | |
| `updated_at` | timestamptz | NO | |

---

### `pay_periods`
Payroll cycle definitions per tenant.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid | NO | PK |
| `tenant_id` | uuid | NO | FK → `tenants.id` |
| `label` | text | NO | e.g. "May 2026" |
| `start_date` | date | NO | |
| `end_date` | date | NO | |
| `pay_date` | date | NO | |
| `status` | `pay_period_status` | NO | default `open` |
| `locked_at` | timestamptz | YES | |
| `locked_by` | uuid | YES | FK → `profiles.id` |
| `created_at` | timestamptz | NO | |
| `updated_at` | timestamptz | NO | |

---

### `payroll_runs`
One record per employee per pay period — the computed payroll.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid | NO | PK |
| `tenant_id` | uuid | NO | FK → `tenants.id` |
| `pay_period_id` | uuid | NO | FK → `pay_periods.id` |
| `employee_id` | uuid | NO | FK → `employees.id` |
| `status` | `payroll_run_status` | NO | default `draft` |
| `rate_per_hour` | numeric | NO | |
| `normal_hours` | numeric | NO | default `0` |
| `normal_amount` | numeric | NO | default `0` |
| `overtime_hours` | numeric | NO | default `0` |
| `overtime_amount` | numeric | NO | default `0` |
| `night_hours` | numeric | NO | default `0` |
| `night_premium_amount` | numeric | NO | default `0` |
| `sunday_hours` | numeric | NO | default `0` |
| `sunday_amount` | numeric | NO | default `0` |
| `public_holiday_hours` | numeric | NO | default `0` |
| `public_holiday_amount` | numeric | NO | default `0` |
| `gross_salary` | numeric | NO | default `0` |
| `transport_allowance` | numeric | NO | default `0` |
| `paye_amount` | numeric | NO | default `0` |
| `ssc_amount` | numeric | NO | default `0` |
| `other_statutory` | numeric | NO | default `0` |
| `consensual_deductions` | numeric | NO | default `0` |
| `total_deductions` | numeric | NO | default `0` |
| `net_salary` | numeric | NO | default `0` |
| `compliance_warnings` | jsonb | NO | default `[]` |
| `leave_balances_snapshot` | jsonb | YES | |
| `generated_at` | timestamptz | NO | default `now()` |
| `finalized_at` | timestamptz | YES | |
| `paid_at` | timestamptz | YES | |
| `created_at` | timestamptz | NO | |
| `updated_at` | timestamptz | NO | |

---

### `paye_brackets`
Tax bracket table used in payroll calculation.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid | NO | PK |
| `tenant_id` | uuid | NO | FK → `tenants.id` |
| `lower_bound` | numeric | NO | |
| `upper_bound` | numeric | YES | NULL = top bracket |
| `marginal_rate` | numeric | NO | |
| `base_tax` | numeric | NO | default `0` |
| `effective_from` | date | NO | default `'2025-01-01'` |
| `created_at` | timestamptz | NO | |

---

### `payroll_constants`
Statutory rates (SSC%, etc.) keyed by string.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid | NO | PK |
| `tenant_id` | uuid | NO | FK → `tenants.id` |
| `key` | text | NO | e.g. `ssc_rate` |
| `value` | numeric | NO | |
| `description` | text | YES | |
| `effective_from` | date | NO | default `'2025-01-01'` |
| `created_at` | timestamptz | NO | |
| `updated_at` | timestamptz | NO | |

---

### `deduction_types`
Catalogue of deduction types (once per tenant).

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid | NO | PK |
| `tenant_id` | uuid | NO | FK → `tenants.id` |
| `code` | text | NO | |
| `label` | text | NO | |
| `category` | `deduction_category` | NO | |
| `is_percentage` | boolean | NO | default `false` |
| `percentage` | numeric | YES | |
| `default_amount` | numeric | NO | default `0` |
| `requires_evidence` | boolean | NO | default `false` |
| `requires_collective_agreement` | boolean | NO | default `false` |
| `note` | text | YES | |
| `active` | boolean | NO | default `true` |
| `created_at` | timestamptz | NO | |
| `updated_at` | timestamptz | NO | |

---

### `deductions`
Applied deductions per employee per pay period.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid | NO | PK |
| `tenant_id` | uuid | NO | FK → `tenants.id` |
| `employee_id` | uuid | NO | FK → `employees.id` |
| `pay_period_id` | uuid | NO | FK → `pay_periods.id` |
| `deduction_type_id` | uuid | NO | FK → `deduction_types.id` |
| `amount` | numeric | NO | |
| `installment_plan_id` | uuid | YES | FK → `installment_plans.id` |
| `disciplinary_action_id` | uuid | YES | FK → `disciplinary_actions.id` |
| `incident_date` | date | YES | |
| `incident_site_id` | uuid | YES | FK → `sites.id` |
| `evidence_url` | text | YES | |
| `note` | text | YES | |
| `created_by` | uuid | YES | FK → `profiles.id` |
| `created_at` | timestamptz | NO | |
| `updated_at` | timestamptz | NO | |

---

### `installment_plans`
Multi-month repayment plans linked to deductions.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid | NO | PK |
| `tenant_id` | uuid | NO | FK → `tenants.id` |
| `employee_id` | uuid | NO | FK → `employees.id` |
| `deduction_type_id` | uuid | NO | FK → `deduction_types.id` |
| `purpose` | text | NO | |
| `total_amount` | numeric | NO | |
| `monthly_amount` | numeric | NO | |
| `balance_remaining` | numeric | NO | |
| `status` | `installment_status` | NO | default `active` |
| `start_period_id` | uuid | YES | FK → `pay_periods.id` |
| `end_period_id` | uuid | YES | FK → `pay_periods.id` |
| `created_at` | timestamptz | NO | |
| `updated_at` | timestamptz | NO | |

---

### `leave_balances`
One row per employee — leave day balances.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid | NO | PK |
| `tenant_id` | uuid | NO | FK → `tenants.id` |
| `employee_id` | uuid | NO | FK → `employees.id` (unique — one row per employee) |
| `annual_days` | numeric | NO | default `0` |
| `sick_days` | numeric | NO | default `0` |
| `compassionate_days` | numeric | NO | default `0` |
| `off_days` | numeric | NO | default `0` |
| `updated_at` | timestamptz | NO | |

---

### `schedule_assignments`
Planned shift assignments (who works where, when).

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid | NO | PK |
| `tenant_id` | uuid | NO | FK → `tenants.id` |
| `employee_id` | uuid | NO | FK → `employees.id` |
| `site_id` | uuid | NO | FK → `sites.id` |
| `shift_type_id` | uuid | NO | FK → `shift_types.id` |
| `date` | date | NO | |
| `planned_hours` | numeric | NO | |
| `is_replacement` | boolean | NO | default `false` |
| `replaced_assignment_id` | uuid | YES | FK → `schedule_assignments.id` (self-ref) |
| `notes` | text | YES | |
| `created_by` | uuid | YES | FK → `profiles.id` |
| `created_at` | timestamptz | NO | |
| `updated_at` | timestamptz | NO | |

---

### `shift_logs`
Actual hours worked — attendance records.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid | NO | PK |
| `tenant_id` | uuid | NO | FK → `tenants.id` |
| `employee_id` | uuid | NO | FK → `employees.id` |
| `site_id` | uuid | NO | FK → `sites.id` |
| `shift_type_id` | uuid | NO | FK → `shift_types.id` |
| `pay_period_id` | uuid | NO | FK → `pay_periods.id` |
| `assignment_id` | uuid | YES | FK → `schedule_assignments.id` |
| `date` | date | NO | |
| `hours_worked` | numeric | NO | default `0` |
| `night_hours` | numeric | NO | default `0` |
| `status` | `shift_log_status` | NO | default `pending` |
| `notes` | text | YES | |
| `approved_by` | uuid | YES | FK → `profiles.id` |
| `approved_at` | timestamptz | YES | |
| `created_at` | timestamptz | NO | |
| `updated_at` | timestamptz | NO | |

---

### `site_requirements`
Manpower requirements per site, day, and shift kind. — **Added migration 6**

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid | NO | PK |
| `tenant_id` | uuid | NO | |
| `site_id` | uuid | NO | |
| `day_of_week` | smallint | NO | 0=Sun … 6=Sat |
| `shift_kind` | `shift_kind` | NO | `day` or `night` |
| `quantity_required` | integer | NO | default `0` |
| `created_at` | timestamptz | NO | |
| `updated_at` | timestamptz | NO | |

Unique constraint on `(site_id, day_of_week, shift_kind)`.

---

### `ps_exemptions`
Protection of Salary Act §17(3) exemptions (>60h/week). — **Added migration 4**

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid | NO | PK |
| `tenant_id` | uuid | NO | |
| `employee_id` | uuid | NO | |
| `reference` | text | NO | |
| `effective_from` | date | NO | |
| `effective_to` | date | NO | |
| `document_url` | text | YES | |
| `notes` | text | YES | |
| `created_by` | uuid | YES | |
| `created_at` | timestamptz | NO | |
| `updated_at` | timestamptz | NO | |

---

### `disciplinary_actions`
Labour Act disciplinary records.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid | NO | PK |
| `tenant_id` | uuid | NO | FK → `tenants.id` |
| `employee_id` | uuid | NO | FK → `employees.id` |
| `action_type` | `disciplinary_action_type` | NO | |
| `offence_code` | text | NO | |
| `description` | text | NO | |
| `incident_date` | date | NO | |
| `incident_site_id` | uuid | YES | FK → `sites.id` |
| `fine_amount` | numeric | YES | |
| `suspension_hours` | numeric | YES | |
| `suspension_pay_period_id` | uuid | YES | FK → `pay_periods.id` |
| `collective_agreement_reference` | text | YES | |
| `collective_agreement_url` | text | YES | |
| `evidence_url` | text | YES | |
| `created_by` | uuid | YES | FK → `profiles.id` |
| `created_at` | timestamptz | NO | |
| `updated_at` | timestamptz | NO | |

---

### `public_holidays`
Holiday calendar per tenant.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid | NO | PK |
| `tenant_id` | uuid | NO | FK → `tenants.id` |
| `date` | date | NO | |
| `name` | text | NO | |
| `created_at` | timestamptz | NO | |

---

### `signed_agreements`
Signed contract records with PDFs. — **Added migration 8**

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid | NO | PK |
| `tenant_id` | uuid | NO | |
| `employee_id` | uuid | NO | |
| `site_id` | uuid | YES | |
| `contract_snapshot` | text | NO | Full text of contract at signing time |
| `signature_url` | text | NO | |
| `id_document_url` | text | NO | |
| `signed_at` | timestamptz | NO | default `now()` |
| `signed_ip` | text | YES | |
| `signed_by_supervisor` | uuid | YES | |
| `created_at` | timestamptz | NO | |
| `updated_at` | timestamptz | NO | |

---

### `audit_events`
Append-only audit log.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid | NO | PK |
| `tenant_id` | uuid | YES | |
| `table_name` | text | NO | |
| `record_id` | text | YES | |
| `action` | text | NO | `INSERT`, `UPDATE`, `DELETE` |
| `actor_id` | uuid | YES | FK → `profiles.id` |
| `actor_email` | text | YES | |
| `old_values` | jsonb | YES | |
| `new_values` | jsonb | YES | |
| `notes` | text | YES | |
| `created_at` | timestamptz | NO | |

---

## Views

### `attendance_logs`
A direct alias view over `shift_logs` — identical columns. Used so queries/reports can reference "attendance" semantically without changing the underlying table.

---

## Storage Buckets

| Bucket | Public | Added | Purpose |
|---|---|---|---|
| `onboarding` | NO (private) | migration 8 | Contract PDFs, ID document scans, signature images — keyed by `employee_id` as first folder segment |

---

## Database Functions

| Function | Args | Returns | Purpose |
|---|---|---|---|
| `current_tenant_id()` | — | uuid | RLS helper: tenant of the logged-in user |
| `current_role()` | — | `app_role` | RLS helper: role of the logged-in user |
| `current_site_ids()` | — | uuid[] | RLS helper: sites assigned to the logged-in supervisor |
| `has_role(_role)` | `app_role` | boolean | Check if current user has given role |
| `is_admin_or_ops()` | — | boolean | Shorthand for admin or operations check |
| `can_access_site(_site_id)` | uuid | boolean | True if user is admin/ops or site is in their assigned list |
| `employee_week_hours(_any_date, _employee_id)` | date, uuid | numeric | Sum of approved hours for employee in the ISO week containing `_any_date` |
| `has_ps_exemption(_date, _employee_id)` | date, uuid | boolean | True if employee has active PS Act exemption on given date |
| `touch_updated_at()` | — | trigger | Trigger function: sets `updated_at = now()` on update |

---

## What Needs Verification on Supabase

Because the configured project `ajgmyvxgnozehavbygda` is not accessible via MCP, you need to manually confirm the following in the Supabase dashboard SQL editor:

### If starting fresh (new project)
Run all 9 migrations in order. The SQL files are in `supabase/migrations/`.

### If migrations were partially applied
Run these queries in Supabase to check state:

```sql
-- Check applied migrations
SELECT * FROM supabase_migrations.schema_migrations ORDER BY version;

-- Check which columns exist on employees (migrations 6, 7, 9 add columns)
SELECT column_name FROM information_schema.columns
WHERE table_name = 'employees' AND table_schema = 'public'
ORDER BY ordinal_position;

-- Check enums for 'driver' (migration 7) and 'shift_preference' (migration 6)
SELECT enumlabel FROM pg_enum
JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
WHERE pg_type.typname IN ('employee_position', 'shift_preference', 'shift_kind')
ORDER BY pg_type.typname, enumsortorder;

-- Check tables that were added incrementally
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;
```

### Known columns that are commonly missing when migrations run out of order

| Table | Column | Migration that adds it |
|---|---|---|
| `employees` | `preferred_shift` | 6 |
| `employees` | `monthly_salary` | 7 |
| `employees` | `contract_signed_at` | 9 |
| `employees` | `contract_signed_pdf_url` | 9 |
| `employees` | `contract_template_kind` | 9 |
| `tenants` | `default_contract_terms` | 8 |
| `tenants` | `contract_template_officer` | 9 |
| `tenants` | `contract_template_driver` | 9 |
| `tenants` | `contract_template_management` | 9 |
| `sites` | `contract_terms_text` | 8 |
| — | `site_requirements` table | 6 |
| — | `ps_exemptions` table | 4 |
| — | `signed_agreements` table | 8 |
| — | `attendance_logs` view | 4 |
| — | `employee_position.driver` value | 7 |
