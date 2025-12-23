'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Plus,
  Download,
  Eye,
  Edit,
  Trash2,
  MapPin,
  Building2,
  Phone,
  Mail,
  DoorOpen,
  Users,
  CheckCircle,
  AlertCircle,
  Wrench,
} from 'lucide-react';
import Header from '@/components/layout/Header';
import DataTable, { Column } from '@/components/ui/DataTable';
import { SourceDot } from '@/components/shared/SourceBadge';
import { cn, formatCurrency } from '@/lib/utils';

interface Venue {
  id: string;
  name: string;
  name_ar: string;
  address: string;
  city: string;
  venue_type: 'internal' | 'external' | 'partner' | 'rented';
  status: 'active' | 'inactive' | 'maintenance';
  rooms_count: number;
  total_capacity: number;
  daily_rate: number | null;
  contact_name: string;
  contact_phone: string;
  amenities: string[];
  data_source: 'offline' | 'lms';
}

const sampleVenues: Venue[] = [
  {
    id: '1',
    name: 'Main Training Center',
    name_ar: 'مركز التدريب الرئيسي',
    address: 'King Fahd Road, Al Olaya District',
    city: 'Riyadh',
    venue_type: 'internal',
    status: 'active',
    rooms_count: 8,
    total_capacity: 320,
    daily_rate: null,
    contact_name: 'Abdullah Al-Saud',
    contact_phone: '+966 11 234 5678',
    amenities: ['WiFi', 'Projector', 'Whiteboard', 'AC', 'Parking', 'Cafeteria'],
    data_source: 'offline',
  },
  {
    id: '2',
    name: 'Tech Hub Innovation Center',
    name_ar: 'مركز ابتكار التقنية',
    address: 'Digital City, KAFD',
    city: 'Riyadh',
    venue_type: 'partner',
    status: 'active',
    rooms_count: 5,
    total_capacity: 150,
    daily_rate: 5000,
    contact_name: 'Fahad Al-Rashid',
    contact_phone: '+966 11 345 6789',
    amenities: ['WiFi', 'Smart Board', 'Video Conferencing', 'Computer Lab', 'Coffee Area'],
    data_source: 'offline',
  },
  {
    id: '3',
    name: 'Jeddah Branch Office',
    name_ar: 'فرع جدة',
    address: 'Tahlia Street, Al-Andalus District',
    city: 'Jeddah',
    venue_type: 'internal',
    status: 'active',
    rooms_count: 4,
    total_capacity: 100,
    daily_rate: null,
    contact_name: 'Sara Al-Zahrani',
    contact_phone: '+966 12 456 7890',
    amenities: ['WiFi', 'Projector', 'Whiteboard', 'AC'],
    data_source: 'lms',
  },
  {
    id: '4',
    name: 'Executive Conference Hotel',
    name_ar: 'فندق المؤتمرات التنفيذي',
    address: 'King Abdullah Road',
    city: 'Riyadh',
    venue_type: 'rented',
    status: 'active',
    rooms_count: 12,
    total_capacity: 500,
    daily_rate: 15000,
    contact_name: 'Events Team',
    contact_phone: '+966 11 567 8901',
    amenities: ['WiFi', 'AV Equipment', 'Catering', 'VIP Lounge', 'Valet Parking'],
    data_source: 'offline',
  },
  {
    id: '5',
    name: 'Dammam Industrial Training Facility',
    name_ar: 'منشأة التدريب الصناعي بالدمام',
    address: 'Industrial Area 2',
    city: 'Dammam',
    venue_type: 'external',
    status: 'maintenance',
    rooms_count: 6,
    total_capacity: 180,
    daily_rate: 8000,
    contact_name: 'Mohammed Al-Qahtani',
    contact_phone: '+966 13 678 9012',
    amenities: ['Workshop Space', 'Safety Equipment', 'Computer Lab', 'Parking'],
    data_source: 'offline',
  },
];

