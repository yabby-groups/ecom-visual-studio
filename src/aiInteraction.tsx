import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { client } from "./api";
import { useAppStore } from "./store";
import type { AiAction, AiChatContext } from "./types";

type PageRegistration = {
  screen: string;
  data: Record<string, unknown> | (() => Record<string, unknown>);
  refresh?: () => Promise<void> | void;
  execute?: (action: AiAction) => boolean;
};

type AiInteractionValue = {
  context: AiChatContext;
  registerPage: (registration: PageRegistration) => () => void;
  execute: (action: AiAction) => Promise<string>;
};

const AiInteractionContext = createContext<AiInteractionValue | null>(null);

const actionTypes = new Set<AiAction["type"]>([
  "navigate",
  "fill_draft",
  "update_asset",
  "add_asset",
  "generate_asset",
  "generate_pack",
  "create_project",
  "create_template",
  "create_try_on",
  "regenerate_try_on",
]);

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      )
    : [];
}

export function AiInteractionProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const refreshProjects = useAppStore((state) => state.refreshProjects);
  const refreshTemplates = useAppStore((state) => state.refreshTemplates);
  const [page, setPage] = useState<PageRegistration>({
    screen: "工作台",
    data: {},
  });

  const registerPage = useCallback((registration: PageRegistration) => {
    setPage(registration);
    return () => {
      setPage((current) => (current === registration ? { screen: "工作台", data: {} } : current));
    };
  }, []);

  const execute = useCallback(
    async (action: AiAction) => {
      if (!actionTypes.has(action.type)) throw new Error("AI 操作类型无效");
      const payload = action.payload || {};
      if (page.execute?.(action)) {
        await page.refresh?.();
        return "当前草稿已更新";
      }
      switch (action.type) {
        case "navigate": {
          const to = stringValue(payload.to);
          if (!/^\/(?:$|new$|library$|templates$|try-on(?:\/[a-zA-Z0-9]+)?$|projects\/[a-zA-Z0-9]+$)/.test(to)) {
            throw new Error("AI 请求的跳转地址无效");
          }
          navigate(to);
          return "已切换到对应页面";
        }
        case "fill_draft":
          throw new Error("当前页面不支持草稿填充");
        case "update_asset": {
          const id = stringValue(payload.id);
          if (!id) throw new Error("缺少画面标识");
          const patch = Object.fromEntries(
            ["title", "template", "ratio", "prompt"]
              .filter((key) => typeof payload[key] === "string")
              .map((key) => [key, payload[key]]),
          );
          if (!Object.keys(patch).length) throw new Error("没有可更新的画面字段");
          await client.updateAsset(id, patch);
          break;
        }
        case "add_asset":
          await client.addAsset(stringValue(payload.project_id), stringValue(payload.template_id));
          break;
        case "generate_asset":
          await client.generateAsset(stringValue(payload.id));
          break;
        case "generate_pack":
          await client.generatePack(stringValue(payload.project_id));
          break;
        case "create_project": {
          const project = await client.createProject({
            name: stringValue(payload.name),
            product: stringValue(payload.product),
            description: stringValue(payload.description),
            benefits: stringValue(payload.benefits),
            color: stringValue(payload.color) || "#137A65",
            reference: stringValue(payload.reference),
          });
          await client.createPack(project.id, {
            kind: stringValue(payload.kind) || "amazon",
            scene_template_ids: stringList(payload.scene_template_ids),
            template_id: stringValue(payload.template_id) || undefined,
          });
          await refreshProjects();
          navigate(`/projects/${project.id}`);
          return "项目已创建，已进入工作区";
        }
        case "create_template":
          await client.addTemplate({
            name: stringValue(payload.name),
            ratio: stringValue(payload.ratio),
            direction: stringValue(payload.direction),
          });
          await refreshTemplates();
          break;
        case "create_try_on":
          await client.createTryOn({
            person_paths: stringList(payload.person_paths),
            garment_paths: stringList(payload.garment_paths),
            generation_mode: payload.generation_mode === "combinations" ? "combinations" : "combined",
            instructions: stringValue(payload.instructions),
            ratio: stringValue(payload.ratio),
          });
          break;
        case "regenerate_try_on":
          await client.regenerateTryOn(stringValue(payload.id));
          break;
      }
      await page.refresh?.();
      return "操作已完成";
    },
    [navigate, page, refreshProjects, refreshTemplates],
  );

  const value = useMemo<AiInteractionValue>(
    () => ({
      context: {
        route: location.pathname,
        screen: page.screen,
        data: typeof page.data === "function" ? page.data() : page.data,
      },
      registerPage,
      execute,
    }),
    [execute, location.pathname, page, registerPage],
  );
  return <AiInteractionContext.Provider value={value}>{children}</AiInteractionContext.Provider>;
}

export function useAiInteraction() {
  const value = useContext(AiInteractionContext);
  if (!value) throw new Error("AI 界面联动未初始化");
  return value;
}
