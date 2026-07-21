using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using Geometry = System.Windows.Media.Geometry;
using MediaBrush = System.Windows.Media.Brush;
using MediaColor = System.Windows.Media.Color;

namespace ParcNotify.Agent.Models;

public sealed class NotificationPopupViewModel : INotifyPropertyChanged
{
    private bool _isActionProcessing;
    private string? _actionError;

    public required DesktopNotification Notification { get; init; }
    public required string NotificationId { get; init; }
    public required string EventType { get; init; }
    public required NotificationSeverity Severity { get; init; }
    public string HeaderApplicationName { get; init; } = "PARC Task Tracker";
    public required string EventTitle { get; init; }
    public string? TaskName { get; init; }
    public required string Metadata { get; init; }
    public string? StatusText { get; init; }
    public required MediaBrush StatusBrush { get; init; }
    public required MediaBrush IconBrush { get; init; }
    public required MediaBrush AccentBrush { get; init; }
    public required MediaBrush AccentHoverBrush { get; init; }
    public required MediaBrush AccentPressedBrush { get; init; }
    public required MediaBrush BrightBorderBrush { get; init; }
    public required MediaBrush TintBrush { get; init; }
    public required MediaBrush IconContainerBrush { get; init; }
    public required MediaBrush FallbackBrush { get; init; }
    public required MediaColor GlowColor { get; init; }
    public required Geometry IconGlyph { get; init; }
    public IReadOnlyList<string> TaskItems { get; init; } = [];
    public string? MoreTasksText { get; init; }
    public ObservableCollection<NotificationActionViewModel> Actions { get; } = [];
    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.Now;
    public TimeSpan AutoDismissDuration { get; init; } = TimeSpan.FromSeconds(15);
    public string Priority { get; init; } = "normal";
    public double CardWidth { get; init; } = 600;
    public double MinCardHeight { get; init; } = 350;
    public double MaxCardHeight { get; init; } = 410;

    public bool HasTaskName => !string.IsNullOrWhiteSpace(TaskName);
    public bool HasTaskItems => TaskItems.Count > 0;
    public bool HasMoreTasksText => !string.IsNullOrWhiteSpace(MoreTasksText);
    public bool HasStatusText => !string.IsNullOrWhiteSpace(StatusText);
    public bool HasActions => Actions.Count > 0;
    public bool HasActionError => !string.IsNullOrWhiteSpace(ActionError);

    public bool IsActionProcessing
    {
        get => _isActionProcessing;
        set
        {
            if (_isActionProcessing == value) return;
            _isActionProcessing = value;
            OnPropertyChanged();
        }
    }

    public string? ActionError
    {
        get => _actionError;
        set
        {
            if (_actionError == value) return;
            _actionError = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(HasActionError));
        }
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    private void OnPropertyChanged([CallerMemberName] string? name = null) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
