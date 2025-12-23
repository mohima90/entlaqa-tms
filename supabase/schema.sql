-- ENTLAQA TMS Database Schema for Supabase
-- This schema includes data_source field in all relevant tables to differentiate between offline and LMS records

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Custom types
CREATE TYPE data_source AS ENUM ('offline', 'lms');
CREATE TYPE user_role AS ENUM ('admin', 'training_admin', 'manager', 'finance_manager', 'instructor', 'learner');
CREATE TYPE venue_type AS ENUM ('internal', 'external', 'partner', 'rented');
CREATE TYPE venue_status AS ENUM ('active', 'inactive', 'maintenance');
CREATE TYPE room_type AS ENUM ('classroom', 'computer_lab', 'workshop', 'auditorium', 'boardroom', 'outdoor');
CREATE TYPE room_status AS ENUM ('available', 'occupied', 'maintenance');
CREATE TYPE instructor_type AS ENUM ('internal', 'external', 'consultant', 'vendor');
CREATE TYPE course_level AS ENUM ('beginner', 'intermediate', 'advanced', 'expert');
CREATE TYPE delivery_mode AS ENUM ('ilt', 'vilt', 'blended');
CREATE TYPE course_status AS ENUM ('draft', 'active', 'archived');
CREATE TYPE session_type AS ENUM ('single', 'multi_day', 'recurring');
CREATE TYPE session_status AS ENUM ('draft', 'scheduled', 'open', 'confirmed', 'in_progress', 'completed', 'cancelled');
CREATE TYPE enrollment_type AS ENUM ('self', 'manager_nomination', 'admin', 'bulk', 'auto', 'api');
CREATE TYPE enrollment_status AS ENUM ('pending', 'approved', 'enrolled', 'waitlisted', 'cancelled', 'completed', 'no_show');
CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE completion_status AS ENUM ('not_started', 'in_progress', 'completed', 'failed');
CREATE TYPE attendance_status AS ENUM ('present', 'absent', 'late', 'excused', 'partial');
CREATE TYPE check_in_method AS ENUM ('manual', 'qr_code', 'kiosk', 'badge', 'mobile', 'biometric');
CREATE TYPE certificate_status AS ENUM ('issued', 'revoked', 'expired');
CREATE TYPE certificate_type AS ENUM ('completion', 'participation', 'achievement', 'professional');
CREATE TYPE supplier_category AS ENUM ('training_provider', 'venue', 'catering', 'equipment', 'consultant');
CREATE TYPE supplier_status AS ENUM ('active', 'inactive', 'blocked');
CREATE TYPE sync_type AS ENUM ('full', 'incremental');
CREATE TYPE sync_status AS ENUM ('pending', 'in_progress', 'completed', 'failed');

-- Organizations / Tenants
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255),
    logo_url TEXT,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Departments
CREATE TABLE departments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255),
    parent_id UUID REFERENCES departments(id),
    manager_id UUID,
    data_source data_source NOT NULL DEFAULT 'offline',
    lms_department_id VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    auth_user_id UUID UNIQUE, -- Reference to Supabase Auth
    email VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    full_name_ar VARCHAR(255),
    avatar_url TEXT,
    role user_role NOT NULL DEFAULT 'learner',
    department_id UUID REFERENCES departments(id),
    phone VARCHAR(50),
    employee_id VARCHAR(100),
    data_source data_source NOT NULL DEFAULT 'offline',
    lms_user_id VARCHAR(255),
    metadata JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, email)
);

-- Add manager_id foreign key after users table exists
ALTER TABLE departments ADD CONSTRAINT fk_departments_manager FOREIGN KEY (manager_id) REFERENCES users(id);

-- Venues
CREATE TABLE venues (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255),
    address TEXT NOT NULL,
    city VARCHAR(100) NOT NULL,
    country VARCHAR(100) NOT NULL DEFAULT 'Saudi Arabia',
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    contact_name VARCHAR(255),
    contact_phone VARCHAR(50),
    contact_email VARCHAR(255),
    venue_type venue_type NOT NULL DEFAULT 'internal',
    status venue_status NOT NULL DEFAULT 'active',
    daily_rate DECIMAL(10, 2),
    hourly_rate DECIMAL(10, 2),
    currency VARCHAR(3) DEFAULT 'SAR',
    amenities TEXT[] DEFAULT '{}',
    photos TEXT[] DEFAULT '{}',
    data_source data_source NOT NULL DEFAULT 'offline',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Rooms
CREATE TABLE rooms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255),
    room_type room_type NOT NULL DEFAULT 'classroom',
    capacity_theater INTEGER DEFAULT 0,
    capacity_classroom INTEGER DEFAULT 0,
    capacity_ushape INTEGER DEFAULT 0,
    capacity_boardroom INTEGER DEFAULT 0,
    equipment TEXT[] DEFAULT '{}',
    status room_status NOT NULL DEFAULT 'available',
    floor VARCHAR(50),
    photos TEXT[] DEFAULT '{}',
    data_source data_source NOT NULL DEFAULT 'offline',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Instructors
