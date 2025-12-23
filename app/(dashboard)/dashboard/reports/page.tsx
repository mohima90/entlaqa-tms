'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Download,
  Calendar,
  Users,
  GraduationCap,
  Award,
  Clock,
  Target,
  PieChart,
  FileSpreadsheet,
  FileText,
  Filter,
  RefreshCw,
  ChevronDown,
  Building2,
  DollarSign,
  CheckCircle,
  AlertTriangle,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart as RePieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from 'recharts';
import Header from '@/components/layout/Header';
import { SourceDot } from '@/components/shared/SourceBadge';
import { cn, formatCurrency } from '@/lib/utils';

// Sample data for reports
const monthlyTrainingData = [
  { month: 'Jul', sessions: 45, learners: 380, hours: 720, offline: 28, lms: 17 },
  { month: 'Aug', sessions: 52, learners: 420, hours: 832, offline: 32, lms: 20 },
  { month: 'Sep', sessions: 48, learners: 395, hours: 768, offline: 30, lms: 18 },
  { month: 'Oct', sessions: 61, learners: 510, hours: 976, offline: 38, lms: 23 },
  { month: 'Nov', sessions: 58, learners: 485, hours: 928, offline: 35, lms: 23 },
  { month: 'Dec', sessions: 42, learners: 350, hours: 672, offline: 25, lms: 17 },
  { month: 'Jan', sessions: 67, learners: 560, hours: 1072, offline: 42, lms: 25 },
];

const departmentData = [
  { name: 'Information Technology', value: 245, color: '#3b82f6' },
  { name: 'Human Resources', value: 189, color: '#10b981' },
  { name: 'Finance', value: 156, color: '#f59e0b' },
  { name: 'Marketing', value: 134, color: '#8b5cf6' },
  { name: 'Operations', value: 178, color: '#ef4444' },
  { name: 'Sales', value: 142, color: '#06b6d4' },
];

const coursePerformanceData = [
  { course: 'Leadership', enrollments: 156, completions: 142, rate: 91, satisfaction: 4.8 },
  { course: 'Cybersecurity', enrollments: 234, completions: 198, rate: 85, satisfaction: 4.6 },
  { course: 'Data Analysis', enrollments: 189, completions: 167, rate: 88, satisfaction: 4.7 },
  { course: 'Project Mgmt', enrollments: 212, completions: 195, rate: 92, satisfaction: 4.5 },
  { course: 'Communication', enrollments: 178, completions: 165, rate: 93, satisfaction: 4.9 },
];

const complianceData = [
  { category: 'Safety Training', required: 450, completed: 423, rate: 94 },
  { category: 'Code of Conduct', required: 450, completed: 445, rate: 99 },
  { category: 'Data Privacy', required: 380, completed: 342, rate: 90 },
  { category: 'Anti-Harassment', required: 450, completed: 438, rate: 97 },
  { category: 'Cybersecurity', required: 320, completed: 278, rate: 87 },
];

const instructorPerformanceData = [
  { name: 'Dr. Ahmed Hassan', sessions: 45, hours: 360, rating: 4.9, learners: 890 },
  { name: 'Eng. Sara Mohamed', sessions: 38, hours: 304, rating: 4.8, learners: 756 },
  { name: 'Mohamed Ali', sessions: 32, hours: 256, rating: 4.7, learners: 640 },
  { name: 'Fatima Al-Qasim', sessions: 41, hours: 328, rating: 4.9, learners: 820 },
  { name: 'Khalid Al-Mutairi', sessions: 28, hours: 224, rating: 4.6, learners: 560 },
];

const budgetData = [
  { month: 'Jul', budget: 180000, spent: 165000 },
  { month: 'Aug', budget: 180000, spent: 172000 },
  { month: 'Sep', budget: 180000, spent: 158000 },
  { month: 'Oct', budget: 200000, spent: 195000 },
  { month: 'Nov', budget: 200000, spent: 187000 },
  { month: 'Dec', budget: 150000, spent: 142000 },
  { month: 'Jan', budget: 220000, spent: 198000 },
];

