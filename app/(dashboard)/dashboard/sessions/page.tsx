'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Edit, Trash2, Calendar, Clock, MapPin, Users, X, Loader2, AlertCircle, CheckCircle, Search, Download } from 'lucide-react';
import Header from '@/components/layout/Header';
import { createClient, generateId } from '@/lib/supabase';

interface Session {
  id: string;
  course_id: string;
  venue_id: string;
  instructor_id: string;
  title: string;
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  capacity: number;
  status: string;
  course?: { name: string };
  venue?: { name: string };
  instructor?: { full_name: string };
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [venues, setVenues] = useState<any[]>([]);
  const [instructors, setInstructors] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const supabase = createClient();

  const [formData, setFormData] = useState({
    course_id: '', venue_id: '', instructor_id: '', title: '', start_date: '', end_date: '', start_time: '09:00', end_time: '17:00', capacity: 20, status: 'scheduled'
  });

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setIsLoading(true);
    const [sessionsRes, coursesRes, venuesRes, instructorsRes] = await Promise.all([
      supabase.from('sessions').select('*').order('start_date', { ascending: false }),
      supabase.from('courses').select('id, name'),
      supabase.from('venues').select('id, name'),
      supabase.from('instructors').select('id, full_name'),
    ]);
    
    const sessionsWithRefs = (sessionsRes.data || []).map(s => ({
      ...s,
      course: coursesRes.data?.find(c => c.id === s.course_id),
      venue: venuesRes.data?.find(v => v.id === s.venue_id),
      instructor: instructorsRes.data?.find(i => i.id === s.instructor_id),
    }));
    
