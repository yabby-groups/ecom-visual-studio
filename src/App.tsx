import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { LoaderCircle } from "lucide-react";
import { EventsOff, EventsOn } from "../wailsjs/runtime/runtime";
import { Home } from "./components/Home";
import { Library } from "./components/Library";
import { Login } from "./components/Login";
import { NewProject } from "./components/NewProject";
import { SettingsPage } from "./components/SettingsPage";
import { Templates } from "./components/Templates";
import { TryOn } from "./components/TryOn";
import { Workspace } from "./components/Workspace";
import { useAppStore } from "./store";
import { AiInteractionProvider } from "./aiInteraction";

export function App() {
  const initializing = useAppStore((state) => state.initializing);
  if (initializing)
    return (
      <div className="boot">
        <LoaderCircle className="spin" size={28} />
      </div>
    );
  return (
    <AiInteractionProvider>
      <AuthorizationExpiryListener />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/new" element={<NewProject />} />
        <Route path="/projects/:id" element={<Workspace />} />
        <Route path="/library" element={<Library />} />
        <Route path="/templates" element={<Templates />} />
        <Route path="/try-on" element={<TryOn />} />
        <Route path="/try-on/:id" element={<TryOn />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AiInteractionProvider>
  );
}

function AuthorizationExpiryListener() {
  const setUser = useAppStore((state) => state.setUser);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const eventName = "auth:expired";
    EventsOn(eventName, () => {
      const returnTo = `${location.pathname}${location.search}${location.hash}`;
      setUser(null);
      navigate(
        `/login?reason=authorization_expired&returnTo=${encodeURIComponent(returnTo)}`,
        { replace: true },
      );
    });
    return () => EventsOff(eventName);
  }, [location.hash, location.pathname, location.search, navigate, setUser]);

  return null;
}
