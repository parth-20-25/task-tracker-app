using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows.Input;
using System.Windows.Media;

namespace ParcNotify.Agent.Models;

public sealed class NotificationActionViewModel : INotifyPropertyChanged
{
    private ICommand? _command;
    private bool _isProcessing;

    public NotificationActionViewModel(string label, NotificationActionType actionType, bool isPrimary, Geometry? iconGlyph = null, string? targetTaskId = null)
    {
        Label = label;
        ActionType = actionType;
        IsPrimary = isPrimary;
        IconGlyph = iconGlyph;
        TargetTaskId = targetTaskId;
    }

    public string Label { get; }
    public string DisplayLabel => IsProcessing ? "Processing..." : Label;
    public NotificationActionType ActionType { get; }
    public bool IsPrimary { get; }
    public Geometry? IconGlyph { get; }
    public string? TargetTaskId { get; }
    public bool HasIcon => IconGlyph is not null;

    public bool IsProcessing
    {
        get => _isProcessing;
        set
        {
            if (_isProcessing == value) return;
            _isProcessing = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(DisplayLabel));
        }
    }

    public ICommand? Command
    {
        get => _command;
        set
        {
            _command = value;
            OnPropertyChanged();
        }
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    private void OnPropertyChanged([CallerMemberName] string? name = null) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}