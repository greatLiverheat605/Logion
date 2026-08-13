# Logion Design System v1

## 1. 视觉语言

Logion 使用安静、可信的专业生产力外壳；未来感只出现在知识图谱局部布局、证据路径和同步状态，不使用营销 Hero、光球、玻璃拟态、霓虹、背景粒子、彩虹节点或 Emoji 功能图标。

## 2. Tokens

### Light

```text
bg.app       #F3F5F7
bg.sidebar   #EAEDF1
bg.surface   #FFFFFF
bg.muted     #F7F8FA
bg.canvas    #EEF2F6
text.primary #18202A
text.second  #596474
text.tertiary#8490A0
primary      #1769D2
success      #237C56
warning      #936210
danger       #B43A3A
```

### Dark

```text
bg.app       #1D2025
bg.sidebar   #17191D
bg.surface   #292D33
bg.muted     #32373E
bg.canvas    #22262C
text.primary #F2F4F7
text.second  #B2BAC6
text.tertiary#7F8998
primary      #5BA2FF
success      #62C493
warning      #F0C461
danger       #FF8A86
```

共同规则：4px 间距网格；按钮和卡片圆角 6/8px；边框优先于阴影；正文 13–14px；页面标题 18–22px；元信息 11–12px；品牌主色只有一组；主题通过根节点 `data-theme` 持久化。

## 3. 组件层级

1. Primitive：Button、IconButton、Input、Select、Textarea、Toggle、Segmented Control；
2. Feedback：Inline Error、Toast、Skeleton、Progress、Request ID、Conflict Resolver；
3. Navigation：App Rail、Context Bar、Breadcrumb、Tabs、Command Palette、Mobile Navigation；
4. Object：Task Row、Source Row、Excerpt Row、Topic Row、Evidence Row、Member Row；
5. Workspace：Reader、Claim Editor、Graph Canvas、Graph List、Inspector、Timeline、Settings List；
6. Flow：Invite Dialog、Danger Confirmation、Import Preview、AI Draft Review。

组件围绕对象和任务命名，不再把 `Panel + Metric + Card` 作为所有页面的默认语言。所有弹层必须有焦点进入、Escape、焦点恢复和移动端可用路径；所有 IconButton 必须有中文 `aria-label`。

## 4. 图谱规则

- 服务端/adapter 提供有界 `GraphViewModel`；Canvas 不复制领域事实；
- 只有授权后的 1/2 跳数据进入渲染；150 节点、400 边硬限；
- 正式关系用实线和标签，候选/探索关系用虚线和“候选”状态，不用颜色单独表达含义；
- 桌面使用 Cytoscape 候选（动态加载、精确版本、adapter 封装），移动端默认列表/树；
- 只在选中路径和局部证据链使用 150–220ms 动态；`prefers-reduced-motion` 关闭非必要动态。
