'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  X,
  Calendar,
  Clock,
  MapPin,
  Users,
  DollarSign,
  FileText,
  Save,
  Loader2,
} from 'lucide-react';
import Modal from './Modal';
import { cn } from '@/lib/utils';

interface SessionFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: SessionFormData) => void;
  initialData?: Partial<SessionFormData>;
  courses: { id: string; name: string; code: string }[];
  venues: { id: string; name: string; rooms: { id: string; name: string }[] }[];
  instructors: { id: string; name: string }[];
}

export interface SessionFormData {
  course_id: string;
  title: string;
  description: string;
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  venue_id: string;
  room_id: string;
  instructor_id: string;
  delivery_mode: 'ilt' | 'vilt' | 'blended';
  capacity: number;
  cost_per_learner: number;
  registration_deadline: string;
  status: 'draft' | 'scheduled' | 'open';
}

const deliveryModes = [
  { value: 'ilt', label: 'In-Person (ILT)', description: 'Face-to-face classroom training' },
  { value: 'vilt', label: 'Virtual (VILT)', description: 'Online live training session' },
  { value: 'blended', label: 'Blended', description: 'Combination of in-person and virtual' },
];

export default function SessionFormModal({
  isOpen,
  onClose,
  onSubmit,
  initialData,
  courses,
  venues,
  instructors,
}: SessionFormModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeStep, setActiveStep] = useState(1);
  const [formData, setFormData] = useState<Partial<SessionFormData>>({
    delivery_mode: 'ilt',
    status: 'draft',
    capacity: 25,
    ...initialData,
  });

  const selectedVenue = venues.find(v => v.id === formData.venue_id);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    onSubmit(formData as SessionFormData);
    setIsSubmitting(false);
    onClose();
  };

  const updateField = (field: keyof SessionFormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const steps = [
    { number: 1, title: 'Basic Info' },
    { number: 2, title: 'Schedule' },
    { number: 3, title: 'Settings' },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={initialData?.title ? 'Edit Session' : 'Create New Session'}
      description="Fill in the details to create a training session"
      size="lg"
      footer={
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {activeStep > 1 && (
              <button onClick={() => setActiveStep(s => s - 1)} className="btn-ghost">
                Previous
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="btn-ghost">
              Cancel
            </button>
            {activeStep < 3 ? (
              <button onClick={() => setActiveStep(s => s + 1)} className="btn-primary">
                Next
              </button>
            ) : (
              <button onClick={handleSubmit} disabled={isSubmitting} className="btn-primary">
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Create Session
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      }
    >
      {/* Progress Steps */}
      <div className="flex items-center justify-between mb-8">
        {steps.map((step, i) => (
          <div key={step.number} className="flex items-center">
            <div className={cn(
              'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors',
              activeStep >= step.number
                ? 'bg-entlaqa-600 text-white'
                : 'bg-slate-200 dark:bg-slate-700 text-slate-500'
            )}>
              {step.number}
            </div>
            <span className={cn(
              'ml-2 text-sm font-medium',
              activeStep >= step.number ? 'text-slate-900 dark:text-white' : 'text-slate-500'
            )}>
              {step.title}
            </span>
            {i < steps.length - 1 && (
              <div className={cn(
                'w-12 h-0.5 mx-4',
                activeStep > step.number ? 'bg-entlaqa-600' : 'bg-slate-200 dark:bg-slate-700'
              )} />
            )}
          </div>
        ))}
      </div>

      {/* Step 1: Basic Info */}
      {activeStep === 1 && (
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="space-y-6"
        >
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Course <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.course_id || ''}
              onChange={(e) => updateField('course_id', e.target.value)}
              className="input-modern"
            >
              <option value="">Select a course</option>
              {courses.map(course => (
                <option key={course.id} value={course.id}>
                  {course.code} - {course.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Session Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.title || ''}
              onChange={(e) => updateField('title', e.target.value)}
              placeholder="e.g., Leadership Excellence - Batch 12"
              className="input-modern"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Description
            </label>
            <textarea
              rows={4}
              value={formData.description || ''}
              onChange={(e) => updateField('description', e.target.value)}
              placeholder="Provide a brief description of this session..."
              className="input-modern"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
              Delivery Mode <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-3 gap-3">
              {deliveryModes.map(mode => (
                <button
                  key={mode.value}
                  type="button"
                  onClick={() => updateField('delivery_mode', mode.value)}
                  className={cn(
                    'p-4 rounded-xl border-2 text-left transition-all',
                    formData.delivery_mode === mode.value
                      ? 'border-entlaqa-600 bg-entlaqa-50 dark:bg-entlaqa-950/30'
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
                  )}
                >
                  <p className="font-medium text-slate-900 dark:text-white">{mode.label}</p>
                  <p className="text-xs text-slate-500 mt-1">{mode.description}</p>
                </button>
              ))}
            </div>
          </div>
        </motion.div>
      )}

      {/* Step 2: Schedule */}
      {activeStep === 2 && (
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="space-y-6"
        >
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Start Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={formData.start_date || ''}
                onChange={(e) => updateField('start_date', e.target.value)}
                className="input-modern"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                End Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={formData.end_date || ''}
                onChange={(e) => updateField('end_date', e.target.value)}
                className="input-modern"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Start Time <span className="text-red-500">*</span>
              </label>
              <input
                type="time"
                value={formData.start_time || ''}
                onChange={(e) => updateField('start_time', e.target.value)}
                className="input-modern"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                End Time <span className="text-red-500">*</span>
              </label>
              <input
                type="time"
                value={formData.end_time || ''}
                onChange={(e) => updateField('end_time', e.target.value)}
                className="input-modern"
              />
            </div>
          </div>

          {formData.delivery_mode !== 'vilt' && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Venue <span className="text-red-500">*</span>
                </label>
                <select
                  value={formData.venue_id || ''}
                  onChange={(e) => {
                    updateField('venue_id', e.target.value);
                    updateField('room_id', '');
                  }}
                  className="input-modern"
                >
                  <option value="">Select a venue</option>
                  {venues.map(venue => (
                    <option key={venue.id} value={venue.id}>{venue.name}</option>
                  ))}
                </select>
              </div>

              {selectedVenue && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Room <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={formData.room_id || ''}
                    onChange={(e) => updateField('room_id', e.target.value)}
                    className="input-modern"
                  >
                    <option value="">Select a room</option>
                    {selectedVenue.rooms.map(room => (
                      <option key={room.id} value={room.id}>{room.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Instructor <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.instructor_id || ''}
              onChange={(e) => updateField('instructor_id', e.target.value)}
              className="input-modern"
            >
              <option value="">Select an instructor</option>
              {instructors.map(instructor => (
                <option key={instructor.id} value={instructor.id}>{instructor.name}</option>
              ))}
            </select>
          </div>
        </motion.div>
      )}

      {/* Step 3: Settings */}
      {activeStep === 3 && (
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="space-y-6"
        >
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Maximum Capacity <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min="1"
                value={formData.capacity || ''}
                onChange={(e) => updateField('capacity', parseInt(e.target.value))}
                className="input-modern"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Cost per Learner (SAR)
              </label>
              <input
                type="number"
                min="0"
                value={formData.cost_per_learner || ''}
                onChange={(e) => updateField('cost_per_learner', parseInt(e.target.value))}
                className="input-modern"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Registration Deadline
            </label>
            <input
              type="date"
              value={formData.registration_deadline || ''}
              onChange={(e) => updateField('registration_deadline', e.target.value)}
              className="input-modern"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Initial Status
            </label>
            <select
              value={formData.status || 'draft'}
              onChange={(e) => updateField('status', e.target.value)}
              className="input-modern"
            >
              <option value="draft">Draft - Not visible to learners</option>
              <option value="scheduled">Scheduled - Visible but not open for enrollment</option>
              <option value="open">Open - Accepting enrollments</option>
            </select>
          </div>

          {/* Summary */}
          <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl">
            <h3 className="font-medium text-slate-900 dark:text-white mb-3">Session Summary</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Title:</span>
                <span className="font-medium text-slate-900 dark:text-white">{formData.title || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Date:</span>
                <span className="font-medium text-slate-900 dark:text-white">
                  {formData.start_date || '—'} {formData.end_date && formData.start_date !== formData.end_date ? `to ${formData.end_date}` : ''}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Time:</span>
                <span className="font-medium text-slate-900 dark:text-white">
                  {formData.start_time || '—'} - {formData.end_time || '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Capacity:</span>
                <span className="font-medium text-slate-900 dark:text-white">{formData.capacity || '—'}</span>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </Modal>
  );
}
