'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, Plus, Edit, Trash2, Send, CheckCircle, X, Loader2, Calendar, Users, Globe } from 'lucide-react';

interface Announcement {
  id: string;
  title: string;
  content: string;
  type: 'info' | 'warning' | 'success' | 'error';
  target: 'all' | 'admins' | 'specific';
  status: 'draft' | 'published';
  created_at: string;
  published_at?: string;
}

export default function AnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([
    { id: '1', title: 'Scheduled Maintenance', content: 'The system will undergo maintenance on Sunday, 2 AM - 4 AM UTC. Please save your work.', type: 'warning', target: 'all', status: 'published', created_at: new Date(Date.now() - 86400000).toISOString(), published_at: new Date(Date.now() - 86400000).toISOString() },
    { id: '2', title: 'New Feature: Certificate Templates', content: 'We have launched customizable certificate templates! Check the Settings page to create your own designs.', type: 'success', target: 'admins', status: 'published', created_at: new Date(Date.now() - 172800000).toISOString(), published_at: new Date(Date.now() - 172800000).toISOString() },
    { id: '3', title: 'Welcome to the New Dashboard', content: 'Draft announcement for new dashboard features...', type: 'info', target: 'all', status: 'draft', created_at: new Date().toISOString() },
  ]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [formData, setFormData] = useState({ title: '', content: '', type: 'info' as Announcement['type'], target: 'all' as Announcement['target'], status: 'draft' as Announcement['status'] });

  const openCreateModal = () => { setSelectedAnnouncement(null); setFormData({ title: '', content: '', type: 'info', target: 'all', status: 'draft' }); setIsModalOpen(true); };

  const openEditModal = (announcement: Announcement) => { setSelectedAnnouncement(announcement); setFormData({ title: announcement.title, content: announcement.content, type: announcement.type, target: announcement.target, status: announcement.status }); setIsModalOpen(true); };

  const handleSave = async () => {
    if (!formData.title || !formData.content) return;
    setIsSaving(true);
    await new Promise(resolve => setTimeout(resolve, 500));
    if (selectedAnnouncement) {
      setAnnouncements(prev => prev.map(a => a.id === selectedAnnouncement.id ? { ...a, ...formData, published_at: formData.status === 'published' ? new Date().toISOString() : a.published_at } : a));
      setSuccess('Announcement updated!');
    } else {
      const newAnnouncement: Announcement = { id: Date.now().toString(), ...formData, created_at: new Date().toISOString(), published_at: formData.status === 'published' ? new Date().toISOString() : undefined };
      setAnnouncements(prev => [newAnnouncement, ...prev]);
      setSuccess('Announcement created!');
    }
    setIsModalOpen(false);
    setIsSaving(false);
    setTimeout(() => setSuccess(''), 3000);
  };

  const deleteAnnouncement = (id: string) => { if (!confirm('Delete this announcement?')) return; setAnnouncements(prev => prev.filter(a => a.id !== id)); setSuccess('Announcement deleted!'); setTimeout(() => setSuccess(''), 3000); };

  const publishAnnouncement = (id: string) => { setAnnouncements(prev => prev.map(a => a.id === id ? { ...a, status: 'published', published_at: new Date().toISOString() } : a)); setSuccess('Announcement published!'); setTimeout(() => setSuccess(''), 3000); };

  const typeColors: Record<string, string> = { info: 'bg-blue-500/20 text-blue-400 border-blue-500', warning: 'bg-yellow-500/20 text-yellow-400 border-yellow-500', success: 'bg-green-500/20 text-green-400 border-green-500', error: 'bg-red-500/20 text-red-400 border-red-500' };
  const statusColors: Record<string, string> = { draft: 'bg-slate-500/20 text-slate-400', published: 'bg-green-500/20 text-green-400' };

  return (
    <div className="space-y-6">
      {success && <div className="p-4 bg-green-500/20 border border-green-500 rounded-lg flex items-center gap-3"><CheckCircle className="w-5 h-5 text-green-400" /><p className="text-green-400">{success}</p></div>}

      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-white">System Announcements</h1><p className="text-slate-400">Broadcast messages to all organizations</p></div>
        <button onClick={openCreateModal} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"><Plus className="w-5 h-5" />New Announcement</button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700"><p className="text-2xl font-bold text-white">{announcements.length}</p><p className="text-sm text-slate-400">Total Announcements</p></div>
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700"><p className="text-2xl font-bold text-green-400">{announcements.filter(a => a.status === 'published').length}</p><p className="text-sm text-slate-400">Published</p></div>
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700"><p className="text-2xl font-bold text-slate-400">{announcements.filter(a => a.status === 'draft').length}</p><p className="text-sm text-slate-400">Drafts</p></div>
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700"><p className="text-2xl font-bold text-yellow-400">{announcements.filter(a => a.type === 'warning').length}</p><p className="text-sm text-slate-400">Warnings</p></div>
      </div>

      <div className="space-y-4">
        {announcements.map((announcement) => (
          <motion.div key={announcement.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className={`bg-slate-800 rounded-xl border-l-4 p-6 ${typeColors[announcement.type].split(' ')[2]}`}>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${typeColors[announcement.type].split(' ').slice(0, 2).join(' ')}`}>{announcement.type.toUpperCase()}</span>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${statusColors[announcement.status]}`}>{announcement.status}</span>
                  <span className="flex items-center gap-1 text-xs text-slate-500">{announcement.target === 'all' ? <><Globe className="w-3 h-3" /> All Users</> : <><Users className="w-3 h-3" /> Admins Only</>}</span>
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">{announcement.title}</h3>
                <p className="text-slate-400">{announcement.content}</p>
                <div className="flex items-center gap-4 mt-4 text-xs text-slate-500">
                  <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />Created: {new Date(announcement.created_at).toLocaleDateString()}</span>
                  {announcement.published_at && <span className="flex items-center gap-1"><Send className="w-3 h-3" />Published: {new Date(announcement.published_at).toLocaleDateString()}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 ml-4">
                {announcement.status === 'draft' && <button onClick={() => publishAnnouncement(announcement.id)} className="p-2 text-green-400 hover:bg-green-500/20 rounded-lg" title="Publish"><Send className="w-4 h-4" /></button>}
                <button onClick={() => openEditModal(announcement)} className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg" title="Edit"><Edit className="w-4 h-4" /></button>
                <button onClick={() => deleteAnnouncement(announcement.id)} className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/20 rounded-lg" title="Delete"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setIsModalOpen(false)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between p-6 border-b border-slate-700"><h2 className="text-xl font-semibold text-white">{selectedAnnouncement ? 'Edit Announcement' : 'New Announcement'}</h2><button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white"><X className="w-6 h-6" /></button></div>
              <div className="p-6 space-y-4">
                <div><label className="block text-sm font-medium text-slate-300 mb-1">Title *</label><input type="text" value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white" placeholder="Announcement title..." /></div>
                <div><label className="block text-sm font-medium text-slate-300 mb-1">Content *</label><textarea value={formData.content} onChange={(e) => setFormData({ ...formData, content: e.target.value })} rows={4} className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white" placeholder="Announcement content..." /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-sm font-medium text-slate-300 mb-1">Type</label><select value={formData.type} onChange={(e) => setFormData({ ...formData, type: e.target.value as Announcement['type'] })} className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"><option value="info">Info</option><option value="success">Success</option><option value="warning">Warning</option><option value="error">Error</option></select></div>
                  <div><label className="block text-sm font-medium text-slate-300 mb-1">Target Audience</label><select value={formData.target} onChange={(e) => setFormData({ ...formData, target: e.target.value as Announcement['target'] })} className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"><option value="all">All Users</option><option value="admins">Admins Only</option></select></div>
                </div>
              </div>
              <div className="flex justify-end gap-3 p-6 border-t border-slate-700">
                <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600">Cancel</button>
                <button onClick={() => { setFormData({ ...formData, status: 'draft' }); handleSave(); }} disabled={isSaving || !formData.title || !formData.content} className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-500 disabled:opacity-50">Save as Draft</button>
                <button onClick={() => { setFormData({ ...formData, status: 'published' }); handleSave(); }} disabled={isSaving || !formData.title || !formData.content} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">{isSaving && <Loader2 className="w-4 h-4 animate-spin" />}<Send className="w-4 h-4" />Publish Now</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
