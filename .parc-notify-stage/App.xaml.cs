using System.Globalization;
using System.Windows;
using ParcNotify.Agent.Infrastructure;
using ParcNotify.Agent.Models;
using ParcNotify.Agent.Services;
using ParcNotify.Agent.Views;

namespace ParcNotify.Agent;

public partial class App : System.Windows.Application
{
    private readonly CancellationTokenSource _shutdown = new();
    private readonly HashSet<long> _pendingNotificationIds = [];
    private AgentSettings _settings = null!;
    private CredentialStorageService _credentials = null!;
    private LocalStateService _state = null!;
    private DeviceRegistrationService _registration = null!;
    private WebSocketConnectionService _connection = null!;
    private WindowsNotificationService? _notifications;
    private DeepLinkService _deepLinks = null!;
    private DesktopNotificationActionClient _desktopActions = null!;
    private NotificationActionHandler _popupActions = null!;
    private NotificationPopupManager? _popupManager;
    private StartupTaskService _startup = null!;
    private SingleInstanceService? _singleInstance;
    private string _status = "Starting";

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        ShutdownMode = ShutdownMode.OnExplicitShutdown;
        _startup = new StartupTaskService();

        if (HandleStartupCommand(e.Args)) return;

        _singleInstance = new SingleInstanceService();
        if (!_singleInstance.IsFirstInstance)
        {
            AgentLogger.Info("A PARC Notify instance is already running; duplicate process exiting.");
            Shutdown();
            return;
        }

        if (e.Args.Contains("--show-priority-examples", StringComparer.OrdinalIgnoreCase))
        {
            StartPriorityExamples(e.Args);
            return;
        }

        if (e.Args.Contains("--show-test-popup", StringComparer.OrdinalIgnoreCase))
        {
            StartTestPopup(e.Args);
            return;
        }

        var background = e.Args.Contains("--background", StringComparer.OrdinalIgnoreCase);
        _settings = new AgentSettings();
        _credentials = new CredentialStorageService();
        _state = new LocalStateService();
        _registration = new DeviceRegistrationService(_settings);
        _connection = new WebSocketConnectionService(_settings, _credentials, _state);
        _notifications = new WindowsNotificationService();
        _deepLinks = new DeepLinkService(_settings);
        _desktopActions = new DesktopNotificationActionClient(_settings, _credentials);
        _popupActions = new NotificationActionHandler(_deepLinks, _desktopActions);
        _popupManager = new NotificationPopupManager(_popupActions);
        _popupManager.Displayed += PopupDisplayed;
        _popupManager.Clicked += PopupClicked;
        _popupManager.PopupClosed += PopupClosed;

        _notifications.ShowStatusRequested += ShowStatus;
        _notifications.TestRequested += SendTest;
        _notifications.ReconnectRequested += Reconnect;
        _notifications.OpenTrackerRequested += () => _deepLinks.Open("/");
        _notifications.InstallStartupRequested += InstallStartup;
        _notifications.RemoveStartupRequested += RemoveStartup;
        _notifications.StartupStatusRequested += ShowStartupStatus;
        _notifications.SignOutRequested += SignOut;
        _notifications.ExitRequested += ExitAgent;
        _connection.StatusChanged += status => Dispatcher.InvokeAsync(() =>
        {
            _status = status;
            _notifications.SetStatus(status);
        });
        _connection.NotificationReceived += notification => Dispatcher.InvokeAsync(() => ShowNotification(notification));

        var hasCredentials = _credentials.Load() is not null;
        if (!hasCredentials)
        {
            if (ShouldShowRegistration(background, hasCredentials) && ShowRegistration() is true)
            {
                AgentLogger.Info("Device registration completed.");
            }
            else
            {
                _status = "Not registered";
                _notifications.SetStatus(_status);
                AgentLogger.Info(background ? "Background startup skipped registration UI because credentials are missing." : "Device is not registered.");
            }
        }

