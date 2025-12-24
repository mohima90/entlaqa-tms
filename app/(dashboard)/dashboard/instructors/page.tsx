'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Edit, Trash2, User, Mail, Phone, X, Loader2, AlertCircle, CheckCircle, Search, Award } from 'lucide-react';
import Header from '@/components/layout/Header';
import { createClient, generateId } from '@/lib/supabase';

interface Instructor {
  id: string;
  full_name: string;
  full_name_ar: string;
  email: string;
  phone: string;
  specialization: string;
  bio: string;
  status: string;
  hourly_rate: number;
  rating: number;
}

export default function InstructorsPage() {
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedInstructor, setSelectedInstructor] = useState<Instructor | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const supabase = createClient();

  const [formData, setFormData] = useState({
    full_name: '', full_name_ar: '', email: '', phone: '', specialization: '', bio: '', status: 'active', hourly_rate: 0
  });

  useEffect(() => { fetchInstructors(); }, []);

  const fetchInstructors = async () => {
    setIsLoading(true);
    const { data, error } = await supabase.from('instructors').select('*').order('full_name');
    if (error) { setError('Failed to fetch instructors'); console.error(error); }
    else { setInstructors(data || []); }
    setIsLoading(false);
  };

  const filteredInstructors = instructors.filter(i => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return i.full_name.toLowerCase().includes(query) || i.email?.toLowerCase().includes(query) || i.specialization?.toLowerCase().includes(query);
  });

  const openCreateModal = () => {
    setSelectedInstructor(null);
    setFormData({ full_name: '', full_name_ar: '', email: '', phone: '', specialization: '', bio: '', status: 'active', hourly_rate: 0 });
    setIsModalOpen(true);
  };

  const openEditModal = (instructor: Instructor) => {
    setSelectedInstructor(instructor);
    setFormData({
      full_name: instructor.full_name, full_name_ar: instructor.full_name_ar || '',
      email: instructor.email || '', phone: instructor.phone || '',
      specialization: instructor.specialization || '', bio: instructor.bio || '',
      status: instructor.status || 'active', hourly_rate: instructor.hourly_rate || 0
    });
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!formData.full_name) { setError('Name is required'); return; }
    setIsSaving(true); setError('');

    const instructorData = { ...formData, updated_at: new Date().toISOString() };

    if (selectedInstructor) {
      const { error } = await supabase.from('instructors').update(instructorData).eq('id', selectedInstructor.id);
      if (error) setError('Failed to update: ' + error.message);
      else { setSuccess('Instructor updated!'); setIsModalOpen(false); fetchInstructors(); }
    } else {
      const { error } = await supabase.from('instructors').insert({ id: generateId('ins'), ...instructorData, organization_id: 'org_001', created_at: new Date().toISOString() });
      if (error) setError('Failed to create: ' + error.message);
      else { setSuccess('Instructor created!'); setIsModalOpen(false); fetchInstructors(); }
    }
    setTimeout(() => setSuccess(''), 3000);
    setIsSaving(false);
  };

  const deleteInstructor = async (instructor: Instructor) => {
    if (!confirm(`Delete "${instructor.full_name}"?`)) return;
    const { error } = await supabase.from('instructors').delete().eq('id', instructor.id);
    if (error) setError('Failed to delete: ' + error.message);
    else { setSuccess('Instructor deleted!'); fetchInstructors(); }
    setTimeout(() => setSuccess(''), 3000);
  };

  const statusColors: Record<string, string> = { active: 'bg-green-100 text-green-800', inactive: 'bg-gray-100 text-gray-800', on_leave: 'bg-yellow-100 text-yellow-800' };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="Instructors" subtitle="Manage training instructors" />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700"><AlertCircle className="w-5 h-5" />{error}<button onClick={() => setError('')} className="ml-auto">×</button></div>}
        {success && <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700"><CheckCircle className="w-5 h-5" />{success}</div>}

        <div className="flex items-center justify-between mb-6">
          <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" /><input type="text" placeholder="Search instructors..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg w-64" /></div>
          <button onClick={openCreateModal} className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"><Plus className="w-5 h-5" />Add Instructor</button>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Instructor</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Contact</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Specialization</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rate</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {isLoading ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center"><Loader2 className="w-8 h-8 text-gray-400 animate-spin mx-auto" /></td></tr>
              ) : filteredInstructors.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-gray-500">No instructors found. <button onClick={openCreateModal} className="text-primary-600 hover:underline">Create one</button></td></tr>
              ) : filteredInstructors.map((instructor) => (
                <tr key={instructor.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center"><User className="w-5 h-5 text-orange-600" /></div>
                      <div><p className="font-medium text-gray-900">{instructor.full_name}</p>{instructor.full_name_ar && <p className="text-sm text-gray-500">{instructor.full_name_ar}</p>}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="space-y-1">
                      {instructor.email && <div className="flex items-center gap-1 text-sm text-gray-600"><Mail className="w-3 h-3" />{instructor.email}</div>}
                      {instructor.phone && <div className="flex items-center gap-1 text-sm text-gray-600"><Phone className="w-3 h-3" />{instructor.phone}</div>}
                    </div>
                  </td>
                  <td className="px-6 py-4"><div className="flex items-center gap-1 text-gray-600"><Award className="w-4 h-4" />{instructor.specialization || '-'}</div></td>
                  <td className="px-6 py-4 text-gray-600">{instructor.hourly_rate ? `$${instructor.hourly_rate}/hr` : '-'}</td>
                  <td className="px-6 py-4"><span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[instructor.status] || 'bg-gray-100 text-gray-800'}`}>{instructor.status}</span></td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => openEditModal(instructor)} className="p-2 text-gray-400 hover:text-primary-600 hover:bg-gray-100 rounded-lg"><Edit className="w-4 h-4" /></button>
                      <button onClick={() => deleteInstructor(instructor)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
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
                <div className="flex items-center justify-between p-6 border-b"><h2 className="text-xl font-semibold">{selectedInstructor ? 'Edit Instructor' : 'Create Instructor'}</h2><button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-6 h-6" /></button></div>
                <div className="p-6 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Full Name (English) *</label><input type="text" value={formData.full_name} onChange={e => setFormData({...formData, full_name: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Full Name (Arabic)</label><input type="text" value={formData.full_name_ar} onChange={e => setFormData({...formData, full_name_ar: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" dir="rtl" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Email</label><input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Phone</label><input type="tel" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Specialization</label><input type="text" value={formData.specialization} onChange={e => setFormData({...formData, specialization: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" placeholder="e.g., Leadership, Technology" /></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Hourly Rate ($)</label><input type="number" value={formData.hourly_rate} onChange={e => setFormData({...formData, hourly_rate: parseInt(e.target.value)})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                  </div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Status</label><select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg"><option value="active">Active</option><option value="inactive">Inactive</option><option value="on_leave">On Leave</option></select></div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Bio</label><textarea value={formData.bio} onChange={e => setFormData({...formData, bio: e.target.value})} rows={3} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                </div>
                <div className="flex justify-end gap-3 p-6 border-t">
                  <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
                  <button onClick={handleSave} disabled={isSaving || !formData.full_name} className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">{isSaving && <Loader2 className="w-4 h-4 animate-spin" />}{selectedInstructor ? 'Update' : 'Create'}</button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
