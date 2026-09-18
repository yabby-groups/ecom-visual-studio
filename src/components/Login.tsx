import { type FormEvent, useState } from "react";
import { ArrowLeft, LoaderCircle } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { client } from "../api";
import { safeReturnTo } from "../auth";
import { useAppStore } from "../store";
import "./Login.css";

export function Login() {
  const setUser = useAppStore((state) => state.setUser);
  const initialize = useAppStore((state) => state.initialize);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState("");
  const [totpRequired, setTotpRequired] = useState(false);
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
      navigate(safeReturnTo(searchParams.get("returnTo")), { replace: true });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "无法完成登录";
      if (message === "totp required") {
        setTotpRequired(true);
        setError("请输入身份验证器中的 6 位验证码");
      } else if (message === "totp invalid") {
        setTotpRequired(true);
        setError("身份验证器验证码错误");
      } else if (message === "user or passwd invalid") {
        setError("huabot 账号或密码错误");
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <button
          className="back-link"
          type="button"
          onClick={() =>
            navigate(safeReturnTo(searchParams.get("returnTo")), {
              replace: true,
            })
          }
        >
          <ArrowLeft size={15} />
          暂不登录
        </button>
        <span className="eyebrow">FRAMEBOARD × HUABOT</span>
        <h1>登录以启用 AI 能力</h1>
        <p>
          登录后自动读取或创建你账号下的 Token Base
          Key，用于图像生成、商品分析和 AI
          对话。本地创作无需登录，密码和动态验证码不会保存。
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
          {totpRequired && (
            <label>
              动态验证码
              <input
                name="totp_code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="输入 6 位验证码"
                required
              />
            </label>
          )}
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
