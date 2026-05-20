import { CheckCircle2, Circle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VerificationStatus } from '@/types';

/**
 * Steps in the verification pipeline, mapped 1:1 to backend verification_status values.
 * No frontend-only states — every step is a real backend state.
 */
const VERIFICATION_STEPS: Array<{ key: VerificationStatus | 'submitted'; label: string }> = [
  { key: 'submitted', label: 'Submitted' },
  { key: 'pending', label: 'Pending Review' },
  { key: 'manager_approved', label: 'Manager Approved' },
  { key: 'quality_pending', label: 'Quality Review' },
  { key: 'approved', label: 'Approved' },
];

function resolveStepIndex(status: VerificationStatus | string): number {
  switch (status) {
    case 'pending':
      return 1;
    case 'manager_approved':
      return 2;
    case 'quality_pending':
      return 3;
    case 'approved':
      return 4;
    case 'rejected':
      return -1; // Special: rejected breaks the flow
    default:
      return 0;
  }
}

interface VerificationProgressIndicatorProps {
  status: VerificationStatus | string;
  requiresQuality?: boolean;
  compact?: boolean;
  className?: string;
}

export function VerificationProgressIndicator({
  status,
  requiresQuality = false,
  compact = false,
  className,
}: VerificationProgressIndicatorProps) {
  const isRejected = status === 'rejected';
  const currentIndex = resolveStepIndex(status);

  // Filter out quality_pending step if not required
  const steps = requiresQuality
    ? VERIFICATION_STEPS
    : VERIFICATION_STEPS.filter((s) => s.key !== 'quality_pending');

  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      {steps.map((step, idx) => {
        const isCompleted = !isRejected && currentIndex > idx;
        const isCurrent = !isRejected && currentIndex === idx;
        const isRejectedStep = isRejected && idx === Math.max(resolveStepIndex('pending'), 1);

        return (
          <div key={step.key} className="flex items-center gap-0.5">
            {idx > 0 && (
              <div
                className={cn(
                  'h-px w-3',
                  compact && 'w-2',
                  isCompleted ? 'bg-emerald-400' : isRejectedStep ? 'bg-red-400' : 'bg-slate-200',
                )}
              />
            )}
            <div
              className={cn(
                'flex items-center gap-1 rounded-full border px-1.5 py-0.5',
                compact && 'px-1 py-0',
                isCompleted && 'border-emerald-200 bg-emerald-50 text-emerald-700',
                isCurrent && 'border-sky-300 bg-sky-50 text-sky-700 ring-1 ring-sky-200',
                isRejectedStep && 'border-red-200 bg-red-50 text-red-700',
                !isCompleted && !isCurrent && !isRejectedStep && 'border-slate-200 bg-slate-50 text-slate-400',
              )}
            >
              {isCompleted ? (
                <CheckCircle2 className={cn('h-3 w-3 text-emerald-500', compact && 'h-2.5 w-2.5')} />
              ) : isRejectedStep ? (
                <XCircle className={cn('h-3 w-3 text-red-500', compact && 'h-2.5 w-2.5')} />
              ) : (
                <Circle className={cn('h-3 w-3', compact && 'h-2.5 w-2.5')} />
              )}
              {!compact && (
                <span className="text-[10px] font-medium whitespace-nowrap">
                  {isRejectedStep ? 'Rejected' : step.label}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
