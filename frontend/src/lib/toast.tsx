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

const variantClass: Record<Toast["variant"], string> = {
  info: "toast--info",
  success: "",
  error: "toast--danger",
};

const variantTitle: Record<Toast["variant"], string> = {
  info: "Notice",
  success: "Success",
  error: "Error",
};

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
      <div className="toast-stack">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast ${variantClass[t.variant]}`}
            onClick={() => dismiss(t.id)}
            role="status"
          >
            <div>
              <div className="toast__title">{variantTitle[t.variant]}</div>
              <div className="toast__body">{t.message}</div>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
