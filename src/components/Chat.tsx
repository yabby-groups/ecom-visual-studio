import { type FormEvent, useState } from "react";
import { LoaderCircle, X } from "lucide-react";
import { client } from "../api";
import "./Chat.css";

export function Chat({ onClose }: { onClose: () => void }) {
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
    let reply = "";
    setMessages([...next, { role: "assistant", content: reply }]);
    try {
      await client.chat(next, (delta) => {
        reply += delta;
        setMessages([...next, { role: "assistant", content: reply }]);
      });
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
