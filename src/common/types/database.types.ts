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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      billing_report_entries: {
        Row: {
          report_id: string
          slack_team_id: string
          time_entry_id: string
        }
        Insert: {
          report_id: string
          slack_team_id: string
          time_entry_id: string
        }
        Update: {
          report_id?: string
          slack_team_id?: string
          time_entry_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_report_entries_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "billing_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_report_entries_slack_team_id_fkey"
            columns: ["slack_team_id"]
            isOneToOne: false
            referencedRelation: "slack_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_report_entries_time_entry_id_fkey"
            columns: ["time_entry_id"]
            isOneToOne: false
            referencedRelation: "time_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_reports: {
        Row: {
          client_id: string
          created_at: string
          created_by: string
          id: string
          is_locked: boolean
          period_end: string
          period_start: string
          slack_team_id: string
          team_id: string
          total_amount: number | null
          total_minutes: number
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by: string
          id?: string
          is_locked?: boolean
          period_end: string
          period_start: string
          slack_team_id: string
          team_id: string
          total_amount?: number | null
          total_minutes: number
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string
          id?: string
          is_locked?: boolean
          period_end?: string
          period_start?: string
          slack_team_id?: string
          team_id?: string
          total_amount?: number | null
          total_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: "billing_reports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_reports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_reports_slack_team_id_fkey"
            columns: ["slack_team_id"]
            isOneToOne: false
            referencedRelation: "slack_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_reports_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          slack_team_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          slack_team_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          slack_team_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_slack_team_id_fkey"
            columns: ["slack_team_id"]
            isOneToOne: false
            referencedRelation: "slack_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      holidays: {
        Row: {
          country_code: string | null
          created_at: string
          created_by: string
          date: string
          id: string
          is_company_custom: boolean
          is_disabled: boolean
          name: string
          slack_team_id: string
          updated_at: string
          updated_by: string | null
          vacation_policy_id: string
          year: number
        }
        Insert: {
          country_code?: string | null
          created_at?: string
          created_by: string
          date: string
          id?: string
          is_company_custom?: boolean
          is_disabled?: boolean
          name: string
          slack_team_id: string
          updated_at?: string
          updated_by?: string | null
          vacation_policy_id: string
          year: number
        }
        Update: {
          country_code?: string | null
          created_at?: string
          created_by?: string
          date?: string
          id?: string
          is_company_custom?: boolean
          is_disabled?: boolean
          name?: string
          slack_team_id?: string
          updated_at?: string
          updated_by?: string | null
          vacation_policy_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "holidays_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holidays_slack_team_id_fkey"
            columns: ["slack_team_id"]
            isOneToOne: false
            referencedRelation: "slack_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holidays_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holidays_vacation_policy_id_fkey"
            columns: ["vacation_policy_id"]
            isOneToOne: false
            referencedRelation: "vacation_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          billable: boolean
          client_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          slack_team_id: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          billable?: boolean
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          slack_team_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          billable?: boolean
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          slack_team_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_slack_team_id_fkey"
            columns: ["slack_team_id"]
            isOneToOne: false
            referencedRelation: "slack_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      request_workflow_step_comments: {
        Row: {
          comment: string
          created_at: string
          created_by: string
          id: string
          request_id: string
          slack_team_id: string
          slack_user_id: string
          step_id: string
          step_level: number
        }
        Insert: {
          comment: string
          created_at?: string
          created_by: string
          id?: string
          request_id: string
          slack_team_id: string
          slack_user_id: string
          step_id: string
          step_level: number
        }
        Update: {
          comment?: string
          created_at?: string
          created_by?: string
          id?: string
          request_id?: string
          slack_team_id?: string
          slack_user_id?: string
          step_id?: string
          step_level?: number
        }
        Relationships: [
          {
            foreignKeyName: "request_workflow_step_comments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_workflow_step_comments_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "vacation_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_workflow_step_comments_slack_team_id_fkey"
            columns: ["slack_team_id"]
            isOneToOne: false
            referencedRelation: "slack_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_workflow_step_comments_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "request_workflow_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      request_workflow_steps: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          processed_at: string | null
          request_id: string
          slack_channel_id: string | null
          slack_message_ts: string | null
          slack_team_id: string
          slack_user_id: string | null
          step_data: Json
          step_level: number
          step_type: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          processed_at?: string | null
          request_id: string
          slack_channel_id?: string | null
          slack_message_ts?: string | null
          slack_team_id: string
          slack_user_id?: string | null
          step_data?: Json
          step_level: number
          step_type: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          processed_at?: string | null
          request_id?: string
          slack_channel_id?: string | null
          slack_message_ts?: string | null
          slack_team_id?: string
          slack_user_id?: string | null
          step_data?: Json
          step_level?: number
          step_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_workflow_steps_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "vacation_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_workflow_steps_slack_team_id_fkey"
            columns: ["slack_team_id"]
            isOneToOne: false
            referencedRelation: "slack_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      slack_teams: {
        Row: {
          created_at: string
          id: string
          name: string
          slack_id: string
          slack_token: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slack_id: string
          slack_token: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slack_id?: string
          slack_token?: string
        }
        Relationships: []
      }
      team_projects: {
        Row: {
          project_id: string
          slack_team_id: string
          team_id: string
        }
        Insert: {
          project_id: string
          slack_team_id?: string
          team_id: string
        }
        Update: {
          project_id?: string
          slack_team_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_projects_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_projects_slack_team_id_fkey"
            columns: ["slack_team_id"]
            isOneToOne: false
            referencedRelation: "slack_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_projects_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          approval_notification_recipients: string[] | null
          created_at: string
          created_by: string | null
          description: string | null
          hr_approvers: string[] | null
          hr_approvers_rule: string
          id: string
          manager_approvers: string[] | null
          manager_approvers_rule: string
          name: string
          slack_team_id: string
          updated_at: string
          updated_by: string | null
          vacation_policy_id: string | null
        }
        Insert: {
          approval_notification_recipients?: string[] | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          hr_approvers?: string[] | null
          hr_approvers_rule?: string
          id?: string
          manager_approvers?: string[] | null
          manager_approvers_rule?: string
          name: string
          slack_team_id: string
          updated_at?: string
          updated_by?: string | null
          vacation_policy_id?: string | null
        }
        Update: {
          approval_notification_recipients?: string[] | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          hr_approvers?: string[] | null
          hr_approvers_rule?: string
          id?: string
          manager_approvers?: string[] | null
          manager_approvers_rule?: string
          name?: string
          slack_team_id?: string
          updated_at?: string
          updated_by?: string | null
          vacation_policy_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teams_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_slack_team_id_fkey"
            columns: ["slack_team_id"]
            isOneToOne: false
            referencedRelation: "slack_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_vacation_policy_id_fkey"
            columns: ["vacation_policy_id"]
            isOneToOne: false
            referencedRelation: "vacation_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      time_entries: {
        Row: {
          client_id: string
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          id: string
          minutes: number
          project_id: string
          slack_team_id: string
          team_id: string
          updated_at: string
          user_id: string
          work_date: string
        }
        Insert: {
          client_id: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          minutes: number
          project_id: string
          slack_team_id: string
          team_id: string
          updated_at?: string
          user_id: string
          work_date: string
        }
        Update: {
          client_id?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          minutes?: number
          project_id?: string
          slack_team_id?: string
          team_id?: string
          updated_at?: string
          user_id?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_slack_team_id_fkey"
            columns: ["slack_team_id"]
            isOneToOne: false
            referencedRelation: "slack_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_projects: {
        Row: {
          project_id: string
          slack_team_id: string
          user_id: string
        }
        Insert: {
          project_id: string
          slack_team_id: string
          user_id: string
        }
        Update: {
          project_id?: string
          slack_team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_projects_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_projects_slack_team_id_fkey"
            columns: ["slack_team_id"]
            isOneToOne: false
            referencedRelation: "slack_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_projects_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          carryover_days: number
          contract_start_date: string | null
          created_at: string
          email: string
          id: string
          is_active: boolean
          name: string
          role: string
          slack_id: string
          slack_team_id: string
          team_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          carryover_days?: number
          contract_start_date?: string | null
          created_at?: string
          email: string
          id?: string
          is_active?: boolean
          name: string
          role: string
          slack_id: string
          slack_team_id: string
          team_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          carryover_days?: number
          contract_start_date?: string | null
          created_at?: string
          email?: string
          id?: string
          is_active?: boolean
          name?: string
          role?: string
          slack_id?: string
          slack_team_id?: string
          team_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_slack_team_id_fkey"
            columns: ["slack_team_id"]
            isOneToOne: false
            referencedRelation: "slack_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "users_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "users_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      vacation_policies: {
        Row: {
          bonus_days: number
          carryover_days: number
          created_at: string
          created_by: string | null
          id: string
          name: string
          slack_team_id: string
          updated_at: string
          updated_by: string | null
          vacation_days: number
          working_days: number
        }
        Insert: {
          bonus_days?: number
          carryover_days?: number
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          slack_team_id: string
          updated_at?: string
          updated_by?: string | null
          vacation_days?: number
          working_days?: number
        }
        Update: {
          bonus_days?: number
          carryover_days?: number
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          slack_team_id?: string
          updated_at?: string
          updated_by?: string | null
          vacation_days?: number
          working_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "vacation_policies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacation_policies_slack_team_id_fkey"
            columns: ["slack_team_id"]
            isOneToOne: false
            referencedRelation: "slack_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacation_policies_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      vacation_requests: {
        Row: {
          approved_by_hr: boolean
          approved_by_manager: boolean
          created_at: string
          created_by: string
          days: number
          end_date: string
          id: string
          slack_team_id: string
          start_date: string
          status: string
          team_id: string | null
          type: string
          updated_at: string
          updated_by: string | null
          user_comment: string | null
          user_id: string
          working_days: number
        }
        Insert: {
          approved_by_hr?: boolean
          approved_by_manager?: boolean
          created_at?: string
          created_by: string
          days: number
          end_date: string
          id?: string
          slack_team_id: string
          start_date: string
          status?: string
          team_id?: string | null
          type?: string
          updated_at?: string
          updated_by?: string | null
          user_comment?: string | null
          user_id: string
          working_days: number
        }
        Update: {
          approved_by_hr?: boolean
          approved_by_manager?: boolean
          created_at?: string
          created_by?: string
          days?: number
          end_date?: string
          id?: string
          slack_team_id?: string
          start_date?: string
          status?: string
          team_id?: string | null
          type?: string
          updated_at?: string
          updated_by?: string | null
          user_comment?: string | null
          user_id?: string
          working_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "vacation_requests_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacation_requests_slack_team_id_fkey"
            columns: ["slack_team_id"]
            isOneToOne: false
            referencedRelation: "slack_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacation_requests_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacation_requests_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacation_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_projects_list:
        | {
            Args: never
            Returns: {
              billable: boolean
              client_name: string
              id: string
              name: string
              status: string
              teams: string[]
              users_count: number
            }[]
          }
        | {
            Args: {
              p_billable?: boolean
              p_client_id?: string
              p_limit?: number
              p_offset?: number
              p_search?: string
              p_slack_team_id: string
              p_status?: string
            }
            Returns: {
              billable: boolean
              client_name: string
              created_at: string
              description: string
              id: string
              name: string
              status: string
              teams: string[]
              total_count: number
              updated_at: string
              users_count: number
            }[]
          }
    }
    Enums: {
      ProjectStatus: "active" | "completed" | "on-hold"
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
      ProjectStatus: ["active", "completed", "on-hold"],
    },
  },
} as const
