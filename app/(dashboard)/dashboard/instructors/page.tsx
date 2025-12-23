'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Plus,
  Download,
  Eye,
  Edit,
  Calendar,
  Star,
  MapPin,
  Phone,
  Mail,
  Globe,
  Award,
  Clock,
  Users,
  Briefcase,
  TrendingUp,
  CheckCircle,
} from 'lucide-react';
import Header from '@/components/layout/Header';
import DataTable, { Column } from '@/components/ui/DataTable';
import { SourceDot, SourceFilter } from '@/components/shared/SourceBadge';
import { cn, formatCurrency } from '@/lib/utils';

interface Instructor {
  id: string;
  user_id: string;
  full_name: string;
  full_name_ar: string;
  email: string;
  phone: string;
  avatar_url: string | null;
  instructor_type: 'internal' | 'external' | 'consultant' | 'vendor';
  bio: string;
  specializations: string[];
  certifications: string[];
  languages: string[];
  hourly_rate: number | null;
  daily_rate: number | null;
  travel_available: boolean;
  rating: number;
  total_sessions: number;
  total_hours: number;
  status: 'active' | 'inactive' | 'on_leave';
  availability: 'available' | 'busy' | 'unavailable';
  data_source: 'offline' | 'lms';
}

const sampleInstructors: Instructor[] = [
  {
    id: '1',
    user_id: 'U1',
    full_name: 'Dr. Ahmed Hassan Al-Rashid',
    full_name_ar: 'د. أحمد حسن الراشد',
    email: 'ahmed.hassan@trainer.com',
    phone: '+966 50 111 2222',
    avatar_url: null,
    instructor_type: 'internal',
    bio: 'Leadership and management expert with 15+ years of corporate training experience.',
    specializations: ['Leadership', 'Strategic Management', 'Executive Coaching'],
    certifications: ['PMP', 'ICF Certified Coach', 'Six Sigma Black Belt'],
    languages: ['Arabic', 'English'],
    hourly_rate: null,
    daily_rate: null,
    travel_available: true,
    rating: 4.9,
    total_sessions: 156,
    total_hours: 1248,
    status: 'active',
    availability: 'available',
    data_source: 'offline',
  },
  {
    id: '2',
    user_id: 'U2',
    full_name: 'Eng. Sara Mohamed Al-Zahrani',
    full_name_ar: 'م. سارة محمد الزهراني',
    email: 'sara.zahrani@techtrainer.com',
    phone: '+966 55 222 3333',
    avatar_url: null,
    instructor_type: 'external',
    bio: 'Cybersecurity specialist and certified ethical hacker with enterprise training focus.',
    specializations: ['Cybersecurity', 'Information Security', 'Risk Management'],
    certifications: ['CISSP', 'CEH', 'CISM', 'CompTIA Security+'],
    languages: ['Arabic', 'English'],
    hourly_rate: 800,
    daily_rate: 5000,
    travel_available: true,
    rating: 4.8,
    total_sessions: 89,
    total_hours: 712,
    status: 'active',
    availability: 'busy',
    data_source: 'lms',
  },
  {
    id: '3',
    user_id: 'U3',
    full_name: 'Mohamed Ali Ibrahim',
    full_name_ar: 'محمد علي إبراهيم',
    email: 'mohamed.ali@analytics.com',
    phone: '+966 54 333 4444',
    avatar_url: null,
    instructor_type: 'consultant',
    bio: 'Data scientist and analytics trainer specializing in business intelligence.',
    specializations: ['Data Analysis', 'Business Intelligence', 'Python', 'Excel Advanced'],
    certifications: ['Google Data Analytics', 'Microsoft Power BI', 'Tableau Desktop'],
    languages: ['Arabic', 'English', 'French'],
    hourly_rate: 600,
    daily_rate: 4000,
    travel_available: false,
    rating: 4.7,
    total_sessions: 67,
    total_hours: 536,
    status: 'active',
    availability: 'available',
    data_source: 'offline',
  },
  {
    id: '4',
    user_id: 'U4',
    full_name: 'Fatima Abdullah Al-Qasim',
    full_name_ar: 'فاطمة عبدالله القاسم',
    email: 'fatima.qasim@hrpro.com',
    phone: '+966 56 444 5555',
    avatar_url: null,
    instructor_type: 'internal',
    bio: 'HR development specialist focused on soft skills and organizational development.',
    specializations: ['Soft Skills', 'Communication', 'HR Management', 'Team Building'],
    certifications: ['SHRM-SCP', 'ATD Master Trainer', 'DiSC Certified'],
    languages: ['Arabic', 'English'],
    hourly_rate: null,
    daily_rate: null,
    travel_available: true,
    rating: 4.9,
    total_sessions: 203,
    total_hours: 1624,
    status: 'active',
    availability: 'available',
    data_source: 'offline',
  },
  {
    id: '5',
    user_id: 'U5',
    full_name: 'Khalid Saeed Al-Mutairi',
    full_name_ar: 'خالد سعيد المطيري',
    email: 'khalid.mutairi@pmtraining.com',
    phone: '+966 59 555 6666',
    avatar_url: null,
    instructor_type: 'vendor',
    bio: 'Project management professional with expertise in agile methodologies.',
    specializations: ['Project Management', 'Agile', 'Scrum', 'Risk Management'],
    certifications: ['PMP', 'PMI-ACP', 'CSM', 'PRINCE2 Practitioner'],
    languages: ['Arabic', 'English'],
    hourly_rate: 700,
    daily_rate: 4500,
    travel_available: true,
    rating: 4.6,
    total_sessions: 45,
    total_hours: 360,
    status: 'active',
    availability: 'busy',
    data_source: 'lms',
  },
  {
    id: '6',
    user_id: 'U6',
    full_name: 'Dr. Omar Khalid Al-Farsi',
    full_name_ar: 'د. عمر خالد الفارسي',
    email: 'omar.farsi@aitraining.com',
    phone: '+966 50 666 7777',
    avatar_url: null,
    instructor_type: 'external',
    bio: 'AI researcher and trainer specializing in generative AI for business applications.',
    specializations: ['Artificial Intelligence', 'Machine Learning', 'Generative AI', 'Digital Transformation'],
    certifications: ['AWS ML Specialty', 'Google Cloud ML', 'DeepLearning.AI'],
    languages: ['Arabic', 'English'],
    hourly_rate: 1200,
    daily_rate: 8000,
    travel_available: true,
    rating: 5.0,
    total_sessions: 28,
    total_hours: 224,
    status: 'active',
    availability: 'unavailable',
    data_source: 'offline',
  },
];

