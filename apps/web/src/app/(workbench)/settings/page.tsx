"use client";
import Link from "next/link";
import { Segmented } from "@/platform/workbench/components";
import { useWorkbench } from "@/platform/workbench/provider";
import type { Theme } from "@/platform/workbench/preferences";
import { Integrations } from "@/modules/settings/integrations";
export default function Page() {
  const { preferences, save, pending } = useWorkbench();
  return (
    <div className="wb-page">
      <div className="wb-page-heading">
        <div>
          <h1>设置</h1>
          <p>你的偏好保存在账户中，在不同浏览器间保持一致。</p>
        </div>
      </div>
      <div className="wb-settings">
        <div className="wb-setting-row">
          <div>
            <strong>外观</strong>
            <p>选择日间、夜间或跟随系统。</p>
          </div>
          <Segmented
            label="外观偏好"
            value={preferences["appearance.theme"]}
            options={[
              { id: "light", label: "日间" },
              { id: "dark", label: "夜间" },
              { id: "system", label: "系统" },
            ]}
            onChange={(value) => {
              if (!pending) void save("appearance.theme", value as Theme);
            }}
          />
        </div>
        <label className="wb-setting-row">
          <span>
            <strong>选中文字后显示菜单</strong>
            <p>在 PDF 中选中文字后，显示翻译、解释、提问、摘录和概念操作。</p>
          </span>
          <input
            type="checkbox"
            checked={preferences["reader.selection_menu"]}
            disabled={pending}
            onChange={(event) =>
              void save("reader.selection_menu", event.target.checked)
            }
          />
        </label>
      </div>
      <nav className="wb-settings" aria-label="更多设置">
        <Link className="wb-setting-row" href="/settings/notifications">
          <div>
            <strong>通知</strong>
            <p>查看待处理事项与普通操作历史。</p>
          </div>
        </Link>
        <Link className="wb-setting-row" href="/settings/spaces">
          <div>
            <strong>空间管理</strong>
            <p>归档与恢复空间，保留已有内容。</p>
          </div>
        </Link>
        <Link className="wb-setting-row" href="/settings/legacy-data">
          <div>
            <strong>本机旧数据</strong>
            <p>检查旧队列，确认后清除当前浏览器的旧数据。</p>
          </div>
        </Link>
        <Link className="wb-setting-row" href="/settings/data">
          <div>
            <strong>数据导出</strong>
            <p>下载研究记录与私人想法，保留旧版导出格式。</p>
          </div>
        </Link>
        <Link className="wb-setting-row" href="/settings/ai">
          <div>
            <strong>AI 服务商与路由</strong>
            <p>管理模型、研究任务预设和月度预算。</p>
          </div>
          <span aria-hidden="true">→</span>
        </Link>
        <Link className="wb-setting-row" href="/settings/security">
          <div>
            <strong>设备与会话</strong>
            <p>检查登录设备，退出其他会话。</p>
          </div>
          <span aria-hidden="true">→</span>
        </Link>
        <Link className="wb-setting-row" href="/settings/audit">
          <div>
            <strong>审计记录</strong>
            <p>查看账户安全与当前工作区的操作记录。</p>
          </div>
          <span aria-hidden="true">→</span>
        </Link>
      </nav>
      <Integrations />
    </div>
  );
}
