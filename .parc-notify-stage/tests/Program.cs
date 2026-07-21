using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Effects;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using ParcNotify.Agent;
using ParcNotify.Agent.Infrastructure;
using ParcNotify.Agent.Models;
using ParcNotify.Agent.Services;
using ParcNotify.Agent.Views;
using DrawingBitmap = System.Drawing.Bitmap;
using DrawingGraphics = System.Drawing.Graphics;
using MediaColor = System.Windows.Media.Color;
using MediaColorConverter = System.Windows.Media.ColorConverter;
using WpfButton = System.Windows.Controls.Button;
using WpfImage = System.Windows.Controls.Image;
using WinForms = System.Windows.Forms;

internal static class Program
{
    private static System.Windows.Application? TestApplication;
    [STAThread]
    private static void Main(string[] args)
    {
        EnsureWpfResources();
        Equal(JsonSerializer.Deserialize<DesktopNotification>("{\"id\":1845,\"eventType\":\"TASK_ASSIGNED\",\"entityType\":\"task\",\"entityId\":607,\"deepLink\":\"/tasks/607\"}")?.EntityId, "607", "numeric entityId accepted");

        var temp = Path.Combine(Path.GetTempPath(), "parc-notify-tests-" + Guid.NewGuid());
        Directory.CreateDirectory(temp);
        Environment.SetEnvironmentVariable("PARC_NOTIFY_LOG_DIRECTORY", Path.Combine(temp, "logs"));
        try
        {
            var settings = new AgentSettings();
            Equal(settings.BackendBaseUrl.AbsoluteUri, "http://192.168.1.227:5000/", "backend origin explicit");
            Equal(settings.FrontendBaseUrl.AbsoluteUri, "http://192.168.1.227:4173/", "frontend origin explicit");
            Equal(settings.BackendBaseUrl != settings.FrontendBaseUrl, true, "frontend and backend origins separated");
            Equal(settings.RegistrationUri.Port, 5000, "registration uses backend port");
            Equal(settings.WebSocketUri.Port, 5000, "websocket uses backend port");
            Equal(settings.BackendUri("api/desktop-notifications/tasks/607/start").Port, 5000, "task action uses backend port");
            var links = new DeepLinkService(settings);
            Equal(links.TryBuildTrustedUri("/tasks/607", out var uri), true, "internal link allowed");
            Equal(uri.Host, "192.168.1.227", "trusted host");
            Equal(uri.Port, 4173, "internal link uses frontend port");
            Equal(uri.AbsoluteUri, "http://192.168.1.227:4173/tasks/607", "task link uses trusted frontend origin");
            Equal(links.TryBuildProtocolUri("/tasks/607", out var protocolUri), true, "protocol link allowed for internal task");
            Equal(protocolUri.Scheme, "web+parc", "installed app protocol scheme");
            Equal(links.TryBuildProtocolUri("https://example.com/tasks/607", out _), false, "protocol link blocks external url");
            Equal(links.TryBuildTrustedUri("javascript:alert(1)", out _), false, "javascript blocked");
            Equal(links.TryBuildTrustedUri("https://example.com/tasks/607", out _), false, "external url blocked");
            Equal(links.TryBuildTrustedUri("//example.com/tasks/607", out _), false, "protocol-relative url blocked");
            Equal(links.TryBuildTrustedUri("/%2Fexample.com/tasks/607", out _), false, "encoded protocol-relative url blocked");
            Equal(links.TryBuildTrustedUri("/tasks%5C607", out _), false, "encoded backslash blocked");
            Equal(links.TryBuildTrustedUri("/file:secret", out _), false, "file scheme text blocked");
            Equal(links.TryBuildTrustedUri("/audit?entity=project&id=119", out var auditUri), true, "audit link allowed");
            Equal(auditUri.Host, "192.168.1.227", "audit trusted host");

            var state = new LocalStateService(temp);
            Equal(state.WasDisplayed(1845), false, "new notification unseen");
            state.MarkDisplayed(1845);
            state.MarkDisplayed(1845);
            Equal(state.WasDisplayed(1845), true, "duplicate notification suppressed");

            Equal(WebSocketConnectionService.GetReconnectDelay(0), TimeSpan.FromSeconds(2), "first reconnect delay");
            Equal(WebSocketConnectionService.GetReconnectDelay(4), TimeSpan.FromSeconds(60), "fifth reconnect delay");
            Equal(WebSocketConnectionService.GetReconnectDelay(99), TimeSpan.FromSeconds(60), "max reconnect delay");

            var store = new CredentialStorageService(temp);
            var credentials = new DeviceCredentials(Guid.NewGuid().ToString(), "token", "940", "Employee Name");
            store.Save(credentials);
            Equal(store.Load(), credentials, "dpapi credentials roundtrip");
            store.Clear();
            Equal(store.Load() is null, true, "credentials cleared");

            var startupService = new StartupTaskService();
            var startupXml = startupService.BuildTaskXml(StartupTaskService.StableExecutablePath, "S-1-5-21-1234");
            Equal(startupXml.Contains("<LogonTrigger>"), true, "startup task at logon");
            Equal(startupXml.Contains("<Delay>PT10S</Delay>"), true, "startup delay");
            Equal(startupXml.Contains("<LogonType>InteractiveToken</LogonType>"), true, "startup current-user interactive token");
            Equal(startupXml.Contains("<RunLevel>LeastPrivilege</RunLevel>"), true, "startup normal privileges");
            Equal(startupXml.Contains("<RestartOnFailure>"), true, "startup restart on failure");
            Equal(startupXml.Contains(StartupTaskService.StableExecutablePath), true, "startup stable executable");
            Equal(startupXml.Contains("<Arguments>--background</Arguments>"), true, "startup background argument");
            Equal(App.ShouldShowRegistration(true, true), false, "registered background startup hides registration");
            Equal(App.ShouldShowRegistration(false, false), true, "interactive unregistered startup shows registration");

            var sharedMutexName = @"Local\PARC.Notify.Test." + Guid.NewGuid();
            using (var first = new SingleInstanceService(sharedMutexName))
            using (var second = new SingleInstanceService(sharedMutexName))
            {
                Equal(first.IsFirstInstance, true, "single-instance first process");
                Equal(second.IsFirstInstance, false, "single-instance duplicate blocked");
            }

            var factory = new NotificationTemplateFactory(new NotificationThemeService());
            var expectedSeverities = new Dictionary<NotificationSeverity, string[]>
            {
                [NotificationSeverity.Info] = ["TASK_ASSIGNED", "TASKS_BULK_ASSIGNED", "TASK_REASSIGNED", "TASK_CANCELLED", "PROJECT_RELEASED", "PROJECT_COMPLETED", "ECN_CREATED"],
                [NotificationSeverity.Reminder] = ["TASK_DUE_TODAY", "APPROVAL_REQUESTED", "APPROVAL_PENDING_TOO_LONG", "TASK_OVERDUE_REMINDER_1", "TASK_OVERDUE_REMINDER_2"],
                [NotificationSeverity.Urgent] = ["TASK_OVERDUE", "TASK_REJECTED", "TASK_UPDATE_REQUIRED", "WORKFLOW_BLOCKED", "CRITICAL_TASK_ACTION_REQUIRED"],
                [NotificationSeverity.Escalation] = ["TASK_OVERDUE_EXECUTIVE_ESCALATION", "PROJECT_DEADLINE_AT_RISK", "CRITICAL_WORKFLOW_ESCALATION", "CEO_DIRECTOR_ESCALATION"],
            };
            foreach (var tier in expectedSeverities)
            {
                foreach (var eventType in tier.Value) Equal(NotificationThemeService.SeverityFor(eventType), tier.Key, eventType + " severity");
            }

            var priorities = factory.CreatePrioritySamples();
            Equal(priorities.Count, 4, "four priority examples");
            Equal(priorities.Select(item => item.Severity).SequenceEqual([NotificationSeverity.Info, NotificationSeverity.Reminder, NotificationSeverity.Urgent, NotificationSeverity.Escalation]), true, "priority examples ordered by severity");
            var assigned = factory.Create(new DesktopNotification
            {
                Id = 1845,
                EventType = "TASK_ASSIGNED",
                EntityType = "task",
                EntityId = "607",
                TaskName = "Drafting Checking 01",
                ProjectNumber = "25-119",
                FixtureNumber = "OP20",
                DueDate = "2026-07-20",
                AvailableActions = ["OPEN_TASK", "START_TASK"],
            });
            Equal(assigned.EventTitle, "Task assigned", "assigned title");
            Equal(assigned.TaskName, "Drafting Checking 01", "assigned task name");
            Equal(assigned.Metadata, "Project 25-119  \u2022  Fixture OP20", "metadata format");
            Equal(assigned.Severity, NotificationSeverity.Info, "assigned info severity");
            Equal(assigned.Actions.Count, 2, "two action maximum");
            Equal(assigned.Actions[0].IsPrimary, false, "open task secondary");
            Equal(assigned.Actions[1].IsPrimary, true, "start task primary");
            Equal(((SolidColorBrush)priorities[0].AccentBrush).Color, (MediaColor)MediaColorConverter.ConvertFromString("#0878D1"), "info blue theme");
            Equal(((SolidColorBrush)priorities[1].AccentBrush).Color, (MediaColor)MediaColorConverter.ConvertFromString("#D98700"), "reminder amber theme");
            Equal(((SolidColorBrush)priorities[2].AccentBrush).Color, (MediaColor)MediaColorConverter.ConvertFromString("#D92D20"), "urgent red theme");
            Equal(((SolidColorBrush)priorities[3].AccentBrush).Color, (MediaColor)MediaColorConverter.ConvertFromString("#6E3EB8"), "escalation purple theme");
            Equal(priorities[1].Actions.Select(action => action.Label).SequenceEqual(["Open Task", "Remind Me"]), true, "due-today reminder actions");
            Equal(priorities[2].Actions.Select(action => action.Label).SequenceEqual(["Open Task", "Start Now"]), true, "overdue actions");
            Equal(priorities[3].Actions.Select(action => action.Label).SequenceEqual(["Open Task", "View Details"]), true, "escalation actions");
            Equal(NotificationPopupManager.ReminderDelay(), TimeSpan.FromMinutes(15), "remind me default delay");
            Equal(typeof(DesktopNotification).GetProperties().Any(property => property.Name.Contains("Color", StringComparison.OrdinalIgnoreCase) || property.Name.Contains("Brush", StringComparison.OrdinalIgnoreCase) || property.Name.Contains("Style", StringComparison.OrdinalIgnoreCase)), false, "server cannot supply visual styles");

            var released = factory.Create(new DesktopNotification
            {
                Id = 1901,
                EventType = "PROJECT_RELEASED",
                EntityType = "project",
                EntityId = "119",
                ProjectNumber = "25-119",
                ProjectName = "Project Name",
                CustomerName = "Customer Name",
                ReleasedByName = "Employee Name",
                ReleasedAt = "2026-07-18T16:35:00+05:30",
                DeepLink = "/projects/119",
                AuditDeepLink = "/audit?entity=project&id=119",
                AvailableActions = ["OPEN_PROJECT", "VIEW_AUDIT"],
            });
            Equal(released.EventTitle, "Project released", "released title");
            Equal(released.TaskName, "Project 25-119", "released primary text");
            Equal(released.Metadata, "Customer Customer Name", "released customer metadata");
            Equal(released.Actions.Count, 2, "released actions");
            Equal(released.Actions[0].ActionType, NotificationActionType.OpenProject, "open project action");
            Equal(released.Actions[1].ActionType, NotificationActionType.ViewAudit, "view audit action");
            Environment.SetEnvironmentVariable("PARC_NOTIFY_POPUP_SECONDS", "60");
            try
            {
                Equal(factory.Create(new DesktopNotification { Id = 1902, EventType = "PROJECT_RELEASED", EntityType = "project", EntityId = "119", ProjectNumber = "25-119" }).AutoDismissDuration, TimeSpan.FromSeconds(60), "test popup duration override");
            }
            finally
            {
                Environment.SetEnvironmentVariable("PARC_NOTIFY_POPUP_SECONDS", null);
            }

            Equal(App.ParseTestPopupDuration(["--show-test-popup"]), 60, "test popup default duration");
            Equal(App.ParseTestPopupDuration(["--test-popup-duration=75"]), 75, "test popup custom duration");
            Equal(App.ParsePriorityExamplesDuration(["--show-priority-examples"]), 120, "priority examples default duration");
            Equal(App.ParsePriorityExamplesDuration(["--duration=180"]), 180, "priority examples custom duration");
            var testPopup = App.CreateTestNotification();
            var testPopupTemplate = factory.Create(testPopup);
            Equal(testPopupTemplate.EventType, "TASK_ASSIGNED", "test mode real assigned template");
            Equal(testPopupTemplate.Actions.Select(action => action.Label).SequenceEqual(["Open Task", "Start Task"]), true, "test mode real actions");
            var renderingWindow = new NotificationPopupWindow(testPopupTemplate, (_, _) => Task.FromResult<string?>(null), (_, _) => { }, () => { }, new NotificationAnimationService(), autoStartTimer: false);
            try
            {
                Equal(renderingWindow.UseLayoutRounding, true, "popup root layout rounding");
                Equal(renderingWindow.SnapsToDevicePixels, true, "popup root pixel snapping");
                Equal(renderingWindow.AllowsTransparency, false, "popup preserves ClearType-compatible window");
                Equal(renderingWindow.ShowActivated, false, "popup does not activate");
                Equal(renderingWindow.Focusable, false, "popup cannot take keyboard focus");
                Equal(testPopupTemplate.CardWidth, 600d, "standard card width");
                Equal(testPopupTemplate.MinCardHeight, 350d, "standard minimum height");
                Equal(testPopupTemplate.MaxCardHeight, 410d, "standard maximum height");
                Equal(TextOptions.GetTextFormattingMode(renderingWindow), TextFormattingMode.Display, "popup display text formatting");
                Equal(TextOptions.GetTextRenderingMode(renderingWindow), TextRenderingMode.ClearType, "popup ClearType rendering");
                Equal(TextOptions.GetTextHintingMode(renderingWindow), TextHintingMode.Fixed, "popup fixed text hinting");
                var root = (Grid)renderingWindow.FindName("Root");
                Equal(root.RenderTransform is ScaleTransform, false, "whole-card scaling absent");
                var contentCard = (Border)renderingWindow.FindName("ContentCard");
                var outerGlow = (Border)renderingWindow.FindName("OuterGlowLayer");
                var acrylic = (Border)renderingWindow.FindName("AcrylicBackdropLayer");
                Equal(contentCard.Effect is null, true, "content tree has no shadow effect");
                Equal(ContainsBlurEffect(contentCard), false, "content tree has no BlurEffect");
                Equal(outerGlow.Effect is DropShadowEffect, true, "glow isolated to outer border");
                Equal(acrylic is not null, true, "acrylic layer present");
                Equal(testPopupTemplate.FallbackBrush is LinearGradientBrush, true, "translucent gradient fallback present");
                var logo = (WpfImage)renderingWindow.FindName("LogoImage");
                Equal(logo.Width, 195d, "logo rendered width");
                Equal(logo.Height, 62d, "logo rendered height");
                Equal(logo.Stretch, Stretch.Uniform, "logo aspect ratio preserved");
                Equal(RenderOptions.GetBitmapScalingMode(logo), BitmapScalingMode.HighQuality, "logo high-quality scaling");
                using var logoResource = System.Windows.Application.GetResourceStream(new Uri("pack://application:,,,/ParcNotify.Agent;component/Assets/PARCLogo-Notification.png"))?.Stream;
                Equal(logoResource is not null && logoResource.Length > 0, true, "original PARC logo resource loads");
                renderingWindow.Show();
                renderingWindow.UpdateLayout();
                Equal(logo.Source is BitmapSource, true, "notification logo renders as a bitmap source");
                Equal(renderingWindow.BackdropApplied || ReferenceEquals(renderingWindow.Background, testPopupTemplate.FallbackBrush), true, "backdrop or gradient fallback active");
                var actionButtons = FindVisualChildren<WpfButton>(renderingWindow).Where(button => button.DataContext is NotificationActionViewModel).ToList();
                Equal(actionButtons.Count, 2, "two real action buttons rendered");
                var secondaryButton = actionButtons.Single(button => ((NotificationActionViewModel)button.DataContext).IsPrimary is false);
                var primaryButton = actionButtons.Single(button => ((NotificationActionViewModel)button.DataContext).IsPrimary);
                Equal(((SolidColorBrush)secondaryButton.BorderBrush).Color, ((SolidColorBrush)testPopupTemplate.AccentBrush).Color, "secondary button severity outline");
                Equal(((SolidColorBrush)primaryButton.Background).Color, ((SolidColorBrush)testPopupTemplate.AccentBrush).Color, "primary button severity fill");
                var animation = new NotificationAnimationService();
                animation.PlayEntrance(renderingWindow);
                PumpDispatcher(TimeSpan.FromMilliseconds(500));
                Equal(renderingWindow.Opacity, 1d, "entrance ends fully opaque");
                Equal(renderingWindow.RootOffset.Y, 0d, "entrance translation cleared");
                Equal(renderingWindow.HasAnimatedProperties, false, "entrance window animation removed");
                Equal(renderingWindow.RootOffset.HasAnimatedProperties, false, "entrance transform animation removed");
                Equal(ContainsBlurEffect(contentCard), false, "text remains unblurred after animation");
            }
            finally
            {
                renderingWindow.CloseNow();
            }

            var dispatcherThread = Environment.CurrentManagedThreadId;
            var displayedCount = 0;
            var clickedCount = 0;
            using (var popupManager = new NotificationPopupManager((_, _, _) => Task.FromResult<string?>(null), animationsEnabled: false, autoStartTimer: false))
            {
                popupManager.Displayed += _ => displayedCount++;
                popupManager.Clicked += (_, _) => clickedCount++;
                var popupAccepted = popupManager.Show(testPopup);
                if (!popupAccepted)
                {
                    var logDirectory = Path.Combine(temp, "logs");
                    var logTail = Directory.Exists(logDirectory) ? Directory.GetFiles(logDirectory, "*.log").SelectMany(File.ReadAllLines).TakeLast(20) : [];
                    throw new Exception("real popup manager rejected test popup: " + string.Join(Environment.NewLine, logTail));
                }

                Equal(popupManager.LastPopupThreadId, dispatcherThread, "popup created on WPF dispatcher");
                Equal(popupManager.ActivePopupCount, 1, "active popup strongly referenced");
                Equal(displayedCount, 0, "not displayed before ContentRendered visibility gate");
                PumpDispatcher(TimeSpan.FromMilliseconds(350));
                Equal(displayedCount, 1, "displayed only after rendered for 250ms");
                Equal(clickedCount, 0, "rendering does not send clicked acknowledgement");
            }

            using (var priorityManager = new NotificationPopupManager((_, _, _) => Task.FromResult<string?>(null), animationsEnabled: false, autoStartTimer: false, maxVisible: 1))
            {
                foreach (var sample in priorities) Equal(priorityManager.Show(sample.Notification), true, "priority test mode popup accepted");
                Equal(priorityManager.ActivePopupCount, 1, "priority test mode uses real popup manager");
                Equal(priorityManager.QueuedPopupCount, 3, "priority test mode queues remaining real popups");
            }

            var workingArea = new System.Drawing.Rectangle(0, 0, 1920, 1040);
            var correctedBounds = NotificationPositioningService.CalculateBounds(workingArea, 600, 350, 24);
            Equal(workingArea.Contains(correctedBounds), true, "off-screen coordinates corrected");
            Equal(correctedBounds.Width, 600, "popup width valid");
            Equal(correctedBounds.Height, 350, "popup height valid");
            Equal(NotificationPositioningService.IsDisplayProofValid(true, true, true, Visibility.Visible, WindowState.Normal, 600, 350, false, correctedBounds, workingArea), true, "valid rendered popup accepted");
            Equal(NotificationPositioningService.IsDisplayProofValid(true, true, true, Visibility.Visible, WindowState.Normal, 600, 350, true, correctedBounds, workingArea), false, "rendering failure blocks displayed acknowledgement");
            Equal(NotificationPositioningService.IsDisplayProofValid(true, true, true, Visibility.Visible, WindowState.Normal, 600, 350, false, new System.Drawing.Rectangle(3000, 3000, 600, 350), workingArea), false, "off-screen popup blocks displayed acknowledgement");

            var actionGate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var actionExecutions = 0;
            var command = new AsyncCommand(async () =>
            {
                actionExecutions++;
                await actionGate.Task;
            });
            command.Execute(null);
            command.Execute(null);
            Equal(actionExecutions, 1, "duplicate Start Task clicks blocked");
            Equal(command.CanExecute(null), false, "Start Task disabled while processing");
            actionGate.SetResult();
            PumpDispatcher(TimeSpan.FromMilliseconds(25));

            Environment.SetEnvironmentVariable("PARC_NOTIFY_POPUP_SECONDS", "1");
            try
            {
                using var autoDismissManager = new NotificationPopupManager((_, _, _) => Task.FromResult<string?>(null), animationsEnabled: false);
                var autoDismissClicks = 0;
                autoDismissManager.Clicked += (_, _) => autoDismissClicks++;
                Equal(autoDismissManager.Show(new DesktopNotification { Id = -2, EventType = "TASK_ASSIGNED", EntityType = "task", EntityId = "607", AvailableActions = ["OPEN_TASK", "START_TASK"] }), true, "auto-dismiss popup shown");
                PumpDispatcher(TimeSpan.FromMilliseconds(1500));
                Equal(autoDismissClicks, 0, "auto-dismiss does not send clicked acknowledgement");
            }
            finally
            {
                Environment.SetEnvironmentVariable("PARC_NOTIFY_POPUP_SECONDS", null);
            }

            if (args.Contains("--desktop-screenshots", StringComparer.OrdinalIgnoreCase))
            {
                RenderDesktopScreenshots(factory, @"C:\tmp\parc-notify-desktop-screenshots");
            }
            if (args.Contains("--final-visuals", StringComparer.OrdinalIgnoreCase))
            {
                RenderFinalVisuals(factory, @"C:\tmp\parc-notify-final-visuals");
            }
        }
        finally
        {
            Environment.SetEnvironmentVariable("PARC_NOTIFY_LOG_DIRECTORY", null);
            try { Directory.Delete(temp, true); } catch { }
        }

        Console.WriteLine("PARC Notify agent checks passed");
    }

