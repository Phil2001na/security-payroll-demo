# Phase 1 CEO AI Assistant Database Foundation

## Existing Schema Map

The ERP is already tenant-scoped through `profiles.tenant_id` and `current_tenant_id()`. Core operational data available for future targeted retrieval includes:

- Workforce: `employees`, `profiles`, `leave_balances`, `signed_agreements`
- Scheduling and attendance: `sites`, `site_requirements`, `schedule_assignments`, `shift_logs`, `shift_types`, `pay_periods`
- Payroll and compliance: `payroll_runs`, `deductions`, `deduction_types`, `installment_plans`, `disciplinary_actions`, `ps_exemptions`, `payroll_constants`, `paye_brackets`, `public_holidays`
- System audit: `audit_events`

The current `erp-brain` Edge Function should not continue using broad `select("*")` table dumps. Phase 1 establishes a database layer for state, memory, and auditability before retrieval or UI work.

## Access Model

The migration adds `profiles.is_ceo_executive boolean not null default false`.

This is intentionally separate from `app_role`. A user with `admin` or `operations` cannot access AI assistant data unless explicitly marked as CEO executive. The helper function `public.is_ceo_executive()` is the only authorization predicate used by the AI RLS policies.

## New Tables

### `ai_conversation_sessions`

Stores CEO-owned assistant sessions. Sessions are tenant-scoped and restricted to `purpose = 'executive_read_only'` for Phase 1.

Key columns:

- `tenant_id`
- `owner_user_id`
- `title`
- `status`
- `purpose`
- `model_provider`
- `model_name`
- `metadata`
- `last_message_at`

### `ai_conversation_messages`

Stores stateful message history. This is conversation memory, not long-term executive memory. It includes structural retrieval metadata so answers can later be audited without storing raw full-table dumps in prompts.

Key columns:

- `session_id`
- `actor_user_id`
- `role`
- `content`
- `content_summary`
- `data_sources`
- `retrieval_snapshot`
- `token_usage`

### `ai_executive_memories`

Stores long-term CEO preferences and business focus. These records are explicit, queryable, and revocable.

Supported `memory_type` values:

- `preference`
- `metric_focus`
- `risk_focus`
- `reporting_style`
- `business_rule`
- `watchlist`

Supported `source` values:

- `manual`
- `assistant_suggested`
- `conversation_confirmed`
- `system_seeded`

### `ai_audit_events`

Stores an immutable record of assistant usage. This is separate from the generic `audit_events` table because AI audit records need prompt and retrieval-specific fields.

Key columns:

- `user_id`
- `session_id`
- `message_id`
- `event_type`
- `prompt_hash`
- `prompt_preview`
- `response_hash`
- `model_provider`
- `model_name`
- `data_sources`
- `retrieval_plan`
- `rows_examined`
- `token_usage`
- `read_only`
- `request_metadata`

The table has no authenticated write policy. Edge Functions using the service role can append rows. Updates and deletes are blocked by triggers.

## RLS Summary

- Sessions: CEO executives can select, insert, and update only their own sessions in their tenant.
- Messages: CEO executives can select messages only for their own sessions. Client-side inserts are limited to `role = 'user'` messages owned by the CEO.
- Memories: CEO executives can manage only their own memory records.
- Audit events: CEO executives can read only their own audit events. No authenticated insert/update/delete policies exist.

## Phase 2 Retrieval Direction

Future retrieval should query narrow, purpose-specific slices instead of whole tables. Examples:

- Payroll summary by pay period from `payroll_runs`
- Attendance anomalies from `shift_logs` joined to `employees`, `sites`, and `pay_periods`
- Schedule coverage gaps from `schedule_assignments` and `site_requirements`
- Contract status from `employees` and `signed_agreements`
- Disciplinary/deduction risk summaries from `disciplinary_actions`, `deductions`, and `installment_plans`

Each assistant answer should write `ai_audit_events.data_sources` with structural metadata such as table names, filters, date ranges, row counts, and record IDs where appropriate.
