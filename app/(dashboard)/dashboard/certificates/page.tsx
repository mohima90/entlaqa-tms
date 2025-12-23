'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Award,
  Download,
  Eye,
  Copy,
  Search,
  Calendar,
  CheckCircle,
  XCircle,
  Clock,
  FileText,
  QrCode,
  Printer,
  Mail,
  Filter,
  Plus,
  ExternalLink,
  Shield,
} from 'lucide-react';
import Header from '@/components/layout/Header';
import DataTable, { Column } from '@/components/ui/DataTable';
import { SourceDot, SourceFilter } from '@/components/shared/SourceBadge';
import { cn, formatDate } from '@/lib/utils';

interface Certificate {
  id: string;
  certificate_number: string;
  learner_name: string;
  learner_email: string;
  course_name: string;
  course_code: string;
  session_title: string;
  issue_date: string;
  expiry_date: string | null;
  status: 'issued' | 'revoked' | 'expired';
  verification_code: string;
  template_name: string;
  issued_by: string;
  data_source: 'offline' | 'lms';
}

interface CertificateTemplate {
  id: string;
  name: string;
  type: 'completion' | 'participation' | 'achievement' | 'professional';
  preview_url: string;
  is_default: boolean;
  usage_count: number;
}

const sampleCertificates: Certificate[] = [
  {
    id: '1',
    certificate_number: 'CERT-2025-001234',
    learner_name: 'Ahmed Ibrahim Al-Rashid',
    learner_email: 'ahmed@company.com',
    course_name: 'Leadership Excellence Program',
    course_code: 'LEAD-101',
    session_title: 'Leadership Excellence - Batch 12',
    issue_date: '2025-01-15',
    expiry_date: '2028-01-15',
    status: 'issued',
    verification_code: 'VRF-7X9K2M',
    template_name: 'Professional Completion',
    issued_by: 'Dr. Ahmed Hassan',
    data_source: 'offline',
  },
  {
    id: '2',
    certificate_number: 'CERT-2025-001235',
    learner_name: 'Sara Mohamed Al-Zahrani',
    learner_email: 'sara@company.com',
    course_name: 'Cybersecurity Fundamentals',
    course_code: 'CYBER-201',
    session_title: 'Cybersecurity Fundamentals - Jan 2025',
    issue_date: '2025-01-14',
    expiry_date: '2026-01-14',
    status: 'issued',
    verification_code: 'VRF-8Y0L3N',
    template_name: 'Technical Certification',
    issued_by: 'Eng. Sara Mohamed',
    data_source: 'lms',
  },
  {
    id: '3',
    certificate_number: 'CERT-2024-009876',
    learner_name: 'Omar Khalid Hassan',
    learner_email: 'omar@company.com',
    course_name: 'Project Management Essentials',
    course_code: 'PM-101',
    session_title: 'PM Essentials - Q4 2024',
    issue_date: '2024-12-20',
    expiry_date: null,
    status: 'issued',
    verification_code: 'VRF-5W7J1P',
    template_name: 'Standard Completion',
    issued_by: 'Khalid Al-Mutairi',
    data_source: 'offline',
  },
  {
    id: '4',
    certificate_number: 'CERT-2024-008765',
    learner_name: 'Fatima Abdullah Al-Qasim',
    learner_email: 'fatima@company.com',
    course_name: 'Data Analysis with Excel',
    course_code: 'DATA-301',
    session_title: 'Data Analysis Workshop',
    issue_date: '2024-11-15',
    expiry_date: '2024-11-15',
    status: 'expired',
    verification_code: 'VRF-3T5H9Q',
    template_name: 'Workshop Certificate',
    issued_by: 'Mohamed Ali',
    data_source: 'lms',
  },
  {
    id: '5',
    certificate_number: 'CERT-2024-007654',
    learner_name: 'Mohammed Ali Al-Farsi',
    learner_email: 'mohammed@company.com',
    course_name: 'Business Communication Skills',
    course_code: 'COMM-102',
    session_title: 'Communication Skills - Nov 2024',
    issue_date: '2024-11-10',
    expiry_date: null,
    status: 'revoked',
    verification_code: 'VRF-9U1K4R',
    template_name: 'Soft Skills Certificate',
    issued_by: 'Fatima Al-Qasim',
    data_source: 'offline',
  },
  {
    id: '6',
    certificate_number: 'CERT-2025-001236',
    learner_name: 'Noura Salim Al-Otaibi',
    learner_email: 'noura@company.com',
    course_name: 'Digital Marketing Masterclass',
    course_code: 'DIGI-401',
    session_title: 'Digital Marketing Bootcamp',
    issue_date: '2025-01-12',
    expiry_date: '2027-01-12',
    status: 'issued',
    verification_code: 'VRF-2V6I8S',
    template_name: 'Professional Completion',
    issued_by: 'Noura Ibrahim',
    data_source: 'lms',
  },
];