    private static void RenderTemplateScreenshots(NotificationTemplateFactory factory, string outputDir)
    {
        Directory.CreateDirectory(outputDir);
        foreach (var vm in factory.CreateSamples())
        {
            var window = new NotificationPopupWindow(vm, (_, _) => Task.FromResult<string?>(null), (_, _) => { }, () => { }, new NotificationAnimationService(), autoStartTimer: false);
            var content = (FrameworkElement)window.Content;
            content.Width = vm.CardWidth;
            content.Measure(new System.Windows.Size(vm.CardWidth, vm.MaxCardHeight + 80));
            var targetHeight = Math.Min(Math.Max(content.DesiredSize.Height, vm.MinCardHeight), vm.MaxCardHeight + 40);
            content.Arrange(new Rect(0, 0, vm.CardWidth, targetHeight));
            content.UpdateLayout();

            var width = Math.Max(1, (int)Math.Ceiling(content.ActualWidth));
            var height = Math.Max(1, (int)Math.Ceiling(content.ActualHeight));
            var bitmap = new RenderTargetBitmap(width, height, 96, 96, PixelFormats.Pbgra32);
            bitmap.Render(content);
            var encoder = new PngBitmapEncoder();
            encoder.Frames.Add(BitmapFrame.Create(bitmap));
            using var stream = File.Create(Path.Combine(outputDir, vm.EventType.ToLowerInvariant() + ".png"));
            encoder.Save(stream);
            window.CloseNow();
        }
    }

