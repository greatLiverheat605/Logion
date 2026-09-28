"use client";
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
      <Integrations />
    </div>
  );
}