const skillsRadarData = [
  { skill: 'Leadership', A: 85, B: 90 },
  { skill: 'Technical', A: 78, B: 85 },
  { skill: 'Communication', A: 92, B: 88 },
  { skill: 'Problem Solving', A: 75, B: 82 },
  { skill: 'Teamwork', A: 88, B: 85 },
  { skill: 'Innovation', A: 70, B: 78 },
];

type ReportType = 'overview' | 'training' | 'compliance' | 'financial' | 'instructors';

const reportTypes = [
  { key: 'overview', label: 'Overview', icon: BarChart3 },
  { key: 'training', label: 'Training Analytics', icon: GraduationCap },
  { key: 'compliance', label: 'Compliance', icon: Target },
  { key: 'financial', label: 'Financial', icon: DollarSign },
  { key: 'instructors', label: 'Instructor Performance', icon: Users },
];

export default function ReportsPage() {
  const [activeReport, setActiveReport] = useState<ReportType>('overview');
  const [dateRange, setDateRange] = useState('last_6_months');

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <Header title="Reports & Analytics" subtitle="Training insights and performance metrics" />

      <div className="p-6 space-y-6">
        {/* Report Type Tabs */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-center gap-2 overflow-x-auto pb-2 lg:pb-0">
            {reportTypes.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveReport(key as ReportType)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all',
                  activeReport === key
                    ? 'bg-entlaqa-600 text-white shadow-lg shadow-entlaqa-500/25'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-entlaqa-500/20"
            >
              <option value="last_month">Last Month</option>
              <option value="last_3_months">Last 3 Months</option>
              <option value="last_6_months">Last 6 Months</option>
              <option value="last_year">Last Year</option>
              <option value="custom">Custom Range</option>
            </select>
            <button className="btn-ghost text-sm">
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
            <button className="btn-primary text-sm">
              <Download className="w-4 h-4" />
              Export Report
            </button>
          </div>
        </div>

        {/* Overview Report */}
        {activeReport === 'overview' && (
          <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {[
                { label: 'Total Sessions', value: '373', change: 12, icon: Calendar, color: 'text-blue-600' },
                { label: 'Learners Trained', value: '3,100', change: 8, icon: Users, color: 'text-emerald-600' },
                { label: 'Training Hours', value: '5,968', change: 15, icon: Clock, color: 'text-purple-600' },
                { label: 'Certificates', value: '2,845', change: 22, icon: Award, color: 'text-amber-600' },
                { label: 'Avg Satisfaction', value: '4.7', change: 3, icon: TrendingUp, color: 'text-pink-600' },
                { label: 'Completion Rate', value: '89%', change: -2, icon: Target, color: 'text-cyan-600' },
              ].map((kpi, i) => (
                <motion.div
                  key={kpi.label}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <kpi.icon className={cn('w-5 h-5', kpi.color)} />
                    <span className={cn(
                      'text-xs font-medium flex items-center gap-0.5',
                      kpi.change >= 0 ? 'text-emerald-600' : 'text-red-600'
                    )}>
                      {kpi.change >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {Math.abs(kpi.change)}%
                    </span>
                  </div>
                  <p className="text-2xl font-bold text-slate-900 dark:text-white">{kpi.value}</p>
                  <p className="text-xs text-slate-500 mt-1">{kpi.label}</p>
                </motion.div>
              ))}
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Training Trend */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6"
              >
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Training Trend</h3>
                    <p className="text-sm text-slate-500">Sessions & learners over time</p>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-entlaqa-500" />Sessions</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-emerald-500" />Learners</span>
                  </div>
                </div>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={monthlyTrainingData}>
                      <defs>
                        <linearGradient id="sessionsGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b99f5" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#3b99f5" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="learnersGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="month" stroke="#94a3b8" fontSize={12} />
                      <YAxis yAxisId="left" stroke="#94a3b8" fontSize={12} />
                      <YAxis yAxisId="right" orientation="right" stroke="#94a3b8" fontSize={12} />
                      <Tooltip />
                      <Area yAxisId="left" type="monotone" dataKey="sessions" stroke="#3b99f5" strokeWidth={2} fill="url(#sessionsGrad)" />
                      <Area yAxisId="right" type="monotone" dataKey="learners" stroke="#10b981" strokeWidth={2} fill="url(#learnersGrad)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </motion.div>

              {/* Department Distribution */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6"
              >
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Training by Department</h3>
                <p className="text-sm text-slate-500 mb-6">Learners distribution across departments</p>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <RePieChart>
                      <Pie
                        data={departmentData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {departmentData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </RePieChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-4">
                  {departmentData.map((dept) => (
                    <div key={dept.name} className="flex items-center gap-2 text-sm">
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: dept.color }} />
                      <span className="text-slate-600 dark:text-slate-400 truncate">{dept.name}</span>
                      <span className="font-medium text-slate-900 dark:text-white ml-auto">{dept.value}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            </div>

            {/* Source Comparison */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6"
            >
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Data Source Comparison</h3>
              <p className="text-sm text-slate-500 mb-6">Offline vs LMS training sessions</p>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyTrainingData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="month" stroke="#94a3b8" fontSize={12} />
                    <YAxis stroke="#94a3b8" fontSize={12} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="offline" name="Offline" fill="#22c55e" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="lms" name="LMS" fill="#a855f7" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </motion.div>

            {/* Course Performance Table */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
            >
              <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Top Performing Courses</h3>
                <p className="text-sm text-slate-500">Based on completion rate and satisfaction</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-slate-900/50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Course</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Enrollments</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Completions</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Rate</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Satisfaction</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {coursePerformanceData.map((course) => (
                      <tr key={course.course} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                        <td className="px-6 py-4 font-medium text-slate-900 dark:text-white">{course.course}</td>
                        <td className="px-6 py-4 text-slate-700 dark:text-slate-300">{course.enrollments}</td>
                        <td className="px-6 py-4 text-slate-700 dark:text-slate-300">{course.completions}</td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${course.rate}%` }} />
                            </div>
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{course.rate}%</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-1">
                            <span className="text-amber-500">★</span>
                            <span className="font-medium text-slate-700 dark:text-slate-300">{course.satisfaction}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          </div>
        )}

        {/* Compliance Report */}
        {activeReport === 'compliance' && (
          <div className="space-y-6">
            {/* Compliance Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-2xl p-6 text-white"
              >
                <CheckCircle className="w-8 h-8 mb-4" />
                <p className="text-4xl font-bold">94%</p>
                <p className="text-emerald-100 mt-1">Overall Compliance Rate</p>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6"
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="text-slate-500">Compliant Learners</span>
                  <CheckCircle className="w-5 h-5 text-emerald-500" />
                </div>
                <p className="text-3xl font-bold text-slate-900 dark:text-white">1,926</p>
                <p className="text-sm text-slate-500 mt-1">of 2,050 required</p>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6"
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="text-slate-500">Overdue Training</span>
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                </div>
                <p className="text-3xl font-bold text-amber-600">124</p>
                <p className="text-sm text-slate-500 mt-1">learners need attention</p>
              </motion.div>
            </div>

            {/* Compliance by Category */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6"
            >
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-6">Compliance by Category</h3>
              <div className="space-y-6">
                {complianceData.map((item) => (
                  <div key={item.category}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-slate-900 dark:text-white">{item.category}</span>
                      <span className={cn(
                        'text-sm font-semibold',
                        item.rate >= 95 ? 'text-emerald-600' : item.rate >= 90 ? 'text-amber-600' : 'text-red-600'
                      )}>
                        {item.rate}%
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex-1 h-3 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all',
                            item.rate >= 95 ? 'bg-emerald-500' : item.rate >= 90 ? 'bg-amber-500' : 'bg-red-500'
                          )}
                          style={{ width: `${item.rate}%` }}
                        />
                      </div>
                      <span className="text-sm text-slate-500 w-24">{item.completed}/{item.required}</span>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        )}

        {/* Financial Report */}
        {activeReport === 'financial' && (
          <div className="space-y-6">
            {/* Financial KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
                <p className="text-sm text-slate-500 mb-2">Total Budget (YTD)</p>
                <p className="text-3xl font-bold text-slate-900 dark:text-white">{formatCurrency(1310000)}</p>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
                <p className="text-sm text-slate-500 mb-2">Total Spent</p>
                <p className="text-3xl font-bold text-emerald-600">{formatCurrency(1217000)}</p>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
                <p className="text-sm text-slate-500 mb-2">Cost per Learner</p>
                <p className="text-3xl font-bold text-slate-900 dark:text-white">{formatCurrency(392)}</p>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
                <p className="text-sm text-slate-500 mb-2">Budget Utilization</p>
                <p className="text-3xl font-bold text-blue-600">93%</p>
              </motion.div>
            </div>

            {/* Budget vs Spent Chart */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6"
            >
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-6">Budget vs Actual Spending</h3>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={budgetData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="month" stroke="#94a3b8" fontSize={12} />
                    <YAxis stroke="#94a3b8" fontSize={12} tickFormatter={(v) => `${v/1000}K`} />
                    <Tooltip formatter={(v: number) => formatCurrency(v)} />
                    <Legend />
                    <Bar dataKey="budget" name="Budget" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="spent" name="Spent" fill="#3b99f5" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </motion.div>
          </div>
        )}

        {/* Instructor Performance Report */}
        {activeReport === 'instructors' && (
          <div className="space-y-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
            >
              <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Instructor Performance</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-slate-900/50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Instructor</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Sessions</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Hours</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Learners</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Rating</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {instructorPerformanceData.map((instructor, i) => (
                      <tr key={instructor.name} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-entlaqa-gradient flex items-center justify-center text-white font-medium text-sm">
                              {instructor.name.split(' ').slice(0, 2).map(n => n[0]).join('')}
                            </div>
                            <span className="font-medium text-slate-900 dark:text-white">{instructor.name}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-slate-700 dark:text-slate-300">{instructor.sessions}</td>
                        <td className="px-6 py-4 text-slate-700 dark:text-slate-300">{instructor.hours}h</td>
                        <td className="px-6 py-4 text-slate-700 dark:text-slate-300">{instructor.learners}</td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-1">
                            <span className="text-amber-500">★</span>
                            <span className="font-medium text-slate-700 dark:text-slate-300">{instructor.rating}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          </div>
        )}

        {/* Training Analytics Report */}
        {activeReport === 'training' && (
          <div className="space-y-6">
            {/* Skills Radar */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6"
              >
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Skills Development</h3>
                <p className="text-sm text-slate-500 mb-6">Pre vs Post Training Assessment</p>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={skillsRadarData}>
                      <PolarGrid stroke="#e2e8f0" />
                      <PolarAngleAxis dataKey="skill" tick={{ fontSize: 12, fill: '#64748b' }} />
                      <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                      <Radar name="Pre-Training" dataKey="A" stroke="#94a3b8" fill="#94a3b8" fillOpacity={0.3} />
                      <Radar name="Post-Training" dataKey="B" stroke="#3b99f5" fill="#3b99f5" fillOpacity={0.3} />
                      <Legend />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6"
              >
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Training Hours Distribution</h3>
                <p className="text-sm text-slate-500 mb-6">Monthly training hours trend</p>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={monthlyTrainingData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="month" stroke="#94a3b8" fontSize={12} />
                      <YAxis stroke="#94a3b8" fontSize={12} />
                      <Tooltip />
                      <Line type="monotone" dataKey="hours" stroke="#3b99f5" strokeWidth={3} dot={{ fill: '#3b99f5', strokeWidth: 2 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </motion.div>
            </div>
          </div>
        )}

        {/* Export Options */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4"
        >
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium text-slate-900 dark:text-white">Export Report</h4>
              <p className="text-sm text-slate-500">Download this report in various formats</p>
            </div>
            <div className="flex items-center gap-2">
              <button className="btn-ghost text-sm">
                <FileSpreadsheet className="w-4 h-4" />
                Excel
              </button>
              <button className="btn-ghost text-sm">
                <FileText className="w-4 h-4" />
                PDF
              </button>
              <button className="btn-primary text-sm">
                <Download className="w-4 h-4" />
                Download All
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