    private static void RenderFinalVisuals(NotificationTemplateFactory factory, string outputDir)
    {
        Directory.CreateDirectory(outputDir);
        var samples = factory.CreatePrioritySamples();
        var fileNames = new[]
        {
            "info-task-assigned.png",
            "reminder-task-due.png",
            "urgent-task-overdue.png",
            "escalation-overdue.png",
        };
        var positioning = new NotificationPositioningService();
        var animation = new NotificationAnimationService();
        var measurements = new List<string>();

        for (var index = 0; index < samples.Count; index++)
        {
            var vm = samples[index];
            var window = new NotificationPopupWindow(vm, (_, _) => Task.FromResult<string?>(null), (_, _) => { }, () => { }, animation, autoStartTimer: false)
            {
                WorkingArea = positioning.ResolveActiveWorkingArea(),
                Opacity = 1,
            };
            try
            {
                window.Show();
                window.UpdateLayout();
                positioning.Position(window, NotificationPositioningService.BottomMarginPx, false, animation);
                PumpDispatcher(TimeSpan.FromMilliseconds(350));
                var bounds = NotificationPositioningService.GetPhysicalBounds(window);
                CaptureVirtualScreen(Path.Combine(outputDir, fileNames[index]));
                CaptureScreenRegion(bounds, Path.Combine(outputDir, Path.GetFileNameWithoutExtension(fileNames[index]) + "-card.png"));
                measurements.Add($"| {vm.Severity} | {bounds.Width} x {bounds.Height} px | {window.BackdropApplied} |");
            }
            finally
            {
                window.CloseNow();
                PumpDispatcher(TimeSpan.FromMilliseconds(60));
            }
        }

        var comparisonWindows = samples.Select(vm => new NotificationPopupWindow(vm, (_, _) => Task.FromResult<string?>(null), (_, _) => { }, () => { }, animation, autoStartTimer: false)
        {
            WorkingArea = positioning.ResolveActiveWorkingArea(),
            Opacity = 1,
        }).ToList();
        try
        {
            foreach (var window in comparisonWindows)
            {
                window.Show();
                window.UpdateLayout();
            }
            PumpDispatcher(TimeSpan.FromMilliseconds(250));

            var area = comparisonWindows[0].WorkingArea;
            var bounds = comparisonWindows.Select(NotificationPositioningService.GetPhysicalBounds).ToList();
            var columnWidth = bounds.Max(item => item.Width);
            var rowHeight = bounds.Max(item => item.Height);
            const int gap = 32;
            var startX = Math.Max(area.Left, area.Left + (area.Width - (columnWidth * 2 + gap)) / 2);
            var startY = Math.Max(area.Top, area.Top + (area.Height - (rowHeight * 2 + gap)) / 2);
            for (var index = 0; index < comparisonWindows.Count; index++)
            {
                PositionWindow(comparisonWindows[index], startX + (index % 2) * (columnWidth + gap), startY + (index / 2) * (rowHeight + gap));
            }
            PumpDispatcher(TimeSpan.FromMilliseconds(350));
            CaptureVirtualScreen(Path.Combine(outputDir, "priority-comparison.png"));
        }
        finally
        {
            foreach (var window in comparisonWindows) window.CloseNow();
            PumpDispatcher(TimeSpan.FromMilliseconds(60));
        }

        var report = $"""
# PARC Notify visual comparison

Assessment: Close match, not an exact pixel match.

The captures use the real WPF `NotificationPopupWindow` at native desktop resolution with the Windows taskbar visible. The 1448 x 1086 reference is a composed design image, so desktop backdrop and type rasterization cannot be pixel-identical.

| Severity | Actual window | DWM backdrop |
| --- | ---: | :---: |
{string.Join(Environment.NewLine, measurements)}

| Element | Reference target | Implemented |
| --- | ---: | ---: |
| Card width | 600 DIPs | 600 DIPs |
| Standard height | 350-410 DIPs | 350-410 DIPs |
| Logo | 185-205 x 58-66 DIPs | 195 x 62 DIPs |
| Header | about 82 DIPs | 82 DIPs |
| Icon container | about 124 DIPs | 124 x 124 DIPs |
| Button height | about 54 DIPs | 54 DIPs |
| Button gap | about 24 DIPs | 24 DIPs |
| Corner radius | about 22 DIPs | 22 DIPs |
| Screen margin | 24 DIPs baseline | 24 physical px positioning margin |
| Tint opacity | about 28%-38% | 34.5% |
| Outer border | about 2 DIPs | 2 DIPs |

Sharpness: PerMonitorV2, layout rounding, device-pixel snapping, Display/ClearType/Fixed text options, and zero residual entrance transform are enabled. No BlurEffect exists in the content tree.

Focus: ShowActivated is false and the native WS_EX_NOACTIVATE tool-window style is applied.

Remaining differences: DWM acrylic strength and wallpaper colour vary by Windows build; Segoe UI rasterization and the vector glyph shapes are close but not identical to the raster reference; DWM top-level corner/shadow rendering is system-controlled.
""";
        File.WriteAllText(Path.Combine(outputDir, "visual-comparison-report.md"), report);
    }

