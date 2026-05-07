export function computeToastStackLayout(toasts, options = {}) {
  const maxVisible = options.maxVisible || 3;
  const total = (toasts || []).length;

  return (toasts || []).map((toast, index) => {
    const id = typeof toast === 'string' ? toast : toast.id;
    const dismissed = typeof toast === 'object' && (toast.dismissed === true || toast._dismissed === true);
    const fromTop = index;
    const hidden = fromTop >= maxVisible;
    const stacked = fromTop > 0;
    const scale = hidden ? 1 - Math.min(fromTop, 3) * 0.05 : 1 - fromTop * 0.05;
    const opacity = hidden ? 0 : Math.max(1 - fromTop * 0.2, 0.3);
    const brightness = hidden ? 0.7 : 1 - fromTop * 0.08;

    return {
      id,
      index,
      fromTop,
      stacked,
      hidden,
      zIndex: dismissed ? 0 : total - index,
      scale,
      opacity,
      brightness
    };
  });
}
