'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Building2, Plus, Search, Edit, Trash2, Ban, CheckCircle, Users, X, Loader2, AlertCircle } from 'lucide-react';
import { createClient, generateId } from '@/lib/supabase';

interface Organization {
  id: string;
  name: string;
  name_ar: string;
  slug: string;
  logo_url: string;
  status: string;
  subscription_plan: string;
  settings: any;
  created_at: string;
  _count?: { users: number; learners: number; courses: number };
}

export default function OrganizationsPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [filteredOrgs, setFilteredOrgs] = useState<Organization[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [planFilter, setPlanFilter] = useState('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const supabase = createClient();

  const [formData, setFormData] = useState({ name: '', name_ar: '', slug: '', status: 'active', subscription_plan: 'basic', email: '', phone: '', address: '', max_users: 50, max_learners: 500, max_storage_gb: 5 });

  useEffect(() => { fetchOrganizations(); }, []);
  useEffect(() => { filterOrganizations(); }, [searchQuery, statusFilter, planFilter, organizations]);

  const fetchOrganizations = async () => {
    setIsLoading(true);
    const { data: orgs, error } = await supabase.from('organizations').select('*').order('created_at', { ascending: false });
    if (error) { setError('Failed to fetch organizations'); setIsLoading(false); return; }
    const orgsWithCounts = await Promise.all((orgs || []).map(async (org) => {
      const { count: userCount } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('organization_id', org.id);
      const { count: learnerCount } = await supabase.from('learners').select('*', { count: 'exact', head: true }).eq('organization_id', org.id);
      const { count: courseCount } = await supabase.from('courses').select('*', { count: 'exact', head: true }).eq('organization_id', org.id);
      return { ...org, _count: { users: userCount || 0, learners: learnerCount || 0, courses: courseCount || 0 } };
    }));
    setOrganizations(orgsWithCounts);
    setIsLoading(false);
  };

  const filterOrganizations = () => {
    let filtered = [...organizations];
    if (searchQuery) { const query = searchQuery.toLowerCase(); filtered = filtered.filter((org) => org.name.toLowerCase().includes(query) || org.name_ar?.toLowerCase().includes(query) || org.slug?.toLowerCase().includes(query)); }
    if (statusFilter !== 'all') filtered = filtered.filter((org) => org.status === statusFilter);
    if (planFilter !== 'all') filtered = filtered.filter((org) => org.subscription_plan === planFilter);
    setFilteredOrgs(filtered);
  };

  const openCreateModal = () => { setSelectedOrg(null); setFormData({ name: '', name_ar: '', slug: '', status: 'active', subscription_plan: 'basic', email: '', phone: '', address: '', max_users: 50, max_learners: 500, max_storage_gb: 5 }); setIsModalOpen(true); };

  const openEditModal = (org: Organization) => {
    setSelectedOrg(org);
    const settings = org.settings || {};
    setFormData({ name: org.name, name_ar: org.name_ar || '', slug: org.slug || '', status: org.status, subscription_plan: org.subscription_plan || 'basic', email: settings.email || '', phone: settings.phone || '', address: settings.address || '', max_users: settings.limits?.max_users || 50, max_learners: settings.limits?.max_learners || 500, max_storage_gb: settings.limits?.max_storage_gb || 5 });
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name) { setError('Organization name is required'); return; }
    setIsSaving(true); setError('');
    const orgData = { name: formData.name, name_ar: formData.name_ar, slug: formData.slug || formData.name.toLowerCase().replace(/\s+/g, '-'), status: formData.status, subscription_plan: formData.subscription_plan, settings: { email: formData.email, phone: formData.phone, address: formData.address, limits: { max_users: formData.max_users, max_learners: formData.max_learners, max_storage_gb: formData.max_storage_gb } }, updated_at: new Date().toISOString() };
    if (selectedOrg) {
      const { error } = await supabase.from('organizations').update(orgData).eq('id', selectedOrg.id);
      if (error) setError('Failed to update organization: ' + error.message);
      else { setSuccess('Organization updated successfully!'); setIsModalOpen(false); fetchOrganizations(); }
    } else {
      const { error } = await supabase.from('organizations').insert({ id: generateId('org'), ...orgData, created_at: new Date().toISOString() });
      if (error) setError('Failed to create organization: ' + error.message);
      else { setSuccess('Organization created successfully!'); setIsModalOpen(false); fetchOrganizations(); }
    }
    setTimeout(() => setSuccess(''), 3000);
    setIsSaving(false);
  };

  const toggleStatus = async (org: Organization) => {
    const newStatus = org.status === 'active' ? 'suspended' : 'active';
    const { error } = await supabase.from('organizations').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', org.id);
    if (error) setError('Failed to update status');
    else { setSuccess(`Organization ${newStatus === 'active' ? 'activated' : 'suspended'}!`); fetchOrganizations(); }
    setTimeout(() => setSuccess(''), 3000);
  };

  const deleteOrganization = async (org: Organization) => {
    if (!confirm(`Are you sure you want to delete "${org.name}"? This action cannot be undone.`)) return;
    const { error } = await supabase.from('organizations').delete().eq('id', org.id);
    if (error) setError('Failed to delete organization: ' + error.message);
    else { setSuccess('Organization deleted!'); fetchOrganizations(); }
    setTimeout(() => setSuccess(''), 3000);
  };

  const planColors: Record<string, string> = { free: 'bg-slate-500/20 text-slate-400', basic: 'bg-blue-500/20 text-blue-400', pro: 'bg-purple-500/20 text-purple-400', enterprise: 'bg-yellow-500/20 text-yellow-400' };

  return (
    <div className="space-y-6">
      {error && <div className="p-4 bg-red-500/20 border border-red-500 rounded-lg flex items-center gap-3"><AlertCircle className="w-5 h-5 text-red-400" /><p className="text-red-400">{error}</p><button onClick={() => setError('')} className="ml-auto text-red-400">×</button></div>}
      {success && <div className="p-4 bg-green-500/20 border border-green-500 rounded-lg flex items-center gap-3"><CheckCircle className="w-5 h-5 text-green-400" /><p className="text-green-400">{success}</p></div>}

      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-white">Organizations</h1><p className="text-slate-400">Manage all organizations on the platform</p></div>
        <button onClick={openCreateModal} className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"><Plus className="w-5 h-5" />Add Organization</button>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" /><input type="text" placeholder="Search organizations..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-400 focus:ring-2 focus:ring-red-500" /></div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:ring-2 focus:ring-red-500"><option value="all">All Status</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="pending">Pending</option></select>
        <select value={planFilter} onChange={(e) => setPlanFilter(e.target.value)} className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:ring-2 focus:ring-red-500"><option value="all">All Plans</option><option value="free">Free</option><option value="basic">Basic</option><option value="pro">Pro</option><option value="enterprise">Enterprise</option></select>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700"><p className="text-2xl font-bold text-white">{organizations.length}</p><p className="text-sm text-slate-400">Total Organizations</p></div>
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700"><p className="text-2xl font-bold text-green-400">{organizations.filter((o) => o.status === 'active').length}</p><p className="text-sm text-slate-400">Active</p></div>
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700"><p className="text-2xl font-bold text-red-400">{organizations.filter((o) => o.status === 'suspended').length}</p><p className="text-sm text-slate-400">Suspended</p></div>
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700"><p className="text-2xl font-bold text-purple-400">{organizations.filter((o) => o.subscription_plan === 'enterprise').length}</p><p className="text-sm text-slate-400">Enterprise</p></div>
      </div>

      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-700/50"><tr><th className="px-6 py-4 text-left text-xs font-medium text-slate-400 uppercase">Organization</th><th className="px-6 py-4 text-left text-xs font-medium text-slate-400 uppercase">Status</th><th className="px-6 py-4 text-left text-xs font-medium text-slate-400 uppercase">Plan</th><th className="px-6 py-4 text-left text-xs font-medium text-slate-400 uppercase">Users</th><th className="px-6 py-4 text-left text-xs font-medium text-slate-400 uppercase">Learners</th><th className="px-6 py-4 text-left text-xs font-medium text-slate-400 uppercase">Created</th><th className="px-6 py-4 text-right text-xs font-medium text-slate-400 uppercase">Actions</th></tr></thead>
          <tbody className="divide-y divide-slate-700">
            {isLoading ? <tr><td colSpan={7} className="px-6 py-12 text-center"><Loader2 className="w-8 h-8 text-slate-400 animate-spin mx-auto" /></td></tr> : filteredOrgs.length === 0 ? <tr><td colSpan={7} className="px-6 py-12 text-center text-slate-500">No organizations found</td></tr> : filteredOrgs.map((org) => (
              <tr key={org.id} className="hover:bg-slate-700/30">
                <td className="px-6 py-4"><div className="flex items-center gap-3"><div className="w-10 h-10 bg-slate-700 rounded-lg flex items-center justify-center">{org.logo_url ? <img src={org.logo_url} alt="" className="w-full h-full object-cover rounded-lg" /> : <Building2 className="w-5 h-5 text-slate-400" />}</div><div><p className="font-medium text-white">{org.name}</p><p className="text-xs text-slate-500">{org.slug}</p></div></div></td>
                <td className="px-6 py-4"><span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${org.status === 'active' ? 'bg-green-500/20 text-green-400' : org.status === 'suspended' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'}`}><span className={`w-1.5 h-1.5 rounded-full ${org.status === 'active' ? 'bg-green-400' : org.status === 'suspended' ? 'bg-red-400' : 'bg-yellow-400'}`} />{org.status}</span></td>
                <td className="px-6 py-4"><span className={`px-2.5 py-1 rounded-full text-xs font-medium ${planColors[org.subscription_plan || 'free']}`}>{org.subscription_plan || 'Free'}</span></td>
                <td className="px-6 py-4 text-slate-300">{org._count?.users || 0}</td>
                <td className="px-6 py-4 text-slate-300">{org._count?.learners || 0}</td>
                <td className="px-6 py-4 text-slate-400 text-sm">{new Date(org.created_at).toLocaleDateString()}</td>
                <td className="px-6 py-4"><div className="flex items-center justify-end gap-2"><button onClick={() => openEditModal(org)} className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg" title="Edit"><Edit className="w-4 h-4" /></button><button onClick={() => toggleStatus(org)} className={`p-2 rounded-lg ${org.status === 'active' ? 'text-slate-400 hover:text-red-400 hover:bg-red-500/20' : 'text-slate-400 hover:text-green-400 hover:bg-green-500/20'}`} title={org.status === 'active' ? 'Suspend' : 'Activate'}>{org.status === 'active' ? <Ban className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}</button><button onClick={() => deleteOrganization(org)} className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/20 rounded-lg" title="Delete"><Trash2 className="w-4 h-4" /></button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setIsModalOpen(false)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between p-6 border-b border-slate-700"><h2 className="text-xl font-semibold text-white">{selectedOrg ? 'Edit Organization' : 'Create Organization'}</h2><button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white"><X className="w-6 h-6" /></button></div>
              <div className="p-6 space-y-6">
                <div><h3 className="text-sm font-medium text-slate-400 uppercase mb-4">Basic Information</h3><div className="grid grid-cols-2 gap-4"><div><label className="block text-sm font-medium text-slate-300 mb-1">Name (English) *</label><input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-red-500" /></div><div><label className="block text-sm font-medium text-slate-300 mb-1">Name (Arabic)</label><input type="text" value={formData.name_ar} onChange={(e) => setFormData({ ...formData, name_ar: e.target.value })} dir="rtl" className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-red-500" /></div><div><label className="block text-sm font-medium text-slate-300 mb-1">Slug (URL)</label><input type="text" value={formData.slug} onChange={(e) => setFormData({ ...formData, slug: e.target.value })} placeholder="auto-generated-from-name" className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-red-500" /></div><div><label className="block text-sm font-medium text-slate-300 mb-1">Status</label><select value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value })} className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-red-500"><option value="active">Active</option><option value="suspended">Suspended</option><option value="pending">Pending</option></select></div></div></div>
                <div><h3 className="text-sm font-medium text-slate-400 uppercase mb-4">Subscription & Limits</h3><div className="grid grid-cols-2 gap-4"><div><label className="block text-sm font-medium text-slate-300 mb-1">Subscription Plan</label><select value={formData.subscription_plan} onChange={(e) => setFormData({ ...formData, subscription_plan: e.target.value })} className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-red-500"><option value="free">Free</option><option value="basic">Basic</option><option value="pro">Pro</option><option value="enterprise">Enterprise</option></select></div><div><label className="block text-sm font-medium text-slate-300 mb-1">Max Users</label><input type="number" value={formData.max_users} onChange={(e) => setFormData({ ...formData, max_users: parseInt(e.target.value) })} className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-red-500" /></div><div><label className="block text-sm font-medium text-slate-300 mb-1">Max Learners</label><input type="number" value={formData.max_learners} onChange={(e) => setFormData({ ...formData, max_learners: parseInt(e.target.value) })} className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-red-500" /></div><div><label className="block text-sm font-medium text-slate-300 mb-1">Max Storage (GB)</label><input type="number" value={formData.max_storage_gb} onChange={(e) => setFormData({ ...formData, max_storage_gb: parseInt(e.target.value) })} className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-red-500" /></div></div></div>
              </div>
              <div className="flex justify-end gap-3 p-6 border-t border-slate-700"><button onClick={() => setIsModalOpen(false)} className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600">Cancel</button><button onClick={handleSave} disabled={isSaving || !formData.name} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">{isSaving && <Loader2 className="w-4 h-4 animate-spin" />}{selectedOrg ? 'Update' : 'Create'}</button></div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
