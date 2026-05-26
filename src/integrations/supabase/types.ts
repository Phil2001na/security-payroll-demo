export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_events: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          created_at: string
          id: string
          new_values: Json | null
          notes: string | null
          old_values: Json | null
          record_id: string | null
          table_name: string
          tenant_id: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          id?: string
          new_values?: Json | null
          notes?: string | null
          old_values?: Json | null
          record_id?: string | null
          table_name: string
          tenant_id?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          id?: string
          new_values?: Json | null
          notes?: string | null
          old_values?: Json | null
          record_id?: string | null
          table_name?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      deduction_types: {
        Row: {
          active: boolean
          category: Database["public"]["Enums"]["deduction_category"]
          code: string
          created_at: string
          default_amount: number
          id: string
          is_percentage: boolean
          label: string
          note: string | null
          percentage: number | null
          requires_collective_agreement: boolean
          requires_evidence: boolean
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          category: Database["public"]["Enums"]["deduction_category"]
          code: string
          created_at?: string
          default_amount?: number
          id?: string
          is_percentage?: boolean
          label: string
          note?: string | null
          percentage?: number | null
          requires_collective_agreement?: boolean
          requires_evidence?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: Database["public"]["Enums"]["deduction_category"]
          code?: string
          created_at?: string
          default_amount?: number
          id?: string
          is_percentage?: boolean
          label?: string
          note?: string | null
          percentage?: number | null
          requires_collective_agreement?: boolean
          requires_evidence?: boolean
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deduction_types_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      deductions: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          deduction_type_id: string
          disciplinary_action_id: string | null
          employee_id: string
          evidence_url: string | null
          id: string
          incident_date: string | null
          incident_site_id: string | null
          installment_plan_id: string | null
          note: string | null
          pay_period_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          deduction_type_id: string
          disciplinary_action_id?: string | null
          employee_id: string
          evidence_url?: string | null
          id?: string
          incident_date?: string | null
          incident_site_id?: string | null
          installment_plan_id?: string | null
          note?: string | null
          pay_period_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          deduction_type_id?: string
          disciplinary_action_id?: string | null
          employee_id?: string
          evidence_url?: string | null
          id?: string
          incident_date?: string | null
          incident_site_id?: string | null
          installment_plan_id?: string | null
          note?: string | null
          pay_period_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deductions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deductions_deduction_type_id_fkey"
            columns: ["deduction_type_id"]
            isOneToOne: false
            referencedRelation: "deduction_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deductions_disciplinary_action_id_fkey"
            columns: ["disciplinary_action_id"]
            isOneToOne: false
            referencedRelation: "disciplinary_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deductions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deductions_incident_site_id_fkey"
            columns: ["incident_site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deductions_installment_plan_id_fkey"
            columns: ["installment_plan_id"]
            isOneToOne: false
            referencedRelation: "installment_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deductions_pay_period_id_fkey"
            columns: ["pay_period_id"]
            isOneToOne: false
            referencedRelation: "pay_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deductions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      disciplinary_actions: {
        Row: {
          action_type: Database["public"]["Enums"]["disciplinary_action_type"]
          collective_agreement_reference: string | null
          collective_agreement_url: string | null
          created_at: string
          created_by: string | null
          description: string
          employee_id: string
          evidence_url: string | null
          fine_amount: number | null
          id: string
          incident_date: string
          incident_site_id: string | null
          offence_code: string
          suspension_hours: number | null
          suspension_pay_period_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          action_type: Database["public"]["Enums"]["disciplinary_action_type"]
          collective_agreement_reference?: string | null
          collective_agreement_url?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          employee_id: string
          evidence_url?: string | null
          fine_amount?: number | null
          id?: string
          incident_date: string
          incident_site_id?: string | null
          offence_code: string
          suspension_hours?: number | null
          suspension_pay_period_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          action_type?: Database["public"]["Enums"]["disciplinary_action_type"]
          collective_agreement_reference?: string | null
          collective_agreement_url?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          employee_id?: string
          evidence_url?: string | null
          fine_amount?: number | null
          id?: string
          incident_date?: string
          incident_site_id?: string | null
          offence_code?: string
          suspension_hours?: number | null
          suspension_pay_period_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "disciplinary_actions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disciplinary_actions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disciplinary_actions_incident_site_id_fkey"
            columns: ["incident_site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disciplinary_actions_suspension_pay_period_id_fkey"
            columns: ["suspension_pay_period_id"]
            isOneToOne: false
            referencedRelation: "pay_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disciplinary_actions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          bank_account_number: string | null
          bank_name: string | null
          category: Database["public"]["Enums"]["employee_category"]
          contract_signed_at: string | null
          contract_signed_pdf_url: string | null
          contract_template_kind: string | null
          created_at: string
          display_name: string | null
          email: string | null
          employee_code: string
          first_names: string
          home_site_id: string | null
          hourly_rate: number
          id: string
          monthly_salary: number
          national_id: string | null
          ordinarily_works_sundays: boolean
          phone: string | null
          photo_url: string | null
          position: Database["public"]["Enums"]["employee_position"]
          preferred_shift: Database["public"]["Enums"]["shift_preference"]
          sesorb_registration_number: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["employee_status"]
          sunday_agreement_url: string | null
          surname: string
          tenant_id: string
          transport_allowance: number
          union_member: boolean
          updated_at: string
        }
        Insert: {
          bank_account_number?: string | null
          bank_name?: string | null
          category?: Database["public"]["Enums"]["employee_category"]
          contract_signed_at?: string | null
          contract_signed_pdf_url?: string | null
          contract_template_kind?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          employee_code: string
          first_names: string
          home_site_id?: string | null
          hourly_rate?: number
          id?: string
          monthly_salary?: number
          national_id?: string | null
          ordinarily_works_sundays?: boolean
          phone?: string | null
          photo_url?: string | null
          position?: Database["public"]["Enums"]["employee_position"]
          preferred_shift?: Database["public"]["Enums"]["shift_preference"]
          sesorb_registration_number?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["employee_status"]
          sunday_agreement_url?: string | null
          surname: string
          tenant_id: string
          transport_allowance?: number
          union_member?: boolean
          updated_at?: string
        }
        Update: {
          bank_account_number?: string | null
          bank_name?: string | null
          category?: Database["public"]["Enums"]["employee_category"]
          contract_signed_at?: string | null
          contract_signed_pdf_url?: string | null
          contract_template_kind?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          employee_code?: string
          first_names?: string
          home_site_id?: string | null
          hourly_rate?: number
          id?: string
          monthly_salary?: number
          national_id?: string | null
          ordinarily_works_sundays?: boolean
          phone?: string | null
          photo_url?: string | null
          position?: Database["public"]["Enums"]["employee_position"]
          preferred_shift?: Database["public"]["Enums"]["shift_preference"]
          sesorb_registration_number?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["employee_status"]
          sunday_agreement_url?: string | null
          surname?: string
          tenant_id?: string
          transport_allowance?: number
          union_member?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employees_home_site_id_fkey"
            columns: ["home_site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      installment_plans: {
        Row: {
          balance_remaining: number
          created_at: string
          deduction_type_id: string
          employee_id: string
          end_period_id: string | null
          id: string
          monthly_amount: number
          purpose: string
          start_period_id: string | null
          status: Database["public"]["Enums"]["installment_status"]
          tenant_id: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          balance_remaining: number
          created_at?: string
          deduction_type_id: string
          employee_id: string
          end_period_id?: string | null
          id?: string
          monthly_amount: number
          purpose: string
          start_period_id?: string | null
          status?: Database["public"]["Enums"]["installment_status"]
          tenant_id: string
          total_amount: number
          updated_at?: string
        }
        Update: {
          balance_remaining?: number
          created_at?: string
          deduction_type_id?: string
          employee_id?: string
          end_period_id?: string | null
          id?: string
          monthly_amount?: number
          purpose?: string
          start_period_id?: string | null
          status?: Database["public"]["Enums"]["installment_status"]
          tenant_id?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "installment_plans_deduction_type_id_fkey"
            columns: ["deduction_type_id"]
            isOneToOne: false
            referencedRelation: "deduction_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_plans_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_plans_end_period_id_fkey"
            columns: ["end_period_id"]
            isOneToOne: false
            referencedRelation: "pay_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_plans_start_period_id_fkey"
            columns: ["start_period_id"]
            isOneToOne: false
            referencedRelation: "pay_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_plans_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_balances: {
        Row: {
          annual_days: number
          compassionate_days: number
          employee_id: string
          id: string
          off_days: number
          sick_days: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          annual_days?: number
          compassionate_days?: number
          employee_id: string
          id?: string
          off_days?: number
          sick_days?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          annual_days?: number
          compassionate_days?: number
          employee_id?: string
          id?: string
          off_days?: number
          sick_days?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leave_balances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: true
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_balances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pay_periods: {
        Row: {
          created_at: string
          end_date: string
          id: string
          label: string
          locked_at: string | null
          locked_by: string | null
          pay_date: string
          start_date: string
          status: Database["public"]["Enums"]["pay_period_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_date: string
          id?: string
          label: string
          locked_at?: string | null
          locked_by?: string | null
          pay_date: string
          start_date: string
          status?: Database["public"]["Enums"]["pay_period_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_date?: string
          id?: string
          label?: string
          locked_at?: string | null
          locked_by?: string | null
          pay_date?: string
          start_date?: string
          status?: Database["public"]["Enums"]["pay_period_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pay_periods_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pay_periods_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      paye_brackets: {
        Row: {
          base_tax: number
          created_at: string
          effective_from: string
          id: string
          lower_bound: number
          marginal_rate: number
          tenant_id: string
          upper_bound: number | null
        }
        Insert: {
          base_tax?: number
          created_at?: string
          effective_from?: string
          id?: string
          lower_bound: number
          marginal_rate: number
          tenant_id: string
          upper_bound?: number | null
        }
        Update: {
          base_tax?: number
          created_at?: string
          effective_from?: string
          id?: string
          lower_bound?: number
          marginal_rate?: number
          tenant_id?: string
          upper_bound?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "paye_brackets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_constants: {
        Row: {
          created_at: string
          description: string | null
          effective_from: string
          id: string
          key: string
          tenant_id: string
          updated_at: string
          value: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          effective_from?: string
          id?: string
          key: string
          tenant_id: string
          updated_at?: string
          value: number
        }
        Update: {
          created_at?: string
          description?: string | null
          effective_from?: string
          id?: string
          key?: string
          tenant_id?: string
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_constants_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_runs: {
        Row: {
          compliance_warnings: Json
          consensual_deductions: number
          created_at: string
          employee_id: string
          finalized_at: string | null
          generated_at: string
          gross_salary: number
          id: string
          leave_balances_snapshot: Json | null
          net_salary: number
          night_hours: number
          night_premium_amount: number
          normal_amount: number
          normal_hours: number
          other_statutory: number
          overtime_amount: number
          overtime_hours: number
          paid_at: string | null
          pay_period_id: string
          paye_amount: number
          public_holiday_amount: number
          public_holiday_hours: number
          rate_per_hour: number
          ssc_amount: number
          status: Database["public"]["Enums"]["payroll_run_status"]
          sunday_amount: number
          sunday_hours: number
          tenant_id: string
          total_deductions: number
          transport_allowance: number
          updated_at: string
        }
        Insert: {
          compliance_warnings?: Json
          consensual_deductions?: number
          created_at?: string
          employee_id: string
          finalized_at?: string | null
          generated_at?: string
          gross_salary?: number
          id?: string
          leave_balances_snapshot?: Json | null
          net_salary?: number
          night_hours?: number
          night_premium_amount?: number
          normal_amount?: number
          normal_hours?: number
          other_statutory?: number
          overtime_amount?: number
          overtime_hours?: number
          paid_at?: string | null
          pay_period_id: string
          paye_amount?: number
          public_holiday_amount?: number
          public_holiday_hours?: number
          rate_per_hour: number
          ssc_amount?: number
          status?: Database["public"]["Enums"]["payroll_run_status"]
          sunday_amount?: number
          sunday_hours?: number
          tenant_id: string
          total_deductions?: number
          transport_allowance?: number
          updated_at?: string
        }
        Update: {
          compliance_warnings?: Json
          consensual_deductions?: number
          created_at?: string
          employee_id?: string
          finalized_at?: string | null
          generated_at?: string
          gross_salary?: number
          id?: string
          leave_balances_snapshot?: Json | null
          net_salary?: number
          night_hours?: number
          night_premium_amount?: number
          normal_amount?: number
          normal_hours?: number
          other_statutory?: number
          overtime_amount?: number
          overtime_hours?: number
          paid_at?: string | null
          pay_period_id?: string
          paye_amount?: number
          public_holiday_amount?: number
          public_holiday_hours?: number
          rate_per_hour?: number
          ssc_amount?: number
          status?: Database["public"]["Enums"]["payroll_run_status"]
          sunday_amount?: number
          sunday_hours?: number
          tenant_id?: string
          total_deductions?: number
          transport_allowance?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_runs_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_runs_pay_period_id_fkey"
            columns: ["pay_period_id"]
            isOneToOne: false
            referencedRelation: "pay_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_runs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          assigned_site_ids: string[]
          created_at: string
          email: string | null
          full_name: string
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          assigned_site_ids?: string[]
          created_at?: string
          email?: string | null
          full_name?: string
          id: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          assigned_site_ids?: string[]
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ps_exemptions: {
        Row: {
          created_at: string
          created_by: string | null
          document_url: string | null
          effective_from: string
          effective_to: string
          employee_id: string
          id: string
          notes: string | null
          reference: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          document_url?: string | null
          effective_from: string
          effective_to: string
          employee_id: string
          id?: string
          notes?: string | null
          reference: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          document_url?: string | null
          effective_from?: string
          effective_to?: string
          employee_id?: string
          id?: string
          notes?: string | null
          reference?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      public_holidays: {
        Row: {
          created_at: string
          date: string
          id: string
          name: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          name: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "public_holidays_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_assignments: {
        Row: {
          created_at: string
          created_by: string | null
          date: string
          employee_id: string
          id: string
          is_replacement: boolean
          notes: string | null
          planned_hours: number
          replaced_assignment_id: string | null
          shift_type_id: string
          site_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          date: string
          employee_id: string
          id?: string
          is_replacement?: boolean
          notes?: string | null
          planned_hours: number
          replaced_assignment_id?: string | null
          shift_type_id: string
          site_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          date?: string
          employee_id?: string
          id?: string
          is_replacement?: boolean
          notes?: string | null
          planned_hours?: number
          replaced_assignment_id?: string | null
          shift_type_id?: string
          site_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_assignments_replaced_assignment_id_fkey"
            columns: ["replaced_assignment_id"]
            isOneToOne: false
            referencedRelation: "schedule_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_assignments_shift_type_id_fkey"
            columns: ["shift_type_id"]
            isOneToOne: false
            referencedRelation: "shift_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_assignments_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_assignments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_logs: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          assignment_id: string | null
          created_at: string
          date: string
          employee_id: string
          hours_worked: number
          id: string
          night_hours: number
          notes: string | null
          pay_period_id: string
          shift_type_id: string
          site_id: string
          status: Database["public"]["Enums"]["shift_log_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          assignment_id?: string | null
          created_at?: string
          date: string
          employee_id: string
          hours_worked?: number
          id?: string
          night_hours?: number
          notes?: string | null
          pay_period_id: string
          shift_type_id: string
          site_id: string
          status?: Database["public"]["Enums"]["shift_log_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          assignment_id?: string | null
          created_at?: string
          date?: string
          employee_id?: string
          hours_worked?: number
          id?: string
          night_hours?: number
          notes?: string | null
          pay_period_id?: string
          shift_type_id?: string
          site_id?: string
          status?: Database["public"]["Enums"]["shift_log_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_logs_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_logs_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "schedule_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_logs_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_logs_pay_period_id_fkey"
            columns: ["pay_period_id"]
            isOneToOne: false
            referencedRelation: "pay_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_logs_shift_type_id_fkey"
            columns: ["shift_type_id"]
            isOneToOne: false
            referencedRelation: "shift_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_logs_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_types: {
        Row: {
          active: boolean
          code: string
          created_at: string
          day_of_week: Database["public"]["Enums"]["day_of_week"]
          default_hours: number
          id: string
          is_leave: boolean
          is_premium: boolean
          label: string
          pay_rule: Database["public"]["Enums"]["pay_rule"]
          period: Database["public"]["Enums"]["shift_period"]
          rate_multiplier: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          day_of_week?: Database["public"]["Enums"]["day_of_week"]
          default_hours?: number
          id?: string
          is_leave?: boolean
          is_premium?: boolean
          label: string
          pay_rule?: Database["public"]["Enums"]["pay_rule"]
          period?: Database["public"]["Enums"]["shift_period"]
          rate_multiplier?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          day_of_week?: Database["public"]["Enums"]["day_of_week"]
          default_hours?: number
          id?: string
          is_leave?: boolean
          is_premium?: boolean
          label?: string
          pay_rule?: Database["public"]["Enums"]["pay_rule"]
          period?: Database["public"]["Enums"]["shift_period"]
          rate_multiplier?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_types_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      signed_agreements: {
        Row: {
          contract_snapshot: string
          created_at: string
          employee_id: string
          id: string
          id_document_url: string
          signature_url: string
          signed_at: string
          signed_by_supervisor: string | null
          signed_ip: string | null
          site_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          contract_snapshot: string
          created_at?: string
          employee_id: string
          id?: string
          id_document_url: string
          signature_url: string
          signed_at?: string
          signed_by_supervisor?: string | null
          signed_ip?: string | null
          site_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          contract_snapshot?: string
          created_at?: string
          employee_id?: string
          id?: string
          id_document_url?: string
          signature_url?: string
          signed_at?: string
          signed_by_supervisor?: string | null
          signed_ip?: string | null
          site_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      site_requirements: {
        Row: {
          created_at: string
          day_of_week: number
          id: string
          quantity_required: number
          shift_kind: Database["public"]["Enums"]["shift_kind"]
          site_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          day_of_week: number
          id?: string
          quantity_required?: number
          shift_kind: Database["public"]["Enums"]["shift_kind"]
          site_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          day_of_week?: number
          id?: string
          quantity_required?: number
          shift_kind?: Database["public"]["Enums"]["shift_kind"]
          site_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      sites: {
        Row: {
          active: boolean
          address: string | null
          client_name: string | null
          code: string | null
          contract_terms_text: string | null
          created_at: string
          default_shifts: Json
          id: string
          name: string
          notes: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          address?: string | null
          client_name?: string | null
          code?: string | null
          contract_terms_text?: string | null
          created_at?: string
          default_shifts?: Json
          id?: string
          name: string
          notes?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          address?: string | null
          client_name?: string | null
          code?: string | null
          contract_terms_text?: string | null
          created_at?: string
          default_shifts?: Json
          id?: string
          name?: string
          notes?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sites_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          contract_template_driver: string | null
          contract_template_management: string | null
          contract_template_officer: string | null
          created_at: string
          default_contract_terms: string | null
          default_hourly_rate: number
          default_transport_allowance: number
          id: string
          legal_name: string | null
          name: string
          pay_date_day: number
          pay_period_start_day: number
          s17_3_exemption_document_url: string | null
          s17_3_exemption_reference: string | null
          sesorb_registration_number: string | null
          updated_at: string
        }
        Insert: {
          contract_template_driver?: string | null
          contract_template_management?: string | null
          contract_template_officer?: string | null
          created_at?: string
          default_contract_terms?: string | null
          default_hourly_rate?: number
          default_transport_allowance?: number
          id?: string
          legal_name?: string | null
          name: string
          pay_date_day?: number
          pay_period_start_day?: number
          s17_3_exemption_document_url?: string | null
          s17_3_exemption_reference?: string | null
          sesorb_registration_number?: string | null
          updated_at?: string
        }
        Update: {
          contract_template_driver?: string | null
          contract_template_management?: string | null
          contract_template_officer?: string | null
          created_at?: string
          default_contract_terms?: string | null
          default_hourly_rate?: number
          default_transport_allowance?: number
          id?: string
          legal_name?: string | null
          name?: string
          pay_date_day?: number
          pay_period_start_day?: number
          s17_3_exemption_document_url?: string | null
          s17_3_exemption_reference?: string | null
          sesorb_registration_number?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      attendance_logs: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          assignment_id: string | null
          created_at: string | null
          date: string | null
          employee_id: string | null
          hours_worked: number | null
          id: string | null
          night_hours: number | null
          notes: string | null
          pay_period_id: string | null
          shift_type_id: string | null
          site_id: string | null
          status: Database["public"]["Enums"]["shift_log_status"] | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          assignment_id?: string | null
          created_at?: string | null
          date?: string | null
          employee_id?: string | null
          hours_worked?: number | null
          id?: string | null
          night_hours?: number | null
          notes?: string | null
          pay_period_id?: string | null
          shift_type_id?: string | null
          site_id?: string | null
          status?: Database["public"]["Enums"]["shift_log_status"] | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          assignment_id?: string | null
          created_at?: string | null
          date?: string | null
          employee_id?: string | null
          hours_worked?: number | null
          id?: string | null
          night_hours?: number | null
          notes?: string | null
          pay_period_id?: string | null
          shift_type_id?: string | null
          site_id?: string | null
          status?: Database["public"]["Enums"]["shift_log_status"] | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_logs_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_logs_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "schedule_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_logs_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_logs_pay_period_id_fkey"
            columns: ["pay_period_id"]
            isOneToOne: false
            referencedRelation: "pay_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_logs_shift_type_id_fkey"
            columns: ["shift_type_id"]
            isOneToOne: false
            referencedRelation: "shift_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_logs_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      can_access_site: { Args: { _site_id: string }; Returns: boolean }
      current_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      current_site_ids: { Args: never; Returns: string[] }
      current_tenant_id: { Args: never; Returns: string }
      employee_week_hours: {
        Args: { _any_date: string; _employee_id: string }
        Returns: number
      }
      has_ps_exemption: {
        Args: { _date: string; _employee_id: string }
        Returns: boolean
      }
      has_role: {
        Args: { _role: Database["public"]["Enums"]["app_role"] }
        Returns: boolean
      }
      is_admin_or_ops: { Args: never; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "accountant" | "operations" | "supervisor" | "viewer"
      day_of_week: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun" | "any"
      deduction_category:
        | "statutory"
        | "recurring"
        | "offence_fine"
        | "offence_suspension"
        | "loan"
        | "other"
      disciplinary_action_type:
        | "verbal_warning"
        | "written_warning"
        | "final_warning"
        | "unpaid_suspension"
        | "fine_with_ca"
        | "dismissal"
      employee_category: "officer" | "management"
      employee_position:
        | "security_officer"
        | "supervisor"
        | "site_manager"
        | "operations_manager"
        | "admin"
        | "other"
        | "driver"
      employee_status: "active" | "suspended" | "terminated"
      installment_status: "active" | "paid_off" | "paused" | "written_off"
      pay_period_status: "open" | "locked" | "paid"
      pay_rule:
        | "standard"
        | "sunday_default"
        | "sunday_ordinary"
        | "public_holiday_ordinary"
        | "public_holiday_non_ordinary"
        | "leave"
        | "off"
      payroll_run_status: "draft" | "finalized" | "paid"
      shift_kind: "day" | "night"
      shift_log_status:
        | "pending"
        | "approved"
        | "no_show"
        | "replaced_by_other"
        | "suspended_unpaid"
      shift_period: "morning" | "day" | "night" | "full_day"
      shift_preference: "day" | "night" | "both"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "accountant", "operations", "supervisor", "viewer"],
      day_of_week: ["mon", "tue", "wed", "thu", "fri", "sat", "sun", "any"],
      deduction_category: [
        "statutory",
        "recurring",
        "offence_fine",
        "offence_suspension",
        "loan",
        "other",
      ],
      disciplinary_action_type: [
        "verbal_warning",
        "written_warning",
        "final_warning",
        "unpaid_suspension",
        "fine_with_ca",
        "dismissal",
      ],
      employee_category: ["officer", "management"],
      employee_position: [
        "security_officer",
        "supervisor",
        "site_manager",
        "operations_manager",
        "admin",
        "other",
        "driver",
      ],
      employee_status: ["active", "suspended", "terminated"],
      installment_status: ["active", "paid_off", "paused", "written_off"],
      pay_period_status: ["open", "locked", "paid"],
      pay_rule: [
        "standard",
        "sunday_default",
        "sunday_ordinary",
        "public_holiday_ordinary",
        "public_holiday_non_ordinary",
        "leave",
        "off",
      ],
      payroll_run_status: ["draft", "finalized", "paid"],
      shift_kind: ["day", "night"],
      shift_log_status: [
        "pending",
        "approved",
        "no_show",
        "replaced_by_other",
        "suspended_unpaid",
      ],
      shift_period: ["morning", "day", "night", "full_day"],
      shift_preference: ["day", "night", "both"],
    },
  },
} as const
