import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { LucideIcon } from 'lucide-react';

interface MetricCardProps {
  label: string;
  value: number | string;
  icon: LucideIcon;
  color?: string;
  className?: string;
}

export function MetricCard({ label, value, icon: Icon, color = 'text-primary', className }: MetricCardProps) {
  return (
    <Card className={cn('animate-fade-in', className)}>
      <CardContent className="p-4 flex items-center gap-4">
        <div className={cn('h-10 w-10 rounded-lg flex items-center justify-center bg-primary/10', color.replace('text-', 'bg-').concat('/10'))}>
          <Icon className={cn('h-5 w-5', color)} />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold tracking-tight">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
