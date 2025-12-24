'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Award, Download, Eye, Search, Loader2, AlertCircle, CheckCircle, Calendar, User, BookOpen, Plus, X } from 'lucide-react';
import Header from '@/components/layout/Header';
import { createClient, generateId } from '@/lib/supabase';

interface Certificate {
  id: string;
  learner_id: string;
  course_id: string;
  session_id: string;
  certificate_number: string;
  issue_date: string;
  expiry_date: string;
  status: string;
  learner?: { full_name: string };
  course?: { name: string };
}

export default function CertificatesPage() {
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [learners, setLearners] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const supabase = createClient();

  const [formData, setFormData] = useState({
    learner_id: '', course_id: '', session_id: '', issue_date: new Date().toISOString().split('T')[0], expiry_date: '', status: 'issued'
  });

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setIsLoading(true);
    const [certsRes, learnersRes, coursesRes, sessionsRes] = await Promise.all([
      supabase.from('certificates').select('*').order('issue_date', { ascending: false }),
      supabase.from('learners').select('id, full_name'),
      supabase.from('courses').select('id, name'),
      supabase.from('sessions').select('id, title'),
    ]);

    const certsWithRefs = (certsRes.data || []).map(c => ({
      ...c,
      learner: learnersRes.data?.find(l => l.id === c.learner_id),
      course: coursesRes.data?.find(cr => cr.id === c.course_id),
    }));

    setCertificates(certsWithRefs);
    setLearners(learnersRes.data || []);
    setCourses(coursesRes.data || []);
    setSessions(sessionsRes.data || []);
    setIsLoading(false);
  };

  const filteredCertificates = certificates.filter(c => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return c.learner?.full_name?.toLowerCase().includes(query) || c.course?.name?.toLowerCase().includes(query) || c.certificate_number?.toLowerCase().includes(query);
  });

  const openCreateModal = () => {
    setFormData({
      learner_id: learners[0]?.id || '', course_id: courses[0]?.id || '', session_id: '',
      issue_date: new Date().toISOString().split('T')[0], expiry_date: '', status: 'issued'
    });
    setIsModalOpen(true);
  };

  const generateCertificateNumber = () => {
    const year = new Date().getFullYear();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `CERT-${year}-${random}`;
  };

  const handleSave = async () => {
    if (!formData.learner_id || !formData.course_id) { setError('Learner and course are required'); return; }
    setIsSaving(true); setError('');

    const certData = {
      ...formData,
      certificate_number: generateCertificateNumber(),
      organization_id: 'org_001',
      created_at: new Date().toISOString()
    };

    const { error } = await supabase.from('certificates').insert({ id: generateId('cert'), ...certData });
    if (error) setError('Failed to create: ' + error.message);
    else { setSuccess('Certificate issued!'); setIsModalOpen(false); fetchData(); }
    
    setTimeout(() => setSuccess(''), 3000);
    setIsSaving(false);
  };

  const statusColors: Record<string, string> = {
    issued: 'bg-green-100 text-green-800',
    expired: 'bg-red-100 text-red-800',
    revoked: 'bg-gray-100 text-gray-800',
    pending: 'bg-yellow-100 text-yellow-800'
  };

  const stats = {
    total: certificates.length,
    issued: certificates.filter(c => c.status === 'issued').length,
    expired: certificates.filter(c => c.status === 'expired').length,
    thisMonth: certificates.filter(c => {
      const issueDate = new Date(c.issue_date);
      const now = new Date();
      return issueDate.getMonth() === now.getMonth() && issueDate.getFullYear() === now.getFullYear();
    }).length,
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="Certificates" subtitle="Manage training certificates" />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700"><AlertCircle className="w-5 h-5" />{error}<button onClick={() => setError('')} className="ml-auto">×</button></div>}
        {success && <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700"><CheckCircle className="w-5 h-5" />{success}</div>}

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center"><Award className="w-5 h-5 text-purple-600" /></div>
              <div><p className="text-2xl font-bold text-gray-900">{stats.total}</p><p className="text-sm text-gray-500">Total Certificates</p></div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center"><CheckCircle className="w-5 h-5 text-green-600" /></div>
              <div><p className="text-2xl font-bold text-green-600">{stats.issued}</p><p className="text-sm text-gray-500">Active</p></div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center"><AlertCircle className="w-5 h-5 text-red-600" /></div>
              <div><p className="text-2xl font-bold text-red-600">{stats.expired}</p><p className="text-sm text-gray-500">Expired</p></div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center"><Calendar className="w-5 h-5 text-blue-600" /></div>
              <div><p className="text-2xl font-bold text-blue-600">{stats.thisMonth}</p><p className="text-sm text-gray-500">This Month</p></div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center justify-between mb-6">
          <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" /><input type="text" placeholder="Search certificates..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg w-64" /></div>
          <button onClick={openCreateModal} className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"><Plus className="w-5 h-5" />Issue Certificate</button>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Certificate</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Learner</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Course</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Issue Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Expiry</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {isLoading ? (
                <tr><td colSpan={7} className="px-6 py-12 text-center"><Loader2 className="w-8 h-8 text-gray-400 animate-spin mx-auto" /></td></tr>
              ) : filteredCertificates.length === 0 ? (
                <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-500">No certificates found. <button onClick={openCreateModal} className="text-primary-600 hover:underline">Issue one</button></td></tr>
              ) : filteredCertificates.map((cert) => (
                <tr key={cert.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center"><Award className="w-5 h-5 text-purple-600" /></div>
                      <div><p className="font-medium text-gray-900 font-mono text-sm">{cert.certificate_number}</p></div>
                    </div>
                  </td>
                  <td className="px-6 py-4"><div className="flex items-center gap-1 text-gray-600"><User className="w-4 h-4" />{cert.learner?.full_name || 'Unknown'}</div></td>
                  <td className="px-6 py-4"><div className="flex items-center gap-1 text-gray-600"><BookOpen className="w-4 h-4" />{cert.course?.name || 'Unknown'}</div></td>
                  <td className="px-6 py-4 text-gray-600">{cert.issue_date || '-'}</td>
                  <td className="px-6 py-4 text-gray-600">{cert.expiry_date || 'No expiry'}</td>
                  <td className="px-6 py-4"><span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[cert.status] || 'bg-gray-100 text-gray-800'}`}>{cert.status}</span></td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <button className="p-2 text-gray-400 hover:text-primary-600 hover:bg-gray-100 rounded-lg" title="View"><Eye className="w-4 h-4" /></button>
                      <button className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg" title="Download"><Download className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Issue Modal */}
        <AnimatePresence>
          {isModalOpen && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setIsModalOpen(false)}>
              <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="bg-white rounded-xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-6 border-b"><h2 className="text-xl font-semibold">Issue Certificate</h2><button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-6 h-6" /></button></div>
                <div className="p-6 space-y-4">
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Learner *</label><select value={formData.learner_id} onChange={e => setFormData({...formData, learner_id: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg"><option value="">Select Learner</option>{learners.map(l => <option key={l.id} value={l.id}>{l.full_name}</option>)}</select></div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Course *</label><select value={formData.course_id} onChange={e => setFormData({...formData, course_id: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg"><option value="">Select Course</option>{courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Session (Optional)</label><select value={formData.session_id} onChange={e => setFormData({...formData, session_id: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg"><option value="">Select Session</option>{sessions.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Issue Date</label><input type="date" value={formData.issue_date} onChange={e => setFormData({...formData, issue_date: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Expiry Date</label><input type="date" value={formData.expiry_date} onChange={e => setFormData({...formData, expiry_date: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                  </div>
                </div>
                <div className="flex justify-end gap-3 p-6 border-t">
                  <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
                  <button onClick={handleSave} disabled={isSaving} className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">{isSaving && <Loader2 className="w-4 h-4 animate-spin" />}Issue Certificate</button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
