import { useApp } from '@/state/store';

export function Toasts() {
  const toast = useApp((s) => s.toast);
  const dismiss = useApp((s) => s.dismissToast);

  return (
    <div
      // Clear of the tool dock, which owns the bottom centre of the reader.
      className="pointer-events-none fixed bottom-[5.5rem] left-1/2 z-[var(--z-toast)] -translate-x-1/2 sm:bottom-5 sm:left-auto sm:right-5 sm:translate-x-0"
      role="status"
      aria-live="polite"
    >
      {toast && (
        <div
          key={toast.id}
          className="pointer-events-auto flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--rule-hairline)] bg-[var(--surface-inverse)] px-4 py-2.5 text-xs text-[var(--ink-inverse)] motion-safe:animate-[toast-in_240ms_var(--ease-out)]"
          style={{ boxShadow: 'var(--shadow-float)' }}
        >
          <span>{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              className="on-inverse font-medium underline underline-offset-[3px] opacity-80 transition-opacity hover:opacity-100"
              onClick={() => {
                toast.action!.run();
                dismiss();
              }}
            >
              {toast.action.label}
            </button>
          )}
          <style>{`@keyframes toast-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>
        </div>
      )}
    </div>
  );
}
