using System.Globalization;
using System.Windows.Media;
using ParcNotify.Agent.Models;

namespace ParcNotify.Agent.Services;

public sealed class NotificationTemplateFactory
{
    private static readonly CultureInfo DateCulture = CultureInfo.GetCultureInfo("en-IN");
    private readonly NotificationThemeService _theme;

    public NotificationTemplateFactory(NotificationThemeService theme) => _theme = theme;

    public NotificationPopupViewModel Create(DesktopNotification notification)
    {
        var eventType = NormalizeEventType(notification.EventType);
        var severity = NotificationThemeService.SeverityFor(eventType);
        var legacy = ParseLegacyBody(notification.Body);
        var taskName = Clean(notification.TaskDisplayName) ?? Clean(notification.TaskName) ?? InferTaskName(notification, eventType);
        var project = Clean(notification.ProjectNumber) ?? legacy.Project;
        var fixture = Clean(notification.FixtureNumber) ?? legacy.Fixture;
        var dueDate = FormatDate(notification.DueDate) ?? legacy.DueDate;
        if (eventType == "PROJECT_RELEASED") taskName = $"Project {project ?? Clean(notification.ProjectName) ?? notification.EntityId}";
        if (severity == NotificationSeverity.Escalation && taskName is null) taskName = "Employee action pending";

        var accent = _theme.AccentBrushFor(severity);
        var vm = new NotificationPopupViewModel
        {
            Notification = notification,
            NotificationId = notification.Id.ToString(CultureInfo.InvariantCulture),
            EventType = eventType,
            Severity = severity,
            EventTitle = BuildTitle(notification, eventType),
            TaskName = ShowsTaskName(eventType) ? taskName : null,
            Metadata = BuildMetadata(notification, eventType, project, fixture),
            StatusText = BuildStatus(notification, eventType, dueDate),
            StatusBrush = accent,
            IconBrush = accent,
            AccentBrush = accent,
            AccentHoverBrush = _theme.AccentHoverBrushFor(severity),
            AccentPressedBrush = _theme.AccentPressedBrushFor(severity),
            BrightBorderBrush = _theme.BrightBorderBrushFor(severity),
            TintBrush = _theme.TintBrushFor(severity),
            IconContainerBrush = _theme.IconContainerBrushFor(severity),
            FallbackBrush = _theme.FallbackBrushFor(severity),
            GlowColor = _theme.GlowColorFor(severity),
            IconGlyph = Geometry.Parse(IconPath(severity)),
            TaskItems = BuildTaskItems(notification, eventType, out var moreText),
            MoreTasksText = moreText,
            AutoDismissDuration = DurationFor(eventType),
            Priority = notification.Priority,
            CardHeight = eventType is "ACTIVE_TASK_REMINDER" or "CURRENT_TASK_SELECTION" ? 300 : 285,
            MinCardHeight = eventType is "ACTIVE_TASK_REMINDER" or "CURRENT_TASK_SELECTION" ? 300 : 285,
            MaxCardHeight = 320,
            IsPersistent = eventType == "TASK_OVERDUE",
        };

        foreach (var choice in BuildTaskChoices(eventType, notification.TaskOptions)) vm.TaskChoices.Add(choice);
        foreach (var action in BuildActions(eventType, notification.AvailableActions)) vm.Actions.Add(action);
        return vm;
    }

    public IReadOnlyList<NotificationPopupViewModel> CreatePrioritySamples() => PrioritySampleNotifications().Select(Create).ToList();

