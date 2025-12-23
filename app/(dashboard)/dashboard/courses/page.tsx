'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Edit, Trash2, BookOpen, Clock, Users, X, Loader2, AlertCircle, CheckCircle, Search } from 'lucide-react';
import Header from '@/components/layout/Header';
import { createClient, generateId } from '@/lib/supabase';

interface Course {
  id: string;
  code: string;
  name: string;
  name_ar: string;
  category: string;
  level: string;
  delivery_mode: string;
  duration_hours: number;
  max_participants: number;
  status: string;
  description: string;
  organization_id: string;
  created_at: string;
}

export default function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [filteredCourses, setFilteredCourses] = useState<Course[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const supabase = createClient();

  const [formData, setFormData] = useState({
    code: '',
    name: '',
    name_ar: '',
    category: '',
    level: 'beginner',
    delivery_mode: 'ilt',
    duration_hours: 8,
    max_participants: 20,
    status: 'active',
    description: '',
  });

  useEffect(() => { fetchCourses(); }, []);
  useEffect(() => { filterCourses(); }, [searchQuery, statusFilter, courses]);

  const fetchCourses = async () => {
    setIsLoading(true);
    const { data, error } = await supabase.from('courses').select('*').order('created_at', { ascending: false });
    if (error) { setError('Failed to fetch courses'); console.error(error); }
    else { setCourses(data || []); }
    setIsLoading(false);
  };

  const filterCourses = () => {
    let filtered = [...courses];
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(c => c.name.toLowerCase().includes(query) || c.code.toLowerCase().includes(query) || c.name_ar?.includes(query));
    }
    if (statusFilter !== 'all') { filtered = filtered.filter(c => c.status === statusFilter); }
    setFilteredCourses(filtered);
  };

  const openCreateModal = () => {
    setSelectedCourse(null);
    setFormData({ code: '', name: '', name_ar: '', category: '', level: 'beginner', delivery_mode: 'ilt', duration_hours: 8, max_participants: 20, status: 'active', description: '' });
    setIsModalOpen(true);
  };

  const openEditModal = (course: Course) => {
    setSelectedCourse(course);
    setFormData({
      code: course.code || '',
      name: course.name,
      name_ar: course.name_ar || '',
      category: course.category || '',
      level: course.level || 'beginner',
      delivery_mode: course.delivery_mode || 'ilt',
      duration_hours: course.duration_hours || 8,
      max_participants: course.max_participants || 20,
      status: course.status || 'active',
      description: course.description || '',
    });
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name || !formData.code) { setError('Name and code are required'); return; }
    setIsSaving(true); setError('');

    const courseData = { ...formData, updated_at: new Date().toISOString() };

    if (selectedCourse) {
      const { error } = await supabase.from('courses').update(courseData).eq('id', selectedCourse.id);
      if (error) { setError('Failed to update course: ' + error.message); }
      else { setSuccess('Course updated!'); setIsModalOpen(false); fetchCourses(); }
    } else {
      const { error } = await supabase.from('courses').insert({ id: generateId('crs'), ...courseData, organization_id: 'org_001', data_source: 'offline', created_at: new Date().toISOString() });
      if (error) { setError('Failed to create course: ' + error.message); }
      else { setSuccess('Course created!'); setIsModalOpen(false); fetchCourses(); }
    }
    setTimeout(() => setSuccess(''), 3000);
    setIsSaving(false);
  };

  const deleteCourse = async (course: Course) => {
    if (!confirm(`Delete "${course.name}"?`)) return;
    const { error } = await supabase.from('courses').delete().eq('id', course.id);
    if (error) { setError('Failed to delete: ' + error.message); }
    else { setSuccess('Course deleted!'); fetchCourses(); }
    setTimeout(() => setSuccess(''), 3000);
  };

  const levelColors: Record<string, string> = { beginner: 'bg-green-100 text-green-800', intermediate: 'bg-blue-100 text-blue-800', advanced: 'bg-purple-100 text-purple-800', expert: 'bg-red-100 text-red-800' };
  const statusColors: Record<string, string> = { active: 'bg-green-100 text-green-800', draft: 'bg-gray-100 text-gray-800', archived: 'bg-red-100 text-red-800' };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="Courses" subtitle="Manage training courses" />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700"><AlertCircle className="w-5 h-5" />{error}<button onClick={() => setError('')} className="ml-auto">×</button></div>}
        {success && <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700"><CheckCircle className="w-5 h-5" />{success}</div>}

        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" /><input type="text" placeholder="Search courses..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg w-64" /></div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-4 py-2 border border-gray-300 rounded-lg"><option value="all">All Status</option><option value="active">Active</option><option value="draft">Draft</option><option value="archived">Archived</option></select>
          </div>
          <button onClick={openCreateModal} className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"><Plus className="w-5 h-5" />Add Course</button>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Course</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Level</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Duration</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {isLoading ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center"><Loader2 className="w-8 h-8 text-gray-400 animate-spin mx-auto" /></td></tr>
              ) : filteredCourses.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-gray-500">No courses found. <button onClick={openCreateModal} className="text-primary-600 hover:underline">Create one</button></td></tr>
              ) : filteredCourses.map((course) => (
                <tr key={course.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center"><BookOpen className="w-5 h-5 text-primary-600" /></div>
                      <div><p className="font-medium text-gray-900">{course.name}</p><p className="text-sm text-gray-500">{course.code}</p></div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-gray-600">{course.category || '-'}</td>
                  <td className="px-6 py-4"><span className={`px-2 py-1 rounded-full text-xs font-medium ${levelColors[course.level] || 'bg-gray-100 text-gray-800'}`}>{course.level}</span></td>
                  <td className="px-6 py-4"><div className="flex items-center gap-1 text-gray-600"><Clock className="w-4 h-4" />{course.duration_hours}h</div></td>
                  <td className="px-6 py-4"><span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[course.status] || 'bg-gray-100 text-gray-800'}`}>{course.status}</span></td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => openEditModal(course)} className="p-2 text-gray-400 hover:text-primary-600 hover:bg-gray-100 rounded-lg"><Edit className="w-4 h-4" /></button>
                      <button onClick={() => deleteCourse(course)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
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
                <div className="flex items-center justify-between p-6 border-b"><h2 className="text-xl font-semibold">{selectedCourse ? 'Edit Course' : 'Create Course'}</h2><button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-6 h-6" /></button></div>
                <div className="p-6 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Course Code *</label><input type="text" value={formData.code} onChange={e => setFormData({...formData, code: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" placeholder="e.g., LEAD-101" /></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Category</label><input type="text" value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" placeholder="e.g., Leadership" /></div>
                  </div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Course Name (English) *</label><input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Course Name (Arabic)</label><input type="text" value={formData.name_ar} onChange={e => setFormData({...formData, name_ar: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" dir="rtl" /></div>
                  <div className="grid grid-cols-3 gap-4">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Level</label><select value={formData.level} onChange={e => setFormData({...formData, level: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg"><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option><option value="expert">Expert</option></select></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Delivery Mode</label><select value={formData.delivery_mode} onChange={e => setFormData({...formData, delivery_mode: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg"><option value="ilt">ILT (In-Person)</option><option value="vilt">VILT (Virtual)</option><option value="blended">Blended</option></select></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Status</label><select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg"><option value="active">Active</option><option value="draft">Draft</option><option value="archived">Archived</option></select></div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Duration (Hours)</label><input type="number" value={formData.duration_hours} onChange={e => setFormData({...formData, duration_hours: parseInt(e.target.value)})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Max Participants</label><input type="number" value={formData.max_participants} onChange={e => setFormData({...formData, max_participants: parseInt(e.target.value)})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                  </div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Description</label><textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} rows={3} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                </div>
                <div className="flex justify-end gap-3 p-6 border-t">
                  <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
                  <button onClick={handleSave} disabled={isSaving || !formData.name || !formData.code} className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">{isSaving && <Loader2 className="w-4 h-4 animate-spin" />}{selectedCourse ? 'Update' : 'Create'}</button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
