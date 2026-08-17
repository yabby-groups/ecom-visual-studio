import { Navigate, Route, Routes } from "react-router-dom";
import { LoaderCircle } from "lucide-react";
import { Home } from "./components/Home";
import { Library } from "./components/Library";
import { Login } from "./components/Login";
import { NewProject } from "./components/NewProject";
import { SettingsPage } from "./components/SettingsPage";
import { Templates } from "./components/Templates";
import { TryOn } from "./components/TryOn";
import { Workspace } from "./components/Workspace";
import { useAppStore } from "./store";

export function App() {
  const user = useAppStore((state) => state.user);
  const initializing = useAppStore((state) => state.initializing);
  if (initializing)
    return (
      <div className="boot">
        <LoaderCircle className="spin" size={28} />
      </div>
    );
  if (!user) return <Login />;
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/new" element={<NewProject />} />
      <Route path="/projects/:id" element={<Workspace />} />
      <Route path="/library" element={<Library />} />
      <Route path="/templates" element={<Templates />} />
      <Route path="/try-on" element={<TryOn />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