const sampleTemplates: CertificateTemplate[] = [
  { id: '1', name: 'Professional Completion', type: 'completion', preview_url: '#', is_default: true, usage_count: 324 },
  { id: '2', name: 'Technical Certification', type: 'professional', preview_url: '#', is_default: false, usage_count: 156 },
  { id: '3', name: 'Workshop Certificate', type: 'participation', preview_url: '#', is_default: false, usage_count: 89 },
  { id: '4', name: 'Soft Skills Certificate', type: 'completion', preview_url: '#', is_default: false, usage_count: 67 },
  { id: '5', name: 'Achievement Award', type: 'achievement', preview_url: '#', is_default: false, usage_count: 23 },
];

const statusConfig = {
  issued: { label: 'Issued', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', icon: CheckCircle },
  revoked: { label: 'Revoked', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', icon: XCircle },
  expired: { label: 'Expired', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', icon: Clock },
};

const templateTypeConfig = {
  completion: { label: 'Completion', color: 'bg-blue-100 text-blue-700' },
  participation: { label: 'Participation', color: 'bg-purple-100 text-purple-700' },
  achievement: { label: 'Achievement', color: 'bg-amber-100 text-amber-700' },
  professional: { label: 'Professional', color: 'bg-emerald-100 text-emerald-700' },
};

export default function CertificatesPage() {
  const [certificates] = useState<Certificate[]>(sampleCertificates);
  const [templates] = useState<CertificateTemplate[]>(sampleTemplates);
  const [activeTab, setActiveTab] = useState<'certificates' | 'templates' | 'verify'>('certificates');
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationResult, setVerificationResult] = useState<Certificate | null | 'not_found'>(null);

  const handleVerify = () => {
    const found = certificates.find(c => c.verification_code === verificationCode.toUpperCase());
    setVerificationResult(found || 'not_found');
  };

  const columns: Column<Certificate>[] = [
    {
      key: 'certificate_number',
      header: 'Certificate',
      sortable: true,
      render: (cert) => (
        <div className="flex items-center gap-3">
          <div className={cn(
            'w-10 h-10 rounded-xl flex items-center justify-center',
            cert.status === 'issued' ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-slate-100 dark:bg-slate-700'
          )}>
            <Award className={cn('w-5 h-5', cert.status === 'issued' ? 'text-emerald-600' : 'text-slate-400')} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-medium text-slate-900 dark:text-white">{cert.certificate_number}</span>
              <SourceDot source={cert.data_source} size="sm" />
            </div>
            <p className="text-xs text-slate-500">{cert.verification_code}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'learner_name',
      header: 'Learner',
      sortable: true,
      render: (cert) => (
        <div>
          <p className="font-medium text-slate-900 dark:text-white">{cert.learner_name}</p>
          <p className="text-xs text-slate-500">{cert.learner_email}</p>
        </div>
      ),
    },
    {
      key: 'course_name',
      header: 'Course',
      sortable: true,
      render: (cert) => (
        <div>
          <p className="text-slate-700 dark:text-slate-300">{cert.course_name}</p>
          <p className="text-xs text-slate-500">{cert.course_code}</p>
        </div>
      ),
    },
    {
      key: 'issue_date',
      header: 'Issue Date',
      sortable: true,
      render: (cert) => (
        <span className="text-slate-700 dark:text-slate-300">{formatDate(cert.issue_date)}</span>
      ),
    },
    {
      key: 'expiry_date',
      header: 'Expiry',
      sortable: true,
      render: (cert) => (
        <span className={cn(
          'text-slate-700 dark:text-slate-300',
          cert.expiry_date && new Date(cert.expiry_date) < new Date() && 'text-red-600'
        )}>
          {cert.expiry_date ? formatDate(cert.expiry_date) : 'Never'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (cert) => {
        const config = statusConfig[cert.status];
        const Icon = config.icon;
        return (
          <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium', config.color)}>
            <Icon className="w-3 h-3" />
            {config.label}
          </span>
        );
      },
    },
  ];

  const stats = {
    total: certificates.length,
    issued: certificates.filter(c => c.status === 'issued').length,
    expired: certificates.filter(c => c.status === 'expired').length,
    revoked: certificates.filter(c => c.status === 'revoked').length,
    thisMonth: certificates.filter(c => new Date(c.issue_date).getMonth() === new Date().getMonth()).length,
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <Header title="Certificates" subtitle="Issue and manage training certificates" />

      <div className="p-6 space-y-6">
        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <div className="flex items-center gap-2">
              <Award className="w-5 h-5 text-entlaqa-600" />
              <span className="text-2xl font-bold text-slate-900 dark:text-white">{stats.total}</span>
            </div>
            <p className="text-sm text-slate-500 mt-1">Total Certificates</p>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-600" />
              <span className="text-2xl font-bold text-emerald-600">{stats.issued}</span>
            </div>
            <p className="text-sm text-slate-500 mt-1">Active</p>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-amber-600" />
              <span className="text-2xl font-bold text-amber-600">{stats.expired}</span>
            </div>
            <p className="text-sm text-slate-500 mt-1">Expired</p>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <div className="flex items-center gap-2">
              <XCircle className="w-5 h-5 text-red-600" />
              <span className="text-2xl font-bold text-red-600">{stats.revoked}</span>
            </div>
            <p className="text-sm text-slate-500 mt-1">Revoked</p>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-gradient-to-br from-entlaqa-500 to-entlaqa-600 rounded-xl p-4 text-white">
            <div className="text-2xl font-bold">{stats.thisMonth}</div>
            <p className="text-sm text-white/80 mt-1">This Month</p>
          </motion.div>
        </div>

        {/* Tabs */}
        <div className="flex items-center justify-between">
          <div className="inline-flex items-center p-1 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
            {[
              { key: 'certificates', label: 'Certificates', icon: Award },
              { key: 'templates', label: 'Templates', icon: FileText },
              { key: 'verify', label: 'Verify', icon: Shield },
            ].map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key as any)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
                  activeTab === key
                    ? 'bg-entlaqa-600 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>

          {activeTab === 'certificates' && (
            <div className="flex items-center gap-2">
              <button className="btn-ghost text-sm">
                <Download className="w-4 h-4" />
                Export
              </button>
              <button className="btn-primary text-sm">
                <Plus className="w-4 h-4" />
                Issue Certificate
              </button>
            </div>
          )}
        </div>

        {/* Certificates Tab */}
        {activeTab === 'certificates' && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <DataTable
              data={certificates}
              columns={columns}
              searchable
              searchPlaceholder="Search by name, course, or certificate number..."
              searchKeys={['certificate_number', 'learner_name', 'course_name', 'verification_code']}
              showSourceFilter
              getSourceFn={(c) => c.data_source}
              actions={[
                { label: 'View', icon: <Eye className="w-4 h-4" />, onClick: (c) => console.log('View', c) },
                { label: 'Download PDF', icon: <Download className="w-4 h-4" />, onClick: (c) => console.log('Download', c) },
                { label: 'Send Email', icon: <Mail className="w-4 h-4" />, onClick: (c) => console.log('Email', c) },
                { label: 'Copy Link', icon: <Copy className="w-4 h-4" />, onClick: (c) => console.log('Copy', c) },
              ]}
            />
          </motion.div>
        )}

        {/* Templates Tab */}
        {activeTab === 'templates' && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {templates.map((template) => (
              <div
                key={template.id}
                className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden hover:shadow-lg transition-shadow"
              >
                {/* Preview */}
                <div className="aspect-[1.414/1] bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-700 dark:to-slate-800 flex items-center justify-center relative">
                  <Award className="w-16 h-16 text-slate-300 dark:text-slate-600" />
                  {template.is_default && (
                    <span className="absolute top-3 right-3 px-2 py-1 bg-entlaqa-600 text-white text-xs font-medium rounded">
                      Default
                    </span>
                  )}
                </div>

                {/* Info */}
                <div className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-slate-900 dark:text-white">{template.name}</h3>
                    <span className={cn('px-2 py-0.5 rounded text-xs font-medium', templateTypeConfig[template.type].color)}>
                      {templateTypeConfig[template.type].label}
                    </span>
                  </div>
                  <p className="text-sm text-slate-500">Used {template.usage_count} times</p>
                </div>

                {/* Actions */}
                <div className="px-4 py-3 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-700 flex gap-2">
                  <button className="flex-1 btn-ghost text-sm py-2">
                    <Eye className="w-4 h-4" />
                    Preview
                  </button>
                  <button className="flex-1 btn-ghost text-sm py-2">
                    <Copy className="w-4 h-4" />
                    Duplicate
                  </button>
                </div>
              </div>
            ))}

            {/* Add Template Card */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 flex items-center justify-center min-h-[300px] cursor-pointer hover:border-entlaqa-500 hover:bg-entlaqa-50/50 dark:hover:bg-entlaqa-950/20 transition-all">
              <div className="text-center">
                <Plus className="w-10 h-10 text-slate-400 mx-auto mb-2" />
                <p className="text-slate-500 font-medium">Create New Template</p>
              </div>
            </div>
          </motion.div>
        )}

        {/* Verify Tab */}
        {activeTab === 'verify' && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl mx-auto">
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-8">
              <div className="text-center mb-8">
                <div className="w-16 h-16 rounded-full bg-entlaqa-100 dark:bg-entlaqa-900/30 flex items-center justify-center mx-auto mb-4">
                  <Shield className="w-8 h-8 text-entlaqa-600" />
                </div>
                <h2 className="text-2xl font-display font-bold text-slate-900 dark:text-white">Verify Certificate</h2>
                <p className="text-slate-500 mt-2">Enter the verification code to validate a certificate</p>
              </div>

              <div className="space-y-4">
                <div className="relative">
                  <input
                    type="text"
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value.toUpperCase())}
                    placeholder="Enter verification code (e.g., VRF-7X9K2M)"
                    className="input-modern text-center text-lg font-mono tracking-wider"
                  />
                </div>
                <button onClick={handleVerify} className="w-full btn-primary py-3">
                  <Search className="w-5 h-5" />
                  Verify Certificate
                </button>
              </div>

              {/* Verification Result */}
              {verificationResult && verificationResult !== 'not_found' && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-8 p-6 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl"
                >
                  <div className="flex items-center gap-3 mb-4">
                    <CheckCircle className="w-6 h-6 text-emerald-600" />
                    <span className="text-lg font-semibold text-emerald-700 dark:text-emerald-400">Certificate Verified</span>
                  </div>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Certificate Number:</span>
                      <span className="font-mono font-medium text-slate-900 dark:text-white">{verificationResult.certificate_number}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Learner Name:</span>
                      <span className="font-medium text-slate-900 dark:text-white">{verificationResult.learner_name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Course:</span>
                      <span className="font-medium text-slate-900 dark:text-white">{verificationResult.course_name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Issue Date:</span>
                      <span className="font-medium text-slate-900 dark:text-white">{formatDate(verificationResult.issue_date)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Status:</span>
                      <span className={cn('font-medium', statusConfig[verificationResult.status].color.replace('bg-', 'text-').split(' ')[0])}>
                        {statusConfig[verificationResult.status].label}
                      </span>
                    </div>
                  </div>
                </motion.div>
              )}

              {verificationResult === 'not_found' && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-8 p-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl"
                >
                  <div className="flex items-center gap-3">
                    <XCircle className="w-6 h-6 text-red-600" />
                    <div>
                      <span className="text-lg font-semibold text-red-700 dark:text-red-400">Certificate Not Found</span>
                      <p className="text-sm text-red-600 dark:text-red-400 mt-1">The verification code does not match any certificate in our system.</p>
                    </div>
                  </div>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
