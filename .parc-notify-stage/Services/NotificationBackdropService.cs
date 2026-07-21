using System.Runtime.InteropServices;

namespace ParcNotify.Agent.Services;

public static class NotificationBackdropService
{
    private const int DwmwaWindowCornerPreference = 33;
    private const int DwmwaSystemBackdropType = 38;
    private const int DwmwcpRound = 2;
    private const int DwmsbtTransientWindow = 3;

    public static bool TryApply(IntPtr windowHandle)
    {
        if (!OperatingSystem.IsWindows() || windowHandle == IntPtr.Zero) return false;
        if (DwmIsCompositionEnabled(out var enabled) != 0 || !enabled) return false;

        var margins = new Margins { Left = -1, Right = -1, Top = -1, Bottom = -1 };
        if (DwmExtendFrameIntoClientArea(windowHandle, ref margins) != 0) return false;

        var backdrop = DwmsbtTransientWindow;
        if (DwmSetWindowAttribute(windowHandle, DwmwaSystemBackdropType, ref backdrop, sizeof(int)) != 0) return false;

        var corner = DwmwcpRound;
        _ = DwmSetWindowAttribute(windowHandle, DwmwaWindowCornerPreference, ref corner, sizeof(int));
        return true;
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmIsCompositionEnabled(out bool enabled);

    [DllImport("dwmapi.dll")]
    private static extern int DwmExtendFrameIntoClientArea(IntPtr windowHandle, ref Margins margins);

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr windowHandle, int attribute, ref int value, int valueSize);

    [StructLayout(LayoutKind.Sequential)]
    private struct Margins
    {
        public int Left;
        public int Right;
        public int Top;
        public int Bottom;
    }
}
