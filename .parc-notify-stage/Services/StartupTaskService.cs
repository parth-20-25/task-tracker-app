using System.Diagnostics;
using System.IO;
using System.Security;
using System.Security.Principal;
using System.Text;

namespace ParcNotify.Agent.Services;

public sealed class StartupTaskService
{
    public const string TaskName = "PARC Notify";
    public static string StablePublishedDirectory => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PARC", "Notify", "App");
    public static string StableExecutablePath => Path.Combine(StablePublishedDirectory, "ParcNotify.Agent.exe");

    public string BuildTaskXml(string exePath, string userSid)
    {
        var command = SecurityElement.Escape(Path.GetFullPath(exePath));
        var user = SecurityElement.Escape(userSid);
        return $"""
            <?xml version="1.0" encoding="UTF-16"?>
            <Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
              <RegistrationInfo><Author>PARC</Author><Description>Starts PARC Notify after the current user signs in.</Description></RegistrationInfo>
              <Triggers><LogonTrigger><Enabled>true</Enabled><Delay>PT10S</Delay><UserId>{user}</UserId></LogonTrigger></Triggers>
              <Principals><Principal id="Author"><UserId>{user}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
              <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable><AllowHardTerminate>true</AllowHardTerminate><Enabled>true</Enabled><Hidden>false</Hidden><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><Priority>7</Priority><RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure></Settings>
              <Actions Context="Author"><Exec><Command>{command}</Command><Arguments>--background</Arguments></Exec></Actions>
            </Task>
            """;
    }

    public void Install()
    {
        if (!File.Exists(StableExecutablePath)) throw new FileNotFoundException("Publish PARC Notify to the stable application folder before installing startup.", StableExecutablePath);
        var sid = WindowsIdentity.GetCurrent().User?.Value ?? throw new InvalidOperationException("Unable to resolve the current Windows user SID.");
        var xmlPath = Path.Combine(Path.GetTempPath(), $"parc-notify-startup-{Environment.ProcessId}.xml");
        try
        {
            File.WriteAllText(xmlPath, BuildTaskXml(StableExecutablePath, sid), Encoding.Unicode);
            var result = RunSchtasks("/Create", "/TN", TaskName, "/XML", xmlPath, "/F");
            if (result.ExitCode != 0) throw new InvalidOperationException("Startup installation failed: " + result.Output);
        }
        finally
        {
            try { File.Delete(xmlPath); } catch { }
        }
    }

    public void Remove()
    {
        var result = RunSchtasks("/Delete", "/TN", TaskName, "/F");
        if (result.ExitCode != 0 && !result.Output.Contains("cannot find", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Startup removal failed: " + result.Output);
        }
    }

    public bool IsInstalled() => RunSchtasks("/Query", "/TN", TaskName).ExitCode == 0;

    public string Status()
    {
        var result = RunSchtasks("/Query", "/TN", TaskName, "/FO", "LIST", "/V");
        return result.ExitCode == 0 ? result.Output : "Not installed";
    }

    private static ProcessResult RunSchtasks(params string[] arguments)
    {
        var start = new ProcessStartInfo("schtasks.exe")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        foreach (var argument in arguments) start.ArgumentList.Add(argument);
        using var process = Process.Start(start) ?? throw new InvalidOperationException("Unable to start Windows Task Scheduler.");
        var output = process.StandardOutput.ReadToEnd() + process.StandardError.ReadToEnd();
        if (!process.WaitForExit(15_000))
        {
            process.Kill(true);
            throw new TimeoutException("Windows Task Scheduler did not respond within 15 seconds.");
        }
        return new ProcessResult(process.ExitCode, output.Trim());
    }

    private sealed record ProcessResult(int ExitCode, string Output);
}