'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { UserCheck, UserX, Clock, Calendar, Search, Loader2, AlertCircle, CheckCircle, Filter } from 'lucide-react';
import Header from '@/components/layout/Header';
import { createClient, generateId } from '@/lib/supabase';

interface AttendanceRecord {
  id: string;
  session_id: string;
  learner_id: string;
  status: string;
  check_in_time: string;
  check_out_time: string;
  notes: string;
  session?: { title: string; start_date: string };
  learner?: { full_name: string; employee_id: string };
}

export default function AttendancePage() {
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [learners, setLearners] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sessionFilter, setSessionFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const supabase = createClient();

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setIsLoading(true);
    const [attendanceRes, sessionsRes, learnersRes] = await Promise.all([
      supabase.from('attendance').select('*').order('created_at', { ascending: false }),
      supabase.from('sessions').select('id, title, start_date'),
      supabase.from('learners').select('id, full_name, employee_id'),
    ]);

    const attendanceWithRefs = (attendanceRes.data || []).map(a => ({
      ...a,
      session: sessionsRes.data?.find(s => s.id === a.session_id),
      learner: learnersRes.data?.find(l => l.id === a.learner_id),
    }));

    setAttendance(attendanceWithRefs);
    setSessions(sessionsRes.data || []);
    setLearners(learnersRes.data || []);
    setIsLoading(false);
  };

  const filteredAttendance = attendance.filter(a => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (!a.learner?.full_name?.toLowerCase().includes(query) && !a.session?.title?.toLowerCase().includes(query)) return false;
    }
    if (sessionFilter !== 'all' && a.session_id !== sessionFilter) return false;
    if (statusFilter !== 'all' && a.status !== statusFilter) return false;
    return true;
  });

  const markAttendance = async (learnerId: string, sessionId: string, status: string) => {
    const existing = attendance.find(a => a.learner_id === learnerId && a.session_id === sessionId);
    
    if (existing) {
      const { error } = await supabase.from('attendance').update({ status, updated_at: new Date().toISOString() }).eq('id', existing.id);
      if (error) setError('Failed to update: ' + error.message);
      else { setSuccess('Attendance updated!'); fetchData(); }
    } else {
      const { error } = await supabase.from('attendance').insert({
        id: generateId('att'), session_id: sessionId, learner_id: learnerId, status,
        check_in_time: status === 'present' ? new Date().toISOString() : null,
        organization_id: 'org_001', created_at: new Date().toISOString()
      });
      if (error) setError('Failed to mark: ' + error.message);
      else { setSuccess('Attendance marked!'); fetchData(); }
    }
    setTimeout(() => setSuccess(''), 3000);
  };

  const statusColors: Record<string, string> = {
    present: 'bg-green-100 text-green-800',
    absent: 'bg-red-100 text-red-800',
    late: 'bg-yellow-100 text-yellow-800',
    excused: 'bg-blue-100 text-blue-800'
  };

  const stats = {
    total: attendance.length,
    present: attendance.filter(a => a.status === 'present').length,
    absent: attendance.filter(a => a.status === 'absent').length,
    late: attendance.filter(a => a.status === 'late').length,
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="Attendance" subtitle="Track session attendance" />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700"><AlertCircle className="w-5 h-5" />{error}<button onClick={() => setError('')} className="ml-auto">×</button></div>}
        {success && <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700"><CheckCircle className="w-5 h-5" />{success}</div>}

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center"><Calendar className="w-5 h-5 text-gray-600" /></div>
              <div><p className="text-2xl font-bold text-gray-900">{stats.total}</p><p className="text-sm text-gray-500">Total Records</p></div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center"><UserCheck className="w-5 h-5 text-green-600" /></div>
              <div><p className="text-2xl font-bold text-green-600">{stats.present}</p><p className="text-sm text-gray-500">Present</p></div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center"><UserX className="w-5 h-5 text-red-600" /></div>
              <div><p className="text-2xl font-bold text-red-600">{stats.absent}</p><p className="text-sm text-gray-500">Absent</p></div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center"><Clock className="w-5 h-5 text-yellow-600" /></div>
              <div><p className="text-2xl font-bold text-yellow-600">{stats.late}</p><p className="text-sm text-gray-500">Late</p></div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4 mb-6">
          <div className="relative flex-1 max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" /><input type="text" placeholder="Search by learner or session..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg" /></div>
          <select value={sessionFilter} onChange={(e) => setSessionFilter(e.target.value)} className="px-4 py-2 border border-gray-300 rounded-lg">
            <option value="all">All Sessions</option>
            {sessions.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-4 py-2 border border-gray-300 rounded-lg">
            <option value="all">All Status</option>
            <option value="present">Present</option>
            <option value="absent">Absent</option>
            <option value="late">Late</option>
            <option value="excused">Excused</option>
          </select>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Learner</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Session</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Check In</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {isLoading ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center"><Loader2 className="w-8 h-8 text-gray-400 animate-spin mx-auto" /></td></tr>
              ) : filteredAttendance.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-gray-500">No attendance records found.</td></tr>
              ) : filteredAttendance.map((record) => (
                <tr key={record.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div><p className="font-medium text-gray-900">{record.learner?.full_name || 'Unknown'}</p><p className="text-sm text-gray-500">{record.learner?.employee_id || ''}</p></div>
                  </td>
                  <td className="px-6 py-4 text-gray-600">{record.session?.title || 'Unknown Session'}</td>
                  <td className="px-6 py-4 text-gray-600">{record.session?.start_date || '-'}</td>
                  <td className="px-6 py-4 text-gray-600">{record.check_in_time ? new Date(record.check_in_time).toLocaleTimeString() : '-'}</td>
                  <td className="px-6 py-4"><span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[record.status] || 'bg-gray-100 text-gray-800'}`}>{record.status}</span></td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => markAttendance(record.learner_id, record.session_id, 'present')} className={`p-1.5 rounded ${record.status === 'present' ? 'bg-green-100 text-green-600' : 'text-gray-400 hover:bg-green-50 hover:text-green-600'}`} title="Present"><UserCheck className="w-4 h-4" /></button>
                      <button onClick={() => markAttendance(record.learner_id, record.session_id, 'absent')} className={`p-1.5 rounded ${record.status === 'absent' ? 'bg-red-100 text-red-600' : 'text-gray-400 hover:bg-red-50 hover:text-red-600'}`} title="Absent"><UserX className="w-4 h-4" /></button>
                      <button onClick={() => markAttendance(record.learner_id, record.session_id, 'late')} className={`p-1.5 rounded ${record.status === 'late' ? 'bg-yellow-100 text-yellow-600' : 'text-gray-400 hover:bg-yellow-50 hover:text-yellow-600'}`} title="Late"><Clock className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
