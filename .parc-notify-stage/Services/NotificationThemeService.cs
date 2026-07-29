using System.Windows;
using ParcNotify.Agent.Models;
using MediaBrush = System.Windows.Media.Brush;
using MediaColor = System.Windows.Media.Color;

namespace ParcNotify.Agent.Services;

public sealed class NotificationThemeService
{
    public static NotificationSeverity SeverityFor(string eventType) => eventType switch
    {
        "TASK_DUE_TODAY" or "APPROVAL_REQUESTED" or "APPROVAL_PENDING_TOO_LONG"
            or "TASK_OVERDUE_REMINDER_1" or "TASK_OVERDUE_REMINDER_2" => NotificationSeverity.Reminder,
        "TASK_UPDATE_REQUIRED" or "TASK_REJECTED" => NotificationSeverity.Correction,
        "TASK_OVERDUE" or "WORKFLOW_BLOCKED"
            or "CRITICAL_TASK_ACTION_REQUIRED" or "ACTION_FAILED" => NotificationSeverity.Urgent,
        "TASK_OVERDUE_EXECUTIVE_ESCALATION" or "PROJECT_DEADLINE_AT_RISK"
            or "CRITICAL_WORKFLOW_ESCALATION" or "CEO_DIRECTOR_ESCALATION" => NotificationSeverity.Escalation,
        _ => NotificationSeverity.Info,
    };

    public MediaBrush AccentBrushFor(NotificationSeverity severity) => Brush(severity, "AccentBrush");
    public MediaBrush AccentHoverBrushFor(NotificationSeverity severity) => Brush(severity, "AccentHoverBrush");
    public MediaBrush AccentPressedBrushFor(NotificationSeverity severity) => Brush(severity, "AccentPressedBrush");
    public MediaBrush BrightBorderBrushFor(NotificationSeverity severity) => Brush(severity, "BrightBorderBrush");
    public MediaBrush TintBrushFor(NotificationSeverity severity) => Brush(severity, "TintBrush");
    public MediaBrush IconContainerBrushFor(NotificationSeverity severity) => Brush(severity, "IconContainerBrush");
    public MediaBrush FallbackBrushFor(NotificationSeverity severity) => Brush(severity, "FallbackBrush");
    public MediaColor GlowColorFor(NotificationSeverity severity) => Resource<MediaColor>(Key(severity, "GlowColor"));

    private static MediaBrush Brush(NotificationSeverity severity, string suffix) => Resource<MediaBrush>(Key(severity, suffix));

    private static string Key(NotificationSeverity severity, string suffix) => $"Notification{severity}{suffix}";

    private static T Resource<T>(string key)
    {
        if (System.Windows.Application.Current?.TryFindResource(key) is T value) return value;
        throw new InvalidOperationException($"Notification theme resource '{key}' is missing.");
    }
}
