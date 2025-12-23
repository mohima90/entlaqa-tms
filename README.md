# ENTLAQA TMS - Training Management System

<p align="center">
  <img src="https://entlaqaic.b-cdn.net/ENTLAQA%20Logo%202025/BLUE.png" alt="ENTLAQA Logo" width="120" />
</p>

<p align="center">
  <strong>Enterprise Training Management System for Offline/ILT Training Operations</strong>
</p>

<p align="center">
  Built with Next.js 14 • Supabase • Tailwind CSS • TypeScript
</p>

---

## 🎯 Overview

ENTLAQA TMS is a comprehensive training management system designed for enterprise organizations with 1000+ employees. It manages offline/ILT (Instructor-Led Training) operations while integrating seamlessly with the Jadarat LMS platform.

### ⭐ Key Feature: Data Source Differentiation

Throughout the entire platform, all records are differentiated between:
- 🟢 **Offline Records** - Manually added training data
- 🟣 **LMS Records** - Synced from Jadarat LMS

This distinction appears in dashboards, reports, tables, and all data views.

---

## ✨ Complete Feature List

### 📊 Dashboard
- Real-time KPIs with source-filtered analytics
- Interactive charts (Recharts)
- Recent activity feed
- Quick action buttons
- Enrollment trends
- Data source distribution

### 📚 Course Management
- Course catalog with categories and levels
- Delivery modes: ILT, VILT, Blended
- Prerequisites and learning outcomes
- Enrollment tracking
- Course duplication

### 📅 Session Management
- Multi-day and recurring sessions
- Enrollment with waitlist support
- Session detail view with:
  - Overview tab
  - Enrollments management
  - Attendance tracking
  - Materials upload
  - Feedback collection
- Session creation wizard

### 🏢 Venue & Room Management
- Multiple venue types (Internal, External, Partner, Rented)
- Room capacity and amenities
- Daily rate tracking
- Availability status

### 👨‍🏫 Instructor Management
- Internal and external trainers
- Specializations and certifications
- Rating system (5-star)
- Availability tracking
- Card and table views
- Contact information

### 👥 Learner Management
- Employee profiles
- Training history
- Certificate tracking
- Department organization
- Enrollment status

### ✅ Attendance Tracking
- Multiple check-in methods:
  - QR Code
  - Mobile App
  - Biometric
  - Kiosk
  - Badge
  - Manual
- Daily and session views
- Real-time statistics
- Late/Excused/Partial tracking

### 🏆 Certificate Management
- Automated certificate generation
- Multiple templates (Completion, Participation, Achievement, Professional)
- Verification system with codes
- Expiry tracking
- Revocation support

### 📈 Reports & Analytics
- **Overview**: KPIs, trends, distributions
- **Training Analytics**: Skills radar, hours distribution
- **Compliance**: Category tracking, overdue alerts
- **Financial**: Budget vs actual, cost per learner
- **Instructor Performance**: Sessions, ratings, hours
- Export to Excel/PDF

### 🏭 Supplier Management
- Training providers
- Venue partners
- Catering services
- Materials suppliers
- Technology vendors
- Contract tracking
- Rating system

### ⚙️ Settings
- Organization profile (bilingual)
- User management
- Notification preferences
- Security settings (2FA, password policy)
- LMS sync configuration
- Theme customization
- Integrations (Microsoft 365, Google, Zoom, Slack)

### 👤 User Profile
- Personal information
- Security settings
- Notification preferences
- Activity log
- Session management

---

## 🛠️ Tech Stack

| Category | Technology |
|----------|------------|
| Framework | Next.js 14 (App Router) |
| Database | Supabase (PostgreSQL) |
| Styling | Tailwind CSS |
| UI Components | Radix UI |
| Charts | Recharts |
| Animations | Framer Motion |
| State Management | Zustand |
| Language | TypeScript |
| Icons | Lucide React |
| Notifications | Custom Toast System |

---

## 📁 Project Structure