CREATE TABLE instructors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    instructor_type instructor_type NOT NULL DEFAULT 'internal',
    bio TEXT,
    bio_ar TEXT,
    specializations TEXT[] DEFAULT '{}',
    certifications TEXT[] DEFAULT '{}',
    languages TEXT[] DEFAULT '{"Arabic", "English"}',
    hourly_rate DECIMAL(10, 2),
    daily_rate DECIMAL(10, 2),
    currency VARCHAR(3) DEFAULT 'SAR',
    travel_available BOOLEAN DEFAULT FALSE,
    max_hours_per_week INTEGER DEFAULT 40,
    rating DECIMAL(3, 2) DEFAULT 0,
    total_sessions INTEGER DEFAULT 0,
    data_source data_source NOT NULL DEFAULT 'offline',
    lms_instructor_id VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Courses
CREATE TABLE courses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255),
    description TEXT,
    description_ar TEXT,
    objectives TEXT[] DEFAULT '{}',
    category VARCHAR(100) NOT NULL,
    subcategory VARCHAR(100),
    level course_level NOT NULL DEFAULT 'beginner',
    delivery_mode delivery_mode NOT NULL DEFAULT 'ilt',
    duration_hours DECIMAL(5, 2) NOT NULL,
    duration_days DECIMAL(5, 2),
    prerequisites TEXT[] DEFAULT '{}',
    target_audience TEXT[] DEFAULT '{}',
    max_participants INTEGER DEFAULT 25,
    min_participants INTEGER DEFAULT 5,
    materials JSONB DEFAULT '{}',
    version VARCHAR(20) DEFAULT '1.0',
    status course_status NOT NULL DEFAULT 'draft',
    data_source data_source NOT NULL DEFAULT 'offline',
    lms_course_id VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, code)
);

-- Sessions
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id),
    venue_id UUID REFERENCES venues(id),
    room_id UUID REFERENCES rooms(id),
    title VARCHAR(255) NOT NULL,
    title_ar VARCHAR(255),
    session_type session_type NOT NULL DEFAULT 'single',
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    timezone VARCHAR(50) DEFAULT 'Asia/Riyadh',
    status session_status NOT NULL DEFAULT 'draft',
    capacity INTEGER NOT NULL,
    enrolled_count INTEGER DEFAULT 0,
    waitlist_count INTEGER DEFAULT 0,
    min_enrollment INTEGER DEFAULT 5,
    registration_deadline TIMESTAMPTZ,
    cancellation_deadline TIMESTAMPTZ,
    notes TEXT,
    virtual_link TEXT,
    cost_per_participant DECIMAL(10, 2),
    total_cost DECIMAL(12, 2),
    currency VARCHAR(3) DEFAULT 'SAR',
    data_source data_source NOT NULL DEFAULT 'offline',
    lms_session_id VARCHAR(255),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Session Instructors
CREATE TABLE session_instructors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    instructor_id UUID NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'lead',
    confirmed BOOLEAN DEFAULT FALSE,
    data_source data_source NOT NULL DEFAULT 'offline',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(session_id, instructor_id)
);

-- Enrollments
CREATE TABLE enrollments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    learner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    enrollment_type enrollment_type NOT NULL DEFAULT 'self',
    status enrollment_status NOT NULL DEFAULT 'pending',
    waitlist_position INTEGER,
    approval_status approval_status,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    cancellation_reason TEXT,
    completion_status completion_status,
    completion_date TIMESTAMPTZ,
    score DECIMAL(5, 2),
    feedback_submitted BOOLEAN DEFAULT FALSE,
    data_source data_source NOT NULL DEFAULT 'offline',
    lms_enrollment_id VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(session_id, learner_id)
);

-- Attendance
CREATE TABLE attendance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    enrollment_id UUID NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    learner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    check_in_time TIMESTAMPTZ,
    check_out_time TIMESTAMPTZ,
    status attendance_status NOT NULL DEFAULT 'absent',
    check_in_method check_in_method,
    duration_minutes INTEGER,
    notes TEXT,
    marked_by UUID REFERENCES users(id),
    data_source data_source NOT NULL DEFAULT 'offline',
    lms_attendance_id VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(enrollment_id, date)
);

-- Certificate Templates
CREATE TABLE certificate_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255),
    template_type certificate_type NOT NULL DEFAULT 'completion',
    design JSONB NOT NULL DEFAULT '{}',
    languages TEXT[] DEFAULT '{"en", "ar"}',
    is_default BOOLEAN DEFAULT FALSE,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Certificates
CREATE TABLE certificates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    enrollment_id UUID NOT NULL REFERENCES enrollments(id),
    learner_id UUID NOT NULL REFERENCES users(id),
    course_id UUID NOT NULL REFERENCES courses(id),
    session_id UUID NOT NULL REFERENCES sessions(id),
    certificate_number VARCHAR(100) NOT NULL UNIQUE,
    template_id UUID REFERENCES certificate_templates(id),
    issue_date DATE NOT NULL,
    expiry_date DATE,
    status certificate_status NOT NULL DEFAULT 'issued',
    pdf_url TEXT,
    verification_code VARCHAR(50) NOT NULL UNIQUE,
    issued_by UUID REFERENCES users(id),
    data_source data_source NOT NULL DEFAULT 'offline',
    lms_certificate_id VARCHAR(255),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Suppliers
