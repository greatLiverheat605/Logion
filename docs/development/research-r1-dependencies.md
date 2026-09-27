# R1 开发依赖核验

R1-9 将 json-schema-to-typescript 升级到 16.0.0、jsdom 升级到 30.1.1，
对应原依赖 PR #259、#262。它们是开发工具，不增加产品运行时依赖。

## js-yaml 覆盖范围

核对 GitHub Advisory Database 后，原 4.3.2 覆盖应仅用于 `>=4.0.0 <5.0.0`：

- [GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh)：
  4.x 受影响范围 `>=4.0.0 <4.3.2`，修补为 4.3.2；3.x 有独立修补线。
- [GHSA-5p4m-2wfm-xmqj](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj)：
  4.x 受影响范围 `>=4.0.0 <4.3.1`，4.3.2 已覆盖。
- [GHSA-pm4m-ph32-ghv5](https://github.com/advisories/GHSA-pm4m-ph32-ghv5)：
  5.x 受影响范围 `>=5.0.0 <=5.2.1`，修补为 5.2.2。

json-schema-to-typescript 16 要求 js-yaml `^5.2.3`；锁文件实际解析为 5.4.2。
需要 4.x 的引用解析工具继续使用 4.3.2。这样既保留 4.x 安全修补，也不把 5.x
使用方强制降到不兼容的主版本。`pnpm audit --audit-level high` 未发现已知漏洞。
升级后重新生成的 OpenAPI、同步类型与已有文件完全相同。

## jsdom 的可访问名称

jsdom 30 对行内元素计算样式更准确，相邻 `strong` / `small` 等元素的可访问名称
不再产生旧测试假设的空格。IntegrationHub 两个选择器继续要求按钮标题、数字和
状态；画像切换选择器继续要求完整文案，只允许行内元素边界的可选空白。
未删除断言，也未修改旧页面、测试等待、重试次数或超时。

原三个失败在本地复现，修正后两份文件共 12 项测试通过。仓库固定 Node 24.18.0
满足 jsdom 30.1.1 的 Node `^24.15.0` 要求。

已有的 `@eslint/js@10.0.1` 与 ESLint 9 可选 peer 提示仍存在，升级前锁文件中也存在。
本项不扩展 ESLint 主版本升级范围；lint、typecheck 和完整测试仍作为合并门禁。
