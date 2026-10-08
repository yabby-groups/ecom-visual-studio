import { ArrowLeft, Check, Clipboard, Eye, Plus, X } from "lucide-react";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { client } from "../api";
import type {
  AvatarAsset,
  AvatarAssetCatalog,
  AvatarAssetSelection,
  AvatarPersona,
} from "../types";
import { userFacingError } from "../utils/assets";
import "./AvatarPicker.css";

type Props = {
  value: AvatarAssetSelection[];
  onChange: Dispatch<SetStateAction<AvatarAssetSelection[]>>;
  disabled?: boolean;
  embedded?: boolean;
};
type Detail = {
  source: "public" | "personal";
  asset: AvatarAsset;
  persona?: AvatarPersona;
};
const keyOf = (source: string, id: string) => `${source}:${id}`;

export function AvatarPicker({
  value,
  onChange,
  disabled,
  embedded = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"public" | "personal">("public");
  const [catalog, setCatalog] = useState<AvatarAssetCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [copied, setCopied] = useState(false);
  const selected = new Set(value.map((item) => keyOf(item.source, item.id)));
  const isSelected = (source: "public" | "personal", id: string) =>
    selected.has(keyOf(source, id));
  const assetURI = (source: "public" | "personal", asset: AvatarAsset) =>
    asset.asset_uri || `avatar://${source}/${asset.id}`;

  const addSelection = (source: "public" | "personal", id: string) => {
    const key = keyOf(source, id);
    onChange((current) => {
      if (current.some((item) => keyOf(item.source, item.id) === key))
        return current;
      if (current.length >= 4) {
        setError("每个任务最多选择 4 张虚拟人素材");
        return current;
      }
      setError("");
      return [...current, { source, id }];
    });
  };
  const toggle = (source: "public" | "personal", id: string) => {
    const key = keyOf(source, id);
    onChange((current) => {
      if (current.some((item) => keyOf(item.source, item.id) === key)) {
        return current.filter((item) => keyOf(item.source, item.id) !== key);
      }
      if (current.length >= 4) {
        setError("每个任务最多选择 4 张虚拟人素材");
        return current;
      }
      setError("");
      return [...current, { source, id }];
    });
  };
  async function loadCatalog() {
    if (catalog || loading) return;
    setLoading(true);
    try {
      setCatalog(await client.avatarAssets());
    } catch (reason) {
      setError(
        userFacingError(
          reason instanceof Error ? reason.message : "",
          "无法加载虚拟人素材",
        ),
      );
    } finally {
      setLoading(false);
    }
  }
  async function show() {
    setOpen(true);
    setError("");
    await loadCatalog();
  }
  async function copyURI() {
    if (!detail) return;
    try {
      await navigator.clipboard.writeText(
        assetURI(detail.source, detail.asset),
      );
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("复制失败，请手动复制 asset URI");
    }
  }
  useEffect(() => {
    if (!open) setDetail(null);
  }, [open]);
  useEffect(() => {
    if (value.length > 0) void loadCatalog();
  }, [value.map((item) => keyOf(item.source, item.id)).join("|")]);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <section className={`avatar-picker${embedded ? " embedded" : ""}`}>
      {!embedded && (
        <div className="avatar-picker-head">
          <div>
            <strong>虚拟人</strong>
            <span>可选，作为人物一致性参考</span>
          </div>
          <button
            type="button"
            className="button secondary"
            disabled={disabled}
            onClick={() => void show()}
          >
            <Plus size={16} />
            选择虚拟人
          </button>
        </div>
      )}
      {value.length > 0 && catalog && (
        <div className="avatar-selected reference-thumbs">
          {value.map((item) => {
            const asset =
              item.source === "personal"
                ? catalog.assets.find((candidate) => candidate.id === item.id)
                : catalog.personas
                    .flatMap((persona) => persona.assets)
                    .find((candidate) => candidate.id === item.id);
            return (
              <div
                className="reference-thumb"
                key={keyOf(item.source, item.id)}
              >
                <div className="product-reference active">
                  {asset?.preview_url ? (
                    <img
                      src={asset.preview_url_64 || asset.preview_url}
                      alt=""
                    />
                  ) : (
                    <span className="avatar-preview-placeholder" />
                  )}
                </div>
                <button
                  type="button"
                  className="reference-remove"
                  aria-label="移除虚拟人"
                  disabled={disabled}
                  onClick={() => toggle(item.source, item.id)}
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      {embedded && (
        <button
          type="button"
          className="button secondary avatar-picker-action"
          disabled={disabled}
          onClick={() => void show()}
        >
          <Plus size={16} />
          选择虚拟人
        </button>
      )}
      {open && (
        <div
          className="avatar-dialog-backdrop"
          role="presentation"
          onMouseDown={() => setOpen(false)}
        >
          <div
            className="avatar-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="选择虚拟人"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="avatar-dialog-header">
              <div>
                <span className="avatar-eyebrow">人物素材库</span>
                <h2>选择虚拟人</h2>
                <span>已选 {value.length}/4</span>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="关闭"
                onClick={() => setOpen(false)}
              >
                <X size={18} />
              </button>
            </header>
            <div className="avatar-tabs" role="tablist" aria-label="素材来源">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "public"}
                className={tab === "public" ? "active" : ""}
                onClick={() => {
                  setTab("public");
                  setDetail(null);
                }}
              >
                公开虚拟人
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "personal"}
                className={tab === "personal" ? "active" : ""}
                onClick={() => {
                  setTab("personal");
                  setDetail(null);
                }}
              >
                我的虚拟人
              </button>
            </div>
            {loading && <p className="avatar-state">正在加载...</p>}
            {error && <p className="avatar-state error">{error}</p>}
            {!loading && catalog && (
              <div
                className={
                  detail ? "avatar-browser is-detail-open" : "avatar-browser"
                }
              >
                <div className="avatar-browser-main">
                  {tab === "public" ? (
                    <div className="avatar-personas">
                      {catalog.personas.length === 0 && (
                        <p className="avatar-state">暂无公开虚拟人</p>
                      )}
                      {catalog.personas.map((item) => {
                        const cover = item.assets[0];
                        if (!cover) return null;
                        return (
                          <AvatarCard
                            key={item.id}
                            asset={cover}
                            title={item.name || "未命名虚拟人"}
                            subtitle={
                              item.tags || `${item.assets.length} 个参考素材`
                            }
                            detail={`${item.assets.length} 个参考素材`}
                            detailLabel={`查看 ${item.name || "虚拟人"} 详情`}
                            selected={item.assets.some((asset) =>
                              isSelected("public", asset.id),
                            )}
                            onClick={() => {
                              setCopied(false);
                              setDetail({
                                source: "public",
                                asset: cover,
                                persona: item,
                              });
                            }}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <div className="avatar-grid">
                      {catalog.assets.length === 0 && (
                        <p className="avatar-state">暂无个人虚拟人</p>
                      )}
                      {catalog.assets.map((asset) => (
                        <AssetCard
                          key={asset.id}
                          asset={asset}
                          selected={isSelected("personal", asset.id)}
                          onClick={() => {
                            setCopied(false);
                            setDetail({ source: "personal", asset });
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
                {detail && (
                  <aside className="avatar-detail" aria-label="虚拟人详情">
                    <div className="avatar-detail-heading">
                      <button
                        type="button"
                        className="avatar-back"
                        onClick={() => setDetail(null)}
                      >
                        <ArrowLeft size={16} />
                        返回列表
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="关闭详情"
                        onClick={() => setDetail(null)}
                      >
                        <X size={17} />
                      </button>
                    </div>
                    <div className="avatar-detail-image">
                      {detail.asset.preview_url ? (
                        <img src={detail.asset.preview_url} alt="" />
                      ) : (
                        <span />
                      )}
                    </div>
                    <span className="avatar-eyebrow">
                      {detail.source === "public"
                        ? "公开虚拟人像"
                        : "我的虚拟人像"}
                    </span>
                    <h3>
                      {detail.persona?.name ||
                        detail.asset.name ||
                        "虚拟人素材"}
                    </h3>
                    <DetailField
                      label="group ID"
                      value={detail.persona?.group_id || detail.persona?.id}
                    />
                    <DetailField
                      label="人物标签"
                      value={detail.persona?.tags}
                    />
                    <DetailField
                      label="人物小传"
                      value={detail.persona?.description}
                    />
                    <div className="avatar-reference-field">
                      <span>参考图</span>
                      <div className="avatar-reference-list">
                        {(detail.persona?.assets || [detail.asset]).map(
                          (asset) => (
                            <button
                              type="button"
                              className={[
                                asset.id === detail.asset.id && "active",
                                isSelected(detail.source, asset.id) &&
                                  "selected",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                              key={asset.id}
                              aria-pressed={isSelected(detail.source, asset.id)}
                              onClick={() => {
                                toggle(detail.source, asset.id);
                                setCopied(false);
                                setDetail({ ...detail, asset });
                              }}
                            >
                              <img
                                src={asset.preview_url_64 || asset.preview_url}
                                alt=""
                              />
                            </button>
                          ),
                        )}
                      </div>
                    </div>
                    <DetailField label="asset ID" value={detail.asset.id} />
                    <button
                      type="button"
                      className="avatar-copy"
                      onClick={() => void copyURI()}
                    >
                      {copied ? <Check size={17} /> : <Clipboard size={17} />}
                      {copied ? "已复制 asset URI" : "复制 asset URI"}
                    </button>
                    <button
                      type="button"
                      className="avatar-use"
                      onClick={() => {
                        addSelection(detail.source, detail.asset.id);
                        setDetail(null);
                        setOpen(false);
                      }}
                    >
                      <Check size={17} />
                      使用此参考图
                    </button>
                  </aside>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function DetailField({ label, value }: { label: string; value?: string }) {
  return value ? (
    <div className="avatar-detail-field">
      <span>{label}</span>
      <p>{value}</p>
    </div>
  ) : null;
}

function AssetCard({
  asset,
  selected,
  onClick,
}: {
  asset: AvatarAsset;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <AvatarCard
      asset={asset}
      title={asset.name || "虚拟人素材"}
      subtitle="我的虚拟人"
      detail="1 个参考素材"
      detailLabel={`查看 ${asset.name || "虚拟人素材"} 详情`}
      selected={selected}
      onClick={onClick}
    />
  );
}

function AvatarCard({
  asset,
  title,
  subtitle,
  detail,
  detailLabel,
  selected = false,
  onClick,
}: {
  asset: AvatarAsset;
  title: string;
  subtitle: string;
  detail: string;
  detailLabel: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <article className={selected ? "avatar-card selected" : "avatar-card"}>
      <button type="button" className="avatar-card-main" onClick={onClick}>
        {asset.preview_url ? (
          <img
            src={asset.preview_url_512 || asset.preview_url}
            alt=""
            loading="lazy"
          />
        ) : (
          <span className="avatar-placeholder" />
        )}
        <strong>{title}</strong>
        <span>{subtitle}</span>
        <small>{detail}</small>
      </button>
      <button
        type="button"
        className="avatar-card-detail"
        aria-label={detailLabel}
        onClick={onClick}
      >
        <Eye size={17} />
      </button>
      {selected && <Check className="avatar-card-check" size={16} />}
    </article>
  );
}
