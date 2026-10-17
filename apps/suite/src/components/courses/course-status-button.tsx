'use client';
import { Alert, Button, Dialog, Icon, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { setCourseStatusAction } from '../../actions/courses';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';

export interface CourseStatusButtonProps {
  readonly id: string;
  readonly version: number;
  readonly code: string;
  /** The course title in the page's language (for the confirmation). */
  readonly title: string;
  /** `archive` an active course or `restore` an archived one. */
  readonly action: 'archive' | 'restore';
  readonly preview: boolean;
  /** The `courses` messages, raw, by dotted key. */
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
}

/**
 * Archive or restore a course (T-M3-03; tms.course.archive — the L&D Manager), after a confirmation. A
 * course is never deleted: archived courses stay in the history and can be restored.
 */
export function CourseStatusButton(props: CourseStatusButtonProps) {
  const { texts } = props;
  const text = (key: string) =>
    (texts[key] ?? key).replaceAll('{code}', props.code).replaceAll('{title}', props.title);
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null);
  const archive = props.action === 'archive';

  function confirm() {
    setMessage(null);
    if (props.preview) {
      setMessage({ tone: 'info', text: text('previewNotSaved') });
      return;
    }
    startTransition(async () => {
      const result = await setCourseStatusAction({
        id: props.id,
        version: props.version,
        status: archive ? 'archived' : 'active',
      });
      if (result.ok) {
        toast.success(archive ? text('archived') : text('restored'));
        setOpen(false);
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
      if (result.error.code === 'CONFLICT_VERSION') {
        setMessage({ tone: 'danger', text: text('conflict') });
      } else if (result.error.code === 'NOT_FOUND') {
        setMessage({ tone: 'danger', text: text('notFound') });
      } else {
        setMessage({ tone: 'danger', text: errorText(result.error, props.errors) });
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setMessage(null);
          setOpen(true);
        }}
        className="grid size-9 place-items-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text pointer-coarse:size-11"
        aria-label={archive ? text('archiveCourse') : text('restoreCourse')}
        data-testid={`course-${props.action}-${props.code}`}
      >
        <Icon name={archive ? 'archive' : 'archive-restore'} />
      </button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title={archive ? text('archiveTitle') : text('restoreTitle')}
        description={archive ? text('archiveBody') : text('restoreBody')}
        closeLabel={text('form.close')}
        size="sm"
        data-testid="course-status-dialog"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
              disabled={pending}
            >
              {text('keep')}
            </Button>
            <Button onClick={confirm} disabled={pending} data-testid="course-status-confirm">
              {pending ? text('working') : archive ? text('archive') : text('restore')}
            </Button>
          </>
        }
      >
        {message ? (
          <Alert tone={message.tone} data-testid="course-status-message">
            {message.text}
          </Alert>
        ) : null}
      </Dialog>
    </>
  );
}
