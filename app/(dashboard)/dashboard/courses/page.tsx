'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Plus,
  Download,
  Upload,
  Eye,
  Edit,
  Trash2,
  Copy,
  BookOpen,
  Clock,
  Users,
  GraduationCap,
} from 'lucide-react';
import Header from '@/components/layout/Header';
import DataTable, { Column } from '@/components/ui/DataTable';
import { SourceBadge, SourceDot } from '@/components/shared/SourceBadge';
import { cn } from '@/lib/utils';

// Sample data
interface Course {
  id: string;
  code: string;
  name: string;
  name_ar: string;
  category: string;
  level: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  delivery_mode: 'ilt' | 'vilt' | 'blended';
  duration_hours: number;
  max_participants: number;
  status: 'draft' | 'active' | 'archived';
  sessions_count: number;
  enrollments_count: number;
  data_source: 'offline' | 'lms';
}

const sampleCourses: Course[] = [
  {
    id: '1',
    code: 'LEAD-101',
    name: 'Leadership Excellence Program',
    name_ar: 'برنامج التميز القيادي',
    category: 'Leadership',
    level: 'advanced',
    delivery_mode: 'ilt',
    duration_hours: 24,
    max_participants: 25,
    status: 'active',
    sessions_count: 8,
    enrollments_count: 156,
    data_source: 'offline',
  },
  {
    id: '2',
    code: 'CYBER-201',
    name: 'Cybersecurity Fundamentals',
    name_ar: 'أساسيات الأمن السيبراني',
    category: 'Technology',
    level: 'intermediate',
    delivery_mode: 'vilt',
    duration_hours: 16,
    max_participants: 40,
    status: 'active',
    sessions_count: 12,
    enrollments_count: 324,
    data_source: 'lms',
  },
  {
    id: '3',
    code: 'DATA-301',
    name: 'Advanced Data Analysis',
    name_ar: 'تحليل البيانات المتقدم',
    category: 'Data & Analytics',
    level: 'expert',
    delivery_mode: 'blended',
    duration_hours: 32,
    max_participants: 20,
    status: 'active',
    sessions_count: 5,
    enrollments_count: 89,
    data_source: 'offline',
  },
  {
    id: '4',
    code: 'PM-101',
    name: 'Project Management Essentials',
    name_ar: 'أساسيات إدارة المشاريع',
    category: 'Management',
    level: 'beginner',
    delivery_mode: 'ilt',
    duration_hours: 20,
    max_participants: 30,
    status: 'active',
    sessions_count: 15,
    enrollments_count: 412,
    data_source: 'lms',
  },
  {
    id: '5',
    code: 'COMM-102',
    name: 'Business Communication Skills',
    name_ar: 'مهارات الاتصال في الأعمال',
    category: 'Soft Skills',
    level: 'intermediate',
    delivery_mode: 'ilt',
    duration_hours: 12,
    max_participants: 25,
    status: 'active',
    sessions_count: 10,
    enrollments_count: 245,
    data_source: 'offline',
  },
  {
    id: '6',
    code: 'DIGI-401',
    name: 'Digital Marketing Masterclass',
    name_ar: 'ماستر كلاس التسويق الرقمي',
    category: 'Marketing',
    level: 'advanced',
    delivery_mode: 'vilt',
    duration_hours: 28,
    max_participants: 35,
    status: 'active',
    sessions_count: 6,
    enrollments_count: 178,
    data_source: 'lms',
  },
  {
    id: '7',
    code: 'HR-201',
    name: 'Strategic HR Management',
    name_ar: 'إدارة الموارد البشرية الاستراتيجية',
    category: 'Human Resources',
    level: 'advanced',
    delivery_mode: 'blended',
    duration_hours: 24,
    max_participants: 25,
    status: 'draft',
    sessions_count: 0,
    enrollments_count: 0,
    data_source: 'offline',
  },
  {
    id: '8',
    code: 'AI-501',
    name: 'Generative AI for Business',
    name_ar: 'الذكاء الاصطناعي التوليدي للأعمال',
    category: 'Technology',
    level: 'expert',
    delivery_mode: 'vilt',
    duration_hours: 16,
    max_participants: 30,
    status: 'active',
    sessions_count: 4,
    enrollments_count: 112,
    data_source: 'offline',
  },
];

const levelColors = {
  beginner: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  intermediate: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  advanced: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  expert: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
};

const statusColors = {
  draft: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  archived: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
};

const deliveryModeLabels = {
  ilt: 'In-Person',
  vilt: 'Virtual',
  blended: 'Blended',
};

