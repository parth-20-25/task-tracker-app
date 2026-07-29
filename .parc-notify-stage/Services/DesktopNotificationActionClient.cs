using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ParcNotify.Agent.Infrastructure;
using ParcNotify.Agent.Models;

namespace ParcNotify.Agent.Services;

public sealed class DesktopNotificationActionClient
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };
    private readonly AgentSettings _settings;
    private readonly CredentialStorageService _credentials;
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(10) };

    public DesktopNotificationActionClient(AgentSettings settings, CredentialStorageService credentials)
    {
        _settings = settings;
        _credentials = credentials;
    }

    public Task<string> ExecuteTaskActionAsync(string taskId, NotificationActionType actionType, long notificationId, CancellationToken cancellationToken)
    {
        var normalizedTaskId = ValidateTaskId(taskId);
        var (path, fallback) = actionType switch
        {
            NotificationActionType.StartTask => ($"api/desktop-notifications/tasks/{normalizedTaskId}/start", "Task started."),
            NotificationActionType.StartCorrection => ($"api/desktop-notifications/tasks/{normalizedTaskId}/start-correction", "Correction started."),
            NotificationActionType.SelectTask => ($"api/desktop-notifications/tasks/{normalizedTaskId}/select-current", "Current working task updated."),
            NotificationActionType.ContinueTask => ($"api/desktop-notifications/tasks/{normalizedTaskId}/continue", "Next progress check scheduled."),
            _ => throw new InvalidOperationException("Unsupported task action."),
        };
        return PostAsync(path, new { notificationId }, fallback, cancellationToken);
    }

    public Task<string> SnoozeAsync(long notificationId, CancellationToken cancellationToken)
    {
        if (notificationId <= 0) throw new InvalidOperationException("Notification id is invalid.");
        return PostAsync($"api/desktop-notifications/{notificationId}/snooze", new { }, "Reminder snoozed for 30 minutes.", cancellationToken);
    }

    private async Task<string> PostAsync(string path, object body, string fallback, CancellationToken cancellationToken)
    {
        var credentials = _credentials.Load() ?? throw new InvalidOperationException("This computer is not registered.");
        using var request = new HttpRequestMessage(HttpMethod.Post, _settings.BackendUri(path));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", credentials.DeviceToken);
        request.Headers.Add("X-PARC-Device-ID", credentials.DeviceId);
        request.Headers.Add("X-PARC-Agent-Version", AgentSettings.AgentVersion);
        request.Content = JsonContent.Create(body);
        using var response = await _http.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException(await ReadSafeErrorAsync(response, cancellationToken));
        var envelope = await response.Content.ReadFromJsonAsync<ApiEnvelope<ActionResponse>>(JsonOptions, cancellationToken);
        return envelope?.Data?.Message ?? envelope?.Message ?? fallback;
    }

    private static string ValidateTaskId(string taskId)
    {
        var normalized = (taskId ?? string.Empty).Trim();
        if (!long.TryParse(normalized, out var value) || value <= 0) throw new InvalidOperationException("Notification task id is invalid.");
        return Uri.EscapeDataString(normalized);
    }

    private static async Task<string> ReadSafeErrorAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        var fallback = response.StatusCode == System.Net.HttpStatusCode.NotFound
            ? "Desktop task action endpoint is not available on this server."
            : $"Task action failed ({(int)response.StatusCode}).";
        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(text)) return fallback;
        try
        {
            using var document = JsonDocument.Parse(text);
            if (document.RootElement.TryGetProperty("message", out var message) && message.ValueKind == JsonValueKind.String) return message.GetString() ?? fallback;
            if (document.RootElement.TryGetProperty("error", out var error) && error.ValueKind == JsonValueKind.String) return error.GetString() ?? fallback;
        }
        catch (JsonException) { }
        return fallback;
    }

    private sealed record ApiEnvelope<T>(bool Success, T? Data, string? Message);
    private sealed record ActionResponse(string? Message);
}