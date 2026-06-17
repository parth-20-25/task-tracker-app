import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';

interface MetricCardProps {
  label: string;
  value: number | string;
  icon: LucideIcon;
  color?: string;
  className?: string;
  to?: string;
}

export function MetricCard({ label, value, icon: Icon, color = 'text-primary', className, to }: MetricCardProps) {
  const card = (
    <Card
      className={cn(
        'animate-fade-in transition-colors',
        to && 'cursor-pointer hover:border-primary/40 hover:bg-muted/30 hover:shadow-sm',
        className,
      )}
    >
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

  if (!to) {
    return card;
  }

  return (
    <Link
      to={to}
      aria-label={`${label}: ${value}`}
      className="block rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      onKeyDown={(event) => {
        if (event.key === ' ' || event.key === 'Spacebar') {
          event.preventDefault();
          event.currentTarget.click();
        }
      }}
    >
      {card}
    </Link>
  );
}
