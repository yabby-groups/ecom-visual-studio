import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  ArrowLeft,
  Check,
  Copy,
  FolderOpen,
  ImagePlus,
  LayoutGrid,
  LoaderCircle,
  LogOut,
  MoreHorizontal,
  Plus,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import { client } from "./api";
import { useAppStore } from "./store";
import type { Asset, Project } from "./types";

const statusText = (status: string) =>
  ({
    draft: "未生成",
    queued: "等待队列",
    prompting: "生成提示词",
    generating: "正在生成",
    ready: "已完成",
  })[status] || (status.startsWith("failed") ? "生成失败" : status);
const isPending = (status: string) =>
  ["queued", "prompting", "generating"].includes(status);
const fileUrl = (path?: string | null) => (path ? `/files/${path}` : "");

function Notice({ text, onClose }: { text: string; onClose: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 3500);
    return () => window.clearTimeout(timer);
  }, [onClose]);
  return (
    <div className="notice" role="status">
      <span>{text}</span>
      <button onClick={onClose} aria-label="关闭提示">
        <X size={16} />
      </button>
    </div>
  );
}

function Login() {
  const setUser = useAppStore((state) => state.setUser);
  const initialize = useAppStore((state) => state.initialize);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    const form = new FormData(event.currentTarget);
    try {
      const { user } = await client.login({
        name: String(form.get("name")),
        password: String(form.get("password")),
        totp_code: String(form.get("totp_code") || ""),
      });
      setUser(user);
      await initialize();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法完成登录");
    } finally {
      setLoading(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <span className="eyebrow">FRAMEBOARD × HUABOT</span>
        <h1>登录 huabot 后开始创作</h1>
        <p>
          登录后自动读取或创建你账号下的 Token Base
          Key，用于本次账号的图像生成。密码和动态验证码不会保存。
        </p>
        <form onSubmit={submit} className="form-stack">
          <label>
            huabot 账号
            <input name="name" autoComplete="username" required />
          </label>
          <label>
            密码
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <label>
            动态验证码（已开启两步验证时填写）
            <input
              name="totp_code"
              inputMode="numeric"
              autoComplete="one-time-code"
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="button primary" disabled={loading}>
            {loading && <LoaderCircle className="spin" size={18} />}
            {loading ? "正在登录并获取 Key..." : "登录 huabot"}
          </button>
        </form>
      </section>
    </main>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
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

function Nav({
  to,
  icon,
  label,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
}) {
  const location = useLocation();
  return (
    <Link
      to={to}
      className={`nav-link ${location.pathname === to ? "active" : ""}`}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}

function Chat({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<{ role: string; content: string }[]>(
    [],
  );
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || busy) return;
    const next = [...messages, { role: "user", content: text.trim() }];
    setMessages(next);
    setText("");
    setBusy(true);
    try {
      const result = await client.chat(next);
      setMessages([...next, { role: "assistant", content: result.reply }]);
    } catch (error) {
      setMessages([
        ...next,
        {
          role: "assistant",
          content: error instanceof Error ? error.message : "对话失败",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside className="chat-panel">
      <header>
        <div>
          <span className="eyebrow">AI CREATIVE ASSISTANT</span>
          <h3>创作助手</h3>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="关闭">
          <X size={19} />
        </button>
      </header>
      <div className="chat-log">
        {messages.length ? (
          messages.map((message, index) => (
            <article
              className={`chat-message ${message.role}`}
              key={`${message.role}-${index}`}
            >
              {message.content}
            </article>
          ))
        ) : (
          <p>
            描述你的商品、销售场景或想优化的卖点，我会协助整理可直接使用的创作方向。
          </p>
        )}
        {busy && <LoaderCircle className="spin" size={20} />}
      </div>
      <form onSubmit={send}>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="例如：为这款商品写 3 个详情页卖点"
          rows={3}
        />
        <button className="button primary" disabled={busy || !text.trim()}>
          发送
        </button>
      </form>
    </aside>
  );
}

function Home() {
  const projects = useAppStore((state) => state.projects);
  const navigate = useNavigate();
  const shortcuts = [
    ["商品主图", "干净陈列，立即适配商城"],
    ["品牌海报", "围绕活动主题建立视觉"],
    ["社媒种草", "真实内容感与传播构图"],
    ["详情信息图", "卖点、结构与使用说明"],
  ];
  return (
    <Shell>
      <div className="topbar">
        <strong>创作台</strong>
      </div>
      <div className="page">
        <section className="studio-hero">
          <div>
            <span className="eyebrow">AI PRODUCT IMAGE STUDIO</span>
            <h1>
              把商品，做成
              <br />
              能被记住的画面。
            </h1>
            <p className="hero-copy">
              上传一张参考图，选择创作目标。主图、广告、内容图和完整商品视觉包会在同一处完成。
            </p>
            <div className="hero-actions">
              <button
                className="create-button large"
                onClick={() => navigate("/new")}
              >
                开始创作
              </button>
              <Link className="text-link" to="/templates">
                浏览全部模板
              </Link>
            </div>
          </div>
          <div className="hero-visual">
            <div className="visual-empty">
              <span>商品视觉</span>
              <b>从一张参考图开始</b>
            </div>
          </div>
        </section>
        <section className="shortcut-section">
          <div className="section-heading section-header">
            <div>
              <span className="eyebrow">快速开始</span>
              <h2>你想做什么？</h2>
            </div>
            <Link className="text-link" to="/templates">
              全部场景
            </Link>
          </div>
          <div className="shortcut-grid">
            {shortcuts.map(([title, detail], index) => (
              <button
                className="shortcut-card"
                onClick={() => navigate("/new")}
                key={title}
              >
                <span className="shortcut-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <strong>{title}</strong>
                <small>{detail}</small>
                <i>开始创作</i>
              </button>
            ))}
          </div>
        </section>
        <section className="gallery-section content-section">
          <div className="section-heading section-header">
            <div>
              <span className="eyebrow">最近作品</span>
              <h2>继续上次的创作</h2>
            </div>
            {projects.length > 0 && (
              <Link className="text-link" to="/library">
                查看作品库
              </Link>
            )}
          </div>
          {projects.length ? (
            <div className="project-grid">
              {projects.slice(0, 6).map((project) => (
                <ProjectCard project={project} key={project.id} />
              ))}
            </div>
          ) : (
            <div className="first-empty empty-state">
              <div>+</div>
              <h3>还没有生成作品</h3>
              <p>创建第一个商品视觉项目，结果会在这里沉淀。</p>
              <button
                className="create-button"
                onClick={() => navigate("/new")}
              >
                创建第一个作品
              </button>
            </div>
          )}
        </section>
      </div>
    </Shell>
  );
}

function ProjectCard({ project }: { project: Project }) {
  return (
    <Link to={`/projects/${project.id}`} className="project-card">
      <div className="project-preview">
        {project.reference ? (
          <img src={fileUrl(project.reference)} alt="" />
        ) : (
          <ImagePlus size={28} />
        )}
      </div>
      <div>
        <span>{project.asset_count || 0} 个画面</span>
        <h3>{project.name}</h3>
        <p>{project.product}</p>
      </div>
      <MoreHorizontal size={18} />
    </Link>
  );
}

function LegacyNewProject() {
  const templates = useAppStore((state) => state.templates);
  const refreshProjects = useAppStore((state) => state.refreshProjects);
  const navigate = useNavigate();
  const [kind, setKind] = useState("amazon");
  const [reference, setReference] = useState("");
  const [preview, setPreview] = useState("");
  const [selectedTemplates, setSelectedTemplates] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  async function upload(file: File) {
    setError("");
    try {
      const { path } = await client.upload(file);
      setReference(path);
      setPreview(fileUrl(path));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "上传失败");
    }
  }
  async function analyze(mode: "name" | "image") {
    const form = new FormData(formRef.current!);
    const product = String(form.get("product") || "").trim();
    if (mode === "name" && !product) {
      setError("请先填写商品名称");
      return;
    }
    if (mode === "image" && !reference) {
      setError("请先上传或导入一张商品图片");
      return;
    }
    setAnalyzing(true);
    setError("");
    try {
      const result = await client.analyze({
        mode,
        product,
        reference,
      });
      const description = formRef.current!.elements.namedItem(
        "description",
      ) as HTMLTextAreaElement;
      const benefits = formRef.current!.elements.namedItem(
        "benefits",
      ) as HTMLTextAreaElement;
      description.value = result.description;
      benefits.value = result.benefits.join("；");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "AI 分析失败";
      setError(message);
    } finally {
      setAnalyzing(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const result = await client.createProject({
        name: String(form.get("name")),
        product: String(form.get("product")),
        description: String(form.get("description")),
        benefits: String(form.get("benefits")),
        color: String(form.get("color")),
        reference,
      });
      await client.createPack(result.id, {
        kind,
        scene_template_ids: selectedTemplates,
      });
      await refreshProjects();
      navigate(`/projects/${result.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }
  const sceneCount =
    kind === "amazon"
      ? 7 + selectedTemplates.length
      : kind === "social"
        ? 3
        : 1;
  return (
    <Shell>
      <div className="topbar">
        <div>
          <button className="back-link" onClick={() => navigate(-1)}>
            <ArrowLeft size={17} />
            返回创作台
          </button>
          <span className="eyebrow">NEW CREATION</span>
          <h1>新建创作</h1>
        </div>
      </div>
      <form ref={formRef} onSubmit={submit} className="create-layout">
        <section className="create-intro">
          <h2>
            先确定你想让商品
            <br />
            被怎样看见。
          </h2>
          <p>
            先完成基础信息。创建后，每一个画面都可以继续调整方向、比例和
            Prompt。
          </p>
        </section>
        <div className="create-form">
          <Step index="01" title="添加商品参考">
            <div className="form-grid">
              <label>
                商品名称
                <input
                  name="product"
                  required
                  placeholder="例如：神经酰胺修护面霜"
                />
              </label>
              <label>
                项目名称
                <input
                  name="name"
                  required
                  placeholder="例如：秋季新品 Campaign"
                />
              </label>
            </div>
            <div className="reference-picker">
              <label className="upload-box">
                {preview ? (
                  <img src={preview} alt="参考商品" />
                ) : (
                  <>
                    <Upload size={26} />
                    <b>上传商品图片</b>
                    <span>JPG、PNG 或 WebP，最大 15MB</span>
                  </>
                )}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) =>
                    event.target.files?.[0] &&
                    void upload(event.target.files[0])
                  }
                />
              </label>
              <div className="url-import">
                <b>或导入网络图片</b>
                <p>使用公开可访问的商品图片 URL。</p>
                <div>
                  <input
                    id="reference-url"
                    type="url"
                    placeholder="https://example.com/product.jpg"
                  />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="导入图片"
                    onClick={async () => {
                      const value = (
                        document.getElementById(
                          "reference-url",
                        ) as HTMLInputElement
                      ).value;
                      try {
                        const result = await client.importUrl(value);
                        setReference(result.path);
                        setPreview(fileUrl(result.path));
                      } catch (reason) {
                        setError(
                          reason instanceof Error ? reason.message : "导入失败",
                        );
                      }
                    }}
                  >
                    <ArrowLeft className="rotate-180" size={18} />
                  </button>
                </div>
              </div>
            </div>
          </Step>
          <Step index="02" title="选择创作目标">
            <div className="goal-grid">
              {[
                [
                  "amazon",
                  "完整商品视觉包",
                  "主图、场景、细节和详情图",
                  "7 张",
                ],
                ["social", "社媒内容组图", "种草、UGC 和品牌海报", "3 张"],
                ["custom", "单张商品主图", "先从一个画面开始探索", "1 张"],
              ].map(([id, title, detail, count]) => (
                <button
                  type="button"
                  className={`goal-card ${kind === id ? "selected" : ""}`}
                  onClick={() => setKind(id)}
                  key={id}
                >
                  <span>{kind === id && <Check size={16} />}</span>
                  <b>{title}</b>
                  <small>{detail}</small>
                  <i>{count}</i>
                </button>
              ))}
            </div>
            {kind === "amazon" && (
              <div className="custom-scenes">
                <div>
                  <b>扩展自定义场景</b>
                  <p>可加入自己保存的场景模板。</p>
                </div>
                {templates.filter((item) => item.custom).length ? (
                  <div className="chip-list">
                    {templates
                      .filter((item) => item.custom)
                      .map((item) => (
                        <label
                          className={`template-chip ${selectedTemplates.includes(item.id) ? "selected" : ""}`}
                          key={item.id}
                        >
                          <input
                            type="checkbox"
                            checked={selectedTemplates.includes(item.id)}
                            onChange={() =>
                              setSelectedTemplates((current) =>
                                current.includes(item.id)
                                  ? current.filter((id) => id !== item.id)
                                  : [...current, item.id],
                              )
                            }
                          />
                          {item.name}
                        </label>
                      ))}
                  </div>
                ) : (
                  <Link className="text-link" to="/templates">
                    创建自定义场景
                  </Link>
                )}
              </div>
            )}
          </Step>
          <Step index="03" title="给它一个方向">
            <div className="form-grid">
              <label>
                品牌主色
                <input name="color" type="color" defaultValue="#A16207" />
              </label>
              <label className="span-full">
                商品描述
                <textarea
                  name="description"
                  placeholder="描述商品材质、结构、使用场景和目标人群"
                  rows={3}
                />
              </label>
              <label className="span-full">
                核心卖点
                <textarea
                  name="benefits"
                  placeholder="用分号分隔多个卖点"
                  rows={3}
                />
              </label>
            </div>
            <div className="analysis-row">
              <span>让 AI 帮你补全商品信息</span>
              <button
                type="button"
                className="button secondary"
                disabled={analyzing}
                onClick={() => void analyze("name")}
              >
                <WandSparkles size={16} />
                根据商品名称分析
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={analyzing || !reference}
                onClick={() => void analyze("image")}
              >
                <Sparkles size={16} />
                根据图片分析
              </button>
            </div>
          </Step>
          {error && <p className="form-error">{error}</p>}
          <footer className="create-footer">
            <span>将生成 {sceneCount} 张可单独编辑的商品视觉</span>
            <button className="button primary" disabled={busy}>
              {busy && <LoaderCircle className="spin" size={18} />}
              创建并进入画布
            </button>
          </footer>
        </div>
      </form>
    </Shell>
  );
}

void LegacyNewProject;

function NewProject() {
  const templates = useAppStore((state) => state.templates);
  const refreshProjects = useAppStore((state) => state.refreshProjects);
  const navigate = useNavigate();
  const [kind, setKind] = useState("amazon");
  const [reference, setReference] = useState("");
  const [preview, setPreview] = useState("");
  const [selectedTemplates, setSelectedTemplates] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState("");
  const [analysisMode, setAnalysisMode] = useState<"name" | "image" | null>(
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);

  async function upload(file: File) {
    try {
      const result = await client.upload(file);
      setReference(result.path);
      setPreview(fileUrl(result.path));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "上传失败");
    }
  }
  async function importUrl() {
    const input = document.getElementById("reference-url") as HTMLInputElement;
    try {
      const result = await client.importUrl(input.value);
      setReference(result.path);
      setPreview(fileUrl(result.path));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "导入失败");
    }
  }
  async function analyze(mode: "name" | "image") {
    const form = new FormData(formRef.current!);
    const product = String(form.get("product") || "").trim();
    if (mode === "name" && !product) {
      setError("请先填写商品名称");
      return;
    }
    if (mode === "image" && !reference) {
      setError("请先上传或导入一张商品图片");
      return;
    }
    setAnalyzing(true);
    setAnalysisMode(mode);
    setError("");
    setAnalysisStatus(
      mode === "name"
        ? "正在根据商品名称整理描述和卖点..."
        : "正在读取商品图片并整理描述和卖点...",
    );
    try {
      const result = await client.analyze({
        mode,
        product,
        reference,
      });
      const description = formRef.current!.elements.namedItem(
        "description",
      ) as HTMLTextAreaElement;
      const benefits = formRef.current!.elements.namedItem(
        "benefits",
      ) as HTMLTextAreaElement;
      description.value = result.description;
      benefits.value = result.benefits.join("；");
      setAnalysisStatus("已生成商品描述和 4 条核心卖点，可以继续编辑。");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "AI 分析失败";
      setError(message);
      setAnalysisStatus(message);
    } finally {
      setAnalyzing(false);
      setAnalysisMode(null);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const project = await client.createProject({
        name: String(form.get("name")),
        product: String(form.get("product")),
        description: String(form.get("description")),
        benefits: String(form.get("benefits")),
        color: String(form.get("color")),
        reference,
      });
      await client.createPack(project.id, {
        kind,
        scene_template_ids: selectedTemplates,
      });
      await refreshProjects();
      navigate(`/projects/${project.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }
  const count =
    kind === "amazon"
      ? 7 + selectedTemplates.length
      : kind === "social"
        ? 3
        : 1;
  return (
    <Shell>
      <header className="topbar">
        <strong>新建创作</strong>
        <div>
          <button className="icon-button" aria-label="查看通知">
            <Plus size={17} />
          </button>
        </div>
      </header>
      <div className="page create-page">
        <div className="create-intro">
          <button className="back-link" onClick={() => navigate("/")}>
            <ArrowLeft size={15} />
            返回创作台
          </button>
          <span className="eyebrow">NEW CREATION</span>
          <h1>
            先确定你想让商品
            <br />
            被怎样看见。
          </h1>
          <p>
            信息不需要一次填完。先选择目标，生成后仍可编辑每张图的内容和风格。
          </p>
        </div>
        <form ref={formRef} onSubmit={submit} className="creation-form">
          <section className="step">
            <span className="step-index">01</span>
            <div className="step-body">
              <h2>添加商品参考</h2>
              <p>
                上传本地商品图，或粘贴公开网络图片地址。系统会将其保存到当前项目中。
              </p>
              <div className="two-col">
                <label>
                  商品名称
                  <input
                    name="product"
                    required
                    placeholder="例如：实木双抽书桌"
                  />
                </label>
                <label>
                  项目名称
                  <input
                    name="name"
                    required
                    placeholder="例如：北欧实木书桌 Campaign"
                  />
                </label>
              </div>
              <div className="reference-picker">
                <label className="upload-box">
                  {preview ? (
                    <img src={preview} alt="参考商品" />
                  ) : (
                    <>
                      <Upload size={26} />
                      <b>上传本地图片</b>
                      <span>JPG、PNG 或 WebP，最大 15MB</span>
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) =>
                      event.target.files?.[0] &&
                      void upload(event.target.files[0])
                    }
                  />
                </label>
                <div className="url-import">
                  <b>使用网络图片</b>
                  <p>粘贴公开可访问的图片 URL</p>
                  <div>
                    <input
                      id="reference-url"
                      type="url"
                      placeholder="https://example.com/product.jpg"
                    />
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => void importUrl()}
                      aria-label="导入网络图片"
                    >
                      <ArrowLeft className="rotate-180" size={16} />
                    </button>
                  </div>
                </div>
              </div>
              <label>
                商品描述
                <textarea
                  name="description"
                  rows={3}
                  placeholder="描述商品材质、结构和使用场景"
                />
              </label>
              <section className="ai-analysis" aria-labelledby="ai-analysis-title">
                <div>
                  <span className="analysis-kicker">AI PRODUCT INTELLIGENCE</span>
                  <h3 id="ai-analysis-title">让 AI 补全商品信息</h3>
                  <p>
                    选择一种分析方式，生成结果将写入商品描述和核心卖点，仍可手动调整。
                  </p>
                </div>
                <div className="analysis-actions">
                  <button
                    type="button"
                    className={`analysis-button ${analysisMode === "name" ? "is-loading" : ""}`}
                    disabled={analyzing}
                    onClick={() => void analyze("name")}
                  >
                    <span aria-hidden="true">
                      {analysisMode === "name" ? "..." : "Aa"}
                    </span>
                    <b>{analysisMode === "name" ? "正在分析" : "根据商品名称分析"}</b>
                    <small>
                      {analysisMode === "name"
                        ? "请稍候，结果将自动填入"
                        : "适合已有明确品类和名称"}
                    </small>
                  </button>
                  <button
                    type="button"
                    className={`analysis-button ${analysisMode === "image" ? "is-loading" : ""}`}
                    disabled={analyzing}
                    onClick={() => void analyze("image")}
                  >
                    <span aria-hidden="true">
                      {analysisMode === "image" ? "..." : "◎"}
                    </span>
                    <b>{analysisMode === "image" ? "正在分析" : "根据上传图片分析"}</b>
                    <small>
                      {analysisMode === "image"
                        ? "请稍候，结果将自动填入"
                        : "从外观、结构和使用场景提取信息"}
                    </small>
                  </button>
                </div>
                <p className="analysis-status" aria-live="polite">
                  {analysisStatus}
                </p>
              </section>
            </div>
          </section>
          <section className="step">
            <span className="step-index">02</span>
            <div className="step-body">
              <h2>选择创作目标</h2>
              <div className="goal-grid">
                {[
                  ["amazon", "商品视觉包", "主图、场景、细节和详情图", "7 张"],
                  ["social", "社媒内容组图", "种草、UGC 和品牌海报", "3 张"],
                  ["custom", "单张商品主图", "先从一个画面开始探索", "1 张"],
                ].map(([id, title, detail, amount]) => (
                  <button
                    type="button"
                    className={`goal ${kind === id ? "active" : ""}`}
                    onClick={() => setKind(id)}
                    key={id}
                  >
                    <b>{title}</b>
                    <span>{detail}</span>
                    <i>{amount}</i>
                  </button>
                ))}
              </div>
              {kind === "amazon" && (
                <div className="custom-scenes">
                  <div>
                    <b>扩展自定义场景</b>
                    <p>可加入自己保存的场景模板。</p>
                  </div>
                  {templates.filter((item) => item.custom).length ? (
                    <div className="chip-list">
                      {templates
                        .filter((item) => item.custom)
                        .map((item) => (
                          <label
                            className={`template-chip ${selectedTemplates.includes(item.id) ? "selected" : ""}`}
                            key={item.id}
                          >
                            <input
                              type="checkbox"
                              checked={selectedTemplates.includes(item.id)}
                              onChange={() =>
                                setSelectedTemplates((current) =>
                                  current.includes(item.id)
                                    ? current.filter((id) => id !== item.id)
                                    : [...current, item.id],
                                )
                              }
                            />
                            {item.name}
                          </label>
                        ))}
                    </div>
                  ) : (
                    <Link className="text-link" to="/templates">
                      创建自定义场景
                    </Link>
                  )}
                </div>
              )}
            </div>
          </section>
          <section className="step">
            <span className="step-index">03</span>
            <div className="step-body">
              <h2>给它一个方向</h2>
              <div className="two-col">
                <label>
                  品牌主色
                  <input name="color" type="color" defaultValue="#137A65" />
                </label>
                <label>
                  核心卖点
                  <textarea
                    name="benefits"
                    rows={3}
                    placeholder="实木质感；双抽收纳；稳定桌腿"
                  />
                </label>
              </div>
            </div>
          </section>
          {error && <p className="form-error">{error}</p>}
          <footer className="creation-footer">
            <span>将生成 {count} 张可单独编辑的商品视觉</span>
            <button className="button primary" disabled={busy}>
              {busy && <LoaderCircle className="spin" size={16} />}
              创建并进入画布
            </button>
          </footer>
        </form>
      </div>
    </Shell>
  );
}

function Step({
  index,
  title,
  children,
}: {
  index: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="form-step">
      <span className="step-index">{index}</span>
      <div>
        <h3>{title}</h3>
        {children}
      </div>
    </section>
  );
}

function Workspace() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const templates = useAppStore((state) => state.templates);
  const [project, setProject] = useState<Project | null>(null);
  const [assetId, setAssetId] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  async function load() {
    try {
      const next = await client.project(id);
      setProject(next);
      setAssetId((current) =>
        next.assets?.some((asset) => asset.id === current)
          ? current
          : next.assets?.[0]?.id || "",
      );
    } catch {
      navigate("/");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [id]);
  useEffect(() => {
    if (!project?.assets?.some((asset) => isPending(asset.status))) return;
    const timer = window.setInterval(() => void load(), 2400);
    return () => window.clearInterval(timer);
  }, [project?.assets?.map((asset) => asset.status).join("|")]);
  if (loading || !project)
    return (
      <Shell>
        <div className="loading-page">
          <LoaderCircle className="spin" size={28} />
          加载项目...
        </div>
      </Shell>
    );
  const currentProject = project;
  const asset = currentProject.assets?.find((item) => item.id === assetId);
  async function updateAsset(patch: Partial<Asset>) {
    if (!asset) return;
    await client.updateAsset(asset.id, patch);
    await load();
  }
  async function generate(one = true) {
    try {
      if (one && asset) await client.generateAsset(asset.id);
      else await client.generatePack(currentProject.id);
      await load();
      setNotice(one ? "已加入生成队列" : "全部画面已加入生成队列");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "生成失败");
    }
  }
  return (
    <Shell>
      <div className="workspace-header">
        <button className="back-link" onClick={() => navigate("/")}>
          <ArrowLeft size={17} />
          创作台
        </button>
        <div>
          <span className="eyebrow">PRODUCT VISUAL SERIES</span>
          <h1>{project.name}</h1>
        </div>
        <button
          className="button primary"
          disabled={project.assets?.some((item) => isPending(item.status))}
          onClick={() => void generate(false)}
        >
          <Sparkles size={18} />
          生成全部
        </button>
      </div>
      <div className="workspace">
        <aside className="sequence">
          <div className="sequence-head">
            <span>画面序列</span>
            <small>{project.assets?.length || 0} 张</small>
          </div>
          {project.assets?.map((item, index) => (
            <button
              className={`sequence-item ${item.id === assetId ? "active" : ""}`}
              onClick={() => setAssetId(item.id)}
              key={item.id}
            >
              <b>{String(index + 1).padStart(2, "0")}</b>
              <span>
                <strong>{item.title.replace(/^\w+\s·\s/, "")}</strong>
                <small>
                  {item.ratio} · {statusText(item.status)}
                </small>
              </span>
              {item.file_path ? (
                <img src={fileUrl(item.file_path)} alt="" />
              ) : (
                <i />
              )}
            </button>
          ))}
        </aside>
        {asset ? (
          <>
            <section className="stage">
              <header>
                <div>
                  <span className="eyebrow">{asset.template}</span>
                  <h2>{asset.title}</h2>
                </div>
                <div>
                  <button
                    className="button secondary"
                    onClick={async () => {
                      const result = await client.resetPrompt(asset.id);
                      await updateAsset({ prompt: result.prompt });
                      setNotice("已按模板重建 Prompt");
                    }}
                  >
                    <WandSparkles size={16} />
                    重建 Prompt
                  </button>
                  <button
                    className="button primary"
                    disabled={isPending(asset.status)}
                    onClick={() => void generate()}
                  >
                    {isPending(asset.status) && (
                      <LoaderCircle className="spin" size={16} />
                    )}
                    {asset.status === "ready" ? "创建新版本" : "生成画面"}
                  </button>
                </div>
              </header>
              <div
                className={`artboard ${asset.file_path ? "with-image" : ""}`}
              >
                {asset.file_path ? (
                  <img src={fileUrl(asset.file_path)} alt={asset.title} />
                ) : (
                  <div className="artboard-empty">
                    {isPending(asset.status) ? (
                      <LoaderCircle className="spin" size={36} />
                    ) : (
                      <ImagePlus size={38} />
                    )}
                    <h3>
                      {isPending(asset.status)
                        ? statusText(asset.status)
                        : "这个画面还未生成"}
                    </h3>
                    <p>
                      {asset.status.startsWith("failed")
                        ? asset.status
                        : "确认右侧的创作方向后，开始生成第一版。"}
                    </p>
                    {!isPending(asset.status) && (
                      <button
                        className="button primary"
                        onClick={() => void generate()}
                      >
                        生成第一版
                      </button>
                    )}
                  </div>
                )}
              </div>
            </section>
            <aside className="controls">
              <div className="controls-head">
                <b>创作控制</b>
                <span>自动保存</span>
              </div>
              <label>
                场景模板
                <select
                  value={asset.template}
                  onChange={(event) =>
                    void updateAsset({ template: event.target.value })
                  }
                >
                  {templates.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset>
                <legend>画面比例</legend>
                <div className="ratio-row">
                  {["1:1", "4:5", "2:3", "16:9"].map((ratio) => (
                    <button
                      key={ratio}
                      className={asset.ratio === ratio ? "active" : ""}
                      onClick={() => void updateAsset({ ratio })}
                    >
                      {ratio}
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className="style-lock">
                <i style={{ background: project.color }} />
                <div>
                  <b>品牌风格已锁定</b>
                  <span>商业光线 · 干净留白</span>
                </div>
              </div>
              <label>
                高级 Prompt
                <textarea
                  defaultValue={asset.prompt}
                  key={asset.id}
                  onBlur={(event) =>
                    void updateAsset({ prompt: event.target.value })
                  }
                  rows={10}
                />
              </label>
              <button
                className="button secondary"
                onClick={() => void navigator.clipboard.writeText(asset.prompt)}
              >
                <Copy size={16} />
                复制 Prompt
              </button>
            </aside>
          </>
        ) : null}
      </div>
      {notice && <Notice text={notice} onClose={() => setNotice("")} />}
    </Shell>
  );
}

function LegacyLibrary() {
  const projects = useAppStore((state) => state.projects);
  const refresh = useAppStore((state) => state.refreshProjects);
  const [notice, setNotice] = useState("");
  async function remove(id: string) {
    if (!window.confirm("确定删除这个项目及其生成图片吗？")) return;
    await client.deleteProject(id);
    await refresh();
    setNotice("项目已删除");
  }
  return (
    <Shell>
      <div className="topbar">
        <div>
          <span className="eyebrow">YOUR ARCHIVE</span>
          <h1>作品库</h1>
        </div>
        <Link className="button primary" to="/new">
          <Plus size={18} />
          新建创作
        </Link>
      </div>
      {projects.length ? (
        <div className="project-grid library-grid">
          {projects.map((project) => (
            <div className="library-item" key={project.id}>
              <ProjectCard project={project} />
              <button
                className="icon-button destructive"
                onClick={() => void remove(project.id)}
                aria-label={`删除 ${project.name}`}
              >
                <Trash2 size={17} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <FolderOpen size={30} />
          <h3>作品库还是空的</h3>
          <p>每一次生成都会沉淀在这里。</p>
        </div>
      )}
      {notice && <Notice text={notice} onClose={() => setNotice("")} />}
    </Shell>
  );
}

void LegacyLibrary;

function Library() {
  const projects = useAppStore((state) => state.projects);
  const refresh = useAppStore((state) => state.refreshProjects);
  const navigate = useNavigate();
  const [filter, setFilter] = useState("全部作品");
  const [notice, setNotice] = useState("");
  async function remove(id: string) {
    if (!window.confirm("确定删除这个项目及其生成图片吗？")) return;
    await client.deleteProject(id);
    await refresh();
    setNotice("项目已删除");
  }
  const filters = ["全部作品", "商品主图", "社媒内容", "详情信息图"];
  return (
    <Shell>
      <div className="topbar">
        <strong>作品库</strong>
      </div>
      <div className="page library-page">
        <div className="library-heading">
          <span className="eyebrow">YOUR OUTPUT</span>
          <h1>作品库</h1>
          <p>每一次生成都保留画面、参考图、Prompt 和所属创作。</p>
        </div>
        <div className="filter-row">
          {filters.map((item) => (
            <button
              className={`filter ${filter === item ? "active" : ""}`}
              onClick={() => setFilter(item)}
              key={item}
            >
              {item}
            </button>
          ))}
        </div>
        {projects.length ? (
          <div className="art-grid library-art-grid">
            {projects.map((project) => (
              <article className="library-item" key={project.id}>
                <ProjectCard project={project} />
                <button
                  className="icon-button destructive"
                  onClick={() => void remove(project.id)}
                  aria-label={`删除 ${project.name}`}
                >
                  <Trash2 size={17} />
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="first-empty library-empty">
            <div>+</div>
            <b>作品库正在等待第一张图</b>
            <p>创建一个商品视觉，生成结果会自动保留在这里。</p>
            <button className="create-button" onClick={() => navigate("/new")}>
              开始创作
            </button>
          </div>
        )}
        {notice && <Notice text={notice} onClose={() => setNotice("")} />}
      </div>
    </Shell>
  );
}

function LegacyTemplates() {
  const templates = useAppStore((state) => state.templates);
  const refresh = useAppStore((state) => state.refreshTemplates);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await client.addTemplate({
        name: String(form.get("name")),
        ratio: String(form.get("ratio")),
        direction: String(form.get("direction")),
      });
      await refresh();
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    }
  }
  return (
    <Shell>
      <div className="topbar">
        <div>
          <span className="eyebrow">CREATIVE STARTING POINTS</span>
          <h1>灵感模板</h1>
        </div>
        <button className="button primary" onClick={() => setOpen(true)}>
          <Plus size={18} />
          自定义场景
        </button>
      </div>
      <p className="page-lead">
        从一个画面方向开始。模板会为 Prompt 提供商业目的、构图重点与场景约束。
      </p>
      <div className="template-grid">
        {templates.map((item) => (
          <article className="template-card" key={item.id}>
            <div className="template-art">
              <Sparkles size={26} />
            </div>
            <span>
              {item.group} · {item.ratio}
            </span>
            <h2>{item.name}</h2>
            <p>{item.direction}</p>
            {item.custom && (
              <button
                className="text-link destructive-link"
                onClick={async () => {
                  await client.deleteTemplate(item.id);
                  await refresh();
                }}
              >
                <Trash2 size={15} />
                删除
              </button>
            )}
          </article>
        ))}
      </div>
      {open && (
        <div className="modal-backdrop">
          <form className="modal" onSubmit={submit}>
            <header>
              <div>
                <span className="eyebrow">CUSTOM SCENE</span>
                <h2>创建场景模板</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setOpen(false)}
                aria-label="关闭"
              >
                <X size={18} />
              </button>
            </header>
            <label>
              模板名称
              <input
                name="name"
                required
                maxLength={80}
                placeholder="例如：午后户外跑步"
              />
            </label>
            <label>
              画面比例
              <select name="ratio" defaultValue="4:5">
                <option>1:1</option>
                <option>4:5</option>
                <option>2:3</option>
                <option>16:9</option>
              </select>
            </label>
            <label>
              创作方向
              <textarea
                name="direction"
                required
                rows={6}
                maxLength={1800}
                placeholder="描述场景、商品如何出现、构图与光线。"
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button className="button primary">保存模板</button>
          </form>
        </div>
      )}
    </Shell>
  );
}

void LegacyTemplates;

function Templates() {
  const templates = useAppStore((state) => state.templates);
  const refresh = useAppStore((state) => state.refreshTemplates);
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const guide: Record<string, [string, string, string]> = {
    "hero-image": [
      "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=900&q=80",
      "为商品建立清晰、可信的第一印象。",
      "白底或纯色背景，突出外观、材质与完整轮廓。",
    ],
    "lifestyle-scene": [
      "https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?auto=format&fit=crop&w=900&q=80",
      "让商品进入真实的生活与使用场景。",
      "空间氛围、人物行为或使用瞬间，适合讲述使用价值。",
    ],
    "detail-macro": [
      "https://images.unsplash.com/photo-1618220179428-22790b461013?auto=format&fit=crop&w=900&q=80",
      "放大材质、做工和关键功能细节。",
      "近景构图与质感光线，帮助用户确认产品品质。",
    ],
    "poster-banner": [
      "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=80",
      "用于促销节点、投放和品牌活动传播。",
      "商品焦点、活动氛围、标题留白和明确的行动区域。",
    ],
    "social-media": [
      "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=80",
      "构建适合社交平台停留与转发的画面。",
      "强视觉中心、自然构图与可承载短文案的留白。",
    ],
    "ugc-style": [
      "https://images.unsplash.com/photo-1604014237800-1c9102c219da?auto=format&fit=crop&w=900&q=80",
      "营造真实用户记录和日常分享感。",
      "自然光、轻微不完美感与生活化视角，降低广告感。",
    ],
    infographic: [
      "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=900&q=80",
      "把卖点、参数和购买理由组织成详情图。",
      "产品主体配合图标、标签、短文案与结构化信息区。",
    ],
    "size-spec": [
      "https://images.unsplash.com/photo-1595515106969-1ce29566ff1c?auto=format&fit=crop&w=900&q=80",
      "清楚表达尺寸、结构和适配空间。",
      "产品正侧视角、尺寸线和规格说明区域。",
    ],
    livestream: [
      "https://images.unsplash.com/photo-1581368135153-a506cf13b1e1?auto=format&fit=crop&w=900&q=80",
      "搭建直播讲解与带货展示场景。",
      "产品陈列、镜头景别、互动区域和直播氛围。",
    ],
    packaging: [
      "https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?auto=format&fit=crop&w=900&q=80",
      "呈现包装、开箱和礼赠体验。",
      "包装正面、内衬、配件和品牌细节的组合展示。",
    ],
    "multi-angle-grid": [
      "https://images.unsplash.com/photo-1583847268964-b28dc8f51f92?auto=format&fit=crop&w=900&q=80",
      "在一张图中交代多角度与完整结构。",
      "正面、侧面、细节与局部特写的有序网格。",
    ],
    "seasonal-campaign": [
      "https://images.unsplash.com/photo-1512389142860-9c449e58a543?auto=format&fit=crop&w=900&q=80",
      "围绕节日、季节和主题活动建立统一视觉。",
      "季节元素、品牌色与商品陈列，共同传达活动氛围。",
    ],
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    try {
      await client.addTemplate({
        name: String(form.get("name")),
        ratio: String(form.get("ratio")),
        direction: String(form.get("direction")),
      });
      await refresh();
      event.currentTarget.reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    }
  }
  return (
    <Shell>
      <div className="topbar">
        <strong>灵感模板</strong>
      </div>
      <div className="page template-page">
        <div className="library-heading">
          <span className="eyebrow">CREATIVE STARTING POINTS</span>
          <h1>从一个画面方向开始</h1>
          <p>
            每个方向都定义了画面的商业目的、构图重点和主要内容。选择后可继续调整风格与细节。
          </p>
        </div>
        <form className="custom-template-form" onSubmit={submit}>
          <div>
            <span>自定义场景模板</span>
            <small>保存后可在画布右侧的场景模板中选择</small>
          </div>
          <input
            name="name"
            maxLength={80}
            placeholder="模板名称，例如：户外跑步场景"
            required
          />
          <select name="ratio" defaultValue="4:5">
            <option value="1:1">1:1 方图</option>
            <option value="4:5">4:5 竖图</option>
            <option value="2:3">2:3 详情长图</option>
            <option value="16:9">16:9 横图</option>
          </select>
          <textarea
            name="direction"
            maxLength={1800}
            placeholder="描述背景、光线、构图和商品如何出现"
            required
          />
          <button className="create-button">保存模板</button>
        </form>
        {error && <p className="form-error">{error}</p>}
        <div className="template-wall">
          {templates.map((item) => {
            const direction = guide[item.id] || guide["hero-image"];
            return (
              <button
                className="template-tile"
                onClick={() => navigate("/new")}
                key={item.id}
              >
                <img
                  className="template-photo"
                  src={direction[0]}
                  alt={`${item.name} 模板示例`}
                  loading="lazy"
                />
                <div>
                  <small>
                    {item.group} · {item.ratio}
                  </small>
                  <b>{item.name}</b>
                  <p>{direction[1]}</p>
                  <span>{direction[2]}</span>
                  <i>使用此方向</i>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </Shell>
  );
}

function SettingsPage() {
  const [settings, setSettings] = useState<Awaited<
    ReturnType<typeof client.tokenSettings>
  > | null>(null);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    void Promise.all([client.tokenSettings(), client.models()])
      .then(([next, items]) => {
        setSettings(next);
        setModels(items.models);
      })
      .catch((error: unknown) =>
        setNotice(error instanceof Error ? error.message : "无法读取设置"),
      );
  }, []);
  if (!settings)
    return (
      <Shell>
        <div className="loading-page">
          <LoaderCircle className="spin" size={28} />
          加载设置...
        </div>
      </Shell>
    );
  return (
    <Shell>
      <div className="topbar">
        <strong>设置</strong>
      </div>
      <div className="page settings-page">
        <span className="eyebrow">HUABOT TOKEN BASE</span>
        <h1>设置</h1>
        <form
          className="settings-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            try {
              await client.saveSettings({
                token_id: String(data.get("token_id")),
                image_model: String(data.get("image_model")),
                text_model: String(data.get("text_model")),
                chat_model: String(data.get("chat_model")),
              });
              setNotice("配置已保存");
            } catch (error) {
              setNotice(error instanceof Error ? error.message : "保存失败");
            }
          }}
        >
          <section>
            <h2>选择 huabot Token</h2>
            <p>
              Token
              只加密保存于服务端。图像生成、商品分析和对话都会使用当前选择。
            </p>
            <label>
              Token
              <select name="token_id" defaultValue={settings.active_token_id}>
                {settings.tokens.map((token) => (
                  <option
                    key={token.id}
                    value={token.id}
                    disabled={token.status !== 1}
                  >
                    {token.name} · 今日 {token.today_cost} · 累计{" "}
                    {token.total_cost}
                    {token.status === 1 ? "" : " · 不可用"}
                  </option>
                ))}
              </select>
            </label>
          </section>
          <section>
            <h2>模型分配</h2>
            <div className="form-grid">
              {[
                ["image_model", "图像生成模型", settings.image_model],
                ["text_model", "商品分析模型", settings.text_model],
                ["chat_model", "创作对话模型", settings.chat_model],
              ].map(([name, label, value]) => (
                <label key={name}>
                  {label}
                  <select name={name} defaultValue={value}>
                    {models.map((model) => (
                      <option value={model.id} key={model.id}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </section>
          <button className="create-button">
            <Settings size={18} />
            保存配置
          </button>
        </form>
      </div>
      {notice && <Notice text={notice} onClose={() => setNotice("")} />}
    </Shell>
  );
}

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
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
