using System.Windows;
using System.Windows.Media.Animation;
using ParcNotify.Agent.Views;

namespace ParcNotify.Agent.Services;

public sealed class NotificationAnimationService
{
    public void PlayEntrance(NotificationPopupWindow window)
    {
        if (!SystemParameters.ClientAreaAnimation)
        {
            ResetEntranceState(window);
            return;
        }

        window.RootOffset.Y = 18;
        window.Opacity = 0;
        window.BeginAnimation(UIElement.OpacityProperty, Animation(1, 220, EasingMode.EaseOut));
        var translation = Animation(0, 220, EasingMode.EaseOut);
        translation.Completed += (_, _) => ResetEntranceState(window);
        window.RootOffset.BeginAnimation(System.Windows.Media.TranslateTransform.YProperty, translation);
    }

    public void PlayExit(NotificationPopupWindow window, Action completed)
    {
        if (!SystemParameters.ClientAreaAnimation)
        {
            completed();
            return;
        }

        var opacity = Animation(0, 170, EasingMode.EaseIn);
        opacity.Completed += (_, _) => completed();
        window.BeginAnimation(UIElement.OpacityProperty, opacity);
        window.RootOffset.BeginAnimation(System.Windows.Media.TranslateTransform.YProperty, Animation(12, 170, EasingMode.EaseIn));
    }

    public void MoveTo(Window window, double left, double top)
    {
        if (!SystemParameters.ClientAreaAnimation)
        {
            window.Left = Math.Round(left);
            window.Top = Math.Round(top);
            return;
        }
        window.BeginAnimation(Window.LeftProperty, Animation(Math.Round(left), 180, EasingMode.EaseOut));
        window.BeginAnimation(Window.TopProperty, Animation(Math.Round(top), 180, EasingMode.EaseOut));
    }

    private static void ResetEntranceState(NotificationPopupWindow window)
    {
        window.BeginAnimation(UIElement.OpacityProperty, null);
        window.Opacity = 1;
        window.RootOffset.BeginAnimation(System.Windows.Media.TranslateTransform.YProperty, null);
        window.RootOffset.Y = 0;
    }

    private static DoubleAnimation Animation(double to, int milliseconds, EasingMode easingMode) => new(to, TimeSpan.FromMilliseconds(milliseconds))
    {
        EasingFunction = new CubicEase { EasingMode = easingMode },
        FillBehavior = FillBehavior.HoldEnd,
    };
}
