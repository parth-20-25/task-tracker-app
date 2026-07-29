using System.Text.Json.Serialization;

namespace ParcNotify.Agent.Models;

public sealed record NotificationEnvelope(
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("notification")] DesktopNotification? Notification,
    [property: JsonPropertyName("notifications")] IReadOnlyList<DesktopNotification>? Notifications,
    [property: JsonPropertyName("activeTaskCount")] int? ActiveTaskCount = null,
    [property: JsonPropertyName("employeeId")] string? EmployeeId = null,
    [property: JsonPropertyName("backendUserId")] string? BackendUserId = null,
    [property: JsonPropertyName("deviceRegistered")] bool? DeviceRegistered = null,
    [property: JsonPropertyName("selectionNotification")] DesktopNotification? SelectionNotification = null,
    [property: JsonPropertyName("currentWorkingTask")] NotificationTaskOption? CurrentWorkingTask = null);