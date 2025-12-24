'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Edit, Trash2, Building2, Mail, Phone, X, Loader2, AlertCircle, CheckCircle, Search, Globe, MapPin, Download } from 'lucide-react';
import Header from '@/components/layout/Header';
import { createClient, generateId } from '@/lib/supabase';

interface Supplier {
  id: string;
  name: string;
  name_ar: string;
  type: string;
  contact_person: string;
  email: string;
  phone: string;
  website: string;
  address: string;
  city: string;
  country: string;
  status: string;
  notes: string;
}

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const supabase = createClient();

  const [formData, setFormData] = useState({
    name: '', name_ar: '', type: 'training_provider', contact_person: '', email: '', phone: '', website: '', address: '', city: '', country: '', status: 'active', notes: ''
  });

  useEffect(() => { fetchSuppliers(); }, []);

  const fetchSuppliers = async () => {
    setIsLoading(true);
    const { data, error } = await supabase.from('suppliers').select('*').order('name');
    if (error) { setError('Failed to fetch suppliers'); console.error(error); }
    else { setSuppliers(data || []); }
    setIsLoading(false);
  };

  const filteredSuppliers = suppliers.filter(s => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (!s.name.toLowerCase().includes(query) && !s.contact_person?.toLowerCase().includes(query) && !s.email?.toLowerCase().includes(query)) return false;
    }
    if (typeFilter !== 'all' && s.type !== typeFilter) return false;
    return true;
  });

  const openCreateModal = () => {
    setSelectedSupplier(null);
    setFormData({ name: '', name_ar: '', type: 'training_provider', contact_person: '', email: '', phone: '', website: '', address: '', city: '', country: '', status: 'active', notes: '' });
    setIsModalOpen(true);
  };

  const openEditModal = (supplier: Supplier) => {
    setSelectedSupplier(supplier);
    setFormData({
      name: supplier.name, name_ar: supplier.name_ar || '', type: supplier.type || 'training_provider',
      contact_person: supplier.contact_person || '', email: supplier.email || '', phone: supplier.phone || '',
      website: supplier.website || '', address: supplier.address || '', city: supplier.city || '',
      country: supplier.country || '', status: supplier.status || 'active', notes: supplier.notes || ''
    });
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name) { setError('Name is required'); return; }
    setIsSaving(true); setError('');
    const supplierData = { ...formData, updated_at: new Date().toISOString() };

    if (selectedSupplier) {
      const { error } = await supabase.from('suppliers').update(supplierData).eq('id', selectedSupplier.id);
      if (error) setError('Failed to update: ' + error.message);
      else { setSuccess('Supplier updated!'); setIsModalOpen(false); fetchSuppliers(); }
    } else {
      const { error } = await supabase.from('suppliers').insert({ id: generateId('sup'), ...supplierData, organization_id: 'org_001', created_at: new Date().toISOString() });
      if (error) setError('Failed to create: ' + error.message);
      else { setSuccess('Supplier created!'); setIsModalOpen(false); fetchSuppliers(); }
    }
    setTimeout(() => setSuccess(''), 3000);
    setIsSaving(false);
  };

  const deleteSupplier = async (supplier: Supplier) => {
    if (!confirm(`Delete "${supplier.name}"?`)) return;
    const { error } = await supabase.from('suppliers').delete().eq('id', supplier.id);
    if (error) setError('Failed to delete: ' + error.message);
    else { setSuccess('Supplier deleted!'); fetchSuppliers(); }
    setTimeout(() => setSuccess(''), 3000);
  };

  const typeLabels: Record<string, string> = { training_provider: 'Training Provider', content_provider: 'Content Provider', technology_vendor: 'Technology Vendor', venue_provider: 'Venue Provider', consultant: 'Consultant', other: 'Other' };
  const statusColors: Record<string, string> = { active: 'bg-green-100 text-green-800', inactive: 'bg-gray-100 text-gray-800', pending: 'bg-yellow-100 text-yellow-800' };

  const headerActions = (
    <div className="flex items-center gap-2">
      <button className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
        <Download className="w-4 h-4" />
        <span className="hidden sm:inline">Export</span>
      </button>
      <button onClick={openCreateModal} className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">
        <Plus className="w-5 h-5" />
        <span>Add Supplier</span>
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="Suppliers" subtitle={`${suppliers.length} vendors & partners`} actions={headerActions} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700"><AlertCircle className="w-5 h-5" />{error}<button onClick={() => setError('')} className="ml-auto">×</button></div>}
        {success && <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700"><CheckCircle className="w-5 h-5" />{success}</div>}

        {/* Filters */}
        <div className="flex items-center gap-4 mb-6">
          <div className="relative flex-1 max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" /><input type="text" placeholder="Search suppliers..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500">
            <option value="all">All Types</option>
            <option value="training_provider">Training Provider</option>
            <option value="content_provider">Content Provider</option>
            <option value="technology_vendor">Technology Vendor</option>
            <option value="venue_provider">Venue Provider</option>
            <option value="consultant">Consultant</option>
          </select>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl p-4 border border-gray-200"><p className="text-2xl font-bold text-gray-900">{suppliers.length}</p><p className="text-sm text-gray-500">Total Suppliers</p></div>
          <div className="bg-white rounded-xl p-4 border border-gray-200"><p className="text-2xl font-bold text-green-600">{suppliers.filter(s => s.status === 'active').length}</p><p className="text-sm text-gray-500">Active</p></div>
          <div className="bg-white rounded-xl p-4 border border-gray-200"><p className="text-2xl font-bold text-blue-600">{suppliers.filter(s => s.type === 'training_provider').length}</p><p className="text-sm text-gray-500">Training Providers</p></div>
          <div className="bg-white rounded-xl p-4 border border-gray-200"><p className="text-2xl font-bold text-purple-600">{suppliers.filter(s => s.type === 'technology_vendor').length}</p><p className="text-sm text-gray-500">Tech Vendors</p></div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Supplier</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Contact</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Location</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {isLoading ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center"><Loader2 className="w-8 h-8 text-gray-400 animate-spin mx-auto" /></td></tr>
              ) : filteredSuppliers.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-gray-500">No suppliers found. <button onClick={openCreateModal} className="text-primary-600 hover:underline">Create one</button></td></tr>
              ) : filteredSuppliers.map((supplier) => (
                <tr key={supplier.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center"><Building2 className="w-5 h-5 text-indigo-600" /></div>
                      <div>
                        <p className="font-medium text-gray-900">{supplier.name}</p>
                        {supplier.website && <a href={supplier.website} target="_blank" rel="noopener noreferrer" className="text-sm text-primary-600 hover:underline flex items-center gap-1"><Globe className="w-3 h-3" />Website</a>}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-gray-600">{typeLabels[supplier.type] || supplier.type}</td>
                  <td className="px-6 py-4">
                    <div className="space-y-1">
                      {supplier.contact_person && <p className="text-sm text-gray-900">{supplier.contact_person}</p>}
                      {supplier.email && <div className="flex items-center gap-1 text-sm text-gray-500"><Mail className="w-3 h-3" />{supplier.email}</div>}
                      {supplier.phone && <div className="flex items-center gap-1 text-sm text-gray-500"><Phone className="w-3 h-3" />{supplier.phone}</div>}
                    </div>
                  </td>
                  <td className="px-6 py-4"><div className="flex items-center gap-1 text-gray-600"><MapPin className="w-4 h-4" />{[supplier.city, supplier.country].filter(Boolean).join(', ') || '-'}</div></td>
                  <td className="px-6 py-4"><span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[supplier.status] || 'bg-gray-100 text-gray-800'}`}>{supplier.status}</span></td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => openEditModal(supplier)} className="p-2 text-gray-400 hover:text-primary-600 hover:bg-gray-100 rounded-lg"><Edit className="w-4 h-4" /></button>
                      <button onClick={() => deleteSupplier(supplier)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
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
                <div className="flex items-center justify-between p-6 border-b"><h2 className="text-xl font-semibold">{selectedSupplier ? 'Edit Supplier' : 'Add New Supplier'}</h2><button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-6 h-6" /></button></div>
                <div className="p-6 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Name (English) *</label><input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Name (Arabic)</label><input type="text" value={formData.name_ar} onChange={e => setFormData({...formData, name_ar: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" dir="rtl" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Type</label><select value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"><option value="training_provider">Training Provider</option><option value="content_provider">Content Provider</option><option value="technology_vendor">Technology Vendor</option><option value="venue_provider">Venue Provider</option><option value="consultant">Consultant</option><option value="other">Other</option></select></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Status</label><select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"><option value="active">Active</option><option value="inactive">Inactive</option><option value="pending">Pending</option></select></div>
                  </div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Contact Person</label><input type="text" value={formData.contact_person} onChange={e => setFormData({...formData, contact_person: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Email</label><input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Phone</label><input type="tel" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
                  </div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Website</label><input type="url" value={formData.website} onChange={e => setFormData({...formData, website: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="https://" /></div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Address</label><input type="text" value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">City</label><input type="text" value={formData.city} onChange={e => setFormData({...formData, city: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Country</label><input type="text" value={formData.country} onChange={e => setFormData({...formData, country: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
                  </div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Notes</label><textarea value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} rows={2} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
                </div>
                <div className="flex justify-end gap-3 p-6 border-t bg-gray-50">
                  <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-100">Cancel</button>
                  <button onClick={handleSave} disabled={isSaving || !formData.name} className="flex items-center gap-2 px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">{isSaving && <Loader2 className="w-4 h-4 animate-spin" />}{selectedSupplier ? 'Save Changes' : 'Create Supplier'}</button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