        AgentLogger.Info($"Agent started processId={Environment.ProcessId} threadId={Environment.CurrentManagedThreadId} background={background} shutdownMode={ShutdownMode}");
        _ = Task.Run(() => _connection.RunAsync(_shutdown.Token));
    }

    private bool HandleStartupCommand(string[] args)
    {
        try
        {
            if (args.Contains("--install-startup", StringComparer.OrdinalIgnoreCase))
            {
                _startup.Install();
                AgentLogger.Info($"Startup installed taskName={StartupTaskService.TaskName} executable={StartupTaskService.StableExecutablePath}");
                Shutdown();
                return true;
            }
            if (args.Contains("--remove-startup", StringComparer.OrdinalIgnoreCase))
            {
                _startup.Remove();
                AgentLogger.Info($"Startup removed taskName={StartupTaskService.TaskName}");
                Shutdown();
                return true;
            }
            if (args.Contains("--startup-status", StringComparer.OrdinalIgnoreCase))
            {
                AgentLogger.Info("Startup status: " + _startup.Status().Replace(Environment.NewLine, " | "));
                Shutdown();
                return true;
            }
        }
        catch (Exception error)
        {
            AgentLogger.Error("Startup command failed", error);
            Shutdown(-1);
            return true;
        }
        return false;
    }

    private void StartTestPopup(string[] args)
    {
        var duration = ParseTestPopupDuration(args);
        Environment.SetEnvironmentVariable("PARC_NOTIFY_FORCE_PRIMARY_SCREEN", "true");
        Environment.SetEnvironmentVariable("PARC_NOTIFY_POPUP_SECONDS", duration.ToString(CultureInfo.InvariantCulture));
        _popupManager = new NotificationPopupManager((viewModel, action, _) =>
        {
            AgentLogger.Info($"Test popup action notificationId={viewModel.NotificationId} action={action.ActionType}");
            return Task.FromResult<string?>(null);
        }, animationsEnabled: false);
        _popupManager.Displayed += notification => AgentLogger.Info($"Test popup visibly rendered notificationId={notification.Id}; no backend acknowledgement sent.");
        _popupManager.PopupClosed += (_, _) => Shutdown();
        Dispatcher.InvokeAsync(() =>
        {
            if (!_popupManager.Show(CreateTestNotification())) Shutdown(-1);
        });
    }

    private void StartPriorityExamples(string[] args)
    {
        var duration = ParsePriorityExamplesDuration(args);
        var samples = new NotificationTemplateFactory(new NotificationThemeService()).CreatePrioritySamples();
        Environment.SetEnvironmentVariable("PARC_NOTIFY_FORCE_PRIMARY_SCREEN", "true");
        Environment.SetEnvironmentVariable("PARC_NOTIFY_POPUP_SECONDS", Math.Max(duration / samples.Count, 5).ToString(CultureInfo.InvariantCulture));
        _popupManager = new NotificationPopupManager((viewModel, action, _) =>
        {
            AgentLogger.Info($"Priority example action notificationId={viewModel.NotificationId} action={action.ActionType}");
            return Task.FromResult<string?>(null);
        }, maxVisible: 1);
        var closed = 0;
        _popupManager.Displayed += notification => AgentLogger.Info($"Priority example visibly rendered notificationId={notification.Id}; no backend acknowledgement sent.");
        _popupManager.PopupClosed += (_, _) =>
        {
            closed++;
            if (closed == samples.Count) Shutdown();
        };
        Dispatcher.InvokeAsync(() =>
        {
            foreach (var sample in samples)
            {
                if (!_popupManager.Show(sample.Notification)) Shutdown(-1);
            }
        });
    }

    public static bool ShouldShowRegistration(bool background, bool hasCredentials) => !background && !hasCredentials;

    public static int ParseTestPopupDuration(IEnumerable<string> args)
    {
        const string prefix = "--test-popup-duration=";
        var value = args.FirstOrDefault(arg => arg.StartsWith(prefix, StringComparison.OrdinalIgnoreCase));
        return value is not null && int.TryParse(value[prefix.Length..], out var seconds)
            ? Math.Clamp(seconds, 1, 600)
            : 60;
    }

    public static int ParsePriorityExamplesDuration(IEnumerable<string> args)
    {
        const string prefix = "--duration=";
        var value = args.FirstOrDefault(arg => arg.StartsWith(prefix, StringComparison.OrdinalIgnoreCase));
        return value is not null && int.TryParse(value[prefix.Length..], out var seconds)
            ? Math.Clamp(seconds, 20, 2400)
            : 120;
    }

    public static DesktopNotification CreateTestNotification() => new()
    {
        Id = -1,
        EventType = "TASK_ASSIGNED",
        EntityType = "task",
        EntityId = "607",
        TaskName = "Drafting Checking 01",
        ProjectNumber = "25-119",
        FixtureNumber = "OP20",
        DueDate = "2026-07-20",
        DeepLink = "/tasks/607",
        Priority = "normal",
        CreatedAt = DateTimeOffset.Now,
        AvailableActions = ["OPEN_TASK", "START_TASK"],
    };

    private bool? ShowRegistration()
    {
        var window = new RegistrationWindow(_registration, _credentials);
        return window.ShowDialog();
    }

    private void ShowNotification(DesktopNotification notification)
    {
        if (_state.WasDisplayed(notification.Id) || !_pendingNotificationIds.Add(notification.Id)) return;
        AgentLogger.Info($"Notification received notificationId={notification.Id} threadId={Environment.CurrentManagedThreadId} dispatcherAccess={Dispatcher.CheckAccess()}");
        if (_popupManager?.Show(notification) is not true) _pendingNotificationIds.Remove(notification.Id);
    }

    private void PopupDisplayed(DesktopNotification notification)
    {
        if (notification.EntityType == "local") return;
        _pendingNotificationIds.Remove(notification.Id);
        if (_state.WasDisplayed(notification.Id)) return;
        _state.MarkDisplayed(notification.Id);
        _ = _connection.AcknowledgeDisplayedAsync(notification.Id, _shutdown.Token);
    }

    private void PopupClicked(DesktopNotification notification, NotificationActionViewModel action)
    {
        if (notification.EntityType == "local") return;
        AgentLogger.Info($"Popup explicitly clicked notificationId={notification.Id} action={action.ActionType}");
        _ = _connection.AcknowledgeClickedAsync(notification.Id, _shutdown.Token);
    }

    private void PopupClosed(DesktopNotification notification, string reason)
    {
        if (!_state.WasDisplayed(notification.Id)) _pendingNotificationIds.Remove(notification.Id);
        AgentLogger.Info($"Notification popup closed notificationId={notification.Id} reason={reason}");
    }

    private void ShowStatus() => new StatusWindow(_status, _credentials.Load()).Show();

    private async void SendTest()
    {
        var credentials = _credentials.Load();
        if (credentials is null)
        {
            ShowRegistration();
            return;
        }
        try { await _registration.SendTestAsync(credentials, _shutdown.Token); }
        catch (Exception error) { AgentLogger.Warn("Test notification failed: " + error.Message); }
    }

    private void InstallStartup()
    {
        try
        {
            _startup.Install();
            _notifications?.ShowMessage("PARC Notify", "Automatic startup installed.");
        }
        catch (Exception error)
        {
            AgentLogger.Error("Startup installation failed", error);
            _notifications?.ShowMessage("PARC Notify", error.Message, true);
        }
    }

    private void RemoveStartup()
    {
        try
        {
            _startup.Remove();
            _notifications?.ShowMessage("PARC Notify", "Automatic startup removed.");
        }
        catch (Exception error)
        {
            AgentLogger.Error("Startup removal failed", error);
            _notifications?.ShowMessage("PARC Notify", error.Message, true);
        }
    }

    private void ShowStartupStatus()
    {
        _notifications?.ShowMessage("PARC Notify startup", _startup.IsInstalled() ? "Installed for the current user." : "Not installed.");
    }

    private void Reconnect()
    {
        AgentLogger.Info("Manual reconnect requested");
        _connection.RequestReconnect();
    }

    private async void SignOut()
    {
        var credentials = _credentials.Load();
        if (credentials is not null)
        {
            try { await _registration.RevokeCurrentAsync(credentials, CancellationToken.None); }
            catch (Exception error) { AgentLogger.Warn("Device revocation failed: " + error.Message); }
        }
        _credentials.Clear();
        _status = "Not registered";
        _notifications?.SetStatus(_status);
        ShowRegistration();
    }

    private void ExitAgent()
    {
        _shutdown.Cancel();
        _popupManager?.Dispose();
        _notifications?.Dispose();
        Shutdown();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _shutdown.Cancel();
        _popupManager?.Dispose();
        _notifications?.Dispose();
        _singleInstance?.Dispose();
        base.OnExit(e);
    }
}