using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using ParcNotify.Agent.Infrastructure;
using ParcNotify.Agent.Models;
using ParcNotify.Agent.Services;

namespace ParcNotify.Agent.Views;

public partial class NotificationPopupWindow : Window
{
    private const int GwlExStyle = -20;
    private const int WsExNoActivate = 0x08000000;
    private const int WsExToolWindow = 0x00000080;
    private readonly Func<NotificationPopupViewModel, NotificationActionViewModel, Task<string?>> _executeAction;
    private readonly Action<string, bool> _showResult;
    private readonly NotificationAnimationService _animation;
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromMilliseconds(250) };
    private readonly List<AsyncCommand> _actionCommands = [];
    private readonly bool _autoStartTimer;
    private TimeSpan _remaining;
    private DateTimeOffset _lastTick;
    private bool _paused;
    private bool _closingAnimated;
    private bool _closeNow;

    public NotificationPopupWindow(NotificationPopupViewModel viewModel, Func<NotificationPopupViewModel, NotificationActionViewModel, Task<string?>> executeAction, Action<string, bool> showResult, Action muteNotifications, NotificationAnimationService animation, bool autoStartTimer = true)
    {
        InitializeComponent();
        ViewModel = viewModel;
        _executeAction = executeAction;
        _showResult = showResult;
        _animation = animation;
        _autoStartTimer = autoStartTimer;
        _ = muteNotifications;
        DataContext = viewModel;
        _remaining = viewModel.AutoDismissDuration;
        foreach (var action in viewModel.Actions)
        {
            var command = new AsyncCommand(() => ExecuteActionAsync(action), () => !ViewModel.IsActionProcessing);
            action.Command = command;
            _actionCommands.Add(command);
        }
        ViewModel.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(NotificationPopupViewModel.IsActionProcessing)) RaiseActionCanExecuteChanged();
        };
        _timer.Tick += Timer_Tick;
        Loaded += (_, _) =>
        {
            LoadedObserved = true;
            LogLifecycle("Loaded");
        };
        MouseEnter += (_, _) => _paused = true;
        MouseLeave += (_, _) => { _paused = false; _lastTick = DateTimeOffset.Now; };
        LogLifecycle("Initialized");
    }

    public NotificationPopupViewModel ViewModel { get; }
    public System.Drawing.Rectangle WorkingArea { get; set; }
    public TranslateTransform RootOffset => RootTranslate;
    public bool LoadedObserved { get; private set; }
    public bool ContentRenderedObserved { get; private set; }
    public bool RenderingFailed { get; private set; }
    public bool BackdropApplied { get; private set; }
    public string CloseReason { get; private set; } = "unknown";
    public event Action? Rendered;
    public event Action<NotificationActionViewModel>? ActionClicked;

    protected override void OnContentRendered(EventArgs e)
    {
        base.OnContentRendered(e);
        if (ContentRenderedObserved) return;
        ContentRenderedObserved = true;
        LogLifecycle("ContentRendered");
        StartTimer();
        Rendered?.Invoke();
    }

    private void StartTimer()
    {
        if (!_autoStartTimer) return;
        _lastTick = DateTimeOffset.Now;
        _timer.Start();
    }

    private void Timer_Tick(object? sender, EventArgs e)
    {
        var now = DateTimeOffset.Now;
        if (!_paused && !ViewModel.IsActionProcessing)
        {
            _remaining -= now - _lastTick;
            if (_remaining <= TimeSpan.Zero) CloseAnimated("auto-dismissed");
        }
        _lastTick = now;
    }

    private async Task ExecuteActionAsync(NotificationActionViewModel action)
    {
        ViewModel.ActionError = null;
        ViewModel.IsActionProcessing = true;
        action.IsProcessing = true;
        if (action.ActionType != NotificationActionType.RemindMe) ActionClicked?.Invoke(action);
        try
        {
            var confirmation = await _executeAction(ViewModel, action);
            CloseAnimated("clicked-success");
            if (!string.IsNullOrWhiteSpace(confirmation)) _showResult(confirmation, false);
        }
        catch (Exception error)
        {
            ViewModel.ActionError = error.Message;
            AgentLogger.Error($"Popup action failed notificationId={ViewModel.NotificationId}", error);
        }
        finally
        {
            action.IsProcessing = false;
            ViewModel.IsActionProcessing = false;
        }
    }

    private void RaiseActionCanExecuteChanged()
    {
        foreach (var command in _actionCommands) command.RaiseCanExecuteChanged();
    }

    private void CloseButton_Click(object sender, RoutedEventArgs e) => CloseAnimated("dismissed");

    public void CloseAnimated(string reason = "dismissed")
    {
        if (_closingAnimated || _closeNow) return;
        CloseReason = reason;
        _closingAnimated = true;
        _timer.Stop();
        _animation.PlayExit(this, () => { _closeNow = true; Close(); });
    }

    public void CloseNow(string reason = "shutdown")
    {
        CloseReason = reason;
        _timer.Stop();
        _closeNow = true;
        Close();
    }

    public void MarkRenderingFailed(Exception error)
    {
        RenderingFailed = true;
        AgentLogger.Error($"Popup rendering failed notificationId={ViewModel.NotificationId}", error);
    }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        var handle = new WindowInteropHelper(this).Handle;
        var source = HwndSource.FromHwnd(handle);
        if (source?.CompositionTarget is not null) source.CompositionTarget.BackgroundColor = Colors.Transparent;
        BackdropApplied = NotificationBackdropService.TryApply(handle);
        Background = BackdropApplied ? System.Windows.Media.Brushes.Transparent : ViewModel.FallbackBrush;

        var exStyle = GetWindowLong(handle, GwlExStyle);
        SetWindowLong(handle, GwlExStyle, exStyle | WsExNoActivate | WsExToolWindow);
        LogLifecycle($"SourceInitialized backdrop={BackdropApplied}");
    }

    protected override void OnClosing(CancelEventArgs e)
    {
        if (!_closeNow)
        {
            e.Cancel = true;
            CloseAnimated("dismissed");
            return;
        }
        base.OnClosing(e);
    }

    protected override void OnClosed(EventArgs e)
    {
        LogLifecycle($"Closed reason={CloseReason}");
        base.OnClosed(e);
    }

    private void LogLifecycle(string stage)
    {
        var handle = new WindowInteropHelper(this).Handle;
        var dpi = VisualTreeHelper.GetDpi(this);
        var monitorDpi = handle == IntPtr.Zero ? (uint)Math.Round(96 * dpi.DpiScaleX) : GetDpiForWindow(handle);
        var physicalBounds = NotificationPositioningService.GetPhysicalBounds(this);
        var physicalWidth = physicalBounds.Width > 0 ? physicalBounds.Width : (int)Math.Round(ActualWidth * dpi.DpiScaleX);
        var physicalHeight = physicalBounds.Height > 0 ? physicalBounds.Height : (int)Math.Round(ActualHeight * dpi.DpiScaleY);
        AgentLogger.Info($"Popup lifecycle notificationId={ViewModel.NotificationId} stage={stage} processId={Environment.ProcessId} threadId={Environment.CurrentManagedThreadId} dispatcherAccess={Dispatcher.CheckAccess()} isLoaded={IsLoaded} isVisible={IsVisible} visibility={Visibility} opacity={Opacity:F2} windowState={WindowState} left={Left:F1} top={Top:F1} wpfDips={ActualWidth:F1}x{ActualHeight:F1} physicalPixels={physicalWidth}x{physicalHeight} monitorDpi={monitorDpi} dpiScale={dpi.DpiScaleX:F2}x{dpi.DpiScaleY:F2} processDpiAwareness={GetDpiAwarenessMode()} workingAreaPx={WorkingArea.Left},{WorkingArea.Top},{WorkingArea.Right},{WorkingArea.Bottom}");
    }

    private static string GetDpiAwarenessMode()
    {
        var context = GetThreadDpiAwarenessContext();
        if (AreDpiAwarenessContextsEqual(context, new IntPtr(-4))) return "PerMonitorV2";
        if (AreDpiAwarenessContextsEqual(context, new IntPtr(-3))) return "PerMonitor";
        if (AreDpiAwarenessContextsEqual(context, new IntPtr(-2))) return "System";
        return "Unaware";
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetThreadDpiAwarenessContext();

    [DllImport("user32.dll")]
    private static extern bool AreDpiAwarenessContextsEqual(IntPtr first, IntPtr second);

    [DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern int GetWindowLong(IntPtr hwnd, int index);

    [DllImport("user32.dll")]
    private static extern int SetWindowLong(IntPtr hwnd, int index, int value);
}
