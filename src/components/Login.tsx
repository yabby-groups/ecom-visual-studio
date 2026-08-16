import { type FormEvent, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { client } from "../api";
import { useAppStore } from "../store";
import "./Login.css";

export function Login() {
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
