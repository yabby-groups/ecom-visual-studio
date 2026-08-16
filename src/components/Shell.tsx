import { useState } from "react";
import {
  FolderOpen,
  LayoutGrid,
  Settings,
  Sparkles,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAppStore } from "../store";
import { Chat } from "./Chat";
import { LogoutButton } from "./LogoutButton";
import { Nav } from "./Nav";
import "./Shell.css";

export function Shell({ children }: { children: React.ReactNode }) {
  const user = useAppStore((state) => state.user)!;
  const navigate = useNavigate();
  const [chatOpen, setChatOpen] = useState(false);
  const displayName = user.profile.nick_name || user.username;
  return (
    <div className="app-shell shell">
      <aside className="rail sidebar">
        <Link className="brand" to="/">
          <span className="brand-mark">F</span>
          <span>Frameboard</span>
        </Link>
        <nav>
          <Nav to="/" icon={<LayoutGrid />} label="创作台" />
          <Nav to="/library" icon={<FolderOpen />} label="作品库" />
          <Nav to="/templates" icon={<Sparkles />} label="灵感模板" />
        </nav>
        <div className="rail-bottom sidebar-bottom">
          <Nav to="/settings" icon={<Settings />} label="设置" />
        </div>
      </aside>
      <main className="app-main">
        <header className="mobile-bar">
          <Link className="brand" to="/">
            <span className="brand-mark">F</span>
            <span>Frameboard</span>
          </Link>
        </header>
        {children}
      </main>
      <nav className="mobile-nav" aria-label="主导航">
        <Nav to="/" icon={<LayoutGrid />} label="创作台" />
        <Nav to="/library" icon={<FolderOpen />} label="作品库" />
        <Nav to="/templates" icon={<Sparkles />} label="模板" />
        <Nav to="/settings" icon={<Settings />} label="设置" />
      </nav>
      <div className="shell-actions">
        <LogoutButton className="text-button">
          {user.profile.avatar_url ? (
            <img className="logout-avatar" src={user.profile.avatar_url} alt="" />
          ) : (
            <span className="logout-avatar logout-avatar-fallback">
              {displayName.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span>{displayName} · 退出</span>
        </LogoutButton>
        <button
          className="chat-toggle"
          onClick={() => setChatOpen((open) => !open)}
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
