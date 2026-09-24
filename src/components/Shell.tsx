import { useState, useSyncExternalStore } from "react";
import {
  FolderOpen,
  LayoutGrid,
  Moon,
  Shirt,
  Settings,
  Sparkles,
  Sun,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAppStore } from "../store";
import { useRequireAiAuth } from "../auth";
import {
  getThemePreference,
  resolvedTheme,
  setThemePreference,
  subscribeTheme,
} from "../theme";
import { Chat } from "./Chat";
import { LogoutButton } from "./LogoutButton";
import { Nav } from "./Nav";
import "./Shell.css";

export function Shell({ children }: { children: React.ReactNode }) {
  const user = useAppStore((state) => state.user);
  const navigate = useNavigate();
  const requireAiAuth = useRequireAiAuth();
  const [chatOpen, setChatOpen] = useState(false);
  const themePreference = useSyncExternalStore(
    subscribeTheme,
    getThemePreference,
  );
  const isDark = resolvedTheme(themePreference) === "dark";
  const displayName = user ? user.profile.nick_name || user.username : "";
  return (
    <div className="app-shell shell">
      <aside className="rail sidebar">
        <Link className="brand" to="/" aria-label="Ecom Visual Studio 首页">
          <img
            className="brand-mark"
            src="/ecom-visual-studio.svg"
            alt=""
            aria-hidden="true"
          />
          <span>Ecom Visual Studio</span>
        </Link>
        <nav>
          <Nav to="/" icon={<LayoutGrid />} label="创作台" />
          <Nav to="/library" icon={<FolderOpen />} label="作品库" />
          <Nav to="/templates" icon={<Sparkles />} label="灵感模板" />
          <Nav to="/try-on" icon={<Shirt />} label="AI 换装" />
        </nav>
        <div className="rail-bottom sidebar-bottom">
          <Nav to="/settings" icon={<Settings />} label="设置" />
          <span className="app-version">v1.0.5</span>
        </div>
      </aside>
      <main className="app-main">
        <header className="mobile-bar">
          <Link className="brand" to="/" aria-label="Ecom Visual Studio 首页">
            <img
              className="brand-mark"
              src="/ecom-visual-studio.svg"
              alt=""
              aria-hidden="true"
            />
            <span>Ecom Visual Studio</span>
          </Link>
        </header>
        {children}
      </main>
      <nav className="mobile-nav" aria-label="主导航">
        <Nav to="/" icon={<LayoutGrid />} label="创作台" />
        <Nav to="/library" icon={<FolderOpen />} label="作品库" />
        <Nav to="/templates" icon={<Sparkles />} label="模板" />
        <Nav to="/try-on" icon={<Shirt />} label="换装" />
        <Nav to="/settings" icon={<Settings />} label="设置" />
      </nav>
      <div className="shell-actions">
        <button
          className="theme-toggle"
          type="button"
          onClick={() => setThemePreference(isDark ? "light" : "dark")}
          aria-label={isDark ? "切换为浅色主题" : "切换为深色主题"}
          title={isDark ? "切换为浅色主题" : "切换为深色主题"}
        >
          {isDark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        {user ? (
          <LogoutButton className="text-button">
            {user.profile.avatar_url ? (
              <img
                className="logout-avatar"
                src={user.profile.avatar_url}
                alt=""
              />
            ) : (
              <span className="logout-avatar logout-avatar-fallback">
                {displayName.slice(0, 1).toUpperCase()}
              </span>
            )}
            <span>{displayName} · 退出</span>
          </LogoutButton>
        ) : (
          <button className="text-button" onClick={() => requireAiAuth()}>
            登录以使用 AI
          </button>
        )}
        <button
          className="chat-toggle"
          onClick={() => {
            if (requireAiAuth()) setChatOpen((open) => !open);
          }}
          aria-label="打开 AI 聊天"
        >
          AI 对话
        </button>
        <button className="create-button" onClick={() => navigate("/new")}>
          新建创作
        </button>
      </div>
      {chatOpen && <Chat onClose={() => setChatOpen(false)} />}
    </div>
  );
}
