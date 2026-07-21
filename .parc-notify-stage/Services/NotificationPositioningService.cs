using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Forms;
using System.Windows.Interop;
using System.Windows.Media;
using ParcNotify.Agent.Infrastructure;
using ParcNotify.Agent.Views;

namespace ParcNotify.Agent.Services;

public sealed class NotificationPositioningService
{
    public const int RightMarginPx = 24;
    public const int BottomMarginPx = 24;
    public const int StackGapPx = 16;
    private static readonly IntPtr HwndTopmost = new(-1);
    private const uint SwpNoSize = 0x0001;
    private const uint SwpNoActivate = 0x0010;
    private const uint SwpShowWindow = 0x0040;

    public System.Drawing.Rectangle ResolveActiveWorkingArea()
    {
        if (string.Equals(Environment.GetEnvironmentVariable("PARC_NOTIFY_FORCE_PRIMARY_SCREEN"), "true", StringComparison.OrdinalIgnoreCase))
        {
            return LogWorkingArea(Screen.PrimaryScreen?.WorkingArea ?? Screen.AllScreens.First().WorkingArea, "primary");
        }

        var foreground = GetForegroundWindow();
        if (foreground != IntPtr.Zero) return LogWorkingArea(Screen.FromHandle(foreground).WorkingArea, "foreground");
        return LogWorkingArea(Screen.PrimaryScreen?.WorkingArea ?? Screen.AllScreens.First().WorkingArea, "fallback-primary");
    }

    public double HeightInPixels(Window window)
    {
        var bounds = GetPhysicalBounds(window);
        if (bounds.Height > 0) return bounds.Height;
        var dpi = VisualTreeHelper.GetDpi(window);
        return (window.ActualHeight > 0 ? window.ActualHeight : window.MinHeight) * dpi.DpiScaleY;
    }

    public void Position(NotificationPopupWindow window, double bottomOffsetPx, bool animate, NotificationAnimationService animation)
    {
        _ = animate;
        _ = animation;
        var current = GetPhysicalBounds(window);
        var dpi = VisualTreeHelper.GetDpi(window);
        var widthPx = current.Width > 0 ? current.Width : (int)Math.Ceiling((window.ActualWidth > 0 ? window.ActualWidth : window.Width) * dpi.DpiScaleX);
        var heightPx = current.Height > 0 ? current.Height : (int)Math.Ceiling((window.ActualHeight > 0 ? window.ActualHeight : window.MinHeight) * dpi.DpiScaleY);
        var target = CalculateBounds(window.WorkingArea, widthPx, heightPx, bottomOffsetPx);
        var handle = new WindowInteropHelper(window).Handle;
        if (handle == IntPtr.Zero || !SetWindowPos(handle, HwndTopmost, target.Left, target.Top, 0, 0, SwpNoSize | SwpNoActivate | SwpShowWindow))
        {
            throw new InvalidOperationException("Unable to position the popup on the selected monitor.");
        }
        window.UpdateLayout();
        LogBounds(window, GetPhysicalBounds(window));
    }

    public bool IsDisplayReady(NotificationPopupWindow window)
    {
        return IsDisplayProofValid(
            window.LoadedObserved,
            window.ContentRenderedObserved,
            window.IsVisible,
            window.Visibility,
            window.WindowState,
            window.ActualWidth,
            window.ActualHeight,
            window.RenderingFailed,
            GetPhysicalBounds(window),
            window.WorkingArea);
    }

    public static bool IsDisplayProofValid(bool loaded, bool contentRendered, bool isVisible, Visibility visibility, WindowState state, double width, double height, bool renderingFailed, System.Drawing.Rectangle popupBounds, System.Drawing.Rectangle workingArea)
    {
        return loaded
            && contentRendered
            && isVisible
            && visibility == Visibility.Visible
            && state == WindowState.Normal
            && width > 0
            && height > 0
            && !renderingFailed
            && popupBounds.Width > 0
            && popupBounds.Height > 0
            && workingArea.IntersectsWith(popupBounds);
    }

    public static System.Drawing.Rectangle CalculateBounds(System.Drawing.Rectangle workingArea, int widthPx, int heightPx, double bottomOffsetPx)
    {
        var width = Math.Clamp(widthPx, 1, workingArea.Width);
        var height = Math.Clamp(heightPx, 1, workingArea.Height);
        var left = Math.Clamp(workingArea.Right - RightMarginPx - width, workingArea.Left, workingArea.Right - width);
        var top = Math.Clamp(workingArea.Bottom - (int)Math.Ceiling(bottomOffsetPx) - height, workingArea.Top, workingArea.Bottom - height);
        return new System.Drawing.Rectangle(left, top, width, height);
    }

    public static System.Drawing.Rectangle GetPhysicalBounds(Window window)
    {
        var handle = new WindowInteropHelper(window).Handle;
        if (handle != IntPtr.Zero && GetWindowRect(handle, out var rect))
        {
            return System.Drawing.Rectangle.FromLTRB(rect.Left, rect.Top, rect.Right, rect.Bottom);
        }
        return System.Drawing.Rectangle.Empty;
    }

    private static void LogBounds(NotificationPopupWindow window, System.Drawing.Rectangle physicalBounds)
    {
        var area = window.WorkingArea;
        AgentLogger.Info($"Popup bounds notificationId={window.ViewModel.NotificationId} physicalMonitorPx={area.Left},{area.Top},{area.Right},{area.Bottom} wpfDips={window.Left:F1},{window.Top:F1},{window.ActualWidth:F1},{window.ActualHeight:F1} convertedPopupPx={physicalBounds.Left},{physicalBounds.Top},{physicalBounds.Right},{physicalBounds.Bottom}");
    }

    private static System.Drawing.Rectangle LogWorkingArea(System.Drawing.Rectangle area, string source)
    {
        AgentLogger.Info($"Popup monitor working area source={source} physicalPx={area.Left},{area.Top},{area.Right},{area.Bottom}");
        return area;
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetWindowRect(IntPtr hWnd, out Rect rect);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint flags);

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }
}
