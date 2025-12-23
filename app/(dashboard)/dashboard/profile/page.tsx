'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  User,
  Mail,
  Phone,
  Building2,
  Calendar,
  Shield,
  Bell,
  Key,
  Camera,
  Save,
  Loader2,
  CheckCircle,
  Award,
  GraduationCap,
  Clock,
  Globe,
} from 'lucide-react';
import Header from '@/components/layout/Header';
import { cn, formatDate } from '@/lib/utils';

type ProfileTab = 'profile' | 'security' | 'notifications' | 'activity';

const userData = {
  id: '1',
  full_name: 'Mohamed Ahmed',
  full_name_ar: 'محمد أحمد',
  email: 'mohamed@entlaqa.com',
  phone: '+966 50 123 4567',
  role: 'Training Administrator',
  department: 'Learning & Development',
  employee_id: 'EMP-001',
  joined_date: '2023-06-15',
  timezone: 'Asia/Riyadh',
  language: 'en',
  avatar_url: null,
  stats: {
    sessions_managed: 156,
    courses_created: 24,
    certificates_issued: 892,
    total_hours: 1248,
  },
  recent_activity: [
    { action: 'Created session', target: 'Leadership Excellence - Batch 13', time: '2 hours ago' },
    { action: 'Issued certificate', target: 'Ahmed Al-Rashid', time: '4 hours ago' },
    { action: 'Updated course', target: 'Cybersecurity Fundamentals', time: '1 day ago' },
    { action: 'Approved enrollment', target: 'Sara Al-Zahrani', time: '1 day ago' },
    { action: 'Created report', target: 'Q4 Training Summary', time: '2 days ago' },
  ],
};

