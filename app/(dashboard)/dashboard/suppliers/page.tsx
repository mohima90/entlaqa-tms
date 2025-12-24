'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Edit, Trash2, Building2, Mail, Phone, X, Loader2, AlertCircle, CheckCircle, Search, Globe, MapPin } from 'lucide-react';
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
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return s.name.toLowerCase().includes(query) || s.contact_person?.toLowerCase().includes(query) || s.email?.toLowerCase().includes(query);
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

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="Suppliers" subtitle="Manage training suppliers and vendors" />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700"><AlertCircle className="w-5 h-5" />{error}<button onClick={() => setError('')} className="ml-auto">×</button></div>}
        {success && <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700"><CheckCircle className="w-5 h-5" />{success}</div>}

        <div className="flex items-center justify-between mb-6">
          <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" /><input type="text" placeholder="Search suppliers..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg w-64" /></div>
          <button onClick={openCreateModal} className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"><Plus className="w-5 h-5" />Add Supplier</button>
        </div>

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

        <AnimatePresence>
          {isModalOpen && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setIsModalOpen(false)}>
              <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-6 border-b"><h2 className="text-xl font-semibold">{selectedSupplier ? 'Edit Supplier' : 'Create Supplier'}</h2><button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-6 h-6" /></button></div>
                <div className="p-6 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Name (English) *</label><input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Name (Arabic)</label><input type="text" value={formData.name_ar} onChange={e => setFormData({...formData, name_ar: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" dir="rtl" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Type</label><select value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg"><option value="training_provider">Training Provider</option><option value="content_provider">Content Provider</option><option value="technology_vendor">Technology Vendor</option><option value="venue_provider">Venue Provider</option><option value="consultant">Consultant</option><option value="other">Other</option></select></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Status</label><select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg"><option value="active">Active</option><option value="inactive">Inactive</option><option value="pending">Pending</option></select></div>
                  </div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Contact Person</label><input type="text" value={formData.contact_person} onChange={e => setFormData({...formData, contact_person: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Email</label><input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Phone</label><input type="tel" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                  </div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Website</label><input type="url" value={formData.website} onChange={e => setFormData({...formData, website: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" placeholder="https://" /></div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Address</label><input type="text" value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">City</label><input type="text" value={formData.city} onChange={e => setFormData({...formData, city: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Country</label><input type="text" value={formData.country} onChange={e => setFormData({...formData, country: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                  </div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Notes</label><textarea value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} rows={2} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                </div>
                <div className="flex justify-end gap-3 p-6 border-t">
                  <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
                  <button onClick={handleSave} disabled={isSaving || !formData.name} className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">{isSaving && <Loader2 className="w-4 h-4 animate-spin" />}{selectedSupplier ? 'Update' : 'Create'}</button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