    public IReadOnlyList<NotificationPopupViewModel> CreateSamples()
    {
        var items = PrioritySampleNotifications().Concat(new[]
        {
            new DesktopNotification { Id = 5, EventType = "TASKS_BULK_ASSIGNED", EntityType = "task", EntityId = "608", ProjectNumber = "25-119", FixtureNumber = "OP20", TaskCount = 6, TaskItems = ["Drafting Checking 01", "Drawing Correction 00", "AutoCAD PDF 00", "IGES 00", "Layout Review 02", "BOM Check 01"], DeepLink = "/tasks?project=25-119", AvailableActions = ["OPEN_TASKS"] },
            new DesktopNotification { Id = 6, EventType = "TASK_REJECTED", EntityType = "task", EntityId = "609", TaskName = "Drawing Correction 00", ProjectNumber = "25-119", FixtureNumber = "OP20", RejectionReason = "Drawing requires correction.", DeepLink = "/tasks/609", AvailableActions = ["VIEW_REJECTION", "START_CORRECTION"] },
            new DesktopNotification { Id = 7, EventType = "TASK_UPDATE_REQUIRED", EntityType = "task", EntityId = "610", TaskName = "AutoCAD PDF 00", ProjectNumber = "25-119", FixtureNumber = "OP20", DeepLink = "/tasks/610", AvailableActions = ["OPEN_TASK"] },
            new DesktopNotification { Id = 8, EventType = "TASK_REASSIGNED", EntityType = "task", EntityId = "613", TaskName = "BOM Check 01", ProjectNumber = "25-119", DeepLink = "/tasks/613", AvailableActions = ["OPEN_TRACKER"] },
            new DesktopNotification { Id = 9, EventType = "APPROVAL_REQUESTED", EntityType = "task", EntityId = "614", TaskName = "Quality Check 01", ProjectNumber = "25-119", FixtureNumber = "OP20", DeepLink = "/tasks/614", AvailableActions = ["REVIEW_TASK"] },
            new DesktopNotification { Id = 10, EventType = "TASK_CANCELLED", EntityType = "task", EntityId = "615", TaskName = "Old Fixture Check", ProjectNumber = "25-119", FixtureNumber = "OP20", DeepLink = "/tasks", AvailableActions = ["OPEN_TRACKER"] },
            new DesktopNotification { Id = 11, EventType = "PROJECT_RELEASED", EntityType = "project", EntityId = "119", ProjectNumber = "25-119", ProjectName = "Project Name", CustomerName = "Customer Name", ReleasedByName = "Employee Name", ReleasedAt = "2026-07-18T16:35:00+05:30", DeepLink = "/projects/119", AuditDeepLink = "/audit?entity=project&id=119", AvailableActions = ["OPEN_PROJECT", "VIEW_AUDIT"] },
        });
        return items.Select(Create).ToList();
    }

    private static IEnumerable<DesktopNotification> PrioritySampleNotifications() =>
    [
        new DesktopNotification { Id = 1, EventType = "TASK_ASSIGNED", EntityType = "task", EntityId = "607", TaskName = "Drafting Checking 01", ProjectNumber = "25-119", FixtureNumber = "OP20", DueDate = "2026-07-20", DeepLink = "/tasks/607", AvailableActions = ["OPEN_TASK", "START_TASK"] },
        new DesktopNotification { Id = 2, EventType = "TASK_DUE_TODAY", EntityType = "task", EntityId = "611", TaskName = "AutoCAD PDF 00", ProjectNumber = "25-119", FixtureNumber = "OP20", DeepLink = "/tasks/611", AvailableActions = ["OPEN_TASK"] },
        new DesktopNotification { Id = 3, EventType = "TASK_OVERDUE", EntityType = "task", EntityId = "612", TaskName = "Drawing Correction 01", ProjectNumber = "25-119", FixtureNumber = "OP20", DueDate = "2026-07-18", DeepLink = "/tasks/612", AvailableActions = ["OPEN_TASK", "START_TASK"] },
        new DesktopNotification { Id = 4, EventType = "TASK_OVERDUE_EXECUTIVE_ESCALATION", EntityType = "task", EntityId = "612", TaskName = "Employee action pending", ProjectNumber = "25-119", FixtureNumber = "OP20", DeepLink = "/tasks/612" },
    ];

    private static string NormalizeEventType(string? value) => string.IsNullOrWhiteSpace(value) ? "TASK_ASSIGNED" : value.Trim().ToUpperInvariant();

    private static string BuildTitle(DesktopNotification notification, string eventType) => eventType switch
    {
        "TASK_ASSIGNED" => "Task assigned",
        "TASKS_BULK_ASSIGNED" => $"{Math.Max(notification.TaskCount ?? notification.TaskItems?.Count ?? 0, 1)} tasks assigned",
        "TASK_REJECTED" => "Task rejected",
        "TASK_UPDATE_REQUIRED" => "Update required",
        "TASK_DUE_TODAY" => "Task due today",
        "TASK_OVERDUE" => "Task overdue",
        "ACTIVE_TASK_REMINDER" => Clean(notification.Title) ?? "Active tasks",
        "CURRENT_TASK_SELECTION" => "Which task are you working on now?",
        "TASK_PROGRESS_UPDATE" => "Task progress update",
        "TASK_REASSIGNED" => "Task reassigned",
        "APPROVAL_REQUESTED" => "Approval requested",
        "APPROVAL_PENDING_TOO_LONG" => "Approval pending",
        "PROJECT_RELEASED" => "Project released",
        "PROJECT_COMPLETED" => "Project completed",
        "TASK_CANCELLED" => "Task cancelled",
        "ECN_CREATED" => "ECN created",
        "WORKFLOW_BLOCKED" => "Workflow blocked",
        "TASK_OVERDUE_EXECUTIVE_ESCALATION" or "CEO_DIRECTOR_ESCALATION" => "Overdue escalation",
        "PROJECT_DEADLINE_AT_RISK" => "Project deadline at risk",
        "CRITICAL_WORKFLOW_ESCALATION" => "Critical workflow escalation",
        "ACTION_CONFIRMED" => "Done",
        "ACTION_FAILED" => "Action failed",
        _ => Clean(notification.Title) ?? "PARC Task Tracker",
    };

