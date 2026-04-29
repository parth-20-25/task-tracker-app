import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCircle2 } from 'lucide-react';
import { fetchNotifications, markNotificationRead } from '@/api/notificationApi';
import { ListSkeleton } from '@/components/LoadingSkeletons';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { notificationQueryKeys } from '@/lib/queryKeys';

export default function Notifications() {
  const queryClient = useQueryClient();
  const notificationsQuery = useQuery({
    queryKey: notificationQueryKeys.all,
    queryFn: fetchNotifications,
  });

  const markReadMutation = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationQueryKeys.all }),
  });

  const notifications = notificationsQuery.data ?? [];
  const unread = notifications.filter(notification => !notification.read_at).length;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Notifications</h1>
        <p className="text-sm text-muted-foreground">{unread} unread alert(s)</p>
      </div>

      <div className="space-y-3">
        {notificationsQuery.isLoading && <ListSkeleton count={4} />}

        {!notificationsQuery.isLoading && notifications.map(notification => (
          <Card key={notification.id} className={!notification.read_at ? 'border-primary/40' : undefined}>
            <CardContent className="p-4 flex items-start gap-3">
              <Bell className="h-4 w-4 mt-1 text-primary" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-sm">{notification.title}</h3>
                  <span className="text-[10px] uppercase text-muted-foreground">{notification.type}</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">{notification.body}</p>
                <p className="text-xs text-muted-foreground mt-2">{new Date(notification.created_at).toLocaleString()}</p>
              </div>
              {!notification.read_at && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => markReadMutation.mutate(notification.id)}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                  Read
                </Button>
              )}
            </CardContent>
          </Card>
        ))}

        {!notificationsQuery.isLoading && notifications.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-12">No notifications yet.</p>
        )}
      </div>
    </div>
  );
}
