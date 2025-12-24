'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Edit, Trash2, MapPin, Users, X, Loader2, AlertCircle, CheckCircle, Search, Building, Download } from 'lucide-react';
import Header from '@/components/layout/Header';
import { createClient, generateId } from '@/lib/supabase';

interface Venue {
  id: string;
  name: string;
  name_ar: string;
  type: string;
  address: string;
  city: string;
  capacity: number;
  status: string;
  contact_phone: string;
  contact_email: string;
  notes: string;
}

export default function VenuesPage() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const supabase = createClient();

  const [formData, setFormData] = useState({
    name: '', name_ar: '', type: 'training_room', address: '', city: '', capacity: 20, status: 'active', contact_phone: '', contact_email: '', notes: ''
  });

  useEffect(() => { fetchVenues(); }, []);

  const fetchVenues = async () => {
    setIsLoading(true);
    const { data, error } = await supabase.from('venues').select('*').order('name');
    if (error) { setError('Failed to fetch venues'); console.error(error); }
    else { setVenues(data || []); }
    setIsLoading(false);
  };

  const filteredVenues = venues.filter(v => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return v.name.toLowerCase().includes(query) || v.city?.toLowerCase().includes(query);
  });

  const openCreateModal = () => {
    setSelectedVenue(null);
    setFormData({ name: '', name_ar: '', type: 'training_room', address: '', city: '', capacity: 20, status: 'active', contact_phone: '', contact_email: '', notes: '' });
    setIsModalOpen(true);
  };

  const openEditModal = (venue: Venue) => {
    setSelectedVenue(venue);
    setFormData({
      name: venue.name, name_ar: venue.name_ar || '', type: venue.type || 'training_room',
      address: venue.address || '', city: venue.city || '', capacity: venue.capacity || 20,
      status: venue.status || 'active', contact_phone: venue.contact_phone || '',
      contact_email: venue.contact_email || '', notes: venue.notes || ''
    });
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name) { setError('Name is required'); return; }
    setIsSaving(true); setError('');
    const venueData = { ...formData, updated_at: new Date().toISOString() };

    if (selectedVenue) {
      const { error } = await supabase.from('venues').update(venueData).eq('id', selectedVenue.id);
      if (error) setError('Failed to update: ' + error.message);
      else { setSuccess('Venue updated!'); setIsModalOpen(false); fetchVenues(); }
    } else {
      const { error } = await supabase.from('venues').insert({ id: generateId('ven'), ...venueData, organization_id: 'org_001', created_at: new Date().toISOString() });
      if (error) setError('Failed to create: ' + error.message);
      else { setSuccess('Venue created!'); setIsModalOpen(false); fetchVenues(); }
    }
    setTimeout(() => setSuccess(''), 3000);
    setIsSaving(false);
  };

  const deleteVenue = async (venue: Venue) => {
    if (!confirm(`Delete "${venue.name}"?`)) return;
    const { error } = await supabase.from('venues').delete().eq('id', venue.id);
    if (error) setError('Failed to delete: ' + error.message);
    else { setSuccess('Venue deleted!'); fetchVenues(); }
    setTimeout(() => setSuccess(''), 3000);
  };

  const typeLabels: Record<string, string> = { training_room: 'Training Room', conference_hall: 'Conference Hall', computer_lab: 'Computer Lab', virtual: 'Virtual', external: 'External' };
  const statusColors: Record<string, string> = { active: 'bg-green-100 text-green-800', inactive: 'bg-gray-100 text-gray-800', maintenance: 'bg-yellow-100 text-yellow-800' };

  const headerActions = (
    <div className="flex items-center gap-2">
      <button className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
        <Download className="w-4 h-4" />
        <span className="hidden sm:inline">Export</span>
      </button>
      <button onClick={openCreateModal} className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">
        <Plus className="w-5 h-5" />
        <span>Add Venue</span>
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="Venues" subtitle={`${venues.length} training locations`} actions={headerActions} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700"><AlertCircle className="w-5 h-5" />{error}<button onClick={() => setError('')} className="ml-auto">×</button></div>}
        {success && <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700"><CheckCircle className="w-5 h-5" />{success}</div>}

        {/* Filters */}
        <div className="flex items-center gap-4 mb-6">
          <div className="relative flex-1 max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" /><input type="text" placeholder="Search venues..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl p-4 border border-gray-200"><p className="text-2xl font-bold text-gray-900">{venues.length}</p><p className="text-sm text-gray-500">Total Venues</p></div>
          <div className="bg-white rounded-xl p-4 border border-gray-200"><p className="text-2xl font-bold text-green-600">{venues.filter(v => v.status === 'active').length}</p><p className="text-sm text-gray-500">Active</p></div>
          <div className="bg-white rounded-xl p-4 border border-gray-200"><p className="text-2xl font-bold text-purple-600">{venues.reduce((sum, v) => sum + (v.capacity || 0), 0)}</p><p className="text-sm text-gray-500">Total Capacity</p></div>
          <div className="bg-white rounded-xl p-4 border border-gray-200"><p className="text-2xl font-bold text-blue-600">{venues.filter(v => v.type === 'virtual').length}</p><p className="text-sm text-gray-500">Virtual</p></div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Venue</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">City</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Capacity</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {isLoading ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center"><Loader2 className="w-8 h-8 text-gray-400 animate-spin mx-auto" /></td></tr>
              ) : filteredVenues.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-gray-500">No venues found. <button onClick={openCreateModal} className="text-primary-600 hover:underline">Create one</button></td></tr>
              ) : filteredVenues.map((venue) => (
                <tr key={venue.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center"><Building className="w-5 h-5 text-purple-600" /></div>
                      <div><p className="font-medium text-gray-900">{venue.name}</p><p className="text-sm text-gray-500">{venue.address || 'No address'}</p></div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-gray-600">{typeLabels[venue.type] || venue.type}</td>
                  <td className="px-6 py-4 text-gray-600">{venue.city || '-'}</td>
                  <td className="px-6 py-4"><div className="flex items-center gap-1 text-gray-600"><Users className="w-4 h-4" />{venue.capacity}</div></td>
                  <td className="px-6 py-4"><span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[venue.status] || 'bg-gray-100 text-gray-800'}`}>{venue.status}</span></td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => openEditModal(venue)} className="p-2 text-gray-400 hover:text-primary-600 hover:bg-gray-100 rounded-lg"><Edit className="w-4 h-4" /></button>
                      <button onClick={() => deleteVenue(venue)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
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
                <div className="flex items-center justify-between p-6 border-b"><h2 className="text-xl font-semibold">{selectedVenue ? 'Edit Venue' : 'Add New Venue'}</h2><button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-6 h-6" /></button></div>
                <div className="p-6 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Name (English) *</label><input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Name (Arabic)</label><input type="text" value={formData.name_ar} onChange={e => setFormData({...formData, name_ar: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" dir="rtl" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Type</label><select value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"><option value="training_room">Training Room</option><option value="conference_hall">Conference Hall</option><option value="computer_lab">Computer Lab</option><option value="virtual">Virtual</option><option value="external">External</option></select></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Status</label><select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"><option value="active">Active</option><option value="inactive">Inactive</option><option value="maintenance">Maintenance</option></select></div>
                  </div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Address</label><input type="text" value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">City</label><input type="text" value={formData.city} onChange={e => setFormData({...formData, city: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Capacity</label><input type="number" value={formData.capacity} onChange={e => setFormData({...formData, capacity: parseInt(e.target.value)})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Contact Phone</label><input type="tel" value={formData.contact_phone} onChange={e => setFormData({...formData, contact_phone: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Contact Email</label><input type="email" value={formData.contact_email} onChange={e => setFormData({...formData, contact_email: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
                  </div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Notes</label><textarea value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} rows={2} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
                </div>
                <div className="flex justify-end gap-3 p-6 border-t bg-gray-50">
                  <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-100">Cancel</button>
                  <button onClick={handleSave} disabled={isSaving || !formData.name} className="flex items-center gap-2 px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">{isSaving && <Loader2 className="w-4 h-4 animate-spin" />}{selectedVenue ? 'Save Changes' : 'Create Venue'}</button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