    private static bool ShowsTaskName(string eventType) => eventType is not "TASKS_BULK_ASSIGNED" and not "ACTIVE_TASK_REMINDER" and not "CURRENT_TASK_SELECTION" and not "ACTION_CONFIRMED";

    private static string? InferTaskName(DesktopNotification notification, string eventType)
    {
        if (eventType == "TASK_REASSIGNED") return Clean(notification.TaskName) ?? Clean(notification.Title);
        var title = Clean(notification.Title);
        if (title is null) return null;
        return title.EndsWith(" assigned", StringComparison.OrdinalIgnoreCase) ? title[..^9] : title;
    }

    private static string? BuildStatus(DesktopNotification notification, string eventType, string? dueDate) => eventType switch
    {
        "TASK_ASSIGNED" => $"Due: {dueDate ?? "Not set"}  •  Priority: {notification.Priority}",
        "TASK_REJECTED" => $"Reason: {Clean(notification.RejectionReason) ?? Clean(notification.StatusMessage) ?? Clean(notification.Body) ?? "Review the task details."}",
        "TASK_UPDATE_REQUIRED" => $"{Clean(notification.StatusMessage) ?? "Update requested by your leader"}  •  Due: {dueDate ?? "Not set"}",
        "ACTIVE_TASK_REMINDER" or "CURRENT_TASK_SELECTION" or "TASK_PROGRESS_UPDATE" => Clean(notification.StatusMessage) ?? Clean(notification.Body),
        "TASK_DUE_TODAY" => "Due today at end of shift",
        "TASK_OVERDUE" => Clean(notification.StatusMessage) ?? $"Overdue since {dueDate ?? "the due date"}",
        "TASK_REASSIGNED" => "This task has been reassigned to another user",
        "APPROVAL_REQUESTED" => "Please review and take action",
        "APPROVAL_PENDING_TOO_LONG" => "Approval has been pending too long",
        "TASK_OVERDUE_EXECUTIVE_ESCALATION" or "CEO_DIRECTOR_ESCALATION" => Clean(notification.StatusMessage) ?? "2 reminders delivered  •  Employee action pending",
        "PROJECT_DEADLINE_AT_RISK" => Clean(notification.StatusMessage) ?? "Project deadline requires executive attention",
        "CRITICAL_WORKFLOW_ESCALATION" => Clean(notification.StatusMessage) ?? "Workflow requires executive attention",
        "PROJECT_RELEASED" => $"Released by {Clean(notification.ReleasedByName) ?? "Unknown"}  •  {FormatDateTime(notification.ReleasedAt)}",
        "TASK_CANCELLED" => "This task has been cancelled",
        "ACTION_CONFIRMED" => Clean(notification.Body) ?? "Action completed",
        "ACTION_FAILED" => Clean(notification.Body) ?? "Action failed",
        _ => Clean(notification.StatusMessage) ?? Clean(notification.Body),
    };

    private static string BuildMetadata(DesktopNotification notification, string eventType, string? project, string? fixture)
    {
        if (eventType == "PROJECT_RELEASED") return $"{Clean(notification.ProjectName) ?? "Project"}  •  Customer {Clean(notification.CustomerName) ?? "Not recorded"}";
        if (eventType is "ACTIVE_TASK_REMINDER" or "CURRENT_TASK_SELECTION") return Clean(notification.Body) ?? "Open My Tasks for details.";
        var parts = new[]
        {
            project is null ? null : $"Project {project}",
            fixture is null ? "Project-level task" : $"Fixture {fixture}",
            Clean(notification.StageType),
        };
        var metadata = string.Join("  •  ", parts.Where(value => !string.IsNullOrWhiteSpace(value)));
        if (eventType is "TASK_OVERDUE_EXECUTIVE_ESCALATION" or "CEO_DIRECTOR_ESCALATION")
        {
            var employee = string.Join(" ", new[] { Clean(notification.EmployeeName), Clean(notification.EmployeeNumber) is { } number ? $"({number})" : null }.Where(value => value is not null));
            return string.IsNullOrWhiteSpace(employee) ? metadata : $"{employee}  •  {metadata}";
        }
        return string.IsNullOrWhiteSpace(metadata) ? "Project-level task" : metadata;
    }

