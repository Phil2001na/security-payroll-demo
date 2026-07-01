-- Literacy/communication grade for officer-category employees, and the minimum
-- grade a site requires of guards posted there. Best→worst: A+, A, B, C, D.
-- Nullable on both sides: employees.literacy_grade null = ungraded (treated as
-- worst-case "D" by the scheduler, never excluded); sites.required_guard_grade
-- null = no requirement (preserves today's behavior for all existing sites).
create type literacy_grade as enum ('A+', 'A', 'B', 'C', 'D');

alter table employees
  add column literacy_grade literacy_grade;

alter table sites
  add column required_guard_grade literacy_grade;
