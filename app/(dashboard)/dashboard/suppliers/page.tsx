'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Plus,
  Download,
  Eye,
  Edit,
  Trash2,
  Building2,
  Phone,
  Mail,
  Globe,
  FileText,
  Star,
  Calendar,
  DollarSign,
  CheckCircle,
  AlertCircle,
  Clock,
  MapPin,
  Tag,
} from 'lucide-react';
import Header from '@/components/layout/Header';
import DataTable, { Column } from '@/components/ui/DataTable';
import { SourceDot } from '@/components/shared/SourceBadge';
import { cn, formatCurrency, formatDate } from '@/lib/utils';

interface Supplier {
  id: string;
  name: string;
  name_ar: string;
  type: 'training_provider' | 'venue' | 'catering' | 'materials' | 'technology' | 'consulting';
  contact_person: string;
  email: string;
  phone: string;
  website: string;
  address: string;
  city: string;
  tax_number: string;
  bank_details: string;
  payment_terms: string;
  rating: number;
  total_contracts: number;
  total_spent: number;
  status: 'active' | 'inactive' | 'pending' | 'blacklisted';
  contract_end_date: string | null;
  services: string[];
  data_source: 'offline' | 'lms';
}

const sampleSuppliers: Supplier[] = [
  {
    id: '1',
    name: 'TechSkills Training Institute',
    name_ar: 'معهد المهارات التقنية للتدريب',
    type: 'training_provider',
    contact_person: 'Mohammed Al-Rashid',
    email: 'contact@techskills.sa',
    phone: '+966 11 456 7890',
    website: 'www.techskills.sa',
    address: 'King Fahd Road, Business Gate',
    city: 'Riyadh',
    tax_number: 'SA123456789',
    bank_details: 'Al Rajhi Bank - 1234567890',
    payment_terms: 'Net 30',
    rating: 4.8,
    total_contracts: 24,
    total_spent: 2450000,
    status: 'active',
    contract_end_date: '2025-12-31',
    services: ['IT Training', 'Cybersecurity', 'Cloud Computing'],
    data_source: 'offline',
  },
  {
    id: '2',
    name: 'Executive Conference Center',
    name_ar: 'مركز المؤتمرات التنفيذي',
    type: 'venue',
    contact_person: 'Sara Al-Zahrani',
    email: 'events@execconf.com',
    phone: '+966 11 567 8901',
    website: 'www.execconf.com',
    address: 'Olaya District',
    city: 'Riyadh',
    tax_number: 'SA234567890',
    bank_details: 'NCB - 2345678901',
    payment_terms: 'Net 15',
    rating: 4.9,
    total_contracts: 45,
    total_spent: 1890000,
    status: 'active',
    contract_end_date: '2025-06-30',
    services: ['Conference Rooms', 'Training Halls', 'Catering'],
    data_source: 'offline',
  },
  {
    id: '3',
    name: 'Premium Catering Services',
    name_ar: 'خدمات الضيافة المتميزة',
    type: 'catering',
    contact_person: 'Khalid Ibrahim',
    email: 'orders@premiumcatering.sa',
    phone: '+966 12 345 6789',
    website: 'www.premiumcatering.sa',
    address: 'Industrial Area',
    city: 'Jeddah',
    tax_number: 'SA345678901',
    bank_details: 'Riyad Bank - 3456789012',
    payment_terms: 'Net 7',
    rating: 4.5,
    total_contracts: 67,
    total_spent: 456000,
    status: 'active',
    contract_end_date: null,
    services: ['Lunch Boxes', 'Coffee Breaks', 'Buffet'],
    data_source: 'offline',
  },
  {
    id: '4',
    name: 'Leadership Academy International',
    name_ar: 'أكاديمية القيادة الدولية',
    type: 'training_provider',
    contact_person: 'Dr. Ahmed Hassan',
    email: 'info@leadershipacademy.com',
    phone: '+966 11 678 9012',
    website: 'www.leadershipacademy.com',
    address: 'KAFD',
    city: 'Riyadh',
    tax_number: 'SA456789012',
    bank_details: 'SABB - 4567890123',
    payment_terms: 'Net 45',
    rating: 5.0,
    total_contracts: 18,
    total_spent: 3200000,
    status: 'active',
    contract_end_date: '2026-03-31',
    services: ['Executive Coaching', 'Leadership Programs', 'Team Building'],
    data_source: 'lms',
  },
  {
    id: '5',
    name: 'Digital Learning Solutions',
    name_ar: 'حلول التعلم الرقمي',
    type: 'technology',
    contact_person: 'Noura Al-Otaibi',
    email: 'support@digitallearning.sa',
    phone: '+966 11 789 0123',
    website: 'www.digitallearning.sa',
    address: 'Tech Valley',
    city: 'Riyadh',
    tax_number: 'SA567890123',
    bank_details: 'Al Inma Bank - 5678901234',
    payment_terms: 'Net 30',
    rating: 4.6,
    total_contracts: 8,
    total_spent: 890000,
    status: 'active',
    contract_end_date: '2025-09-30',
    services: ['LMS Platform', 'E-Learning Content', 'Virtual Labs'],
    data_source: 'lms',
  },
  {
    id: '6',
    name: 'Quick Print Services',
    name_ar: 'خدمات الطباعة السريعة',
    type: 'materials',
    contact_person: 'Omar Khalid',
    email: 'orders@quickprint.sa',
    phone: '+966 11 890 1234',
    website: 'www.quickprint.sa',
    address: 'Malaz District',
    city: 'Riyadh',
    tax_number: 'SA678901234',
    bank_details: 'Al Bilad Bank - 6789012345',
    payment_terms: 'COD',
    rating: 4.2,
    total_contracts: 89,
    total_spent: 234000,
    status: 'inactive',
    contract_end_date: '2024-12-31',
    services: ['Training Materials', 'Certificates', 'Banners'],
    data_source: 'offline',
  },
];

