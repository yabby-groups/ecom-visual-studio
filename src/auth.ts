import { useLocation, useNavigate } from "react-router-dom";
import { useAppStore } from "./store";

export function useRequireAiAuth() {
  const user = useAppStore((state) => state.user);
  const location = useLocation();
  const navigate = useNavigate();

  return () => {
    if (user) return true;
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`);
    return false;
  };
}

export function safeReturnTo(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
}
