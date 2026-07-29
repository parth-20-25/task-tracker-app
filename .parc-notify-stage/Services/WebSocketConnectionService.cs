using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using ParcNotify.Agent.Infrastructure;
using ParcNotify.Agent.Models;

namespace ParcNotify.Agent.Services;

public sealed class WebSocketConnectionService
{
    private static readonly TimeSpan[] ReconnectDelays =
    [
        TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(10),
        TimeSpan.FromSeconds(30), TimeSpan.FromSeconds(60),
    ];

    private readonly AgentSettings _settings;
    private readonly CredentialStorageService _credentials;
    private readonly LocalStateService _state;
    private readonly SemaphoreSlim _sendGate = new(1, 1);
    private readonly string _loginSessionId;
    private ClientWebSocket? _socket;

    public event Action<string>? StatusChanged;
    public event Action<DesktopNotification>? NotificationReceived;

    public bool IsWebSocketConnected { get; private set; }
    public bool DeviceRegistered { get; private set; }
    public bool IsConnected => IsWebSocketConnected && DeviceRegistered;
    public string? EmployeeId { get; private set; }
    public string? BackendUserId { get; private set; }
    public DateTimeOffset? LastSuccessfulSync { get; private set; }
    public int? LastActiveTaskCount { get; private set; }
    public NotificationTaskOption? CurrentWorkingTask { get; private set; }
    public string? LastNotificationEventType { get; private set; }
    public DateTimeOffset? LastNotificationReceived { get; private set; }
    public string? LastError { get; private set; }
    public string LoginSessionId => _loginSessionId;

    public WebSocketConnectionService(AgentSettings settings, CredentialStorageService credentials, LocalStateService state, string? loginSessionId = null)
    {
        _settings = settings;
        _credentials = credentials;
        _state = state;
        _loginSessionId = string.IsNullOrWhiteSpace(loginSessionId) ? WindowsLoginSessionService.CurrentId() : loginSessionId;
    }

    public static TimeSpan GetReconnectDelay(int attempt) => ReconnectDelays[Math.Min(Math.Max(attempt, 0), ReconnectDelays.Length - 1)];

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        var attempt = 0;
        while (!cancellationToken.IsCancellationRequested)
        {
            var credentials = _credentials.Load();
            if (credentials is null)
            {
                DeviceRegistered = false;
                LastError = "No saved credentials.";
                StatusChanged?.Invoke("Not registered");
                await Task.Delay(TimeSpan.FromSeconds(5), cancellationToken);
                continue;
            }

            EmployeeId = credentials.EmployeeId;
            BackendUserId = credentials.BackendUserId;
            try
            {
                using var socket = new ClientWebSocket();
                socket.Options.SetRequestHeader("Authorization", "Bearer " + credentials.DeviceToken);
                socket.Options.SetRequestHeader("X-PARC-Device-ID", credentials.DeviceId);
                socket.Options.SetRequestHeader("X-PARC-Agent-Version", AgentSettings.AgentVersion);
                _socket = socket;
                StatusChanged?.Invoke("Connecting");
                AgentLogger.Info($"WebSocket connecting employeeId={credentials.EmployeeId} backendUserId={credentials.BackendUserId ?? "unknown"} loginSession={_loginSessionId}");
                await socket.ConnectAsync(_settings.WebSocketUri, cancellationToken);
                attempt = 0;
                IsWebSocketConnected = true;
                DeviceRegistered = true;
                LastError = null;
                StatusChanged?.Invoke($"Connected as employee {credentials.EmployeeId}");
                AgentLogger.Info($"WebSocket connected employeeId={credentials.EmployeeId} backendUserId={credentials.BackendUserId ?? "unknown"} deviceId={credentials.DeviceId}");
                await RequestSynchronizationAsync(cancellationToken);
                await ReceiveLoopAsync(socket, cancellationToken);
                LastError = "WebSocket disconnected.";
                StatusChanged?.Invoke("Disconnected");
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { break; }
            catch (Exception error)
            {
                LastError = error.Message;
                AgentLogger.Warn($"WebSocket reconnect needed employeeId={credentials.EmployeeId}: {error.Message}");
                StatusChanged?.Invoke("Disconnected");
            }
            finally
            {
                IsWebSocketConnected = false;
                _socket = null;
            }

            var delay = GetReconnectDelay(attempt++);
            AgentLogger.Info($"WebSocket reconnect scheduled attempt={attempt} delaySeconds={delay.TotalSeconds:0}");
            await Task.Delay(delay, cancellationToken);
        }
    }

    public void RequestReconnect() => _socket?.Abort();

