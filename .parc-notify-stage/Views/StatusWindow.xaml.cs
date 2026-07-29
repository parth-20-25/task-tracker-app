using System.Windows;
using ParcNotify.Agent.Infrastructure;
using ParcNotify.Agent.Models;
using ParcNotify.Agent.Services;

namespace ParcNotify.Agent.Views;

public partial class StatusWindow : Window
{
    public StatusWindow(string status, DeviceCredentials? credentials, AgentSettings settings, WebSocketConnectionService connection)
    {
        InitializeComponent();
        var employeeId = connection.EmployeeId ?? credentials?.EmployeeId;
        var backendUserId = connection.BackendUserId ?? credentials?.BackendUserId;
        StatusText.Text = string.Join(Environment.NewLine,
        [
            $"Connected: {YesNo(connection.IsConnected)}",
            $"Employee: {employeeId ?? "Not registered"}",
            $"Backend user ID: {backendUserId ?? "Unknown"}",
            $"Device registered: {YesNo(connection.DeviceRegistered)}",
            $"WebSocket connected: {YesNo(connection.IsWebSocketConnected)}",
            $"Active tasks found: {connection.LastActiveTaskCount?.ToString() ?? "Not synchronized"}",
            $"Current working task: {connection.CurrentWorkingTask?.Label ?? "None"}",
            $"Last synchronization: {FormatTime(connection.LastSuccessfulSync)}",
            $"Last notification received: {FormatNotification(connection)}",
            $"Last error: {connection.LastError ?? "None"}",
            $"Client version: {AgentSettings.AgentVersion}",
            $"Executable path: {Environment.ProcessPath ?? "Unknown"}",
            $"Backend: {settings.BackendBaseUrl}",
            $"Connection state: {status}",
        ]);
    }

    private static string YesNo(bool value) => value ? "Yes" : "No";
    private static string FormatTime(DateTimeOffset? value) => value?.LocalDateTime.ToString("g") ?? "Never";
    private static string FormatNotification(WebSocketConnectionService connection) =>
        connection.LastNotificationReceived is null
            ? "None"
            : $"{connection.LastNotificationEventType ?? "Unknown"} at {FormatTime(connection.LastNotificationReceived)}";

    private void Close_Click(object sender, RoutedEventArgs e) => Close();
}
