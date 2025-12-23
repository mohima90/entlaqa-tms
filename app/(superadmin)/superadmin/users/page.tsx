'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Search, Edit, Trash2, Ban, CheckCircle, Key, Building2, Shield, Loader2, AlertCircle, X, Plus, RefreshCw } from 'lucide-react';
import { createClient, generateId } from '@/lib/supabase';

interface User {
  id: string;
  organization_id: string;
  email: string;
  full_name: string;
  full_name_ar: string;
  phone: string;
  role: string;
  status: string;
  created_at: string;
  organization?: { name: string };
}

interface Organization {
  id: string;
  name: string;
}

export default function AllUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [orgFilter, setOrgFilter] = useState('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const supabase = createClient();

  const [formData, setFormData] = useState({ organization_id: '', email: '', full_name: '', full_name_ar: '', phone: '', role: 'learner', status: 'active' });

  const roleOptions = [
    { value: 'super_admin', label: 'Super Admin' },
    { value: 'org_admin', label: 'Organization Admin' },
    { value: 'hr_manager', label: 'HR Manager' },
    { value: 'dept_head', label: 'Department Head' },
    { value: 'instructor', label: 'Instructor' },
    { value: 'learner', label: 'Learner' },
  ];

  useEffect(() => { fetchData(); }, []);
  useEffect(() => { filterUsers(); }, [searchQuery, roleFilter, statusFilter, orgFilter, users]);

  const fetchData = async () => {
    setIsLoading(true);
    const { data: orgs } = await supabase.from('organizations').select('id, name').order('name');
    setOrganizations(orgs || []);
    const { data: usersData, error } = await supabase.from('users').select('*').order('created_at', { ascending: false });
    if (error) { setError('Failed to fetch users'); setIsLoading(false); return; }
    const usersWithOrg = (usersData || []).map((user) => ({ ...user, organization: orgs?.find((o) => o.id === user.organization_id) }));
    setUsers(usersWithOrg);
    setIsLoading(false);
  };

  const filterUsers = () => {
    let filtered = [...users];
    if (searchQuery) { const query = searchQuery.toLowerCase(); filtered = filtered.filter((user) => user.email.toLowerCase().includes(query) || user.full_name?.toLowerCase().includes(query) || user.phone?.includes(query)); }
    if (roleFilter !== 'all') filtered = filtered.filter((user) => user.role === roleFilter);
    if (statusFilter !== 'all') filtered = filtered.filter((user) => user.status === statusFilter);
    if (orgFilter !== 'all') filtered = filtered.filter((user) => user.organization_id === orgFilter);
    setFilteredUsers(filtered);
  };

  const openCreateModal = () => { setSelectedUser(null); setFormData({ organization_id: organizations[0]?.id || '', email: '', full_name: '', full_name_ar: '', phone: '', role: 'learner', status: 'active' }); setIsModalOpen(true); };

  const openEditModal = (user: User) => { setSelectedUser(user); setFormData({ organization_id: user.organization_id, email: user.email, full_name: user.full_name, full_name_ar: user.full_name_ar || '', phone: user.phone || '', role: user.role, status: user.status }); setIsModalOpen(true); };

  const handleSave = async () => {
    if (!formData.email || !formData.full_name || !formData.organization_id) { setError('Email, name, and organization are required'); return; }
    setIsSaving(true); setError('');
    const userData = { organization_id: formData.organization_id, email: formData.email, full_name: formData.full_name, full_name_ar: formData.full_name_ar, phone: formData.phone, role: formData.role, status: formData.status, updated_at: new Date().toISOString() };
    if (selectedUser) {
      const { error } = await supabase.from('users').update(userData).eq('id', selectedUser.id);
      if (error) setError('Failed to update user: ' + error.message);
      else { setSuccess('User updated successfully!'); setIsModalOpen(false); fetchData(); }
    } else {
      const { error } = await supabase.from('users').insert({ id: generateId('usr'), ...userData, data_source: 'offline', created_at: new Date().toISOString() });
      if (error) setError('Failed to create user: ' + error.message);
      else { setSuccess('User created successfully!'); setIsModalOpen(false); fetchData(); }
    }
    setTimeout(() => setSuccess(''), 3000);
    setIsSaving(false);
  };

  const toggleUserStatus = async (user: User) => {
    const newStatus = user.status === 'active' ? 'suspended' : 'active';
    const { error } = await supabase.from('users').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', user.id);
    if (error) setError('Failed to update status');
    else { setSuccess(`User ${newStatus === 'active' ? 'activated' : 'suspended'}!`); fetchData(); }
    setTimeout(() => setSuccess(''), 3000);
  };

  const deleteUser = async (user: User) => {
    if (!confirm(`Delete user "${user.full_name}"? This cannot be undone.`)) return;
    const { error } = await supabase.from('users').delete().eq('id', user.id);
    if (error) setError('Failed to delete user: ' + error.message);
    else { setSuccess('User deleted!'); fetchData(); }
    setTimeout(() => setSuccess(''), 3000);
  };

  const roleColors: Record<string, string> = { super_admin: 'bg-red-500/20 text-red-400', org_admin: 'bg-purple-500/20 text-purple-400', hr_manager: 'bg-blue-500/20 text-blue-400', dept_head: 'bg-cyan-500/20 text-cyan-400', instructor: 'bg-green-500/20 text-green-400', learner: 'bg-slate-500/20 text-slate-400' };

  return (
    <div className="space-y-6">
      {error && <div className="p-4 bg-red-500/20 border border-red-500 rounded-lg flex items-center gap-3"><AlertCircle className="w-5 h-5 text-red-400" /><p className="text-red-400">{error}</p><button onClick={() => setError('')} className="ml-auto text-red-400">×</button></div>}
      {success && <div className="p-4 bg-green-500/20 border border-green-500 rounded-lg flex items-center gap-3"><CheckCircle className="w-5 h-5 text-green-400" /><p className="text-green-400">{success}</p></div>}

      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-white">All Users</h1><p className="text-slate-400">Manage users across all organizations</p></div>
        <div className="flex items-center gap-3">
          <button onClick={fetchData} className="flex items-center gap-2 px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600"><RefreshCw className="w-4 h-4" />Refresh</button>
          <button onClick={openCreateModal} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"><Plus className="w-5 h-5" />Add User</button>
        </div>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" /><input type="text" placeholder="Search users..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-400" /></div>
        <select value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)} className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white"><option value="all">All Organizations</option>{organizations.map((org) => (<option key={org.id} value={org.id}>{org.name}</option>))}</select>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white"><option value="all">All Roles</option>{roleOptions.map((r) => (<option key={r.value} value={r.value}>{r.label}</option>))}</select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white"><option value="all">All Status</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="suspended">Suspended</option></select>
      </div>

      <div className="grid grid-cols-5 gap-4">
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700"><p className="text-2xl font-bold text-white">{users.length}</p><p className="text-sm text-slate-400">Total Users</p></div>
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700"><p className="text-2xl font-bold text-red-400">{users.filter((u) => u.role === 'super_admin').length}</p><p className="text-sm text-slate-400">Super Admins</p></div>
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700"><p className="text-2xl font-bold text-purple-400">{users.filter((u) => u.role === 'org_admin').length}</p><p className="text-sm text-slate-400">Org Admins</p></div>
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700"><p className="text-2xl font-bold text-green-400">{users.filter((u) => u.status === 'active').length}</p><p className="text-sm text-slate-400">Active</p></div>
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700"><p className="text-2xl font-bold text-yellow-400">{users.filter((u) => u.status === 'suspended').length}</p><p className="text-sm text-slate-400">Suspended</p></div>
      </div>

      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-700/50"><tr><th className="px-6 py-4 text-left text-xs font-medium text-slate-400 uppercase">User</th><th className="px-6 py-4 text-left text-xs font-medium text-slate-400 uppercase">Organization</th><th className="px-6 py-4 text-left text-xs font-medium text-slate-400 uppercase">Role</th><th className="px-6 py-4 text-left text-xs font-medium text-slate-400 uppercase">Status</th><th className="px-6 py-4 text-left text-xs font-medium text-slate-400 uppercase">Created</th><th className="px-6 py-4 text-right text-xs font-medium text-slate-400 uppercase">Actions</th></tr></thead>
          <tbody className="divide-y divide-slate-700">
            {isLoading ? <tr><td colSpan={6} className="px-6 py-12 text-center"><Loader2 className="w-8 h-8 text-slate-400 animate-spin mx-auto" /></td></tr> : filteredUsers.length === 0 ? <tr><td colSpan={6} className="px-6 py-12 text-center text-slate-500">No users found</td></tr> : filteredUsers.map((user) => (
              <tr key={user.id} className="hover:bg-slate-700/30">
                <td className="px-6 py-4"><div className="flex items-center gap-3"><div className={`w-10 h-10 rounded-full flex items-center justify-center ${user.role === 'super_admin' ? 'bg-red-600' : user.role === 'org_admin' ? 'bg-purple-600' : 'bg-slate-600'}`}>{user.role === 'super_admin' ? <Shield className="w-5 h-5 text-white" /> : <span className="text-white font-medium">{user.full_name?.charAt(0)}</span>}</div><div><p className="font-medium text-white">{user.full_name}</p><p className="text-xs text-slate-500">{user.email}</p></div></div></td>
                <td className="px-6 py-4"><div className="flex items-center gap-2 text-slate-300"><Building2 className="w-4 h-4 text-slate-500" />{user.organization?.name || 'N/A'}</div></td>
                <td className="px-6 py-4"><span className={`px-2.5 py-1 rounded-full text-xs font-medium ${roleColors[user.role] || roleColors.learner}`}>{roleOptions.find(r => r.value === user.role)?.label || user.role}</span></td>
                <td className="px-6 py-4"><span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${user.status === 'active' ? 'bg-green-500/20 text-green-400' : user.status === 'suspended' ? 'bg-red-500/20 text-red-400' : 'bg-slate-500/20 text-slate-400'}`}><span className={`w-1.5 h-1.5 rounded-full ${user.status === 'active' ? 'bg-green-400' : user.status === 'suspended' ? 'bg-red-400' : 'bg-slate-400'}`} />{user.status}</span></td>
                <td className="px-6 py-4 text-slate-400 text-sm">{new Date(user.created_at).toLocaleDateString()}</td>
                <td className="px-6 py-4"><div className="flex items-center justify-end gap-1"><button onClick={() => openEditModal(user)} className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg" title="Edit"><Edit className="w-4 h-4" /></button><button onClick={() => toggleUserStatus(user)} className={`p-2 rounded-lg ${user.status === 'active' ? 'text-slate-400 hover:text-red-400 hover:bg-red-500/20' : 'text-slate-400 hover:text-green-400 hover:bg-green-500/20'}`} title={user.status === 'active' ? 'Suspend' : 'Activate'}>{user.status === 'active' ? <Ban className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}</button><button onClick={() => deleteUser(user)} className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/20 rounded-lg" title="Delete"><Trash2 className="w-4 h-4" /></button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setIsModalOpen(false)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between p-6 border-b border-slate-700"><h2 className="text-xl font-semibold text-white">{selectedUser ? 'Edit User' : 'Create User'}</h2><button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white"><X className="w-6 h-6" /></button></div>
              <div className="p-6 space-y-4">
                <div><label className="block text-sm font-medium text-slate-300 mb-1">Organization *</label><select value={formData.organization_id} onChange={(e) => setFormData({ ...formData, organization_id: e.target.value })} className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"><option value="">Select Organization</option>{organizations.map((org) => (<option key={org.id} value={org.id}>{org.name}</option>))}</select></div>
                <div className="grid grid-cols-2 gap-4"><div><label className="block text-sm font-medium text-slate-300 mb-1">Full Name *</label><input type="text" value={formData.full_name} onChange={(e) => setFormData({ ...formData, full_name: e.target.value })} className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white" /></div><div><label className="block text-sm font-medium text-slate-300 mb-1">Name (Arabic)</label><input type="text" value={formData.full_name_ar} onChange={(e) => setFormData({ ...formData, full_name_ar: e.target.value })} dir="rtl" className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white" /></div></div>
                <div><label className="block text-sm font-medium text-slate-300 mb-1">Email *</label><input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white" /></div>
                <div><label className="block text-sm font-medium text-slate-300 mb-1">Phone</label><input type="tel" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white" /></div>
                <div className="grid grid-cols-2 gap-4"><div><label className="block text-sm font-medium text-slate-300 mb-1">Role *</label><select value={formData.role} onChange={(e) => setFormData({ ...formData, role: e.target.value })} className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white">{roleOptions.map((r) => (<option key={r.value} value={r.value}>{r.label}</option>))}</select></div><div><label className="block text-sm font-medium text-slate-300 mb-1">Status</label><select value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value })} className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"><option value="active">Active</option><option value="inactive">Inactive</option><option value="suspended">Suspended</option></select></div></div>
              </div>
              <div className="flex justify-end gap-3 p-6 border-t border-slate-700"><button onClick={() => setIsModalOpen(false)} className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600">Cancel</button><button onClick={handleSave} disabled={isSaving} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">{isSaving && <Loader2 className="w-4 h-4 animate-spin" />}{selectedUser ? 'Update' : 'Create'}</button></div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