```
entlaqa-tms/
├── app/
│   ├── (auth)/
│   │   └── login/                # Login page
│   ├── (dashboard)/
│   │   └── dashboard/
│   │       ├── page.tsx          # Main dashboard
│   │       ├── courses/          # Course management
│   │       ├── sessions/         # Session management
│   │       │   └── [id]/         # Session detail view
│   │       ├── venues/           # Venue management
│   │       ├── instructors/      # Instructor management
│   │       ├── learners/         # Learner management
│   │       ├── attendance/       # Attendance tracking
│   │       ├── certificates/     # Certificate management
│   │       ├── reports/          # Reports & analytics
│   │       ├── suppliers/        # Supplier management
│   │       ├── settings/         # System settings
│   │       └── profile/          # User profile
│   ├── globals.css               # Global styles
│   ├── layout.tsx                # Root layout
│   └── page.tsx                  # Redirect to dashboard
├── components/
│   ├── dashboard/
│   │   └── StatCard.tsx          # Dashboard stat cards
│   ├── layout/
│   │   ├── Sidebar.tsx           # Main navigation
│   │   └── Header.tsx            # Page header
│   ├── shared/
│   │   └── SourceBadge.tsx       # Offline/LMS indicators
│   └── ui/
│       ├── DataTable.tsx         # Reusable data table
│       ├── Modal.tsx             # Modal dialogs
│       ├── SessionFormModal.tsx  # Session creation form
│       ├── LoadingStates.tsx     # Skeletons & empty states
│       └── Toast.tsx             # Toast notifications
├── hooks/
│   └── useApi.ts                 # Data fetching hooks
├── lib/
│   ├── supabase.ts               # Supabase client
│   └── utils.ts                  # Utility functions
├── types/
│   └── database.ts               # TypeScript types
├── supabase/
│   └── schema.sql                # Database schema
└── public/                       # Static assets
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Supabase account

### Installation

1. **Clone and install**
   ```bash
   cd entlaqa-tms
   npm install
   ```

2. **Set up environment variables**
   ```bash
   cp .env.example .env.local
   ```
   
   Update with your Supabase credentials:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

3. **Set up the database**
   - Open Supabase Dashboard → SQL Editor
   - Run the contents of `supabase/schema.sql`

4. **Start development server**
   ```bash
   npm run dev
   ```

5. **Open in browser**
   ```
   http://localhost:3000
   ```

### Demo Credentials

```
Email: demo@entlaqa.com
Password: demo123
```

---

## 🎨 Design System

### Brand Colors

| Color | Hex | Usage |
|-------|-----|-------|
| Primary | `#1d65d8` | Main brand color |
| Primary Light | `#3b99f5` | Hover states |
| Primary Dark | `#1854b8` | Active states |
| Offline | `#22c55e` | Offline data indicator |
| LMS | `#a855f7` | LMS data indicator |

### Source Indicators

```jsx
// Badge style
<SourceBadge source="offline" />  // Green badge
<SourceBadge source="lms" />      // Purple badge

// Dot style
<SourceDot source="offline" />    // Green dot
<SourceDot source="lms" />        // Purple dot

// Card with border
<SourceCard source="offline">     // Left border green
<SourceCard source="lms">         // Left border purple

// Filter buttons
<SourceFilter value="all" onChange={...} counts={...} />
```

---

## 🔌 Jadarat LMS Integration

The system is designed to integrate with Jadarat LMS through:

- **Scheduled Sync** - Regular data synchronization
- **Real-time Webhooks** - Instant updates
- **API Integration** - Direct API calls

Configure in Settings → LMS Sync:
- API endpoint and key
- Sync interval (15 min to daily)
- Data types to sync
- Sync direction (bidirectional/pull/push)

---

## 📊 Database Schema

All relevant tables include `data_source` field:

| Table | Description |
|-------|-------------|
| `organizations` | Multi-tenant organization data |
| `departments` | Organizational structure |
| `users` | All users (admins, learners, instructors) |
| `courses` | Course catalog |
| `sessions` | Training sessions |
| `enrollments` | Session enrollments |
| `attendance` | Attendance records |
| `certificates` | Issued certificates |
| `venues` / `rooms` | Training locations |
| `instructors` | Trainer profiles |
| `suppliers` | Vendor management |
| `audit_logs` | Activity tracking |
| `lms_sync_logs` | Sync history |

---

## 🛡️ Security Features

- Row Level Security (RLS) enabled
- Multi-tenant data isolation
- Role-based access control
- Two-factor authentication support
- Password policy configuration
- Session management
- Audit logging

---

## 📱 Responsive Design

- **Desktop**: Full sidebar navigation
- **Tablet**: Collapsible sidebar
- **Mobile**: Optimized layouts

---

## 🌐 Localization

Built-in support for:
- **English** (LTR)
- **Arabic** (RTL)

All database fields support bilingual content (`name`, `name_ar`).

---

## 📄 License

© 2025 Entlaqa E-Learning Solutions. All rights reserved.

---

<p align="center">
  Built with ❤️ by <a href="https://entlaqa.com">ENTLAQA</a>
</p>