    setSessions(sessionsWithRefs);
    setCourses(coursesRes.data || []);
    setVenues(venuesRes.data || []);
    setInstructors(instructorsRes.data || []);
    setIsLoading(false);
  };

  const filteredSessions = sessions.filter(s => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (!s.title?.toLowerCase().includes(query) && !s.course?.name?.toLowerCase().includes(query)) return false;
    }
    if (statusFilter !== 'all' && s.status !== statusFilter) return false;
    return true;
  });

  const openCreateModal = () => {
    setSelectedSession(null);
    setFormData({ course_id: courses[0]?.id || '', venue_id: venues[0]?.id || '', instructor_id: instructors[0]?.id || '', title: '', start_date: '', end_date: '', start_time: '09:00', end_time: '17:00', capacity: 20, status: 'scheduled' });
    setIsModalOpen(true);
  };

  const openEditModal = (session: Session) => {
    setSelectedSession(session);
    setFormData({
      course_id: session.course_id || '', venue_id: session.venue_id || '', instructor_id: session.instructor_id || '',
      title: session.title || '', start_date: session.start_date || '', end_date: session.end_date || '',
      start_time: session.start_time || '09:00', end_time: session.end_time || '17:00',
      capacity: session.capacity || 20, status: session.status || 'scheduled'
    });
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!formData.title || !formData.course_id) { setError('Title and course are required'); return; }
    setIsSaving(true); setError('');
    const sessionData = { ...formData, updated_at: new Date().toISOString() };

    if (selectedSession) {
      const { error } = await supabase.from('sessions').update(sessionData).eq('id', selectedSession.id);
      if (error) setError('Failed to update: ' + error.message);
      else { setSuccess('Session updated!'); setIsModalOpen(false); fetchData(); }
    } else {
      const { error } = await supabase.from('sessions').insert({ id: generateId('ses'), ...sessionData, organization_id: 'org_001', created_at: new Date().toISOString() });
      if (error) setError('Failed to create: ' + error.message);
      else { setSuccess('Session created!'); setIsModalOpen(false); fetchData(); }
    }
    setTimeout(() => setSuccess(''), 3000);
    setIsSaving(false);
  };

  const deleteSession = async (session: Session) => {
    if (!confirm(`Delete "${session.title}"?`)) return;
    const { error } = await supabase.from('sessions').delete().eq('id', session.id);
    if (error) setError('Failed to delete: ' + error.message);
    else { setSuccess('Session deleted!'); fetchData(); }
    setTimeout(() => setSuccess(''), 3000);
  };

  const statusColors: Record<string, string> = { scheduled: 'bg-blue-100 text-blue-800', ongoing: 'bg-green-100 text-green-800', completed: 'bg-gray-100 text-gray-800', cancelled: 'bg-red-100 text-red-800', open: 'bg-yellow-100 text-yellow-800', confirmed: 'bg-purple-100 text-purple-800' };

  const headerActions = (
    <div className="flex items-center gap-2">
      <button className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
        <Download className="w-4 h-4" />
        <span className="hidden sm:inline">Export</span>
      </button>
      <button onClick={openCreateModal} className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">
        <Plus className="w-5 h-5" />
        <span>Add Session</span>
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="Sessions" subtitle={`${sessions.length} total sessions`} actions={headerActions} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700"><AlertCircle className="w-5 h-5" />{error}<button onClick={() => setError('')} className="ml-auto">×</button></div>}
        {success && <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700"><CheckCircle className="w-5 h-5" />{success}</div>}

        {/* Filters */}
        <div className="flex items-center gap-4 mb-6">
          <div className="relative flex-1 max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" /><input type="text" placeholder="Search sessions..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"><option value="all">All Status</option><option value="scheduled">Scheduled</option><option value="ongoing">Ongoing</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl p-4 border border-gray-200"><p className="text-2xl font-bold text-gray-900">{sessions.length}</p><p className="text-sm text-gray-500">Total Sessions</p></div>
          <div className="bg-white rounded-xl p-4 border border-gray-200"><p className="text-2xl font-bold text-blue-600">{sessions.filter(s => s.status === 'scheduled').length}</p><p className="text-sm text-gray-500">Scheduled</p></div>
          <div className="bg-white rounded-xl p-4 border border-gray-200"><p className="text-2xl font-bold text-green-600">{sessions.filter(s => s.status === 'ongoing' || s.status === 'open').length}</p><p className="text-sm text-gray-500">Active</p></div>
          <div className="bg-white rounded-xl p-4 border border-gray-200"><p className="text-2xl font-bold text-gray-600">{sessions.filter(s => s.status === 'completed').length}</p><p className="text-sm text-gray-500">Completed</p></div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Session</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Course</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Venue</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {isLoading ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center"><Loader2 className="w-8 h-8 text-gray-400 animate-spin mx-auto" /></td></tr>
              ) : filteredSessions.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-gray-500">No sessions found. <button onClick={openCreateModal} className="text-primary-600 hover:underline">Create one</button></td></tr>
              ) : filteredSessions.map((session) => (
                <tr key={session.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center"><Calendar className="w-5 h-5 text-blue-600" /></div>
                      <div><p className="font-medium text-gray-900">{session.title}</p><p className="text-sm text-gray-500">{session.instructor?.full_name || 'No instructor'}</p></div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-gray-600">{session.course?.name || '-'}</td>
                  <td className="px-6 py-4"><div className="flex items-center gap-1 text-gray-600"><Clock className="w-4 h-4" />{session.start_date || '-'}</div></td>
                  <td className="px-6 py-4"><div className="flex items-center gap-1 text-gray-600"><MapPin className="w-4 h-4" />{session.venue?.name || '-'}</div></td>
                  <td className="px-6 py-4"><span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[session.status] || 'bg-gray-100 text-gray-800'}`}>{session.status}</span></td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => openEditModal(session)} className="p-2 text-gray-400 hover:text-primary-600 hover:bg-gray-100 rounded-lg"><Edit className="w-4 h-4" /></button>
                      <button onClick={() => deleteSession(session)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Modal */}
        <AnimatePresence>
          {isModalOpen && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setIsModalOpen(false)}>
              <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-6 border-b"><h2 className="text-xl font-semibold">{selectedSession ? 'Edit Session' : 'Add New Session'}</h2><button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-6 h-6" /></button></div>
                <div className="p-6 space-y-4">
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Session Title *</label><input type="text" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Course *</label><select value={formData.course_id} onChange={e => setFormData({...formData, course_id: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"><option value="">Select Course</option>{courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Venue</label><select value={formData.venue_id} onChange={e => setFormData({...formData, venue_id: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"><option value="">Select Venue</option>{venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
                  </div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Instructor</label><select value={formData.instructor_id} onChange={e => setFormData({...formData, instructor_id: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"><option value="">Select Instructor</option>{instructors.map(i => <option key={i.id} value={i.id}>{i.full_name}</option>)}</select></div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label><input type="date" value={formData.start_date} onChange={e => setFormData({...formData, start_date: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">End Date</label><input type="date" value={formData.end_date} onChange={e => setFormData({...formData, end_date: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label><input type="time" value={formData.start_time} onChange={e => setFormData({...formData, start_time: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">End Time</label><input type="time" value={formData.end_time} onChange={e => setFormData({...formData, end_time: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Capacity</label><input type="number" value={formData.capacity} onChange={e => setFormData({...formData, capacity: parseInt(e.target.value)})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
                  </div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Status</label><select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"><option value="scheduled">Scheduled</option><option value="ongoing">Ongoing</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></div>
                </div>
                <div className="flex justify-end gap-3 p-6 border-t bg-gray-50">
                  <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-100">Cancel</button>
                  <button onClick={handleSave} disabled={isSaving} className="flex items-center gap-2 px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">{isSaving && <Loader2 className="w-4 h-4 animate-spin" />}{selectedSession ? 'Save Changes' : 'Create Session'}</button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
