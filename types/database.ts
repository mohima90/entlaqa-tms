// ENTLAQA TMS Database Types
// All records have a data_source field to differentiate between offline (manual) and LMS records

export type DataSource = 'offline' | 'lms';

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      // Organizations / Tenants
      organizations: {
        Row: {
          id: string;
          name: string;
          name_ar: string | null;
          logo_url: string | null;
          settings: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['organizations']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['organizations']['Insert']>;
      };
      
      // Users / Staff
      users: {
        Row: {
          id: string;
          organization_id: string;
          email: string;
          full_name: string;
          full_name_ar: string | null;
          avatar_url: string | null;
          role: 'admin' | 'training_admin' | 'manager' | 'finance_manager' | 'instructor' | 'learner';
          department_id: string | null;
          phone: string | null;
          employee_id: string | null;
          data_source: DataSource;
          lms_user_id: string | null; // Reference to Jadarat LMS user
          metadata: Json;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['users']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['users']['Insert']>;
      };
      
      // Departments
      departments: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          name_ar: string | null;
          parent_id: string | null;
          manager_id: string | null;
          data_source: DataSource;
          lms_department_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['departments']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['departments']['Insert']>;
      };
      
      // Venues
      venues: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          name_ar: string | null;
          address: string;
          city: string;
          country: string;
          latitude: number | null;
          longitude: number | null;
          contact_name: string | null;
          contact_phone: string | null;
          contact_email: string | null;
          venue_type: 'internal' | 'external' | 'partner' | 'rented';
          status: 'active' | 'inactive' | 'maintenance';
          daily_rate: number | null;
          hourly_rate: number | null;
          currency: string;
          amenities: string[];
          photos: string[];
          data_source: DataSource;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['venues']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['venues']['Insert']>;
      };
      
      // Rooms within Venues
      rooms: {
        Row: {
          id: string;
          venue_id: string;
          name: string;
          name_ar: string | null;
          room_type: 'classroom' | 'computer_lab' | 'workshop' | 'auditorium' | 'boardroom' | 'outdoor';
          capacity_theater: number;
          capacity_classroom: number;
          capacity_ushape: number;
          capacity_boardroom: number;
          equipment: string[];
          status: 'available' | 'occupied' | 'maintenance';
          floor: string | null;
          photos: string[];
          data_source: DataSource;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['rooms']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['rooms']['Insert']>;
      };
      
      // Instructors / Trainers
      instructors: {
        Row: {
          id: string;
          user_id: string;
          organization_id: string;
          instructor_type: 'internal' | 'external' | 'consultant' | 'vendor';
          bio: string | null;
          bio_ar: string | null;
          specializations: string[];
          certifications: string[];
          languages: string[];
          hourly_rate: number | null;
          daily_rate: number | null;
          currency: string;
          travel_available: boolean;
          max_hours_per_week: number;
          rating: number;
          total_sessions: number;
          data_source: DataSource;
          lms_instructor_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['instructors']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['instructors']['Insert']>;
      };
      
      // Course Catalog
      courses: {
        Row: {
          id: string;
          organization_id: string;
          code: string;
          name: string;
          name_ar: string | null;
          description: string | null;
          description_ar: string | null;
          objectives: string[];
          category: string;
          subcategory: string | null;
          level: 'beginner' | 'intermediate' | 'advanced' | 'expert';
          delivery_mode: 'ilt' | 'vilt' | 'blended';
          duration_hours: number;
          duration_days: number | null;
          prerequisites: string[];
          target_audience: string[];
          max_participants: number;
          min_participants: number;
          materials: Json;
          version: string;
          status: 'draft' | 'active' | 'archived';
          data_source: DataSource;
          lms_course_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['courses']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['courses']['Insert']>;
      };
      
      // Training Sessions
      sessions: {
        Row: {
          id: string;
          organization_id: string;
          course_id: string;
          venue_id: string | null;
          room_id: string | null;
          title: string;
          title_ar: string | null;
          session_type: 'single' | 'multi_day' | 'recurring';
          start_date: string;
          end_date: string;
          start_time: string;
          end_time: string;
          timezone: string;
          status: 'draft' | 'scheduled' | 'open' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
          capacity: number;
          enrolled_count: number;
          waitlist_count: number;
          min_enrollment: number;
          registration_deadline: string | null;
          cancellation_deadline: string | null;
          notes: string | null;
          virtual_link: string | null;
          cost_per_participant: number | null;
          total_cost: number | null;
          currency: string;
          data_source: DataSource;
          lms_session_id: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['sessions']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['sessions']['Insert']>;
      };
      
      // Session Instructors (Many-to-Many)
      session_instructors: {
        Row: {
          id: string;
          session_id: string;
          instructor_id: string;
          role: 'lead' | 'assistant' | 'guest';
          confirmed: boolean;
          data_source: DataSource;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['session_instructors']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['session_instructors']['Insert']>;
      };
      
      // Enrollments
      enrollments: {
        Row: {
          id: string;
          session_id: string;
          learner_id: string;
          enrollment_type: 'self' | 'manager_nomination' | 'admin' | 'bulk' | 'auto' | 'api';
          status: 'pending' | 'approved' | 'enrolled' | 'waitlisted' | 'cancelled' | 'completed' | 'no_show';
          waitlist_position: number | null;
          approval_status: 'pending' | 'approved' | 'rejected' | null;
          approved_by: string | null;
          approved_at: string | null;
          cancelled_at: string | null;
          cancellation_reason: string | null;
          completion_status: 'not_started' | 'in_progress' | 'completed' | 'failed' | null;
          completion_date: string | null;
          score: number | null;
          feedback_submitted: boolean;
          data_source: DataSource;
          lms_enrollment_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['enrollments']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['enrollments']['Insert']>;
      };
      
      // Attendance Records
      attendance: {
        Row: {
          id: string;
          enrollment_id: string;
          session_id: string;
          learner_id: string;
          date: string;
          check_in_time: string | null;
          check_out_time: string | null;
          status: 'present' | 'absent' | 'late' | 'excused' | 'partial';
          check_in_method: 'manual' | 'qr_code' | 'kiosk' | 'badge' | 'mobile' | 'biometric' | null;
          duration_minutes: number | null;
          notes: string | null;
          marked_by: string | null;
          data_source: DataSource;
          lms_attendance_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['attendance']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['attendance']['Insert']>;
      };
      
      // Certificates
      certificates: {
        Row: {
          id: string;
          organization_id: string;
          enrollment_id: string;
          learner_id: string;
          course_id: string;
          session_id: string;
          certificate_number: string;
          template_id: string;
          issue_date: string;
          expiry_date: string | null;
          status: 'issued' | 'revoked' | 'expired';
          pdf_url: string | null;
          verification_code: string;
          issued_by: string;
          data_source: DataSource;
          lms_certificate_id: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['certificates']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['certificates']['Insert']>;
      };
      
      // Certificate Templates
      certificate_templates: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          name_ar: string | null;
          template_type: 'completion' | 'participation' | 'achievement' | 'professional';
          design: Json; // Template design configuration
          languages: string[];
          is_default: boolean;
          status: 'active' | 'inactive';
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['certificate_templates']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['certificate_templates']['Insert']>;
      };
      
      // Suppliers / Vendors
      suppliers: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          name_ar: string | null;
          category: 'training_provider' | 'venue' | 'catering' | 'equipment' | 'consultant';
          contact_name: string;
          contact_email: string;
          contact_phone: string;
          address: string | null;
          city: string | null;
          country: string;
          tax_number: string | null;
          bank_details: Json | null;
          documents: Json; // CR, tax docs, etc.
          rating: number;
          status: 'active' | 'inactive' | 'blocked';
          data_source: DataSource;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['suppliers']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['suppliers']['Insert']>;
      };
      
      // Audit Log
      audit_logs: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string;
          action: string;
          entity_type: string;
          entity_id: string;
          old_values: Json | null;
          new_values: Json | null;
          ip_address: string | null;
          user_agent: string | null;
          data_source: DataSource;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['audit_logs']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['audit_logs']['Insert']>;
      };
      
      // LMS Sync Log (for Jadarat integration)
      lms_sync_logs: {
        Row: {
          id: string;
          organization_id: string;
          sync_type: 'full' | 'incremental';
          entity_type: string;
          status: 'pending' | 'in_progress' | 'completed' | 'failed';
          records_synced: number;
          records_failed: number;
          error_details: Json | null;
          started_at: string;
          completed_at: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['lms_sync_logs']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['lms_sync_logs']['Insert']>;
      };
    };
    Views: {};
    Functions: {};
    Enums: {
      data_source: DataSource;
      user_role: 'admin' | 'training_admin' | 'manager' | 'finance_manager' | 'instructor' | 'learner';
      session_status: 'draft' | 'scheduled' | 'open' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
      enrollment_status: 'pending' | 'approved' | 'enrolled' | 'waitlisted' | 'cancelled' | 'completed' | 'no_show';
      attendance_status: 'present' | 'absent' | 'late' | 'excused' | 'partial';
    };
  };
}

// Helper types for easier usage
export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
export type InsertTables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert'];
export type UpdateTables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update'];

// Commonly used types
export type User = Tables<'users'>;
export type Department = Tables<'departments'>;
export type Venue = Tables<'venues'>;
export type Room = Tables<'rooms'>;
export type Instructor = Tables<'instructors'>;
export type Course = Tables<'courses'>;
export type Session = Tables<'sessions'>;
export type Enrollment = Tables<'enrollments'>;
export type Attendance = Tables<'attendance'>;
export type Certificate = Tables<'certificates'>;
export type Supplier = Tables<'suppliers'>;
