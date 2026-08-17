import { useState } from "react";
import { client } from "../api";
import { useAppStore } from "../store";
import { useNavigate } from "react-router-dom";
import { ConfirmDialog } from "./ConfirmDialog";

type LogoutButtonProps = {
  className: string;
  children: React.ReactNode;
};

export function LogoutButton({ className, children }: LogoutButtonProps) {
  const setUser = useAppStore((state) => state.setUser);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function signOut() {
    setPending(true);
    setError("");
    try {
      await client.logout();
      setUser(null);
      navigate("/");
    } catch (logoutError) {
      setError(
        logoutError instanceof Error
          ? logoutError.message
          : "退出登录失败，请重试",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        className={className}
        type="button"
        onClick={() => {
          setError("");
          setOpen(true);
        }}
      >
        {children}
      </button>
      {open && (
        <ConfirmDialog
          title="确认退出登录？"
          message="退出后需要重新登录才能继续使用创作台。"
          confirmLabel="确认退出"
          error={error}
          loading={pending}
          onCancel={() => setOpen(false)}
          onConfirm={() => void signOut()}
        />
      )}
    </>
  );
}
