using System.Text.Json.Serialization;

namespace ParcNotify.Agent.Models;

public sealed class DesktopNotification
{
    [JsonPropertyName("id")]
    public long Id { get; init; }

    [JsonPropertyName("eventType")]
    public string EventType { get; init; } = "TEST_NOTIFICATION";

    [JsonPropertyName("entityType")]
    public string EntityType { get; init; } = "notification";

    [JsonPropertyName("entityId")]
    [JsonConverter(typeof(LenientStringJsonConverter))]
    public string EntityId { get; init; } = string.Empty;

    [JsonPropertyName("title")]
    public string Title { get; init; } = string.Empty;

    [JsonPropertyName("body")]
    public string Body { get; init; } = string.Empty;

    [JsonPropertyName("deepLink")]
    public string DeepLink { get; init; } = "/";

    [JsonPropertyName("priority")]
    public string Priority { get; init; } = "normal";

    [JsonPropertyName("createdAt")]
    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.Now;

    [JsonPropertyName("taskName")]
    public string? TaskName { get; init; }

    [JsonPropertyName("taskDisplayName")]
    public string? TaskDisplayName { get; init; }

    [JsonPropertyName("projectNumber")]
    public string? ProjectNumber { get; init; }

    [JsonPropertyName("projectName")]
    public string? ProjectName { get; init; }

    [JsonPropertyName("customerName")]
    public string? CustomerName { get; init; }

    [JsonPropertyName("releasedByName")]
    public string? ReleasedByName { get; init; }

    [JsonPropertyName("releasedAt")]
    public string? ReleasedAt { get; init; }

    [JsonPropertyName("auditDeepLink")]
    public string? AuditDeepLink { get; init; }

    [JsonPropertyName("fixtureNumber")]
    public string? FixtureNumber { get; init; }

    [JsonPropertyName("dueDate")]
    public string? DueDate { get; init; }

    [JsonPropertyName("rejectionReason")]
    public string? RejectionReason { get; init; }

    [JsonPropertyName("statusMessage")]
    public string? StatusMessage { get; init; }

    [JsonPropertyName("availableActions")]
    public IReadOnlyList<string>? AvailableActions { get; init; }

    [JsonPropertyName("taskItems")]
    public IReadOnlyList<string>? TaskItems { get; init; }

    [JsonPropertyName("taskCount")]
    public int? TaskCount { get; init; }

    [JsonPropertyName("taskOptions")]
    public IReadOnlyList<NotificationTaskOption>? TaskOptions { get; init; }

    [JsonPropertyName("stageType")]
    public string? StageType { get; init; }

    [JsonPropertyName("employeeName")]
    public string? EmployeeName { get; init; }

    [JsonPropertyName("employeeNumber")]
    public string? EmployeeNumber { get; init; }

    [JsonPropertyName("overdueDuration")]
    public string? OverdueDuration { get; init; }
}

public sealed record NotificationTaskOption(
    [property: JsonPropertyName("taskId")] string TaskId,
    [property: JsonPropertyName("label")] string Label,
    [property: JsonPropertyName("taskName")] string? TaskName = null,
    [property: JsonPropertyName("projectNumber")] string? ProjectNumber = null,
    [property: JsonPropertyName("fixtureNumber")] string? FixtureNumber = null);