'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Edit, Trash2, User, Mail, Phone, X, Loader2, AlertCircle, CheckCircle, Search, Building, GraduationCap } from 'lucide-react';
import Header from '@/components/layout/Header';
import { createClient, generateId } from '@/lib/supabase';

interface Learner {
  id: string;
  employee_id: string;
  full_name: string;
  full_name_ar: string;
  email: string;
  phone: string;
  department: string;
  job_title: string;
  status: string;
  hire_date: string;
}

export default function LearnersPage() {
  const [learners, setLearners] = useState<Learner[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedLearner, setSelectedLearner] = useState<Learner | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const supabase = createClient();

  const [formData, setFormData] = useState({
    employee_id: '', full_name: '', full_name_ar: '', email: '', phone: '', department: '', job_title: '', status: 'active', hire_date: ''
  });

  useEffect(() => { fetchLearners(); }, []);

  const fetchLearners = async () => {
    setIsLoading(true);
    const { data, error } = await supabase.from('learners').select('*').order('full_name');
    if (error) { setError('Failed to fetch learners'); console.error(error); }
    else { setLearners(data || []); }
    setIsLoading(false);
  };

  const departments = Array.from(new Set(learners.map(l => l.department).filter(Boolean)));

  const filteredLearners = learners.filter(l => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (!l.full_name.toLowerCase().includes(query) && !l.email?.toLowerCase().includes(query) && !l.employee_id?.toLowerCase().includes(query)) return false;
    }
    if (departmentFilter !== 'all' && l.department !== departmentFilter) return false;
    return true;
  });

  const openCreateModal = () => {
    setSelectedLearner(null);
    setFormData({ employee_id: '', full_name: '', full_name_ar: '', email: '', phone: '', department: '', job_title: '', status: 'active', hire_date: '' });
    setIsModalOpen(true);
  };

  const openEditModal = (learner: Learner) => {
    setSelectedLearner(learner);
    setFormData({
      employee_id: learner.employee_id || '', full_name: learner.full_name, full_name_ar: learner.full_name_ar || '',
      email: learner.email || '', phone: learner.phone || '', department: learner.department || '',
      job_title: learner.job_title || '', status: learner.status || 'active', hire_date: learner.hire_date || ''
    });
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!formData.full_name) { setError('Name is required'); return; }
    setIsSaving(true); setError('');

    const learnerData = { ...formData, updated_at: new Date().toISOString() };

    if (selectedLearner) {
      const { error } = await supabase.from('learners').update(learnerData).eq('id', selectedLearner.id);
      if (error) setError('Failed to update: ' + error.message);
      else { setSuccess('Learner updated!'); setIsModalOpen(false); fetchLearners(); }
    } else {
      const { error } = await supabase.from('learners').insert({ id: generateId('lrn'), ...learnerData, organization_id: 'org_001', data_source: 'offline', created_at: new Date().toISOString() });
      if (error) setError('Failed to create: ' + error.message);
      else { setSuccess('Learner created!'); setIsModalOpen(false); fetchLearners(); }
    }
    setTimeout(() => setSuccess(''), 3000);
    setIsSaving(false);
  };

  const deleteLearner = async (learner: Learner) => {
    if (!confirm(`Delete "${learner.full_name}"?`)) return;
    const { error } = await supabase.from('learners').delete().eq('id', learner.id);
    if (error) setError('Failed to delete: ' + error.message);
    else { setSuccess('Learner deleted!'); fetchLearners(); }
    setTimeout(() => setSuccess(''), 3000);
  };

  const statusColors: Record<string, string> = { active: 'bg-green-100 text-green-800', inactive: 'bg-gray-100 text-gray-800', on_leave: 'bg-yellow-100 text-yellow-800', terminated: 'bg-red-100 text-red-800' };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="Learners" subtitle="Manage employees and trainees" />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700"><AlertCircle className="w-5 h-5" />{error}<button onClick={() => setError('')} className="ml-auto">×</button></div>}
        {success && <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700"><CheckCircle className="w-5 h-5" />{success}</div>}

        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" /><input type="text" placeholder="Search learners..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg w-64" /></div>
            <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} className="px-4 py-2 border border-gray-300 rounded-lg">
              <option value="all">All Departments</option>
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <button onClick={openCreateModal} className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"><Plus className="w-5 h-5" />Add Learner</button>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Learner</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Employee ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Department</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Job Title</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {isLoading ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center"><Loader2 className="w-8 h-8 text-gray-400 animate-spin mx-auto" /></td></tr>
              ) : filteredLearners.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-gray-500">No learners found. <button onClick={openCreateModal} className="text-primary-600 hover:underline">Create one</button></td></tr>
              ) : filteredLearners.map((learner) => (
                <tr key={learner.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center"><GraduationCap className="w-5 h-5 text-green-600" /></div>
                      <div>
                        <p className="font-medium text-gray-900">{learner.full_name}</p>
                        <p className="text-sm text-gray-500">{learner.email || 'No email'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-gray-600 font-mono text-sm">{learner.employee_id || '-'}</td>
                  <td className="px-6 py-4"><div className="flex items-center gap-1 text-gray-600"><Building className="w-4 h-4" />{learner.department || '-'}</div></td>
                  <td className="px-6 py-4 text-gray-600">{learner.job_title || '-'}</td>
                  <td className="px-6 py-4"><span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[learner.status] || 'bg-gray-100 text-gray-800'}`}>{learner.status}</span></td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => openEditModal(learner)} className="p-2 text-gray-400 hover:text-primary-600 hover:bg-gray-100 rounded-lg"><Edit className="w-4 h-4" /></button>
                      <button onClick={() => deleteLearner(learner)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <AnimatePresence>
          {isModalOpen && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setIsModalOpen(false)}>
              <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-6 border-b"><h2 className="text-xl font-semibold">{selectedLearner ? 'Edit Learner' : 'Create Learner'}</h2><button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-6 h-6" /></button></div>
                <div className="p-6 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Full Name (English) *</label><input type="text" value={formData.full_name} onChange={e => setFormData({...formData, full_name: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Full Name (Arabic)</label><input type="text" value={formData.full_name_ar} onChange={e => setFormData({...formData, full_name_ar: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" dir="rtl" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Employee ID</label><input type="text" value={formData.employee_id} onChange={e => setFormData({...formData, employee_id: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" placeholder="e.g., EMP001" /></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Hire Date</label><input type="date" value={formData.hire_date} onChange={e => setFormData({...formData, hire_date: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Email</label><input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Phone</label><input type="tel" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Department</label><input type="text" value={formData.department} onChange={e => setFormData({...formData, department: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" placeholder="e.g., IT, HR, Sales" /></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Job Title</label><input type="text" value={formData.job_title} onChange={e => setFormData({...formData, job_title: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                  </div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Status</label><select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg"><option value="active">Active</option><option value="inactive">Inactive</option><option value="on_leave">On Leave</option><option value="terminated">Terminated</option></select></div>
                </div>
                <div className="flex justify-end gap-3 p-6 border-t">
                  <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
                  <button onClick={handleSave} disabled={isSaving || !formData.full_name} className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">{isSaving && <Loader2 className="w-4 h-4 animate-spin" />}{selectedLearner ? 'Update' : 'Create'}</button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