const typeConfig = {
  internal: { label: 'Internal', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  external: { label: 'External', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
  consultant: { label: 'Consultant', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  vendor: { label: 'Vendor', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
};

const availabilityConfig = {
  available: { label: 'Available', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', dot: 'bg-emerald-500' },
  busy: { label: 'Busy', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', dot: 'bg-amber-500' },
  unavailable: { label: 'Unavailable', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', dot: 'bg-red-500' },
};

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={cn(
            'w-4 h-4',
            star <= rating
              ? 'text-amber-400 fill-amber-400'
              : star - 0.5 <= rating
              ? 'text-amber-400 fill-amber-400/50'
              : 'text-slate-300 dark:text-slate-600'
          )}
        />
      ))}
      <span className="ml-1 text-sm font-medium text-slate-700 dark:text-slate-300">{rating.toFixed(1)}</span>
    </div>
  );
}

export default function InstructorsPage() {
  const [instructors] = useState<Instructor[]>(sampleInstructors);
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('cards');

  const columns: Column<Instructor>[] = [
    {
      key: 'full_name',
      header: 'Instructor',
      sortable: true,
      render: (instructor) => (
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-entlaqa-gradient flex items-center justify-center text-white font-semibold text-sm">
            {instructor.full_name.split(' ').slice(0, 2).map(n => n[0]).join('')}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-slate-900 dark:text-white">{instructor.full_name}</span>
              <SourceDot source={instructor.data_source} size="sm" />
            </div>
            <p className="text-xs text-slate-500">{instructor.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'instructor_type',
      header: 'Type',
      sortable: true,
      render: (instructor) => (
        <span className={cn('px-2.5 py-1 rounded-full text-xs font-medium', typeConfig[instructor.instructor_type].color)}>
          {typeConfig[instructor.instructor_type].label}
        </span>
      ),
    },
    {
      key: 'specializations',
      header: 'Specializations',
      render: (instructor) => (
        <div className="flex flex-wrap gap-1 max-w-xs">
          {instructor.specializations.slice(0, 2).map((spec) => (
            <span key={spec} className="px-2 py-0.5 bg-slate-100 dark:bg-slate-700 rounded text-xs text-slate-600 dark:text-slate-300">
              {spec}
            </span>
          ))}
          {instructor.specializations.length > 2 && (
            <span className="text-xs text-slate-500">+{instructor.specializations.length - 2}</span>
          )}
        </div>
      ),
    },
    {
      key: 'rating',
      header: 'Rating',
      sortable: true,
      render: (instructor) => <StarRating rating={instructor.rating} />,
    },
    {
      key: 'total_sessions',
      header: 'Sessions',
      sortable: true,
      render: (instructor) => (
        <span className="font-medium text-slate-700 dark:text-slate-300">{instructor.total_sessions}</span>
      ),
    },
    {
      key: 'availability',
      header: 'Availability',
      sortable: true,
      render: (instructor) => (
        <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium', availabilityConfig[instructor.availability].color)}>
          <span className={cn('w-1.5 h-1.5 rounded-full', availabilityConfig[instructor.availability].dot)} />
          {availabilityConfig[instructor.availability].label}
        </span>
      ),
    },
  ];

  const stats = {
    total: instructors.length,
    internal: instructors.filter(i => i.instructor_type === 'internal').length,
    external: instructors.filter(i => i.instructor_type === 'external').length,
    available: instructors.filter(i => i.availability === 'available').length,
    totalSessions: instructors.reduce((acc, i) => acc + i.total_sessions, 0),
    avgRating: (instructors.reduce((acc, i) => acc + i.rating, 0) / instructors.length).toFixed(1),
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <Header title="Instructors" subtitle="Manage trainers and their schedules" />

      <div className="p-6 space-y-6">
        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-entlaqa-600" />
              <span className="text-2xl font-bold text-slate-900 dark:text-white">{stats.total}</span>
            </div>
            <p className="text-sm text-slate-500 mt-1">Total Instructors</p>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <div className="flex items-center gap-2">
              <Briefcase className="w-5 h-5 text-blue-600" />
              <span className="text-2xl font-bold text-slate-900 dark:text-white">{stats.internal}</span>
            </div>
            <p className="text-sm text-slate-500 mt-1">Internal</p>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <div className="flex items-center gap-2">
              <Globe className="w-5 h-5 text-purple-600" />
              <span className="text-2xl font-bold text-slate-900 dark:text-white">{stats.external}</span>
            </div>
            <p className="text-sm text-slate-500 mt-1">External</p>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-600" />
              <span className="text-2xl font-bold text-slate-900 dark:text-white">{stats.available}</span>
            </div>
            <p className="text-sm text-slate-500 mt-1">Available</p>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-amber-600" />
              <span className="text-2xl font-bold text-slate-900 dark:text-white">{stats.totalSessions}</span>
            </div>
            <p className="text-sm text-slate-500 mt-1">Total Sessions</p>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="bg-gradient-to-br from-amber-400 to-amber-500 rounded-xl p-4 text-white">
            <div className="flex items-center gap-2">
              <Star className="w-5 h-5 fill-white" />
              <span className="text-2xl font-bold">{stats.avgRating}</span>
            </div>
            <p className="text-sm text-white/80 mt-1">Avg Rating</p>
          </motion.div>
        </div>

        {/* View Toggle & Actions */}
        <div className="flex items-center justify-between">
          <div className="inline-flex items-center p-1 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
            <button
              onClick={() => setViewMode('cards')}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium transition-all',
                viewMode === 'cards' ? 'bg-entlaqa-600 text-white' : 'text-slate-600 dark:text-slate-400'
              )}
            >
              Cards
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium transition-all',
                viewMode === 'table' ? 'bg-entlaqa-600 text-white' : 'text-slate-600 dark:text-slate-400'
              )}
            >
              Table
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button className="btn-ghost text-sm">
              <Download className="w-4 h-4" />
              Export
            </button>
            <button className="btn-primary text-sm">
              <Plus className="w-4 h-4" />
              Add Instructor
            </button>
          </div>
        </div>

        {/* Cards View */}
        {viewMode === 'cards' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {instructors.map((instructor, index) => (
              <motion.div
                key={instructor.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className={cn(
                  'bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden hover:shadow-lg transition-shadow',
                  'border-l-4',
                  instructor.data_source === 'offline' ? 'border-l-source-offline' : 'border-l-source-lms'
                )}
              >
                {/* Header */}
                <div className="p-5 pb-0">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-14 h-14 rounded-xl bg-entlaqa-gradient flex items-center justify-center text-white font-bold text-lg">
                        {instructor.full_name.split(' ').slice(0, 2).map(n => n[0]).join('')}
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-900 dark:text-white">{instructor.full_name}</h3>
                        <span className={cn('inline-block mt-1 px-2 py-0.5 rounded text-xs font-medium', typeConfig[instructor.instructor_type].color)}>
                          {typeConfig[instructor.instructor_type].label}
                        </span>
                      </div>
                    </div>
                    <span className={cn('flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium', availabilityConfig[instructor.availability].color)}>
                      <span className={cn('w-1.5 h-1.5 rounded-full', availabilityConfig[instructor.availability].dot)} />
                      {availabilityConfig[instructor.availability].label}
                    </span>
                  </div>

                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-3 line-clamp-2">
                    {instructor.bio}
                  </p>
                </div>

                {/* Specializations */}
                <div className="px-5 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {instructor.specializations.map((spec) => (
                      <span key={spec} className="px-2 py-1 bg-slate-100 dark:bg-slate-700 rounded-lg text-xs text-slate-600 dark:text-slate-300">
                        {spec}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Stats */}
                <div className="px-5 py-3 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-700">
                  <div className="flex items-center justify-between">
                    <StarRating rating={instructor.rating} />
                    <div className="flex items-center gap-4 text-sm text-slate-600 dark:text-slate-400">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        {instructor.total_sessions}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        {instructor.total_hours}h
                      </span>
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {instructor.languages.map((lang) => (
                      <span key={lang} className="text-xs text-slate-500">{lang}</span>
                    ))}
                  </div>
                  {instructor.daily_rate && (
                    <span className="text-sm font-semibold text-entlaqa-600">
                      {formatCurrency(instructor.daily_rate)}/day
                    </span>
                  )}
                </div>

                {/* Actions */}
                <div className="px-5 py-3 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-700 flex gap-2">
                  <button className="flex-1 btn-ghost text-sm py-2">
                    <Eye className="w-4 h-4" />
                    View
                  </button>
                  <button className="flex-1 btn-ghost text-sm py-2">
                    <Calendar className="w-4 h-4" />
                    Schedule
                  </button>
                  <button className="flex-1 btn-primary text-sm py-2">
                    <Mail className="w-4 h-4" />
                    Contact
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          /* Table View */
          <DataTable
            data={instructors}
            columns={columns}
            searchable
            searchPlaceholder="Search instructors..."
            searchKeys={['full_name', 'email', 'specializations']}
            showSourceFilter
            getSourceFn={(i) => i.data_source}
            actions={[
              { label: 'View Profile', icon: <Eye className="w-4 h-4" />, onClick: (i) => console.log('View', i) },
              { label: 'Edit', icon: <Edit className="w-4 h-4" />, onClick: (i) => console.log('Edit', i) },
              { label: 'Schedule', icon: <Calendar className="w-4 h-4" />, onClick: (i) => console.log('Schedule', i) },
            ]}
          />
        )}
      </div>
    </div>
  );
}
