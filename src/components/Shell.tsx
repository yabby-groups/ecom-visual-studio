import { useState } from "react";
import {
  FolderOpen,
  LayoutGrid,
  LogOut,
  Plus,
  Settings,
  Sparkles,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { client } from "../api";
import { useAppStore } from "../store";
import { Chat } from "./Chat";
import { Nav } from "./Nav";
import "./Shell.css";

export function Shell({ children }: { children: React.ReactNode }) {
  const user = useAppStore((state) => state.user)!;
  const setUser = useAppStore((state) => state.setUser);
  const navigate = useNavigate();
  const [chatOpen, setChatOpen] = useState(false);
  async function signOut() {
    await client.logout();
    setUser(null);
    navigate("/");
  }
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
          <button className="account-button" onClick={signOut} title="退出登录">
            <span>{user.username.slice(0, 1).toUpperCase()}</span>
            <b>{user.username}</b>
            <LogOut size={16} />
          </button>
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
      <div className="shell-actions">
        <button className="text-button" onClick={signOut}>
          {user.username} · 退出
        </button>
        <button
          className="chat-toggle"
          onClick={() => setChatOpen((open) => !open)}
          aria-label="打开 AI 聊天"
        >
          AI 对话
        </button>
        <button className="icon-button" aria-label="查看通知">
          <Plus size={18} />
        </button>
        <button className="create-button" onClick={() => navigate("/new")}>
          新建创作
        </button>
      </div>
      {chatOpen && <Chat onClose={() => setChatOpen(false)} />}
    </div>
  );
}
