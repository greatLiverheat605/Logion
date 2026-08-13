# Logion D0：开源组件评估

> 查询日期：2026-08-11。版本来自 npm registry 当日 `latest`；许可证/peer/未压缩包体来自 npm
> 元数据。OSV 以精确包名和版本查询，当日均返回 0 条已知记录。0 条不等于未来安全保证，也不替代
> 安装后的 `pnpm audit`、许可证、锁文件和候选构建检查。

## 1. 候选事实

| 候选                      | 精确版本 | 许可证     | React/维护与包体事实                                                      | D0 判断                                                                                |
| ------------------------- | -------: | ---------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `@radix-ui/react-dialog`  |   1.1.23 | MIT        | peer 覆盖 React/DOM 16.8～19；2026-07-31 更新；npm unpacked 99,377 B      | **推荐作为原语族代表**；按需引入 Dialog/Popover/Tabs/Tooltip/Menu，不引入视觉主题      |
| `react-aria-components`   |   1.20.0 | Apache-2.0 | peer 覆盖 React 16.8～19 RC 范围；2026-08-10 更新；unpacked 6,418,565 B   | **备选**；无障碍覆盖广，但不与 Radix 在同一组件层混用，先验证 React 19.2/Next 16 SSR   |
| `cytoscape`               |   3.34.0 | MIT        | 无 React peer；2026-08-06 更新；unpacked 5,696,647 B                      | **推荐图谱内核候选**；仅客户端动态加载，封装 adapter/layout/render                     |
| `cytoscape-fcose`         |    2.2.0 | MIT        | peer Cytoscape `^3.2.0`；最后更新 2023-01-17；unpacked 8,681,809 B        | **条件候选**；维护陈旧且体积大，先用 Cytoscape 内置布局做真实规模比较，不能默认加入    |
| `@xyflow/react`           |  12.11.2 | MIT        | peer React/DOM >=17；2026-07-06 更新；unpacked 1,208,222 B                | **不推荐首版知识网络**；适合节点编辑器/流程画布，正式图谱更偏网络探索与多布局          |
| `@tanstack/react-table`   |    9.1.2 | MIT        | peer React >=18、Node >=20；2026-08-09 更新；unpacked 134,093 B           | **推荐候选但需冻结验证**；版本很新，先在 Sources/Audit 原型验证 API 与 SSR，再精确锁定 |
| `@tanstack/react-virtual` |   3.14.9 | MIT        | peer React/DOM 16.8～19；2026-07-28 更新；unpacked 56,532 B               | **推荐长列表候选**；只在真实规模达到阈值时启用，保留读屏/键盘策略                      |
| `@floating-ui/react`      |  0.27.20 | MIT        | peer React/DOM >=17；2026-07-11 更新；unpacked 934,317 B                  | **条件候选**；Radix 已满足浮层时不直接重复引入，只用于特殊锚定/碰撞需求                |
| `lucide-react`            |   1.31.0 | ISC        | peer React 16.5～19；2026-08-09 更新；unpacked 31,224,249 B（全图标源码） | **推荐**；只做静态命名直接 import，禁止运行时全库映射导致整包进入客户端                |

## 2. 无障碍原语：Radix 与 React Aria

### 推荐：Radix 子包 + Logion 自有视觉层

理由：

- 项目已有 AppModal、主题和大量原生表单，重构需要渐进替换，不需要整套视觉框架；
- Radix 可按组件子包引入，适合 Dialog、Popover、Dropdown Menu、Tabs、Tooltip；
- 视觉完全由 Logion tokens 控制，符合单一品牌强调色和双主题要求；
- peer 明确覆盖 React 19。

约束：

- 不把 shadcn 生成代码无选择地复制进仓库；只吸收经审查的组件配方；
- 每个 primitive 都要补中文键盘、焦点返回、Portal、SSR/hydration、移动触控和 reduced-motion 测试；
- 现有 AppModal 先做行为对照，迁移后再删除，不允许两套 Dialog 长期并存。

### React Aria 使用条件

如果 D2 证明复杂 Select/ComboBox/Table/Grid 的读屏和键盘需求明显超过 Radix，应在独立 spike 中用
React Aria Components 替代同一层，而不是两者混搭。必须验证 React 19.2 稳定版本、Next 16 SSR、
中文输入法、Portal 与包体。

## 3. 图谱：Cytoscape/fCoSE 与 XYFlow

### 推荐：Cytoscape 作为首选评估对象

- Logion 的核心是有界知识网络探索，不是自由拖拽流程编排；Cytoscape 更贴近图查询、选择、邻居、
  类别样式和网络布局。
- 只输入授权后的 1/2 跳、最多 150 节点/400 边；领域对象先转为稳定 `GraphViewModel`。
- Canvas 只负责呈现；筛选、授权、截断与正式关系来源由服务端/adapter 决定。
- 图库必须 `next/dynamic` 客户端加载；非 Graph 视图不下载/初始化。

fCoSE 不能随 Cytoscape 自动批准。先比较内置 cose/grid/concentric 与真实数据；只有布局稳定性/性能
确有收益才精确锁定 2.2.0，并记录其 2023 年后未更新风险、Worker 可行性与回滚布局。

### XYFlow 的适用边界

XYFlow 更适合未来“用户编辑流程/白板”的节点端口和受控连线。如果后续产品批准探索白板，可单独
评估；v1 知识图谱使用它会把节点编辑器交互强加给只读/审查型网络，因此不作为首选。

## 4. 表格、虚拟化、浮层与图标

- Sources、Audit、History 使用 TanStack Table 的 headless 排序/筛选/选择，但 DOM 结构保持语义表格；
  移动端换列表模板，不横向压缩桌面表格。
- TanStack Virtual 只用于经过数据量测量的长列表。虚拟化后必须保留总数、当前位置、键盘移动、选中
  对象和 Inspector 的稳定关系；不能因卸载行丢失焦点。
- Floating UI 仅在 Radix 无法满足的跨容器锚定场景使用，避免重复浮层基础设施。
- Lucide 只用一套 stroke（约 1.75～2px）；IconButton 必须有 `aria-label` 和 Tooltip；状态仍用文字/
  pill，不用图标单独传意。

## 5. 供应链与升级策略

1. D2 原型可以隔离安装候选，但正式仓库只在 G2 后修改 Manifest/lockfile。
2. 正式引入使用精确版本，不使用 `latest`、宽范围或 CDN；保留 lockfile。
3. 每个依赖记录源码仓库、许可证、维护日期、包体基线、SSR/React peer 和回滚替代。
4. CI 必须执行 `pnpm audit --prod --audit-level high`、许可证策略、构建和 Browser；候选图谱另测 bundle。
5. 图谱、表格、虚拟化和浮层必须被 Logion adapter/primitives 包住，领域组件不直接传播第三方对象。
6. 升级一次只改一个依赖族，运行 Light/Dark、1440/1024/390/320、axe、键盘、reduced-motion 与截图审查。
7. 任何未维护插件、安全记录、peer 冲突或不可解释 bundle 增幅都会停止正式引入。

## 6. 建议的最小正式依赖集合

G2 通过后，I0/I2 首选候选为：

```text
Radix 的少量交互子包
lucide-react
@tanstack/react-table（需要表格时）
@tanstack/react-virtual（达到长列表阈值时）
cytoscape（Graph 视图动态加载）
```

React Aria、fCoSE、XYFlow、Floating UI 均不默认加入；只有 D2/性能/无障碍 spike 提供明确证据后再
审批。
