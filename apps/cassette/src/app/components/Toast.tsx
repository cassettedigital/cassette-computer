"use client";

/**
 * Minimal toast system — no external library.
 *
 * A tiny context + provider that renders a fixed bottom-right stack of
 * transient messages. Mounted once at the app root (see providers.tsx);
 * any client component calls `useToast()` and fires `toast(message, opts)`.
 *
 * Variants map to the existing cs-* status colors. Toasts auto-dismiss
 * after `duration` ms (default 3500) and can be dismissed by click.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

export type ToastVariant = "info" | "success" | "error";

type ToastItem = {
  id: number;
  message: string;
  variant: ToastVariant;
};

type ToastOptions = {
  variant?: ToastVariant;
  duration?: number;
};

type ToastFn = (message: string, opts?: ToastOptions) => void;

const ToastContext = createContext<ToastFn | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback<ToastFn>(
    (message, opts) => {
      const id = nextId++;
      const variant = opts?.variant ?? "info";
      const duration = opts?.duration ?? 3500;
      setToasts((prev) => [...prev, { id, message, variant }]);
      if (duration > 0) {
        setTimeout(() => dismiss(id), duration);
      }
    },
    [dismiss]
  );

  const value = useMemo(() => toast, [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        style={{
          position: "fixed",
          bottom: "1.25rem",
          right: "1.25rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
          zIndex: 2000,
          maxWidth: "min(92vw, 380px)",
        }}
      >
        {toasts.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => dismiss(t.id)}
            style={{
              textAlign: "left",
              cursor: "pointer",
              background: "var(--cs-bg2)",
              border: `1px solid ${accentFor(t.variant)}`,
              borderLeft: `3px solid ${accentFor(t.variant)}`,
              borderRadius: "var(--cs-radius-md)",
              padding: "0.7rem 0.9rem",
              boxShadow: "0 6px 24px rgba(0,0,0,0.35)",
              fontFamily: "var(--cs-font-mono)",
              fontSize: "var(--cs-text-label)",
              lineHeight: 1.4,
              color: "var(--cs-ink)",
              letterSpacing: "0.02em",
            }}
          >
            {t.message}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function accentFor(variant: ToastVariant): string {
  if (variant === "success") return "var(--cs-green)";
  if (variant === "error") return "var(--cs-red)";
  return "var(--cs-amber)";
}

/**
 * Access the toast dispatcher. Returns a no-op stub if used outside the
 * provider so a stray call never throws (keeps detail pages — which may
 * render the action without the provider in some edge cases — safe).
 */
export function useToast(): ToastFn {
  const ctx = useContext(ToastContext);
  return ctx ?? noop;
}

const noop: ToastFn = () => {};
