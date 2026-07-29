using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;

namespace ParcNotify.Agent.Services;

public static class WindowsLoginSessionService
{
    private const int TokenStatistics = 10;

    public static string CurrentId()
    {
        if (!OperatingSystem.IsWindows()) return "non-windows-session";
        var identity = WindowsIdentity.GetCurrent();
        var size = 0;
        _ = GetTokenInformation(identity.Token, TokenStatistics, IntPtr.Zero, 0, out size);
        var buffer = Marshal.AllocHGlobal(size);
        try
        {
            if (!GetTokenInformation(identity.Token, TokenStatistics, buffer, size, out _))
            {
                throw new InvalidOperationException("Windows login session identity is unavailable.");
            }
            var statistics = Marshal.PtrToStructure<TokenStatisticsData>(buffer);
            var raw = $"{identity.User?.Value}:{statistics.AuthenticationId.HighPart:x8}{statistics.AuthenticationId.LowPart:x8}";
            return Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(raw)))[..32];
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(IntPtr tokenHandle, int informationClass, IntPtr information, int informationLength, out int returnLength);

    [StructLayout(LayoutKind.Sequential)]
    private struct Luid
    {
        public uint LowPart;
        public int HighPart;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct TokenStatisticsData
    {
        public Luid TokenId;
        public Luid AuthenticationId;
        public long ExpirationTime;
        public int TokenType;
        public int ImpersonationLevel;
        public uint DynamicCharged;
        public uint DynamicAvailable;
        public uint GroupCount;
        public uint PrivilegeCount;
        public Luid ModifiedId;
    }
}