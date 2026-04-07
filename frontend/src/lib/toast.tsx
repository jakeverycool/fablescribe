import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface Toast {
  id: number;
  message: string;
  variant: "info" | "success" | "error";
}

interface ToastCtx {
  show: (message: string, variant?: Toast["variant"]) => void;
}

const ToastContext = createContext<ToastCtx>({ show: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, variant: Toast["variant"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const dismiss = (id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div style={styles.container}>
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              ...styles.toast,
              ...(t.variant === "error" ? styles.error : {}),
              ...(t.variant === "success" ? styles.success : {}),
            }}
            onClick={() => dismiss(t.id)}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "fixed",
    top: "16px",
    right: "16px",
    zIndex: 9999,
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    maxWidth: "400px",
  },
  toast: {
    padding: "12px 16px",
    background: "#1a1a1a",
    border: "1px solid #333",
    borderLeft: "3px solid #7c3aed",
    borderRadius: "6px",
    color: "#e0e0e0",
    fontSize: "13px",
    fontFamily: "'JetBrains Mono', monospace",
    cursor: "pointer",
    boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
  },
  error: {
    borderLeftColor: "#f87171",
    background: "#1a0a0a",
  },
  success: {
    borderLeftColor: "#4ade80",
    background: "#0a1a0f",
  },
};