    private static IReadOnlyList<string> BuildTaskItems(DesktopNotification notification, string eventType, out string? moreText)
    {
        var items = (notification.TaskItems ?? []).Select(Clean).Where(value => value is not null).Cast<string>().ToList();
        var visible = items.Take(3).ToList();
        var hiddenCount = Math.Max((notification.TaskCount ?? items.Count) - visible.Count, 0);
        moreText = hiddenCount > 0 ? $"+{hiddenCount} more tasks" : null;
        return eventType == "CURRENT_TASK_SELECTION" ? [] : visible;
    }

    private static IReadOnlyList<NotificationActionViewModel> BuildActions(string eventType, IReadOnlyList<string>? availableActions)
    {
        var allowed = availableActions?.Select(value => value.Trim().ToUpperInvariant()).ToHashSet();
        var defaults = eventType switch
        {
            "TASK_ASSIGNED" => new[] { Action("Open Task", NotificationActionType.OpenTask, false, "OPEN_TASK"), Action("Start Task", NotificationActionType.StartTask, true, "START_TASK") },
            "TASKS_BULK_ASSIGNED" => [Action("Open Tasks", NotificationActionType.OpenTasks, true, "OPEN_TASKS")],
            "TASK_REJECTED" => new[] { Action("View Rejection", NotificationActionType.ViewRejection, false, "VIEW_REJECTION"), Action("Start Correction", NotificationActionType.StartCorrection, true, "START_CORRECTION") },
            "TASK_UPDATE_REQUIRED" => new[] { Action("Open Task", NotificationActionType.OpenTask, false, "OPEN_TASK"), Action("Start Correction", NotificationActionType.StartCorrection, true, "START_CORRECTION") },
            "TASK_DUE_TODAY" => new[] { Action("Open Task", NotificationActionType.OpenTask, false, "OPEN_TASK"), Action("Remind Me", NotificationActionType.RemindMe, true, null) },
            "TASK_OVERDUE" => new[] { Action("Open Task", NotificationActionType.OpenTask, false, "OPEN_TASK"), Action("Start Now", NotificationActionType.StartTask, true, "START_TASK") },
            "ACTIVE_TASK_REMINDER" => [Action("Open My Tasks", NotificationActionType.OpenTasks, true, "OPEN_TASKS")],
            "CURRENT_TASK_SELECTION" => [Action("Open My Tasks", NotificationActionType.OpenTasks, false, "OPEN_TASKS")],
            "TASK_PROGRESS_UPDATE" => new[] { Action("Complete Task", NotificationActionType.CompleteTask, false, "COMPLETE_TASK"), Action("Continue", NotificationActionType.ContinueTask, true, "CONTINUE"), Action("Switch Task", NotificationActionType.SwitchTask, false, "SWITCH_TASK") },
            "TASK_OVERDUE_EXECUTIVE_ESCALATION" or "CEO_DIRECTOR_ESCALATION" or "PROJECT_DEADLINE_AT_RISK" or "CRITICAL_WORKFLOW_ESCALATION" => new[] { Action("Open Task", NotificationActionType.OpenTask, false, null), Action("View Details", NotificationActionType.ViewDetails, true, null) },
            "TASK_REASSIGNED" => [Action("Open Task Tracker", NotificationActionType.OpenTracker, true, "OPEN_TRACKER")],
            "APPROVAL_REQUESTED" or "APPROVAL_PENDING_TOO_LONG" => [Action("Review Task", NotificationActionType.ReviewTask, true, "REVIEW_TASK")],
            "PROJECT_RELEASED" => new[] { Action("Open Project", NotificationActionType.OpenProject, false, "OPEN_PROJECT"), Action("View Details", NotificationActionType.ViewAudit, true, "VIEW_AUDIT") },
            "TASK_CANCELLED" => [Action("Open Task Tracker", NotificationActionType.OpenTracker, true, "OPEN_TRACKER")],
            _ => [Action("Open Task Tracker", NotificationActionType.OpenTracker, true, "OPEN_TRACKER")],
        };
        var limit = eventType == "TASK_PROGRESS_UPDATE" ? 3 : 2;
        return defaults.Where(item => item.ServerName is null || allowed is null || allowed.Contains(item.ServerName)).Take(limit).Select(item => item.ViewModel).ToList();
    }

