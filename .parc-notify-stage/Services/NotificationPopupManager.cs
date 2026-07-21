using System.Windows;
using System.Windows.Threading;
using ParcNotify.Agent.Infrastructure;
using ParcNotify.Agent.Models;
using ParcNotify.Agent.Views;

namespace ParcNotify.Agent.Services;

public sealed class NotificationPopupManager : IDisposable
{
    private readonly NotificationQueue _queue = new();
    private readonly List<NotificationPopupWindow> _visible = [];
    private readonly HashSet<NotificationPopupWindow> _displayConfirmed = [];
    private readonly NotificationTemplateFactory _factory = new(new NotificationThemeService());
    private readonly Func<NotificationPopupViewModel, NotificationActionViewModel, CancellationToken, Task<string?>> _executeAction;
    private readonly NotificationPositioningService _positioning = new();
    private readonly NotificationAnimationService _animation = new();
    private readonly CancellationTokenSource _lifetime = new();
    private readonly bool _animationsEnabled;
    private readonly Dispatcher _dispatcher;
    private readonly bool _autoStartTimer;
    private readonly int _maxVisible;
    private DateTimeOffset _mutedUntil;
    private bool _disposed;

    public NotificationPopupManager(NotificationActionHandler actions) : this((viewModel, action, cancellationToken) => actions.HandleAsync(viewModel, action.ActionType, cancellationToken)) { }

    public NotificationPopupManager(Func<NotificationPopupViewModel, NotificationActionViewModel, CancellationToken, Task<string?>> executeAction, bool animationsEnabled = true, bool autoStartTimer = true, int maxVisible = 3)
    {
        _executeAction = executeAction;
        _dispatcher = System.Windows.Application.Current?.Dispatcher ?? Dispatcher.CurrentDispatcher;
        _animationsEnabled = animationsEnabled;
        _autoStartTimer = autoStartTimer;
        _maxVisible = Math.Clamp(maxVisible, 1, 3);
    }

    public event Action<DesktopNotification>? Displayed;
    public event Action<DesktopNotification, NotificationActionViewModel>? Clicked;
    public event Action<DesktopNotification, string>? PopupClosed;
    public int ActivePopupCount => _visible.Count;
    public int QueuedPopupCount => _queue.Count;
    public int? LastPopupThreadId { get; private set; }

    public bool Show(DesktopNotification notification)
    {
        if (!_dispatcher.CheckAccess()) return _dispatcher.Invoke(() => Show(notification));
        if (_disposed || DateTimeOffset.Now < _mutedUntil) return false;
        if (_visible.Count >= _maxVisible)
        {
            _queue.Enqueue(notification);
            return true;
        }
        return ShowNow(notification);
    }

    private bool ShowNow(DesktopNotification notification)
    {
        NotificationPopupWindow? window = null;
        try
        {
            LastPopupThreadId = Environment.CurrentManagedThreadId;
            var viewModel = _factory.Create(notification);
            window = new NotificationPopupWindow(viewModel, ExecuteActionAsync, ShowActionResult, MuteFor15Minutes, _animation, _autoStartTimer)
            {
                WorkingArea = _positioning.ResolveActiveWorkingArea(),
                Opacity = _animationsEnabled ? 0 : 1,
                Visibility = Visibility.Visible,
                WindowState = WindowState.Normal,
                Width = viewModel.CardWidth,
                Topmost = true,
                ShowActivated = false,
                ShowInTaskbar = false,
                WindowStyle = WindowStyle.None,
                ResizeMode = ResizeMode.NoResize,
            };
            window.Rendered += () => _ = ConfirmDisplayedAsync(notification, window);
            window.ActionClicked += action => Clicked?.Invoke(notification, action);
            window.Closed += (_, _) => OnClosed(notification, window);
            _visible.Add(window);
            AgentLogger.Info($"Popup created notificationId={notification.Id} processId={Environment.ProcessId} threadId={Environment.CurrentManagedThreadId} dispatcherAccess={_dispatcher.CheckAccess()} activePopups={_visible.Count} createdAt={DateTimeOffset.UtcNow:o}");
            window.Show();
            AgentLogger.Info($"Popup Show notificationId={notification.Id} timestamp={DateTimeOffset.UtcNow:o}");
            window.UpdateLayout();
            Reposition(false);
            if (_animationsEnabled) _animation.PlayEntrance(window);
            else
            {
                window.Opacity = 1;
                window.RootOffset.Y = 0;
            }
            return true;
        }
        catch (Exception error)
        {
            AgentLogger.Error($"Popup show failed notificationId={notification.Id}", error);
            if (window is not null)
            {
                window.MarkRenderingFailed(error);
                _visible.Remove(window);
                if (window.IsLoaded) window.CloseNow("render-failed");
            }
            return false;
        }
    }

