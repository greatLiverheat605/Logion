import type { components } from "@logion/contracts";

import styles from "./ai-governance-workbench.module.css";

type Provider = components["schemas"]["AIProviderResponse"];
const guidance: Record<string, string> = {
  AI_PROVIDER_DISABLED: "Provider 已停用。请核实是否需要由管理员启用。",
  AI_PROVIDER_KEY_UNAVAILABLE: "服务端凭据不可用。请管理员核实密钥配置。",
  AI_PROVIDER_REDIRECT_BLOCKED:
    "连接遇到重定向并已被阻止。请核实直接服务地址，不要绕过安全检查。",
  AI_PROVIDER_RESPONSE_INVALID: "响应不符合支持的格式。请核实服务接口兼容性。",
  AI_PROVIDER_RESPONSE_TOO_LARGE:
    "响应超过安全大小限制。请检查服务接口，不要放宽限制。",
  AI_PROVIDER_DNS_UNRESOLVABLE:
    "无法解析 Provider 域名。请管理员检查服务端 DNS 与网络，再由你决定是否重新检查。",
  AI_PROVIDER_DNS_BLOCKED:
    "Provider DNS 检查未通过，解析结果未通过公网地址检查。请检查 Provider 配置，不要放宽地址安全限制。",
  AI_PROVIDER_URL_BLOCKED:
    "地址未通过安全检查。请使用受支持的公开 HTTPS 地址。",
  AI_PROVIDER_AUTH_FAILED: "凭据被拒绝。请核实或更新密钥后再检查。",
  AI_PROVIDER_UNAVAILABLE: "服务暂不可用。请检查服务状态与网络后再试。",
  AI_PROVIDER_RATE_LIMITED: "服务请求受限。请稍后再试，并检查服务侧配额。",
};

export function ProviderDiagnostics({ provider }: { provider: Provider }) {
  const code = provider.last_health_error_code;
  const knownCode = code && Object.hasOwn(guidance, code) ? code : null;
  const checkedAt = provider.last_health_checked_at;
  const date = checkedAt ? new Date(checkedAt) : null;
  const validDate = date && Number.isFinite(date.getTime());
  return (
    <section className={styles.diagnostics} aria-label="Provider 诊断">
      <h3>最近一次连接检查</h3>
      <dl>
        <dt>检查结果</dt>
        <dd>
          {provider.last_health_status === "healthy"
            ? "通过"
            : provider.last_health_status === "unhealthy"
              ? "未通过"
              : "尚无检查结果"}
        </dd>
        <dt>检查时间</dt>
        <dd>
          {validDate ? (
            <time dateTime={date.toISOString()}>
              {date.toLocaleString("zh-CN")}
            </time>
          ) : (
            "暂无可用时间"
          )}
        </dd>
        <dt>错误分类</dt>
        <dd>{knownCode ?? (code ? "其他连接错误" : "无已记录错误")}</dd>
      </dl>
      <p>
        {knownCode
          ? guidance[knownCode]
          : provider.last_health_status === "unhealthy"
            ? "请管理员检查 Provider 配置和服务状态；核心学习功能不受影响。"
            : "可在需要时使用现有检查入口确认连接状态。"}
      </p>
      <p>
        以上是上次检查记录，不代表当前实时连通性。查看诊断不会发送外部请求；“测试并发现模型”仍需确认后才会连接
        Provider。
      </p>
    </section>
  );
}
