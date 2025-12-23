'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Search,
  Filter,
  Download,
  Upload,
  Plus,
  MoreHorizontal,
  Mail,
  Phone,
  Building2,
  ChevronDown,
  Eye,
  Edit,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import Header from '@/components/layout/Header';
import { SourceBadge, SourceFilter, SourceDot } from '@/components/shared/SourceBadge';
import { cn, getInitials } from '@/lib/utils';

const learners = [
  { id: 1, name: 'Ahmed Hassan Ibrahim', email: 'ahmed.hassan@company.com', phone: '+966 50 123 4567', department: 'Information Technology', employeeId: 'EMP001', enrollments: 12, completed: 10, source: 'offline' as const, avatar: null, status: 'active' },
  { id: 2, name: 'Sara Mohamed Ali', email: 'sara.mohamed@company.com', phone: '+966 55 234 5678', department: 'Human Resources', employeeId: 'EMP002', enrollments: 8, completed: 8, source: 'lms' as const, avatar: null, status: 'active' },
  { id: 3, name: 'Khalid Abdullah', email: 'khalid.abdullah@company.com', phone: '+966 54 345 6789', department: 'Finance', employeeId: 'EMP003', enrollments: 15, completed: 12, source: 'offline' as const, avatar: null, status: 'active' },
  { id: 4, name: 'Fatima Al-Rashid', email: 'fatima.rashid@company.com', phone: '+966 56 456 7890', department: 'Operations', employeeId: 'EMP004', enrollments: 6, completed: 5, source: 'lms' as const, avatar: null, status: 'active' },
  { id: 5, name: 'Omar Yusuf Khan', email: 'omar.khan@company.com', phone: '+966 50 567 8901', department: 'Sales', employeeId: 'EMP005', enrollments: 20, completed: 18, source: 'offline' as const, avatar: null, status: 'active' },
  { id: 6, name: 'Noura Saleh Ahmed', email: 'noura.saleh@company.com', phone: '+966 55 678 9012', department: 'Marketing', employeeId: 'EMP006', enrollments: 9, completed: 7, source: 'lms' as const, avatar: null, status: 'inactive' },
  { id: 7, name: 'Mansour Al-Dosari', email: 'mansour.dosari@company.com', phone: '+966 54 789 0123', department: 'Information Technology', employeeId: 'EMP007', enrollments: 11, completed: 11, source: 'offline' as const, avatar: null, status: 'active' },
  { id: 8, name: 'Layla Mahmoud', email: 'layla.mahmoud@company.com', phone: '+966 56 890 1234', department: 'Legal', employeeId: 'EMP008', enrollments: 4, completed: 3, source: 'lms' as const, avatar: null, status: 'active' },
];