const venueTypeConfig = {
  internal: { label: 'Internal', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  external: { label: 'External', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
  partner: { label: 'Partner', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  rented: { label: 'Rented', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
};

const statusConfig = {
  active: { label: 'Active', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', icon: CheckCircle },
  inactive: { label: 'Inactive', color: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300', icon: AlertCircle },
  maintenance: { label: 'Maintenance', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', icon: Wrench },
};

export default function VenuesPage() {
  const [venues] = useState<Venue[]>(sampleVenues);

  const columns: Column<Venue>[] = [
    {
      key: 'name',
      header: 'Venue',
      sortable: true,
      render: (venue) => (
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
            <Building2 className="w-5 h-5 text-slate-600 dark:text-slate-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-slate-900 dark:text-white">{venue.name}</span>
              <SourceDot source={venue.data_source} size="sm" />
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {venue.city}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'venue_type',
      header: 'Type',
      sortable: true,
      render: (venue) => (
        <span className={cn('px-2.5 py-1 rounded-full text-xs font-medium', venueTypeConfig[venue.venue_type].color)}>
          {venueTypeConfig[venue.venue_type].label}
        </span>
      ),
    },
    {
      key: 'rooms_count',
      header: 'Rooms',
      sortable: true,
      render: (venue) => (
        <div className="flex items-center gap-1.5">
          <DoorOpen className="w-4 h-4 text-slate-400" />
          <span className="text-slate-700 dark:text-slate-300">{venue.rooms_count}</span>
        </div>
      ),
    },
    {
      key: 'total_capacity',
      header: 'Capacity',
      sortable: true,
      render: (venue) => (
        <div className="flex items-center gap-1.5">
          <Users className="w-4 h-4 text-slate-400" />
          <span className="text-slate-700 dark:text-slate-300">{venue.total_capacity}</span>
        </div>
      ),
    },
    {
      key: 'daily_rate',
      header: 'Daily Rate',
      sortable: true,
      render: (venue) => (
        <span className="text-slate-700 dark:text-slate-300">
          {venue.daily_rate ? formatCurrency(venue.daily_rate) : '—'}
        </span>
      ),
    },
    {
      key: 'contact_name',
      header: 'Contact',
      render: (venue) => (
        <div className="text-sm">
          <p className="text-slate-700 dark:text-slate-300">{venue.contact_name}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{venue.contact_phone}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (venue) => {
        const config = statusConfig[venue.status];
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

  const actions = [
    { label: 'View Details', icon: <Eye className="w-4 h-4" />, onClick: (v: Venue) => console.log('View', v) },
    { label: 'Edit Venue', icon: <Edit className="w-4 h-4" />, onClick: (v: Venue) => console.log('Edit', v) },
    { label: 'Manage Rooms', icon: <DoorOpen className="w-4 h-4" />, onClick: (v: Venue) => console.log('Rooms', v) },
    { label: 'Delete', icon: <Trash2 className="w-4 h-4" />, onClick: (v: Venue) => console.log('Delete', v), variant: 'danger' as const },
  ];

  const stats = {
    total: venues.length,
    active: venues.filter(v => v.status === 'active').length,
    totalRooms: venues.reduce((acc, v) => acc + v.rooms_count, 0),
    totalCapacity: venues.reduce((acc, v) => acc + v.total_capacity, 0),
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <Header title="Venues" subtitle="Manage training venues and rooms" />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <div className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-entlaqa-600" />
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.total}</p>
            </div>
            <p className="text-sm text-slate-500 mt-1">Total Venues</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-600" />
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.active}</p>
            </div>
            <p className="text-sm text-slate-500 mt-1">Active</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <div className="flex items-center gap-2">
              <DoorOpen className="w-5 h-5 text-blue-600" />
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.totalRooms}</p>
            </div>
            <p className="text-sm text-slate-500 mt-1">Total Rooms</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-purple-600" />
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.totalCapacity}</p>
            </div>
            <p className="text-sm text-slate-500 mt-1">Total Capacity</p>
          </motion.div>
        </div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <DataTable data={venues} columns={columns} searchable searchPlaceholder="Search venues..." searchKeys={['name', 'name_ar', 'city', 'address']} showSourceFilter getSourceFn={(v) => v.data_source} actions={actions}
            headerActions={<div className="flex items-center gap-2"><button className="btn-ghost text-sm"><Download className="w-4 h-4" />Export</button><button className="btn-primary text-sm"><Plus className="w-4 h-4" />Add Venue</button></div>}
            emptyState={{ title: 'No venues found', description: 'Add your first training venue.', action: { label: 'Add Venue', onClick: () => console.log('Add venue') } }}
          />
        </motion.div>
      </div>
    </div>
  );
}
