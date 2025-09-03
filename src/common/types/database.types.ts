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
    PostgrestVersion: "12.2.3 (519615d)"
  }
  public: {
    Tables: {
      slack_teams: {
        Row: {
          created_at: string | null
          id: string
          name: string
          slack_id: string
          slack_token: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          slack_id: string
          slack_token: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          slack_id?: string
          slack_token?: string
        }
        Relationships: []
      }
      teams: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_primary: boolean
          name: string
          slack_team_id: string
          updated_at: string
          updated_by: string | null
          vacation_policy_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_primary?: boolean
          name: string
          slack_team_id?: string
          updated_at?: string
          updated_by?: string | null
          vacation_policy_id?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_primary?: boolean
          name?: string
          slack_team_id?: string
          updated_at?: string
          updated_by?: string | null
          vacation_policy_id?: string
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
          team_id: string
          updated_at: string | null
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
          slack_team_id?: string
          team_id?: string
          updated_at?: string | null
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
          team_id?: string
          updated_at?: string | null
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
          country_code: string | null
          created_at: string
          created_by: string | null
          id: string
          is_primary: boolean
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
          country_code?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_primary?: boolean
          name?: string
          slack_team_id?: string
          updated_at?: string
          updated_by?: string | null
          vacation_days?: number
          working_days?: number
        }
        Update: {
          bonus_days?: number
          carryover_days?: number
          country_code?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_primary?: boolean
          name?: string
          slack_team_id?: string
          updated_at?: string
          updated_by?: string | null
          vacation_days?: number
          working_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "team_settings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_settings_updated_by_fkey"
            columns: ["updated_by"]
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
        ]
      }
      vacations: {
        Row: {
          approved_by_hr: boolean | null
          approved_by_manager: boolean | null
          comment: string | null
          created_at: string | null
          created_by: string
          days: number
          end_date: string
          id: string
          start_date: string
          status: string
          team_id: string
          type: string
          updated_at: string | null
          updated_by: string
          user_id: string
        }
        Insert: {
          approved_by_hr?: boolean | null
          approved_by_manager?: boolean | null
          comment?: string | null
          created_at?: string | null
          created_by: string
          days: number
          end_date: string
          id?: string
          start_date: string
          status?: string
          team_id?: string
          type?: string
          updated_at?: string | null
          updated_by: string
          user_id: string
        }
        Update: {
          approved_by_hr?: boolean | null
          approved_by_manager?: boolean | null
          comment?: string | null
          created_at?: string | null
          created_by?: string
          days?: number
          end_date?: string
          id?: string
          start_date?: string
          status?: string
          team_id?: string
          type?: string
          updated_at?: string | null
          updated_by?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vacations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacations_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacations_user_id_fkey"
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
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
