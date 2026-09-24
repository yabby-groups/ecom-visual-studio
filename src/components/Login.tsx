import { type FormEvent, useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, LoaderCircle } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { BrowserOpenURL } from "../../wailsjs/runtime/runtime";
import { client } from "../api";
import { safeReturnTo } from "../auth";
import { useAppStore } from "../store";
import type { DeviceAuthorization, User } from "../types";
import "./Login.css";

export function Login() {
  const setUser = useAppStore((state) => state.setUser);
  const initialize = useAppStore((state) => state.initialize);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState(() =>
    searchParams.get("reason") === "authorization_expired"
      ? "Huabot 授权已失效，请重新授权"
      : "",
  );
  const [totpRequired, setTotpRequired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [authorization, setAuthorization] =
    useState<DeviceAuthorization | null>(null);

  async function finishLogin(user: User) {
    setUser(user);
    await initialize();
    navigate(safeReturnTo(searchParams.get("returnTo")), { replace: true });
  }

  async function startAuthorization() {
    setError("");
    setLoading(true);
    try {
      const next = await client.startHuabotAuthorization();
      setAuthorization(next);
      BrowserOpenURL(next.verification_uri_complete);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "无法开始 Huabot 授权",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authorization) return;
    let active = true;
    let timer = 0;
    const expiresAt = Date.now() + authorization.expires_in * 1000;
    let pollInterval = Math.max(authorization.interval, 3) * 1000;
    const poll = async () => {
      if (!active) return;
      if (Date.now() >= expiresAt) {
        setAuthorization(null);
        setError("授权请求已过期，请重新发起");
        return;
      }
      try {
        const result = await client.pollHuabotAuthorization(
          authorization.device_code,
        );
        if (!active) return;
        if (result.status === "authorized" && result.user) {
          await finishLogin(result.user);
          return;
        }
        if (result.status === "denied" || result.status === "expired") {
          setAuthorization(null);
          setError(
            result.status === "denied" ? "你已拒绝此次授权" : "授权请求已过期",
          );
          return;
        }
        if (result.status === "slow_down") pollInterval += 5000;
      } catch (reason) {
        if (active)
          setError(
            reason instanceof Error ? reason.message : "授权状态读取失败",
          );
      }
      if (active) {
        timer = window.setTimeout(poll, pollInterval);
      }
    };
    timer = window.setTimeout(poll, pollInterval);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [authorization]);

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
      await finishLogin(user);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "无法完成登录";
      if (message === "totp required") {
        setTotpRequired(true);
        setError("请输入身份验证器中的 6 位验证码");
      } else if (message === "totp invalid") {
        setTotpRequired(true);
        setError("身份验证器验证码错误");
      } else if (message === "user or passwd invalid") {
        setError("Huabot 账号或密码错误");
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
        <div className="auth-brand">
          <img src="/ecom-visual-studio.svg" alt="" aria-hidden="true" />
          <span className="eyebrow">Huabot 账号授权</span>
        </div>
        <h1>登录以启用 AI 能力</h1>
        <p>使用网页授权时，在 Huabot 页面完成验证，无需在应用中输入密码。</p>

        {authorization ? (
          <div className="oauth-card">
            <span>请在浏览器确认授权</span>
            <strong>{authorization.user_code}</strong>
            <button
              className="button primary"
              type="button"
              onClick={() =>
                BrowserOpenURL(authorization.verification_uri_complete)
              }
            >
              <ExternalLink size={17} />
              重新打开授权页面
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => setAuthorization(null)}
            >
              取消
            </button>
          </div>
        ) : (
          <button
            className="button primary oauth-start"
            type="button"
            disabled={loading}
            onClick={() => void startAuthorization()}
          >
            {loading && <LoaderCircle className="spin" size={18} />}
            {loading ? "正在创建授权请求..." : "使用 Huabot 网页授权"}
          </button>
        )}

        <button
          className="password-toggle"
          type="button"
          onClick={() => setPasswordVisible((value) => !value)}
        >
          {passwordVisible ? "收起账号密码登录" : "使用账号密码登录"}
        </button>
        {passwordVisible && (
          <form onSubmit={submit} className="form-stack">
            <label>
              Huabot 账号
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
            <button className="button primary" disabled={loading}>
              {loading && <LoaderCircle className="spin" size={18} />}
              {loading ? "正在登录..." : "登录 Huabot"}
            </button>
          </form>
        )}
        {error && <p className="form-error">{error}</p>}
      </section>
    </main>
  );
}