export default function LearnersPage() {
  const [sourceFilter, setSourceFilter] = useState<'all' | 'offline' | 'lms'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLearners, setSelectedLearners] = useState<number[]>([]);

  const filteredLearners = learners.filter((learner) => {
    const matchesSource = sourceFilter === 'all' || learner.source === sourceFilter;
    const matchesSearch = learner.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      learner.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      learner.employeeId.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSource && matchesSearch;
  });

  const counts = {
    all: learners.length,
    offline: learners.filter(l => l.source === 'offline').length,
    lms: learners.filter(l => l.source === 'lms').length,
  };

  const toggleSelectAll = () => {
    if (selectedLearners.length === filteredLearners.length) {
      setSelectedLearners([]);
    } else {
      setSelectedLearners(filteredLearners.map(l => l.id));
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedLearners(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <Header title="Learners" subtitle="Manage all learner profiles and training records" />

      <div className="p-6 space-y-6">
        {/* Filters and Actions Bar */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <SourceFilter value={sourceFilter} onChange={setSourceFilter} counts={counts} />
          </div>

          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search learners..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2 w-64 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-entlaqa-500/20 focus:border-entlaqa-500"
              />
            </div>

            {/* Filter Button */}
            <button className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
              <Filter className="w-4 h-4" />
              Filters
            </button>

            {/* Export */}
            <button className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
              <Download className="w-4 h-4" />
              Export
            </button>

            {/* Sync from LMS */}
            <button className="flex items-center gap-2 px-4 py-2 bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-xl text-sm text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-950/50">
              <RefreshCw className="w-4 h-4" />
              Sync LMS
            </button>

            {/* Add Learner */}
            <button className="flex items-center gap-2 px-4 py-2 bg-entlaqa-gradient text-white rounded-xl text-sm font-medium hover:shadow-lg hover:shadow-entlaqa-500/25">
              <Plus className="w-4 h-4" />
              Add Learner
            </button>
          </div>
        </div>

        {/* Bulk Actions */}
        {selectedLearners.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-4 p-4 bg-entlaqa-50 dark:bg-entlaqa-950/30 border border-entlaqa-200 dark:border-entlaqa-800 rounded-xl"
          >
            <span className="text-sm font-medium text-entlaqa-700 dark:text-entlaqa-300">
              {selectedLearners.length} learner(s) selected
            </span>
            <div className="flex items-center gap-2">
              <button className="px-3 py-1.5 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50">
                Bulk Enroll
              </button>
              <button className="px-3 py-1.5 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50">
                Export Selected
              </button>
              <button className="px-3 py-1.5 text-sm text-red-600 bg-white dark:bg-slate-800 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50">
                Delete
              </button>
            </div>
          </motion.div>
        )}

        {/* Learners Table */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
        >
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 dark:bg-slate-800/50">
                <tr>
                  <th className="px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={selectedLearners.length === filteredLearners.length && filteredLearners.length > 0}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded border-slate-300 text-entlaqa-600 focus:ring-entlaqa-500"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Learner
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Source
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Department
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Contact
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Training Progress
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {filteredLearners.map((learner, index) => (
                  <motion.tr
                    key={learner.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className={cn(
                      'hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors',
                      selectedLearners.includes(learner.id) && 'bg-entlaqa-50/50 dark:bg-entlaqa-950/20'
                    )}
                  >
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        checked={selectedLearners.includes(learner.id)}
                        onChange={() => toggleSelect(learner.id)}
                        className="w-4 h-4 rounded border-slate-300 text-entlaqa-600 focus:ring-entlaqa-500"
                      />
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          'w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm',
                          learner.source === 'offline' ? 'bg-gradient-to-br from-green-500 to-emerald-600' : 'bg-gradient-to-br from-purple-500 to-violet-600'
                        )}>
                          {getInitials(learner.name)}
                        </div>
                        <div>
                          <p className="font-medium text-slate-900 dark:text-white">{learner.name}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{learner.employeeId}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <SourceBadge source={learner.source} size="sm" />
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-slate-400" />
                        <span className="text-sm text-slate-700 dark:text-slate-300">{learner.department}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                          <Mail className="w-3.5 h-3.5" />
                          {learner.email}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                          <Phone className="w-3.5 h-3.5" />
                          {learner.phone}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-600 dark:text-slate-400">
                            {learner.completed}/{learner.enrollments} completed
                          </span>
                          <span className="font-medium text-slate-900 dark:text-white">
                            {Math.round((learner.completed / learner.enrollments) * 100)}%
                          </span>
                        </div>
                        <div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className={cn(
                              'h-full rounded-full',
                              learner.source === 'offline' ? 'bg-source-offline' : 'bg-source-lms'
                            )}
                            style={{ width: `${(learner.completed / learner.enrollments) * 100}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span className={cn(
                        'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium',
                        learner.status === 'active'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                      )}>
                        {learner.status}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors">
                          <Eye className="w-4 h-4" />
                        </button>
                        <button className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors">
                          <Edit className="w-4 h-4" />
                        </button>
                        <button className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 dark:border-slate-700">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Showing {filteredLearners.length} of {learners.length} learners
            </p>
            <div className="flex items-center gap-2">
              <button className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50" disabled>
                Previous
              </button>
              <button className="px-3 py-1.5 text-sm bg-entlaqa-600 text-white rounded-lg">1</button>
              <button className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700">2</button>
              <button className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700">3</button>
              <button className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700">
                Next
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