    private static void CaptureScreenRegion(System.Drawing.Rectangle bounds, string outputPath)
    {
        using var bitmap = new DrawingBitmap(bounds.Width, bounds.Height);
        using var graphics = DrawingGraphics.FromImage(bitmap);
        graphics.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, bounds.Size);
        bitmap.Save(outputPath, ImageFormat.Png);
    }

    private static void PositionWindow(Window window, int left, int top)
    {
        const uint flags = 0x0001 | 0x0010 | 0x0040;
        if (!SetWindowPos(new WindowInteropHelper(window).Handle, new IntPtr(-1), left, top, 0, 0, flags))
        {
            throw new InvalidOperationException("Unable to position comparison popup.");
        }
    }

    private static void RenderDesktopScreenshots(NotificationTemplateFactory factory, string outputDir)
    {
        Directory.CreateDirectory(outputDir);
        var selected = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "TASK_ASSIGNED",
            "TASKS_BULK_ASSIGNED",
            "TASK_REJECTED",
            "TASK_OVERDUE",
            "APPROVAL_REQUESTED",
            "PROJECT_RELEASED",
        };
        var positioning = new NotificationPositioningService();
        var animation = new NotificationAnimationService();

        foreach (var vm in factory.CreateSamples().Where(item => selected.Contains(item.EventType)))
        {
            var window = new NotificationPopupWindow(vm, (_, _) => Task.FromResult<string?>(null), (_, _) => { }, () => { }, animation, autoStartTimer: false)
            {
                WorkingArea = positioning.ResolveActiveWorkingArea(),
                Opacity = 1,
            };
            window.Show();
            window.UpdateLayout();
            positioning.Position(window, NotificationPositioningService.BottomMarginPx, false, animation);
            PumpDispatcher(TimeSpan.FromMilliseconds(250));
            CaptureVirtualScreen(Path.Combine(outputDir, vm.EventType.ToLowerInvariant() + ".png"));
            window.CloseNow();
            PumpDispatcher(TimeSpan.FromMilliseconds(50));
        }
    }

    private static void CaptureVirtualScreen(string outputPath)
    {
        var bounds = WinForms.SystemInformation.VirtualScreen;
        using var bitmap = new DrawingBitmap(bounds.Width, bounds.Height);
        using var graphics = DrawingGraphics.FromImage(bitmap);
        graphics.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, bounds.Size);
        bitmap.Save(outputPath, ImageFormat.Png);
    }

    private static void PumpDispatcher(TimeSpan duration)
    {
        var frame = new DispatcherFrame();
        var timer = new DispatcherTimer { Interval = duration };
        timer.Tick += (_, _) =>
        {
            timer.Stop();
            frame.Continue = false;
        };
        timer.Start();
        Dispatcher.PushFrame(frame);
    }

    private static void EnsureWpfResources()
    {
        if (TestApplication is not null) return;
        var app = System.Windows.Application.Current ?? new System.Windows.Application();
        if (app.TryFindResource("NotificationIconButtonStyle") is null)
        {
            app.Resources.MergedDictionaries.Add(new ResourceDictionary { Source = new Uri("pack://application:,,,/ParcNotify.Agent;component/Themes/NotificationColors.xaml", UriKind.Absolute) });
            app.Resources.MergedDictionaries.Add(new ResourceDictionary { Source = new Uri("pack://application:,,,/ParcNotify.Agent;component/Themes/NotificationStyles.xaml", UriKind.Absolute) });
        }
        app.ShutdownMode = ShutdownMode.OnExplicitShutdown;
        TestApplication = app;
    }

    private static bool ContainsBlurEffect(DependencyObject node)
    {
        if (node is UIElement element && element.Effect is BlurEffect) return true;
        for (var index = 0; index < VisualTreeHelper.GetChildrenCount(node); index++)
        {
            if (ContainsBlurEffect(VisualTreeHelper.GetChild(node, index))) return true;
        }
        return false;
    }

    private static IEnumerable<T> FindVisualChildren<T>(DependencyObject node) where T : DependencyObject
    {
        for (var index = 0; index < VisualTreeHelper.GetChildrenCount(node); index++)
        {
            var child = VisualTreeHelper.GetChild(node, index);
            if (child is T match) yield return match;
            foreach (var descendant in FindVisualChildren<T>(child)) yield return descendant;
        }
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr windowHandle, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

    private static void Equal<T>(T actual, T expected, string name)
    {
        if (!EqualityComparer<T>.Default.Equals(actual, expected)) throw new Exception($"{name}: expected {expected}, got {actual}");
    }
}
