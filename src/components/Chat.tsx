import { type FormEvent, useState } from "react";
import { LoaderCircle, X } from "lucide-react";
import { client } from "../api";
import { useAiInteraction } from "../aiInteraction";
import type { AiAction } from "../types";
import "./Chat.css";

type Message = {
  role: string;
  content: string;
  actions?: AiAction[];
};

export function Chat({ onClose }: { onClose: () => void }) {
  const { context, execute } = useAiInteraction();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState("");
  const [actionStatus, setActionStatus] = useState<Record<string, string>>({});
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || busy) return;
    const next = [...messages, { role: "user", content: text.trim() }];
    setMessages(next);
    setText("");
    setBusy(true);
    let reply = "";
    setMessages([...next, { role: "assistant", content: reply }]);
    try {
      const result = await client.chat(next, context, (delta) => {
        reply += delta;
        setMessages([...next, { role: "assistant", content: reply }]);
      });
      setMessages([
        ...next,
        {
          role: "assistant",
          content: result.text || reply,
          actions: result.actions,
        },
      ]);
    } catch (error) {
      setMessages([
        ...next,
        {
          role: "assistant",
          content: `${reply}${reply ? "\n\n" : ""}${error instanceof Error ? error.message : "对话失败"}`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }
  async function confirm(action: AiAction, key: string) {
    setRunning(key);
    try {
      const result = await execute(action);
      setActionStatus((current) => ({ ...current, [key]: result }));
    } catch (error) {
      setActionStatus((current) => ({
        ...current,
        [key]: error instanceof Error ? error.message : "操作失败",
      }));
    } finally {
      setRunning("");
    }
  }
  return (
    <aside className="chat-panel">
      <header>
        <div>
          <span className="eyebrow">AI 对话</span>
          <h3>创作助手</h3>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="关闭">
          <X size={19} />
        </button>
      </header>
      <div className="chat-log">
        {messages.length ? (
          messages.map((message, index) => (
            <div className="chat-entry" key={`${message.role}-${index}`}>
              <article className={`chat-message ${message.role}`}>
                {message.content}
              </article>
              {message.actions?.map((action, actionIndex) => {
                const key = `${index}-${actionIndex}`;
                const status = actionStatus[key];
                return (
                  <section className="chat-action" key={key}>
                    <strong>{action.summary}</strong>
                    {status ? (
                      <small>{status}</small>
                    ) : (
                      <div>
                        <button
                          className="button primary"
                          type="button"
                          disabled={Boolean(running)}
                          onClick={() => void confirm(action, key)}
                        >
                          {running === key ? "执行中..." : "确认执行"}
                        </button>
                        <button
                          className="button secondary"
                          type="button"
                          disabled={Boolean(running)}
                          onClick={() =>
                            setActionStatus((current) => ({
                              ...current,
                              [key]: "已取消",
                            }))
                          }
                        >
                          取消
                        </button>
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
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
