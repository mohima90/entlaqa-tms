'use client';

import { useState, useEffect } from 'react';
import { BarChart3, Users, BookOpen, Award, Calendar, TrendingUp, Download, Loader2, Building, Clock, FileText, RefreshCw, Filter } from 'lucide-react';
import Header from '@/components/layout/Header';
import { createClient } from '@/lib/supabase';

export default function ReportsPage() {
  const [activeReport, setActiveReport] = useState<'overview' | 'courses' | 'sessions' | 'learners' | 'attendance' | 'instructors'>('overview');
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  
  // Data
  const [courses, setCourses] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [learners, setLearners] = useState<any[]>([]);
  const [instructors, setInstructors] = useState<any[]>([]);
  const [venues, setVenues] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [certificates, setCertificates] = useState<any[]>([]);

  // Filters
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [courseFilter, setCourseFilter] = useState('all');
  const [departmentFilter, setDepartmentFilter] = useState('all');

  const supabase = createClient();

  useEffect(() => { fetchAllData(); }, []);

  const fetchAllData = async () => {
    setIsLoading(true);
    const [coursesRes, sessionsRes, learnersRes, instructorsRes, venuesRes, attendanceRes, certsRes] = await Promise.all([
      supabase.from('courses').select('*').order('created_at', { ascending: false }),
      supabase.from('sessions').select('*').order('start_date', { ascending: false }),
      supabase.from('learners').select('*').order('full_name'),
      supabase.from('instructors').select('*').order('full_name'),
      supabase.from('venues').select('*').order('name'),
      supabase.from('attendance').select('*').order('created_at', { ascending: false }),
      supabase.from('certificates').select('*').order('issue_date', { ascending: false }),
    ]);

    setCourses(coursesRes.data || []);
    setSessions(sessionsRes.data || []);
    setLearners(learnersRes.data || []);
    setInstructors(instructorsRes.data || []);
    setVenues(venuesRes.data || []);
    setAttendance(attendanceRes.data || []);
    setCertificates(certsRes.data || []);
    setIsLoading(false);
  };

  // Filter functions
  const filterByDate = (items: any[], dateField: string) => {
    return items.filter(item => {
      if (!item[dateField]) return true;
      const itemDate = new Date(item[dateField]);
      if (dateFrom && itemDate < new Date(dateFrom)) return false;
      if (dateTo && itemDate > new Date(dateTo)) return false;
      return true;
    });
  };

  const getFilteredCourses = () => {
    let filtered = [...courses];
    filtered = filterByDate(filtered, 'created_at');
    if (statusFilter !== 'all') filtered = filtered.filter(c => c.status === statusFilter);
    return filtered;
  };

  const getFilteredSessions = () => {
    let filtered = [...sessions];
    filtered = filterByDate(filtered, 'start_date');
    if (statusFilter !== 'all') filtered = filtered.filter(s => s.status === statusFilter);
    if (courseFilter !== 'all') filtered = filtered.filter(s => s.course_id === courseFilter);
    return filtered;
  };

  const getFilteredLearners = () => {
    let filtered = [...learners];
    filtered = filterByDate(filtered, 'created_at');
    if (statusFilter !== 'all') filtered = filtered.filter(l => l.status === statusFilter);
    if (departmentFilter !== 'all') filtered = filtered.filter(l => l.department === departmentFilter);
    return filtered;
  };

  const getFilteredAttendance = () => {
    let filtered = [...attendance];
    filtered = filterByDate(filtered, 'created_at');
    if (statusFilter !== 'all') filtered = filtered.filter(a => a.status === statusFilter);
    return filtered;
  };

  const getFilteredInstructors = () => {
    let filtered = [...instructors];
    if (statusFilter !== 'all') filtered = filtered.filter(i => i.status === statusFilter);
    return filtered;
  };

  // Stats calculations
  const stats = {
    totalCourses: courses.length,
    activeCourses: courses.filter(c => c.status === 'active').length,
    totalSessions: sessions.length,
    completedSessions: sessions.filter(s => s.status === 'completed').length,
    totalLearners: learners.length,
    activeLearners: learners.filter(l => l.status === 'active').length,
    totalInstructors: instructors.length,
    totalVenues: venues.length,
    totalAttendance: attendance.length,
    presentCount: attendance.filter(a => a.status === 'present').length,
    absentCount: attendance.filter(a => a.status === 'absent').length,
    totalCertificates: certificates.length,
    attendanceRate: attendance.length > 0 ? Math.round((attendance.filter(a => a.status === 'present').length / attendance.length) * 100) : 0,
  };

  const departments = Array.from(new Set(learners.map(l => l.department).filter(Boolean)));

  // Export functions
  const exportToCSV = (data: any[], filename: string, columns: { key: string; label: string }[]) => {
    setIsExporting(true);
    const header = columns.map(col => col.label).join(',');
    const rows = data.map(item => {
      return columns.map(col => {
        let value = item[col.key] || '';
        if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
          value = `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      }).join(',');
    });
    const csv = [header, ...rows].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setIsExporting(false);
  };

  const exportCurrentReport = () => {
    switch (activeReport) {
      case 'courses':
        exportToCSV(getFilteredCourses(), 'courses-report', [
          { key: 'code', label: 'Code' }, { key: 'name', label: 'Course Name' }, { key: 'name_ar', label: 'Course Name (Arabic)' },
          { key: 'category', label: 'Category' }, { key: 'level', label: 'Level' }, { key: 'delivery_mode', label: 'Delivery Mode' },
          { key: 'duration_hours', label: 'Duration (Hours)' }, { key: 'max_participants', label: 'Max Participants' },
          { key: 'status', label: 'Status' }, { key: 'created_at', label: 'Created Date' },
        ]);
        break;
      case 'sessions':
        const sessionsWithNames = getFilteredSessions().map(s => ({
          ...s,
          course_name: courses.find(c => c.id === s.course_id)?.name || '',
          venue_name: venues.find(v => v.id === s.venue_id)?.name || '',
          instructor_name: instructors.find(i => i.id === s.instructor_id)?.full_name || '',
        }));
        exportToCSV(sessionsWithNames, 'sessions-report', [
          { key: 'title', label: 'Session Title' }, { key: 'course_name', label: 'Course' },
          { key: 'instructor_name', label: 'Instructor' }, { key: 'venue_name', label: 'Venue' },
          { key: 'start_date', label: 'Start Date' }, { key: 'end_date', label: 'End Date' },
          { key: 'start_time', label: 'Start Time' }, { key: 'end_time', label: 'End Time' },
          { key: 'capacity', label: 'Capacity' }, { key: 'status', label: 'Status' },
        ]);
        break;
      case 'learners':
        exportToCSV(getFilteredLearners(), 'learners-report', [
          { key: 'employee_id', label: 'Employee ID' }, { key: 'full_name', label: 'Full Name' },
          { key: 'full_name_ar', label: 'Full Name (Arabic)' }, { key: 'email', label: 'Email' },
          { key: 'phone', label: 'Phone' }, { key: 'department', label: 'Department' },
          { key: 'job_title', label: 'Job Title' }, { key: 'status', label: 'Status' }, { key: 'hire_date', label: 'Hire Date' },
        ]);
        break;
      case 'attendance':
        const attendanceWithNames = getFilteredAttendance().map(a => ({
          ...a,
          learner_name: learners.find(l => l.id === a.learner_id)?.full_name || '',
          learner_employee_id: learners.find(l => l.id === a.learner_id)?.employee_id || '',
          session_title: sessions.find(s => s.id === a.session_id)?.title || '',
          session_date: sessions.find(s => s.id === a.session_id)?.start_date || '',
        }));
        exportToCSV(attendanceWithNames, 'attendance-report', [
          { key: 'learner_employee_id', label: 'Employee ID' }, { key: 'learner_name', label: 'Learner Name' },
          { key: 'session_title', label: 'Session' }, { key: 'session_date', label: 'Session Date' },
          { key: 'status', label: 'Attendance Status' }, { key: 'check_in_time', label: 'Check In Time' },
          { key: 'check_out_time', label: 'Check Out Time' },
        ]);
        break;
      case 'instructors':
        exportToCSV(getFilteredInstructors(), 'instructors-report', [
          { key: 'full_name', label: 'Full Name' }, { key: 'full_name_ar', label: 'Full Name (Arabic)' },
          { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' },
          { key: 'specialization', label: 'Specialization' }, { key: 'hourly_rate', label: 'Hourly Rate' }, { key: 'status', label: 'Status' },
        ]);
        break;
      default:
        const overview = [
          { metric: 'Total Courses', value: stats.totalCourses }, { metric: 'Active Courses', value: stats.activeCourses },
          { metric: 'Total Sessions', value: stats.totalSessions }, { metric: 'Completed Sessions', value: stats.completedSessions },
          { metric: 'Total Learners', value: stats.totalLearners }, { metric: 'Active Learners', value: stats.activeLearners },
          { metric: 'Total Instructors', value: stats.totalInstructors }, { metric: 'Total Venues', value: stats.totalVenues },
          { metric: 'Total Certificates', value: stats.totalCertificates }, { metric: 'Attendance Rate', value: `${stats.attendanceRate}%` },
        ];
        exportToCSV(overview, 'overview-report', [{ key: 'metric', label: 'Metric' }, { key: 'value', label: 'Value' }]);
    }
  };

  const resetFilters = () => {
    setDateFrom('');
    setDateTo('');
    setStatusFilter('all');
    setCourseFilter('all');
    setDepartmentFilter('all');
  };

  const headerActions = (
    <div className="flex items-center gap-2">
      <button 
        onClick={fetchAllData} 
        className="flex items-center gap-2 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl border border-gray-200 transition-colors font-medium"
      >
        <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        <span className="hidden sm:inline">Refresh</span>
      </button>
      <button 
        onClick={exportCurrentReport} 
        disabled={isExporting} 
        className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-sm hover:shadow-md transition-all font-medium disabled:opacity-50"
      >
        <Download className={`w-4 h-4 ${isExporting ? 'animate-pulse' : ''}`} />
        <span>Export CSV</span>
      </button>
    </div>
  );

  const reportTabs = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'courses', label: 'Courses', icon: BookOpen },
    { id: 'sessions', label: 'Sessions', icon: Calendar },
    { id: 'learners', label: 'Learners', icon: Users },
    { id: 'attendance', label: 'Attendance', icon: Clock },
    { id: 'instructors', label: 'Instructors', icon: Award },
  ];

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title="Reports" subtitle="Training analytics and insights" actions={headerActions} />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 text-blue-600 animate-spin" /></div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="Reports" subtitle="Training analytics and insights" actions={headerActions} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Report Tabs */}
        <div className="flex flex-wrap gap-2 mb-6 p-1.5 bg-white rounded-xl border border-gray-200 shadow-sm w-fit">
          {reportTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveReport(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg transition-all font-medium ${
                activeReport === tab.id
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Filter className="w-5 h-5 text-gray-500" />
              <span className="font-semibold text-gray-700">Filters</span>
            </div>
            <button onClick={resetFilters} className="text-sm text-blue-600 hover:text-blue-700 font-medium">Reset All</button>
          </div>
          <div className="flex flex-wrap gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">From Date</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">To Date</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Status</label>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white min-w-[140px]">
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="completed">Completed</option>
                <option value="scheduled">Scheduled</option>
                <option value="present">Present</option>
                <option value="absent">Absent</option>
              </select>
            </div>
            {(activeReport === 'sessions' || activeReport === 'attendance') && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Course</label>
                <select value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)} className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white min-w-[180px]">
                  <option value="all">All Courses</option>
                  {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            {activeReport === 'learners' && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Department</label>
                <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white min-w-[160px]">
                  <option value="all">All Departments</option>
                  {departments.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Overview Report */}
        {activeReport === 'overview' && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center"><BookOpen className="w-6 h-6 text-blue-600" /></div>
                  <div><p className="text-3xl font-bold text-gray-900">{stats.totalCourses}</p><p className="text-sm text-gray-500">Total Courses</p></div>
                </div>
              </div>
              <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center"><Users className="w-6 h-6 text-green-600" /></div>
                  <div><p className="text-3xl font-bold text-gray-900">{stats.totalLearners}</p><p className="text-sm text-gray-500">Total Learners</p></div>
                </div>
              </div>
              <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center"><Calendar className="w-6 h-6 text-purple-600" /></div>
                  <div><p className="text-3xl font-bold text-gray-900">{stats.totalSessions}</p><p className="text-sm text-gray-500">Total Sessions</p></div>
                </div>
              </div>
              <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center"><TrendingUp className="w-6 h-6 text-emerald-600" /></div>
                  <div><p className="text-3xl font-bold text-emerald-600">{stats.attendanceRate}%</p><p className="text-sm text-gray-500">Attendance Rate</p></div>
                </div>
              </div>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
                <h3 className="text-lg font-semibold mb-4">Training Summary</h3>
                <div className="space-y-3">
                  <div className="flex justify-between py-2 border-b border-gray-100"><span className="text-gray-600">Active Courses</span><span className="font-semibold">{stats.activeCourses}</span></div>
                  <div className="flex justify-between py-2 border-b border-gray-100"><span className="text-gray-600">Completed Sessions</span><span className="font-semibold">{stats.completedSessions}</span></div>
                  <div className="flex justify-between py-2 border-b border-gray-100"><span className="text-gray-600">Active Learners</span><span className="font-semibold">{stats.activeLearners}</span></div>
                  <div className="flex justify-between py-2 border-b border-gray-100"><span className="text-gray-600">Total Instructors</span><span className="font-semibold">{stats.totalInstructors}</span></div>
                  <div className="flex justify-between py-2 border-b border-gray-100"><span className="text-gray-600">Total Venues</span><span className="font-semibold">{stats.totalVenues}</span></div>
                  <div className="flex justify-between py-2"><span className="text-gray-600">Certificates Issued</span><span className="font-semibold">{stats.totalCertificates}</span></div>
                </div>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
                <h3 className="text-lg font-semibold mb-4">Attendance Breakdown</h3>
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between mb-1"><span className="text-gray-600">Present</span><span className="font-semibold text-green-600">{stats.presentCount}</span></div>
                    <div className="w-full bg-gray-100 rounded-full h-3"><div className="bg-green-500 h-3 rounded-full transition-all" style={{ width: `${stats.totalAttendance > 0 ? (stats.presentCount / stats.totalAttendance) * 100 : 0}%` }}></div></div>
                  </div>
                  <div>
                    <div className="flex justify-between mb-1"><span className="text-gray-600">Absent</span><span className="font-semibold text-red-600">{stats.absentCount}</span></div>
                    <div className="w-full bg-gray-100 rounded-full h-3"><div className="bg-red-500 h-3 rounded-full transition-all" style={{ width: `${stats.totalAttendance > 0 ? (stats.absentCount / stats.totalAttendance) * 100 : 0}%` }}></div></div>
                  </div>
                  <div>
                    <div className="flex justify-between mb-1"><span className="text-gray-600">Late</span><span className="font-semibold text-amber-600">{attendance.filter(a => a.status === 'late').length}</span></div>
                    <div className="w-full bg-gray-100 rounded-full h-3"><div className="bg-amber-500 h-3 rounded-full transition-all" style={{ width: `${stats.totalAttendance > 0 ? (attendance.filter(a => a.status === 'late').length / stats.totalAttendance) * 100 : 0}%` }}></div></div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Courses Report */}
        {activeReport === 'courses' && (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
            <div className="p-4 border-b border-gray-100 bg-gray-50/50"><span className="font-semibold text-gray-700">{getFilteredCourses().length} courses found</span></div>
            <table className="w-full">
              <thead className="bg-gray-50/80 border-b border-gray-100">
                <tr>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Code</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Course Name</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Category</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Level</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Duration</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {getFilteredCourses().map(course => (
                  <tr key={course.id} className="hover:bg-gray-50/50">
                    <td className="px-5 py-4 font-mono text-sm text-gray-600">{course.code}</td>
                    <td className="px-5 py-4 font-medium text-gray-900">{course.name}</td>
                    <td className="px-5 py-4 text-gray-600">{course.category || '-'}</td>
                    <td className="px-5 py-4"><span className="px-2.5 py-1 bg-blue-100 text-blue-700 rounded-lg text-xs font-medium">{course.level}</span></td>
                    <td className="px-5 py-4 text-gray-600">{course.duration_hours}h</td>
                    <td className="px-5 py-4"><span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${course.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{course.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Sessions Report */}
        {activeReport === 'sessions' && (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
            <div className="p-4 border-b border-gray-100 bg-gray-50/50"><span className="font-semibold text-gray-700">{getFilteredSessions().length} sessions found</span></div>
            <table className="w-full">
              <thead className="bg-gray-50/80 border-b border-gray-100">
                <tr>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Session</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Course</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Instructor</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Date</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Venue</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {getFilteredSessions().map(session => (
                  <tr key={session.id} className="hover:bg-gray-50/50">
                    <td className="px-5 py-4 font-medium text-gray-900">{session.title}</td>
                    <td className="px-5 py-4 text-gray-600">{courses.find(c => c.id === session.course_id)?.name || '-'}</td>
                    <td className="px-5 py-4 text-gray-600">{instructors.find(i => i.id === session.instructor_id)?.full_name || '-'}</td>
                    <td className="px-5 py-4 text-gray-600">{session.start_date || '-'}</td>
                    <td className="px-5 py-4 text-gray-600">{venues.find(v => v.id === session.venue_id)?.name || '-'}</td>
                    <td className="px-5 py-4"><span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${session.status === 'completed' ? 'bg-green-100 text-green-700' : session.status === 'scheduled' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{session.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Learners Report */}
        {activeReport === 'learners' && (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
            <div className="p-4 border-b border-gray-100 bg-gray-50/50"><span className="font-semibold text-gray-700">{getFilteredLearners().length} learners found</span></div>
            <table className="w-full">
              <thead className="bg-gray-50/80 border-b border-gray-100">
                <tr>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Employee ID</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Name</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Email</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Department</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Job Title</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {getFilteredLearners().map(learner => (
                  <tr key={learner.id} className="hover:bg-gray-50/50">
                    <td className="px-5 py-4 font-mono text-sm text-gray-600">{learner.employee_id || '-'}</td>
                    <td className="px-5 py-4 font-medium text-gray-900">{learner.full_name}</td>
                    <td className="px-5 py-4 text-gray-600">{learner.email || '-'}</td>
                    <td className="px-5 py-4 text-gray-600">{learner.department || '-'}</td>
                    <td className="px-5 py-4 text-gray-600">{learner.job_title || '-'}</td>
                    <td className="px-5 py-4"><span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${learner.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{learner.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Attendance Report */}
        {activeReport === 'attendance' && (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
            <div className="p-4 border-b border-gray-100 bg-gray-50/50"><span className="font-semibold text-gray-700">{getFilteredAttendance().length} attendance records found</span></div>
            <table className="w-full">
              <thead className="bg-gray-50/80 border-b border-gray-100">
                <tr>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Learner</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Employee ID</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Session</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Check In</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {getFilteredAttendance().map(record => {
                  const learner = learners.find(l => l.id === record.learner_id);
                  const session = sessions.find(s => s.id === record.session_id);
                  return (
                    <tr key={record.id} className="hover:bg-gray-50/50">
                      <td className="px-5 py-4 font-medium text-gray-900">{learner?.full_name || 'Unknown'}</td>
                      <td className="px-5 py-4 font-mono text-sm text-gray-600">{learner?.employee_id || '-'}</td>
                      <td className="px-5 py-4 text-gray-600">{session?.title || 'Unknown'}</td>
                      <td className="px-5 py-4 text-gray-600">{record.check_in_time ? new Date(record.check_in_time).toLocaleString() : '-'}</td>
                      <td className="px-5 py-4"><span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${record.status === 'present' ? 'bg-green-100 text-green-700' : record.status === 'absent' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{record.status}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Instructors Report */}
        {activeReport === 'instructors' && (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
            <div className="p-4 border-b border-gray-100 bg-gray-50/50"><span className="font-semibold text-gray-700">{getFilteredInstructors().length} instructors found</span></div>
            <table className="w-full">
              <thead className="bg-gray-50/80 border-b border-gray-100">
                <tr>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Name</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Email</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Phone</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Specialization</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Rate</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {getFilteredInstructors().map(instructor => (
                  <tr key={instructor.id} className="hover:bg-gray-50/50">
                    <td className="px-5 py-4 font-medium text-gray-900">{instructor.full_name}</td>
                    <td className="px-5 py-4 text-gray-600">{instructor.email || '-'}</td>
                    <td className="px-5 py-4 text-gray-600">{instructor.phone || '-'}</td>
                    <td className="px-5 py-4 text-gray-600">{instructor.specialization || '-'}</td>
                    <td className="px-5 py-4 text-gray-600">{instructor.hourly_rate ? `$${instructor.hourly_rate}/hr` : '-'}</td>
                    <td className="px-5 py-4"><span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${instructor.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{instructor.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