    private async Task ConfirmDisplayedAsync(DesktopNotification notification, NotificationPopupWindow window)
    {
        try
        {
            await Task.Delay(TimeSpan.FromMilliseconds(250));
            if (_disposed || !_visible.Contains(window) || _displayConfirmed.Contains(window)) return;
            if (!_positioning.IsDisplayReady(window))
            {
                AgentLogger.Warn($"Popup display proof rejected notificationId={notification.Id}");
                return;
            }
            _displayConfirmed.Add(window);
            AgentLogger.Info($"Popup display confirmed notificationId={notification.Id} visibleForMs=250 activePopups={_visible.Count}");
            Displayed?.Invoke(notification);
        }
        catch (Exception error)
        {
            window.MarkRenderingFailed(error);
        }
    }

    private Task<string?> ExecuteActionAsync(NotificationPopupViewModel viewModel, NotificationActionViewModel action)
    {
        if (action.ActionType != NotificationActionType.RemindMe)
        {
            return _executeAction(viewModel, action, CancellationToken.None);
        }

        _ = RemindLaterAsync(viewModel.Notification, _lifetime.Token);
        return Task.FromResult<string?>(null);
    }

    private async Task RemindLaterAsync(DesktopNotification notification, CancellationToken cancellationToken)
    {
        try
        {
            await Task.Delay(ReminderDelay(), cancellationToken);
            await _dispatcher.InvokeAsync(() => Show(notification));
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
    }

    public static TimeSpan ReminderDelay()
    {
        return int.TryParse(Environment.GetEnvironmentVariable("PARC_NOTIFY_REMINDER_MINUTES"), out var minutes) && minutes > 0
            ? TimeSpan.FromMinutes(Math.Min(minutes, 1440))
            : TimeSpan.FromMinutes(15);
    }

    private void ShowActionResult(string message, bool isError)
    {
        Show(new DesktopNotification
        {
            Id = DateTimeOffset.Now.ToUnixTimeMilliseconds(),
            EventType = isError ? "ACTION_FAILED" : "ACTION_CONFIRMED",
            EntityType = "local",
            EntityId = "0",
            Title = isError ? "Action failed" : "Done",
            Body = message,
            DeepLink = "/",
            Priority = isError ? "normal" : "low",
            CreatedAt = DateTimeOffset.Now,
        });
    }

    private void MuteFor15Minutes()
    {
        _mutedUntil = DateTimeOffset.Now.AddMinutes(15);
        _queue.Clear();
        foreach (var window in _visible.ToArray()) window.CloseAnimated("muted");
    }

    private void OnClosed(DesktopNotification notification, NotificationPopupWindow window)
    {
        _visible.Remove(window);
        _displayConfirmed.Remove(window);
        AgentLogger.Info($"Popup removed notificationId={notification.Id} closeReason={window.CloseReason} activePopups={_visible.Count}");
        PopupClosed?.Invoke(notification, window.CloseReason);
        Reposition(true);
        while (_visible.Count < _maxVisible && _queue.TryDequeue(out var next) && next is not null) ShowNow(next);
    }

    private void Reposition(bool animate)
    {
        foreach (var group in _visible.GroupBy(window => window.WorkingArea))
        {
            double offset = NotificationPositioningService.BottomMarginPx;
            foreach (var window in group)
            {
                _positioning.Position(window, offset, animate, _animation);
                offset += _positioning.HeightInPixels(window) + NotificationPositioningService.StackGapPx;
            }
        }
    }

    public void Dispose()
    {
        _disposed = true;
        _lifetime.Cancel();
        _queue.Clear();
        foreach (var window in _visible.ToArray()) window.CloseNow("shutdown");
        _visible.Clear();
        _displayConfirmed.Clear();
        _lifetime.Dispose();
    }
}
