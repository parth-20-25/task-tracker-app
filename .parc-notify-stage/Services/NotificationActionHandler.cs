using ParcNotify.Agent.Models;

namespace ParcNotify.Agent.Services;

public sealed class NotificationActionHandler
{
    private readonly DeepLinkService _deepLinks;
    private readonly DesktopNotificationActionClient _desktopActions;
    private readonly Func<Task> _synchronize;
    private readonly Action<DesktopNotification> _showNotification;

    public NotificationActionHandler(
        DeepLinkService deepLinks,
        DesktopNotificationActionClient desktopActions,
        Func<Task>? synchronize = null,
        Action<DesktopNotification>? showNotification = null)
    {
        _deepLinks = deepLinks;
        _desktopActions = desktopActions;
        _synchronize = synchronize ?? (() => Task.CompletedTask);
        _showNotification = showNotification ?? (_ => { });
    }

    public async Task<string?> HandleAsync(NotificationPopupViewModel notification, NotificationActionViewModel action, CancellationToken cancellationToken)
    {
        switch (action.ActionType)
        {
            case NotificationActionType.OpenTask:
            case NotificationActionType.ViewDetails:
            case NotificationActionType.ViewRejection:
            case NotificationActionType.ReviewTask:
            case NotificationActionType.OpenProject:
                _deepLinks.Open(notification.Notification.DeepLink);
                return null;
            case NotificationActionType.ViewAudit:
                _deepLinks.Open(notification.Notification.AuditDeepLink ?? notification.Notification.DeepLink);
                return null;
            case NotificationActionType.OpenTasks:
                _deepLinks.Open(string.IsNullOrWhiteSpace(notification.Notification.DeepLink) ? "/tasks?status=active" : notification.Notification.DeepLink);
                return null;
            case NotificationActionType.OpenTracker:
                _deepLinks.Open("/");
                return null;
            case NotificationActionType.RemindMe:
                return await _desktopActions.SnoozeAsync(notification.Notification.Id, cancellationToken);
            case NotificationActionType.StartTask:
            case NotificationActionType.StartCorrection:
            case NotificationActionType.ContinueTask:
                return await ExecuteAndSynchronizeAsync(notification.Notification.EntityId, action.ActionType, notification.Notification.Id, cancellationToken);
            case NotificationActionType.SelectTask:
                return await ExecuteAndSynchronizeAsync(action.TargetTaskId ?? notification.Notification.EntityId, action.ActionType, notification.Notification.Id, cancellationToken);
            case NotificationActionType.CompleteTask:
                _deepLinks.Open(notification.Notification.DeepLink);
                return "Complete this task in PARC Task Tracker; its normal proof and approval rules still apply.";
            case NotificationActionType.SwitchTask:
                ShowTaskSelection(notification.Notification);
                return null;
            default:
                throw new InvalidOperationException("Unsupported notification action.");
        }
    }

    private async Task<string> ExecuteAndSynchronizeAsync(string taskId, NotificationActionType action, long notificationId, CancellationToken cancellationToken)
    {
        var message = await _desktopActions.ExecuteTaskActionAsync(taskId, action, notificationId, cancellationToken);
        await _synchronize();
        return message;
    }

    private void ShowTaskSelection(DesktopNotification source)
    {
        var options = (source.TaskOptions ?? []).Where(option => option.TaskId != source.EntityId).Take(3).ToList();
        if (options.Count == 0)
        {
            _deepLinks.Open("/tasks?status=active");
            return;
        }
        _showNotification(new DesktopNotification
        {
            Id = -DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            EventType = "CURRENT_TASK_SELECTION",
            EntityType = "local",
            EntityId = "current-task-selection",
            Title = "Which task are you working on now?",
            Body = "Choose another task to transfer active working time.",
            DeepLink = "/tasks?status=active",
            Priority = "high",
            CreatedAt = DateTimeOffset.Now,
            TaskCount = options.Count,
            TaskItems = options.Select(option => option.Label).ToList(),
            TaskOptions = options,
            StatusMessage = "Selecting a task pauses the previous timer and starts this one.",
            AvailableActions = ["OPEN_TASKS"],
        });
    }
}