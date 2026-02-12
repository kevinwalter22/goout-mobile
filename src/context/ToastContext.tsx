import { createContext, useContext, useState, ReactNode } from "react";
import { Toast, ToastType } from "../components/Toast";

type ToastContextType = {
  showToast: (message: string, type?: ToastType, duration?: number) => void;
};

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState("");
  const [type, setType] = useState<ToastType>("info");
  const [duration, setDuration] = useState(3000);

  function showToast(msg: string, toastType: ToastType = "info", toastDuration: number = 3000) {
    setMessage(msg);
    setType(toastType);
    setDuration(toastDuration);
    setVisible(true);
  }

  function hideToast() {
    setVisible(false);
  }

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <Toast
        visible={visible}
        message={message}
        type={type}
        duration={duration}
        onHide={hideToast}
      />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}