CREATE TABLE suppliers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255),
    category supplier_category NOT NULL,
    contact_name VARCHAR(255) NOT NULL,
    contact_email VARCHAR(255) NOT NULL,
    contact_phone VARCHAR(50) NOT NULL,
    address TEXT,
    city VARCHAR(100),
    country VARCHAR(100) DEFAULT 'Saudi Arabia',
    tax_number VARCHAR(100),
    bank_details JSONB,
    documents JSONB DEFAULT '{}',
    rating DECIMAL(3, 2) DEFAULT 0,
    status supplier_status NOT NULL DEFAULT 'active',
    data_source data_source NOT NULL DEFAULT 'offline',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit Logs
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID NOT NULL,
    old_values JSONB,
    new_values JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    data_source data_source NOT NULL DEFAULT 'offline',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- LMS Sync Logs (for Jadarat integration)
CREATE TABLE lms_sync_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    sync_type sync_type NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    status sync_status NOT NULL DEFAULT 'pending',
    records_synced INTEGER DEFAULT 0,
    records_failed INTEGER DEFAULT 0,
    error_details JSONB,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_users_organization ON users(organization_id);
CREATE INDEX idx_users_data_source ON users(data_source);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_departments_organization ON departments(organization_id);
CREATE INDEX idx_venues_organization ON venues(organization_id);
CREATE INDEX idx_rooms_venue ON rooms(venue_id);
CREATE INDEX idx_instructors_organization ON instructors(organization_id);
CREATE INDEX idx_courses_organization ON courses(organization_id);
CREATE INDEX idx_courses_data_source ON courses(data_source);
CREATE INDEX idx_sessions_organization ON sessions(organization_id);
CREATE INDEX idx_sessions_course ON sessions(course_id);
CREATE INDEX idx_sessions_date ON sessions(start_date);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_data_source ON sessions(data_source);
CREATE INDEX idx_enrollments_session ON enrollments(session_id);
CREATE INDEX idx_enrollments_learner ON enrollments(learner_id);
CREATE INDEX idx_enrollments_status ON enrollments(status);
CREATE INDEX idx_enrollments_data_source ON enrollments(data_source);
CREATE INDEX idx_attendance_session ON attendance(session_id);
CREATE INDEX idx_attendance_learner ON attendance(learner_id);
CREATE INDEX idx_attendance_date ON attendance(date);
CREATE INDEX idx_attendance_data_source ON attendance(data_source);
CREATE INDEX idx_certificates_learner ON certificates(learner_id);
CREATE INDEX idx_certificates_verification ON certificates(verification_code);
CREATE INDEX idx_certificates_data_source ON certificates(data_source);
CREATE INDEX idx_audit_logs_organization ON audit_logs(organization_id);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX idx_lms_sync_organization ON lms_sync_logs(organization_id);

-- Row Level Security (RLS)
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE instructors ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_instructors ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificate_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE lms_sync_logs ENABLE ROW LEVEL SECURITY;

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_departments_updated_at BEFORE UPDATE ON departments FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_venues_updated_at BEFORE UPDATE ON venues FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_rooms_updated_at BEFORE UPDATE ON rooms FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_instructors_updated_at BEFORE UPDATE ON instructors FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_courses_updated_at BEFORE UPDATE ON courses FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_sessions_updated_at BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_enrollments_updated_at BEFORE UPDATE ON enrollments FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_attendance_updated_at BEFORE UPDATE ON attendance FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_certificates_updated_at BEFORE UPDATE ON certificates FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_certificate_templates_updated_at BEFORE UPDATE ON certificate_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_suppliers_updated_at BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Function to update session counts
CREATE OR REPLACE FUNCTION update_session_counts()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE sessions SET 
        enrolled_count = (SELECT COUNT(*) FROM enrollments WHERE session_id = COALESCE(NEW.session_id, OLD.session_id) AND status IN ('enrolled', 'completed')),
        waitlist_count = (SELECT COUNT(*) FROM enrollments WHERE session_id = COALESCE(NEW.session_id, OLD.session_id) AND status = 'waitlisted')
    WHERE id = COALESCE(NEW.session_id, OLD.session_id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_session_counts_on_enrollment
AFTER INSERT OR UPDATE OR DELETE ON enrollments
FOR EACH ROW EXECUTE FUNCTION update_session_counts();

-- Sample data for testing
INSERT INTO organizations (id, name, name_ar, settings) VALUES 
    ('550e8400-e29b-41d4-a716-446655440000', 'ENTLAQA Training', 'انطلاقة للتدريب', '{"timezone": "Asia/Riyadh", "currency": "SAR", "language": "ar"}');