export default function ProfilePage() {
  const [activeTab, setActiveTab] = useState<ProfileTab>('profile');
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    full_name: userData.full_name,
    full_name_ar: userData.full_name_ar,
    email: userData.email,
    phone: userData.phone,
    timezone: userData.timezone,
    language: userData.language,
  });

  const handleSave = async () => {
    setIsSaving(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    setIsSaving(false);
  };

  const tabs = [
    { key: 'profile', label: 'Profile', icon: User },
    { key: 'security', label: 'Security', icon: Shield },
    { key: 'notifications', label: 'Notifications', icon: Bell },
    { key: 'activity', label: 'Activity', icon: Clock },
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <Header title="My Profile" subtitle="Manage your account settings" />

      <div className="p-6">
        <div className="max-w-5xl mx-auto">
          {/* Profile Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden mb-6"
          >
            {/* Cover */}
            <div className="h-32 bg-entlaqa-gradient" />
            
            {/* Profile Info */}
            <div className="px-6 pb-6">
              <div className="flex flex-col md:flex-row md:items-end gap-4 -mt-12">
                {/* Avatar */}
                <div className="relative">
                  <div className="w-24 h-24 rounded-2xl bg-white dark:bg-slate-800 border-4 border-white dark:border-slate-800 shadow-lg flex items-center justify-center text-3xl font-bold text-entlaqa-600">
                    {userData.full_name.split(' ').map(n => n[0]).join('')}
                  </div>
                  <button className="absolute bottom-0 right-0 p-1.5 bg-entlaqa-600 text-white rounded-lg hover:bg-entlaqa-700 transition-colors">
                    <Camera className="w-4 h-4" />
                  </button>
                </div>
                
                {/* Info */}
                <div className="flex-1">
                  <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-white">
                    {userData.full_name}
                  </h1>
                  <p className="text-slate-500">{userData.role} • {userData.department}</p>
                </div>

                {/* Stats */}
                <div className="flex items-center gap-6">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-slate-900 dark:text-white">{userData.stats.sessions_managed}</p>
                    <p className="text-xs text-slate-500">Sessions</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-slate-900 dark:text-white">{userData.stats.courses_created}</p>
                    <p className="text-xs text-slate-500">Courses</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-slate-900 dark:text-white">{userData.stats.certificates_issued}</p>
                    <p className="text-xs text-slate-500">Certificates</p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Tabs */}
          <div className="flex items-center gap-2 mb-6 overflow-x-auto">
            {tabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key as ProfileTab)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all',
                  activeTab === key
                    ? 'bg-entlaqa-600 text-white'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>

          {/* Profile Tab */}
          {activeTab === 'profile' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700"
            >
              <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Personal Information</h2>
                <p className="text-sm text-slate-500 mt-1">Update your personal details</p>
              </div>
              
              <div className="p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Full Name (English)
                    </label>
                    <input
                      type="text"
                      value={formData.full_name}
                      onChange={(e) => setFormData(prev => ({ ...prev, full_name: e.target.value }))}
                      className="input-modern"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Full Name (Arabic)
                    </label>
                    <input
                      type="text"
                      value={formData.full_name_ar}
                      onChange={(e) => setFormData(prev => ({ ...prev, full_name_ar: e.target.value }))}
                      className="input-modern text-right"
                      dir="rtl"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Email Address
                    </label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                      className="input-modern"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                      className="input-modern"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Timezone
                    </label>
                    <select
                      value={formData.timezone}
                      onChange={(e) => setFormData(prev => ({ ...prev, timezone: e.target.value }))}
                      className="input-modern"
                    >
                      <option value="Asia/Riyadh">Asia/Riyadh (UTC+3)</option>
                      <option value="Asia/Dubai">Asia/Dubai (UTC+4)</option>
                      <option value="Africa/Cairo">Africa/Cairo (UTC+2)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Language
                    </label>
                    <select
                      value={formData.language}
                      onChange={(e) => setFormData(prev => ({ ...prev, language: e.target.value }))}
                      className="input-modern"
                    >
                      <option value="en">English</option>
                      <option value="ar">العربية (Arabic)</option>
                    </select>
                  </div>
                </div>

                {/* Read-only Info */}
                <div className="pt-6 border-t border-slate-200 dark:border-slate-700">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">Account Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                      <p className="text-sm text-slate-500 mb-1">Employee ID</p>
                      <p className="font-medium text-slate-900 dark:text-white">{userData.employee_id}</p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500 mb-1">Role</p>
                      <p className="font-medium text-slate-900 dark:text-white">{userData.role}</p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500 mb-1">Joined Date</p>
                      <p className="font-medium text-slate-900 dark:text-white">{formatDate(userData.joined_date)}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-200 dark:border-slate-700 flex justify-end">
                <button onClick={handleSave} disabled={isSaving} className="btn-primary">
                  {isSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Save Changes
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          )}

          {/* Security Tab */}
          {activeTab === 'security' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              {/* Change Password */}
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Change Password</h2>
                <div className="space-y-4 max-w-md">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Current Password
                    </label>
                    <input type="password" className="input-modern" placeholder="Enter current password" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      New Password
                    </label>
                    <input type="password" className="input-modern" placeholder="Enter new password" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Confirm New Password
                    </label>
                    <input type="password" className="input-modern" placeholder="Confirm new password" />
                  </div>
                  <button className="btn-primary">
                    <Key className="w-4 h-4" />
                    Update Password
                  </button>
                </div>
              </div>

              {/* Two-Factor Authentication */}
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Two-Factor Authentication</h2>
                    <p className="text-sm text-slate-500 mt-1">Add an extra layer of security to your account</p>
                  </div>
                  <span className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-sm font-medium">
                    Enabled
                  </span>
                </div>
              </div>

              {/* Active Sessions */}
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Active Sessions</h2>
                <div className="space-y-4">
                  {[
                    { device: 'Chrome on Windows', location: 'Riyadh, SA', current: true, time: 'Now' },
                    { device: 'Safari on iPhone', location: 'Riyadh, SA', current: false, time: '2 hours ago' },
                  ].map((session, i) => (
                    <div key={i} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
                          <Globe className="w-5 h-5 text-slate-600" />
                        </div>
                        <div>
                          <p className="font-medium text-slate-900 dark:text-white">{session.device}</p>
                          <p className="text-sm text-slate-500">{session.location} • {session.time}</p>
                        </div>
                      </div>
                      {session.current ? (
                        <span className="text-sm text-emerald-600 font-medium">Current Session</span>
                      ) : (
                        <button className="text-sm text-red-600 hover:text-red-700 font-medium">Revoke</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* Notifications Tab */}
          {activeTab === 'notifications' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6"
            >
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-6">Notification Preferences</h2>
              <div className="space-y-6">
                {[
                  { title: 'Email Notifications', items: [
                    { label: 'New enrollment requests', enabled: true },
                    { label: 'Session reminders', enabled: true },
                    { label: 'System updates', enabled: false },
                  ]},
                  { title: 'Push Notifications', items: [
                    { label: 'Real-time alerts', enabled: true },
                    { label: 'Chat messages', enabled: true },
                  ]},
                ].map(section => (
                  <div key={section.title}>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">{section.title}</h3>
                    <div className="space-y-3">
                      {section.items.map(item => (
                        <div key={item.label} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl">
                          <span className="text-slate-700 dark:text-slate-300">{item.label}</span>
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" defaultChecked={item.enabled} className="sr-only peer" />
                            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-entlaqa-500/20 rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-entlaqa-600"></div>
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Activity Tab */}
          {activeTab === 'activity' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6"
            >
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-6">Recent Activity</h2>
              <div className="space-y-4">
                {userData.recent_activity.map((activity, i) => (
                  <div key={i} className="flex items-start gap-4 p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl">
                    <div className="w-10 h-10 rounded-full bg-entlaqa-100 dark:bg-entlaqa-900/30 flex items-center justify-center">
                      <CheckCircle className="w-5 h-5 text-entlaqa-600" />
                    </div>
                    <div className="flex-1">
                      <p className="text-slate-900 dark:text-white">
                        <span className="font-medium">{activity.action}</span>
                        {' '}
                        <span className="text-entlaqa-600">{activity.target}</span>
                      </p>
                      <p className="text-sm text-slate-500 mt-1">{activity.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