    private static IReadOnlyList<NotificationActionViewModel> BuildTaskChoices(string eventType, IReadOnlyList<NotificationTaskOption>? options) =>
        eventType == "CURRENT_TASK_SELECTION"
            ? (options ?? []).Take(3).Select(option => new NotificationActionViewModel(option.Label, NotificationActionType.SelectTask, true, targetTaskId: option.TaskId)).ToList()
            : [];

    private static (NotificationActionViewModel ViewModel, string? ServerName) Action(string label, NotificationActionType type, bool isPrimary, string? serverName) =>
        (new NotificationActionViewModel(label, type, isPrimary), serverName);

    private static TimeSpan DurationFor(string eventType)
    {
        if (int.TryParse(Environment.GetEnvironmentVariable("PARC_NOTIFY_POPUP_SECONDS"), out var seconds) && seconds > 0)
        {
            return TimeSpan.FromSeconds(Math.Min(seconds, 600));
        }

        return NotificationThemeService.SeverityFor(eventType) switch
        {
            NotificationSeverity.Urgent or NotificationSeverity.Escalation => TimeSpan.FromSeconds(30),
            NotificationSeverity.Reminder => TimeSpan.FromSeconds(20),
            _ when eventType is "ACTION_CONFIRMED" or "ACTION_FAILED" => TimeSpan.FromSeconds(5),
            _ => TimeSpan.FromSeconds(15),
        };
    }

    private static string IconPath(NotificationSeverity severity) => severity switch
    {
        NotificationSeverity.Reminder => "M7,16 L17,16 M8,16 C8,19 16,19 16,16 M8,10 C8,6 10,4 12,4 C14,4 16,6 16,10 L17,15 L7,15 Z M12,2 L12,4",
        NotificationSeverity.Correction => "M4,18 L7,18 L19,6 L16,3 L4,15 Z M14,5 L17,8",
        NotificationSeverity.Urgent => "M12,3 L22,20 L2,20 Z M12,8 L12,14 M12,17 L12,18",
        NotificationSeverity.Escalation => "M12,3 A9,9 0 1 0 12,21 A9,9 0 1 0 12,3 M12,17 L12,8 M8,12 L12,8 L16,12",
        _ => "M12,3 A9,9 0 1 0 12,21 A9,9 0 1 0 12,3 M12,10 L12,17 M12,7 L12,7.2",
    };

    private static string FormatDateTime(string? value)
    {
        var clean = Clean(value);
        return DateTimeOffset.TryParse(clean, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var date)
            ? date.LocalDateTime.ToString("dd MMM yyyy, h:mm tt", DateCulture)
            : clean ?? "Time not recorded";
    }

    private static string? FormatDate(string? value)
    {
        var clean = Clean(value);
        if (clean is null) return null;
        if (DateOnly.TryParseExact(clean, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var dateOnly)) return dateOnly.ToString("dd MMMM yyyy", DateCulture);
        if (DateTimeOffset.TryParse(clean, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var date)) return date.ToString("dd MMMM yyyy", DateCulture);
        return clean;
    }

    private static string? Clean(string? value)
    {
        var clean = value?.Trim();
        if (string.IsNullOrWhiteSpace(clean)) return null;
        return clean.Equals("null", StringComparison.OrdinalIgnoreCase)
            || clean.Equals("undefined", StringComparison.OrdinalIgnoreCase)
            || clean.Equals("n/a", StringComparison.OrdinalIgnoreCase)
            ? null
            : clean;
    }

    private static (string? Project, string? Fixture, string? DueDate) ParseLegacyBody(string? body)
    {
        var parts = (body ?? string.Empty).Split(" - ", StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        string? project = null;
        string? fixture = null;
        string? due = null;
        foreach (var part in parts)
        {
            if (part.StartsWith("Due ", StringComparison.OrdinalIgnoreCase)) due = part[4..];
            else if (project is null) project = Clean(part);
            else if (fixture is null) fixture = Clean(part);
        }
        return (project, fixture, due);
    }
}