    public Task AcknowledgeReceivedAsync(long notificationId, CancellationToken cancellationToken) => SendAsync(new
    {
        type = "notification_received", notificationId, receivedAt = DateTimeOffset.Now,
    }, cancellationToken);

    public Task AcknowledgeDisplayedAsync(long notificationId, CancellationToken cancellationToken) => SendAsync(new
    {
        type = "notification_displayed", notificationId, displayedAt = DateTimeOffset.Now,
    }, cancellationToken);

    public Task AcknowledgeClickedAsync(long notificationId, CancellationToken cancellationToken) => SendAsync(new
    {
        type = "notification_clicked", notificationId, clickedAt = DateTimeOffset.Now,
    }, cancellationToken);

    public Task RequestSynchronizationAsync(CancellationToken cancellationToken = default) => SendAsync(new
    {
        type = "sync_pending_notifications",
        lastAcknowledgedNotificationId = _state.LastAcknowledgedNotificationId,
        loginSessionId = _loginSessionId,
    }, cancellationToken);

    private async Task SendAsync(object payload, CancellationToken cancellationToken)
    {
        var socket = _socket;
        if (socket is null || socket.State != WebSocketState.Open) return;
        var json = JsonSerializer.Serialize(payload);
        await _sendGate.WaitAsync(cancellationToken);
        try
        {
            if (socket.State == WebSocketState.Open)
            {
                await socket.SendAsync(Encoding.UTF8.GetBytes(json), WebSocketMessageType.Text, true, cancellationToken);
            }
        }
        finally { _sendGate.Release(); }
    }

    private async Task ReceiveLoopAsync(ClientWebSocket socket, CancellationToken cancellationToken)
    {
        var buffer = new byte[64 * 1024];
        while (socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
        {
            using var message = new MemoryStream();
            WebSocketReceiveResult result;
            do
            {
                result = await socket.ReceiveAsync(buffer, cancellationToken);
                if (result.MessageType == WebSocketMessageType.Close) return;
                message.Write(buffer, 0, result.Count);
            } while (!result.EndOfMessage);
            await HandleMessageAsync(Encoding.UTF8.GetString(message.ToArray()), cancellationToken);
        }
    }

    private async Task HandleMessageAsync(string json, CancellationToken cancellationToken)
    {
        var envelope = JsonSerializer.Deserialize<NotificationEnvelope>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        if (envelope is null) return;
        if (envelope.Type == "desktop_notification" && envelope.Notification is not null)
        {
            await ReceiveNotificationAsync(envelope.Notification, cancellationToken);
            return;
        }
        if (envelope.Type == "pending_notifications" && envelope.Notifications is not null)
        {
            LastSuccessfulSync = DateTimeOffset.Now;
            AgentLogger.Info($"Pending notification sync result count={envelope.Notifications.Count}");
            foreach (var notification in envelope.Notifications.Take(100)) await ReceiveNotificationAsync(notification, cancellationToken);
            return;
        }
        if (envelope.Type == "active_task_sync")
        {
            EmployeeId = envelope.EmployeeId ?? EmployeeId;
            BackendUserId = envelope.BackendUserId ?? BackendUserId;
            DeviceRegistered = envelope.DeviceRegistered ?? DeviceRegistered;
            LastSuccessfulSync = DateTimeOffset.Now;
            LastActiveTaskCount = envelope.ActiveTaskCount ?? envelope.Notification?.TaskCount ?? 0;
            CurrentWorkingTask = envelope.CurrentWorkingTask;
            LastError = null;
            AgentLogger.Info($"Active task sync result activeTaskCount={LastActiveTaskCount} currentTask={CurrentWorkingTask?.TaskId ?? "none"} loginSession={_loginSessionId}");
            if (envelope.Notification is not null) await ReceiveNotificationAsync(envelope.Notification, cancellationToken);
            if (envelope.SelectionNotification is not null) await ReceiveNotificationAsync(envelope.SelectionNotification, cancellationToken);
        }
    }

    private async Task ReceiveNotificationAsync(DesktopNotification notification, CancellationToken cancellationToken)
    {
        if (!string.Equals(notification.EntityType, "local", StringComparison.OrdinalIgnoreCase) && notification.Id > 0)
        {
            await AcknowledgeReceivedAsync(notification.Id, cancellationToken);
        }
        LastNotificationEventType = notification.EventType;
        LastNotificationReceived = DateTimeOffset.Now;
        AgentLogger.Info($"Notification received eventType={notification.EventType} notificationId={notification.Id}");
        NotificationReceived?.Invoke(notification);
    }
}