const typeConfig = {
  training_provider: { label: 'Training Provider', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', icon: '🎓' },
  venue: { label: 'Venue', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400', icon: '🏢' },
  catering: { label: 'Catering', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', icon: '🍽️' },
  materials: { label: 'Materials', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', icon: '📦' },
  technology: { label: 'Technology', color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400', icon: '💻' },
  consulting: { label: 'Consulting', color: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400', icon: '💼' },
};

const statusConfig = {
  active: { label: 'Active', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', icon: CheckCircle },
  inactive: { label: 'Inactive', color: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300', icon: Clock },
  pending: { label: 'Pending', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', icon: AlertCircle },
  blacklisted: { label: 'Blacklisted', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', icon: AlertCircle },
};

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={cn(
            'w-4 h-4',
            star <= rating ? 'text-amber-400 fill-amber-400' : 'text-slate-300 dark:text-slate-600'
          )}
        />
      ))}
      <span className="ml-1 text-sm font-medium text-slate-700 dark:text-slate-300">{rating.toFixed(1)}</span>
    </div>
  );
}

export default function SuppliersPage() {
  const [suppliers] = useState<Supplier[]>(sampleSuppliers);
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('cards');

  const columns: Column<Supplier>[] = [
    {
      key: 'name',
      header: 'Supplier',
      sortable: true,
      render: (supplier) => (
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-lg">
            {typeConfig[supplier.type].icon}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-slate-900 dark:text-white">{supplier.name}</span>
              <SourceDot source={supplier.data_source} size="sm" />
            </div>
            <p className="text-xs text-slate-500">{supplier.city}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      sortable: true,
      render: (supplier) => (
        <span className={cn('px-2.5 py-1 rounded-full text-xs font-medium', typeConfig[supplier.type].color)}>
          {typeConfig[supplier.type].label}
        </span>
      ),
    },
    {
      key: 'contact_person',
      header: 'Contact',
      render: (supplier) => (
        <div>
          <p className="text-slate-700 dark:text-slate-300">{supplier.contact_person}</p>
          <p className="text-xs text-slate-500">{supplier.email}</p>
        </div>
      ),
    },
    {
      key: 'rating',
      header: 'Rating',
      sortable: true,
      render: (supplier) => <StarRating rating={supplier.rating} />,
    },
    {
      key: 'total_spent',
      header: 'Total Spent',
      sortable: true,
      render: (supplier) => (
        <span className="font-medium text-slate-700 dark:text-slate-300">
          {formatCurrency(supplier.total_spent)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (supplier) => {
        const config = statusConfig[supplier.status];
        const Icon = config.icon;
        return (
          <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium', config.color)}>
            <Icon className="w-3 h-3" />
            {config.label}
          </span>
        );
      },
    },
  ];

  const stats = {
    total: suppliers.length,
    active: suppliers.filter(s => s.status === 'active').length,
    totalSpent: suppliers.reduce((acc, s) => acc + s.total_spent, 0),
    avgRating: (suppliers.reduce((acc, s) => acc + s.rating, 0) / suppliers.length).toFixed(1),
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <Header title="Suppliers" subtitle="Manage vendors and service providers" />

      <div className="p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <div className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-entlaqa-600" />
              <span className="text-2xl font-bold text-slate-900 dark:text-white">{stats.total}</span>
            </div>
            <p className="text-sm text-slate-500 mt-1">Total Suppliers</p>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-600" />
              <span className="text-2xl font-bold text-emerald-600">{stats.active}</span>
            </div>
            <p className="text-sm text-slate-500 mt-1">Active</p>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <div className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-blue-600" />
              <span className="text-2xl font-bold text-slate-900 dark:text-white">{formatCurrency(stats.totalSpent)}</span>
            </div>
            <p className="text-sm text-slate-500 mt-1">Total Spent</p>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="bg-gradient-to-br from-amber-400 to-amber-500 rounded-xl p-4 text-white">
            <div className="flex items-center gap-2">
              <Star className="w-5 h-5 fill-white" />
              <span className="text-2xl font-bold">{stats.avgRating}</span>
            </div>
            <p className="text-sm text-white/80 mt-1">Avg Rating</p>
          </motion.div>
        </div>

        {/* View Toggle */}
        <div className="flex items-center justify-between">
          <div className="inline-flex items-center p-1 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
            <button
              onClick={() => setViewMode('cards')}
              className={cn('px-4 py-2 rounded-lg text-sm font-medium transition-all', viewMode === 'cards' ? 'bg-entlaqa-600 text-white' : 'text-slate-600 dark:text-slate-400')}
            >
              Cards
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={cn('px-4 py-2 rounded-lg text-sm font-medium transition-all', viewMode === 'table' ? 'bg-entlaqa-600 text-white' : 'text-slate-600 dark:text-slate-400')}
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
              Add Supplier
            </button>
          </div>
        </div>

        {/* Cards View */}
        {viewMode === 'cards' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {suppliers.map((supplier, index) => (
              <motion.div
                key={supplier.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className={cn(
                  'bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden hover:shadow-lg transition-shadow',
                  'border-l-4',
                  supplier.data_source === 'offline' ? 'border-l-source-offline' : 'border-l-source-lms'
                )}
              >
                <div className="p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-2xl">
                        {typeConfig[supplier.type].icon}
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-900 dark:text-white">{supplier.name}</h3>
                        <span className={cn('inline-block mt-1 px-2 py-0.5 rounded text-xs font-medium', typeConfig[supplier.type].color)}>
                          {typeConfig[supplier.type].label}
                        </span>
                      </div>
                    </div>
                    <span className={cn('flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium', statusConfig[supplier.status].color)}>
                      {statusConfig[supplier.status].label}
                    </span>
                  </div>

                  <div className="space-y-2 text-sm mb-4">
                    <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                      <MapPin className="w-4 h-4" />
                      {supplier.city}
                    </div>
                    <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                      <Mail className="w-4 h-4" />
                      {supplier.email}
                    </div>
                    <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                      <Phone className="w-4 h-4" />
                      {supplier.phone}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1 mb-4">
                    {supplier.services.slice(0, 3).map((service) => (
                      <span key={service} className="px-2 py-1 bg-slate-100 dark:bg-slate-700 rounded text-xs text-slate-600 dark:text-slate-300">
                        {service}
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-700">
                    <StarRating rating={supplier.rating} />
                    <span className="text-sm font-semibold text-entlaqa-600">
                      {formatCurrency(supplier.total_spent)}
                    </span>
                  </div>
                </div>

                <div className="px-5 py-3 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-700 flex gap-2">
                  <button className="flex-1 btn-ghost text-sm py-2">
                    <Eye className="w-4 h-4" />
                    View
                  </button>
                  <button className="flex-1 btn-ghost text-sm py-2">
                    <FileText className="w-4 h-4" />
                    Contracts
                  </button>
                  <button className="flex-1 btn-primary text-sm py-2">
                    <Edit className="w-4 h-4" />
                    Edit
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <DataTable
            data={suppliers}
            columns={columns}
            searchable
            searchPlaceholder="Search suppliers..."
            searchKeys={['name', 'name_ar', 'email', 'contact_person', 'city']}
            showSourceFilter
            getSourceFn={(s) => s.data_source}
            actions={[
              { label: 'View Details', icon: <Eye className="w-4 h-4" />, onClick: (s) => console.log('View', s) },
              { label: 'Edit', icon: <Edit className="w-4 h-4" />, onClick: (s) => console.log('Edit', s) },
              { label: 'Contracts', icon: <FileText className="w-4 h-4" />, onClick: (s) => console.log('Contracts', s) },
              { label: 'Delete', icon: <Trash2 className="w-4 h-4" />, onClick: (s) => console.log('Delete', s), variant: 'danger' },
            ]}
          />
        )}
      </div>
    </div>
  );
}
