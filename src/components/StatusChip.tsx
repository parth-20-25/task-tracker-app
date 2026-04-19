import { cn } from '@/lib/utils';
import { TaskStatus, VerificationStatus, Priority } from '@/types';
import { Clock, PlayCircle, PauseCircle, CheckCircle2, RotateCcw, XCircle, ShieldCheck, ArrowDown, ArrowUp, ChevronsUp, Flame, ClipboardCheck } from 'lucide-react';

const statusConfig: Record<TaskStatus, { label: string; class: string; icon: React.ElementType }> = {
  created: { label: 'Created', class: 'bg-muted text-muted-foreground', icon: Clock },
  assigned: { label: 'Assigned', class: 'bg-info/10 text-info', icon: ClipboardCheck },
  in_progress: { label: 'In Progress', class: 'bg-info/10 text-info', icon: PlayCircle },
  on_hold: { label: 'On Hold', class: 'bg-warning/10 text-warning', icon: PauseCircle },
  under_review: { label: 'Under Review', class: 'bg-warning/10 text-warning', icon: ShieldCheck },
  rework: { label: 'Rework', class: 'bg-destructive/10 text-destructive', icon: RotateCcw },
  closed: { label: 'Closed', class: 'bg-success/10 text-success', icon: CheckCircle2 },
  cancelled: { label: 'Cancelled', class: 'bg-muted text-muted-foreground', icon: XCircle },
};

const verificationConfig: Record<VerificationStatus, { label: string; class: string; icon: React.ElementType }> = {
  pending: { label: 'Pending', class: 'bg-warning/10 text-warning', icon: Clock },
  manager_approved: { label: 'Manager Approved', class: 'bg-info/10 text-info', icon: ShieldCheck },
  quality_pending: { label: 'Quality Pending', class: 'bg-warning/10 text-warning', icon: ShieldCheck },
  approved: { label: 'Approved', class: 'bg-success/10 text-success', icon: ShieldCheck },
  rejected: { label: 'Rejected', class: 'bg-destructive/10 text-destructive', icon: XCircle },
};

const priorityConfig: Record<Priority, { label: string; class: string; icon: React.ElementType }> = {
  low: { label: 'Low', class: 'bg-muted text-muted-foreground', icon: ArrowDown },
  medium: { label: 'Medium', class: 'bg-info/10 text-info', icon: ArrowUp },
  high: { label: 'High', class: 'bg-warning/10 text-warning', icon: ChevronsUp },
  critical: { label: 'Critical', class: 'bg-destructive/10 text-destructive', icon: Flame },
};

interface StatusChipProps {
  type: 'status' | 'verification' | 'priority';
  value: string;
  className?: string;
}

export function StatusChip({ type, value, className }: StatusChipProps) {
  const config = type === 'status'
    ? statusConfig[value as TaskStatus]
    : type === 'verification'
    ? verificationConfig[value as VerificationStatus]
    : priorityConfig[value as Priority];

  if (!config) return null;
  const Icon = config.icon;

  return (
    <span className={cn('status-chip', config.class, className)}>
      <Icon className="h-3.5 w-3.5" />
      {config.label}
    </span>
  );
}