export default function CoursesPage() {
  const [courses] = useState<Course[]>(sampleCourses);

  const columns: Column<Course>[] = [
    {
      key: 'code',
      header: 'Course',
      sortable: true,
      render: (course) => (
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-entlaqa-100 dark:bg-entlaqa-900/30 flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-entlaqa-600" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-slate-900 dark:text-white">{course.code}</span>
              <SourceDot source={course.data_source} size="sm" />
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 max-w-xs truncate">
              {course.name}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      sortable: true,
      render: (course) => (
        <span className="text-slate-700 dark:text-slate-300">{course.category}</span>
      ),
    },
    {
      key: 'level',
      header: 'Level',
      sortable: true,
      render: (course) => (
        <span className={cn('px-2.5 py-1 rounded-full text-xs font-medium capitalize', levelColors[course.level])}>
          {course.level}
        </span>
      ),
    },
    {
      key: 'delivery_mode',
      header: 'Delivery',
      sortable: true,
      render: (course) => (
        <span className="text-slate-700 dark:text-slate-300">
          {deliveryModeLabels[course.delivery_mode]}
        </span>
      ),
    },
    {
      key: 'duration_hours',
      header: 'Duration',
      sortable: true,
      render: (course) => (
        <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
          <Clock className="w-4 h-4" />
          <span>{course.duration_hours}h</span>
        </div>
      ),
    },
    {
      key: 'sessions_count',
      header: 'Sessions',
      sortable: true,
      render: (course) => (
        <span className="font-medium text-slate-700 dark:text-slate-300">
          {course.sessions_count}
        </span>
      ),
    },
    {
      key: 'enrollments_count',
      header: 'Enrollments',
      sortable: true,
      render: (course) => (
        <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
          <Users className="w-4 h-4" />
          <span>{course.enrollments_count}</span>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (course) => (
        <span className={cn('px-2.5 py-1 rounded-full text-xs font-medium capitalize', statusColors[course.status])}>
          {course.status}
        </span>
      ),
    },
  ];

  const actions = [
    {
      label: 'View Details',
      icon: <Eye className="w-4 h-4" />,
      onClick: (course: Course) => console.log('View', course),
    },
    {
      label: 'Edit Course',
      icon: <Edit className="w-4 h-4" />,
      onClick: (course: Course) => console.log('Edit', course),
    },
    {
      label: 'Duplicate',
      icon: <Copy className="w-4 h-4" />,
      onClick: (course: Course) => console.log('Duplicate', course),
    },
    {
      label: 'Delete',
      icon: <Trash2 className="w-4 h-4" />,
      onClick: (course: Course) => console.log('Delete', course),
      variant: 'danger' as const,
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <Header
        title="Courses"
        subtitle="Manage your course catalog"
      />

      <div className="p-6 space-y-6">
        {/* Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-entlaqa-100 dark:bg-entlaqa-900/30">
                <GraduationCap className="w-5 h-5 text-entlaqa-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">
                  {courses.length}
                </p>
                <p className="text-sm text-slate-500">Total Courses</p>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1 }}
            className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                <BookOpen className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">
                  {courses.filter(c => c.status === 'active').length}
                </p>
                <p className="text-sm text-slate-500">Active</p>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.2 }}
            className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-source-offline-light">
                <SourceDot source="offline" size="lg" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">
                  {courses.filter(c => c.data_source === 'offline').length}
                </p>
                <p className="text-sm text-slate-500">Offline Courses</p>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.3 }}
            className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-source-lms-light">
                <SourceDot source="lms" size="lg" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">
                  {courses.filter(c => c.data_source === 'lms').length}
                </p>
                <p className="text-sm text-slate-500">LMS Courses</p>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Data Table */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.4 }}
        >
          <DataTable
            data={courses}
            columns={columns}
            searchable
            searchPlaceholder="Search courses by name or code..."
            searchKeys={['name', 'name_ar', 'code', 'category']}
            showSourceFilter
            getSourceFn={(course) => course.data_source}
            actions={actions}
            headerActions={
              <div className="flex items-center gap-2">
                <button className="btn-ghost text-sm">
                  <Download className="w-4 h-4" />
                  Export
                </button>
                <button className="btn-ghost text-sm">
                  <Upload className="w-4 h-4" />
                  Import
                </button>
                <button className="btn-primary text-sm">
                  <Plus className="w-4 h-4" />
                  Add Course
                </button>
              </div>
            }
            emptyState={{
              title: 'No courses found',
              description: 'Get started by creating your first course.',
              action: {
                label: 'Create Course',
                onClick: () => console.log('Create course'),
              },
            }}
          />
        </motion.div>
      </div>
    </div>
  );
}
