import { useState } from "react";
import { client } from "../api";
import { useAppStore } from "../store";
import { ConfirmDialog } from "./ConfirmDialog";

type LogoutButtonProps = {
  className: string;
  children: React.ReactNode;
};

export function LogoutButton({ className, children }: LogoutButtonProps) {
  const setUser = useAppStore((state) => state.setUser);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function signOut() {
    setPending(true);
    setError("");
    try {
      await client.logout();
      setUser(null);
      setOpen(false);
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
          message="退出后 AI 能力将停用，本地项目和素材仍可继续使用。"
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
