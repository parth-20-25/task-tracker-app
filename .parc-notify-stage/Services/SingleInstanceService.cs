namespace ParcNotify.Agent.Services;

public sealed class SingleInstanceService : IDisposable
{
    public const string DefaultName = @"Local\PARC.Notify.Agent";
    private readonly Mutex _mutex;
    private readonly EventWaitHandle _activationSignal;
    private readonly CancellationTokenSource _lifetime = new();
    private readonly bool _ownsMutex;
    private Task? _listener;

    public SingleInstanceService(string name = DefaultName)
    {
        _mutex = new Mutex(true, name, out _ownsMutex);
        _activationSignal = new EventWaitHandle(false, EventResetMode.AutoReset, name + ".Activate");
    }

    public bool IsFirstInstance => _ownsMutex;
    public event Action? ActivationRequested;

    public void SignalExisting() => _activationSignal.Set();

    public void StartListening()
    {
        if (!_ownsMutex || _listener is not null) return;
        _listener = Task.Run(() =>
        {
            var handles = new WaitHandle[] { _activationSignal, _lifetime.Token.WaitHandle };
            while (!_lifetime.IsCancellationRequested)
            {
                if (WaitHandle.WaitAny(handles) != 0) return;
                ActivationRequested?.Invoke();
            }
        });
    }

    public void Dispose()
    {
        _lifetime.Cancel();
        if (_ownsMutex) _mutex.ReleaseMutex();
        _activationSignal.Dispose();
        _mutex.Dispose();
        _lifetime.Dispose();
    }
}