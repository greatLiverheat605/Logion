# 人工智能研究生与 Agent 安全完整学习路线

> 面向：人工智能及其应用方向准研究生；导师研究集中在推荐系统、数据挖掘、深度学习、序列推荐、图协同过滤与对比学习；个人项目为 [Vigils](https://vigils.ai/)——本地 AI Agent 控制平面。  
> 版本日期：2026-07-19。课程和工具会持续更新，选课前应再次检查官方页面。  
> 本文定位：一份可执行的“课程选择 + 理论地图 + 项目训练 + 科研准备”方案，而不是简单资源清单。

> 已根据你的实际基础生成精确到日期的配套计划：[2026开学前47天个性化学习计划.md](./2026开学前47天个性化学习计划.md)。

---

## 0. 先给结论

你的学习应当同时服务于三个目标，但优先级不同：

1. **开学后能做研究**：数学、机器学习、PyTorch、实验方法与论文阅读是地基。
2. **能快速进入导师课题**：重点学习推荐系统、序列建模、图神经网络、对比学习与元学习。
3. **能把 Vigils 做成可信的 Agent 安全产品**：学习 Agent 架构、系统安全、应用安全、威胁建模、授权、沙箱、审计、隐私与安全评测。

建议的长期时间分配：

- 40%：机器学习与推荐系统科研基础
- 30%：Agent 安全理论与实验
- 20%：Vigils 工程实现和测试
- 10%：论文写作、英语、复现记录与汇报

开学前不要追求“全部学完”。你真正需要完成的是：

- 能独立写一个规范的 PyTorch 训练循环；
- 能解释并实现矩阵分解、LightGCN、SASRec 中至少两个；
- 能解释 Transformer、对比学习、InfoNCE、负采样和常用推荐指标；
- 能画出一个 Agent 的数据流、控制流和信任边界；
- 能针对 Vigils 写出威胁模型、安全不变量和自动化攻击测试；
- 能向导师做一次 10 分钟汇报：复现了什么、结果如何、下一步研究问题是什么。

---

## 1. 你的导师方向意味着什么

从导师的代表论文可以反推出研究能力栈。

| 论文关键词 | 必须掌握的基础 | 进一步能力 |
|---|---|---|
| Sequential Recommendation | 序列建模、Attention、Transformer、负采样、Top-K 排序 | SASRec、BERT4Rec、生成式推荐、长短期兴趣建模 |
| Contrastive Learning | 表征学习、数据增强、互信息直觉、InfoNCE | 增强策略、假负样本、去偏、自监督目标设计 |
| Graph Collaborative Filtering | 图论、消息传递、Embedding、协同过滤 | LightGCN、图增强、结构/语义视图、知识图谱 |
| Meta-optimization | 双层优化、超参数学习、元学习 | 可学习增强、自动权重、稳定训练与消融 |
| Deep Self-Attention | Transformer、残差、归一化、位置编码 | 特征级交互、深层网络优化、效率分析 |
| Data Mining / Big Data | SQL、数据清洗、统计检验、可复现实验 | Spark/分布式训练按课题需要再学 |

### 最适合你的交叉研究方向

导师方向和 Vigils 可以自然结合，不必二选一：

1. **Agent 行为序列的风险检测**  
   把工具调用、参数、权限变化、网络访问看作行为序列，用序列推荐模型预测“下一步合理动作”或异常风险。

2. **基于对比学习的恶意轨迹检测**  
   对正常/攻击轨迹构造结构与语义增强，训练安全表征，用于提示注入、越权调用和数据外泄检测。

3. **MCP 工具生态的图风险建模**  
   将用户、Agent、工具、MCP Server、资源和凭证构造成异构图，研究恶意节点、权限传播和供应链风险。

4. **人机审批推荐与最小打扰**  
   在安全约束下预测哪些操作可自动放行、哪些必须审批。核心不是单纯提高点击率，而是在漏报、误报、打扰成本之间做受约束优化。

5. **安全约束下的工具推荐与规划**  
   把 Agent 的工具选择理解为带权限、成本和风险约束的排序/序列决策问题。

优先推荐第 1 或第 2 个方向：与导师成果最贴近，也容易利用 Vigils 生成真实行为数据和实验平台。

---

## 2. 完整知识地图

### 2.1 数学基础

#### 线性代数

需要掌握：

- 向量、矩阵、张量及广播；
- 内积、范数、距离、余弦相似度；
- 线性变换、秩、基、正交投影；
- 特征值、特征向量、SVD、PCA；
- 矩阵求导、Jacobian、Hessian 的基本直觉。

验收任务：不用框架实现 PCA；推导矩阵分解推荐的损失和梯度。

#### 概率与统计

需要掌握：

- 条件概率、贝叶斯公式、独立性；
- 常见分布、期望、方差、协方差；
- 最大似然、最大后验；
- 采样、置信区间、假设检验；
- 偏差—方差、校准、类别不平衡；
- A/B 测试与多重比较的基本问题。

验收任务：对安全检测器给出 Precision、Recall、FPR、FNR、PR-AUC 和置信区间，不能只报 Accuracy。

#### 微积分与优化

需要掌握：

- 导数、偏导、链式法则；
- 梯度下降、SGD、Momentum、Adam；
- 正则化、约束优化、拉格朗日乘子；
- 凸优化直觉；
- 双层优化和元梯度的基本形式。

验收任务：手写两层神经网络反向传播；解释导师论文中“meta-optimized”的内外层目标。

#### 信息论

重点掌握：熵、交叉熵、KL 散度、互信息直觉、温度系数。它们直接关联分类、推荐和对比学习。

### 2.2 编程与科研工程

必须熟练：

- Python：数据结构、函数、类、类型标注、异常、虚拟环境；
- NumPy、pandas、Matplotlib/Seaborn；
- PyTorch：Dataset/DataLoader、Module、Autograd、优化器、GPU、保存/加载；
- Linux 命令行、Git、SSH、环境变量；
- SQL 和 SQLite；
- 单元测试、配置管理、日志、随机种子；
- 实验记录：数据版本、代码提交、配置、指标、硬件和运行时间。

建议掌握：Docker、Weights & Biases 或 MLflow、Hydra、pytest。

按需学习：Spark、Kubernetes、CUDA kernel。开学前不要把它们当主线。

### 2.3 机器学习与深度学习

学习顺序：

1. 线性/逻辑回归、损失函数、正则化；
2. 决策树、随机森林、GBDT；
3. 聚类、降维、异常检测；
4. MLP、反向传播、初始化、归一化；
5. CNN 和 RNN 了解基本思想；
6. Attention 与 Transformer 深入掌握；
7. 表征学习、自监督学习、对比学习；
8. 图神经网络；
9. 元学习与双层优化。

### 2.4 推荐系统

#### 第一层：基本问题

- 显式反馈与隐式反馈；
- 协同过滤、矩阵分解；
- Pointwise、Pairwise、Listwise 排序；
- BPR loss、交叉熵、负采样；
- 冷启动、长尾、曝光偏差、流行度偏差；
- Recall、Precision、Hit Rate、NDCG、MRR、AUC；
- 数据切分，尤其是时间切分和防止未来信息泄漏。

#### 第二层：现代模型

- Wide & Deep、DeepFM 等特征交互模型；
- GRU4Rec、Caser；
- SASRec、BERT4Rec；
- NGCF、LightGCN；
- 自监督与对比学习推荐；
- 多兴趣、跨域、多模态和生成式推荐。

#### 第三层：科研问题

- 增强操作是否保留用户真实意图；
- 对比学习中的假负样本；
- 流行度偏差对离线结果的影响；
- 图结构噪声与鲁棒性；
- Meta-learning 如何自动选择增强、损失权重或结构；
- 统计显著性、消融实验、效率与公平比较。

推荐实验框架：[RecBole](https://recbole.io/)。官方页面当前描述其包含 100+ 推荐模型、44 个格式化数据集，并覆盖一般、序列、上下文、知识类推荐，适合做统一复现，但仍需阅读模型原始实现和论文，不能把跑配置等同于理解。

### 2.5 LLM 与 Agent

#### LLM 基础

- Tokenization、Embedding、位置编码；
- Transformer、因果语言模型、训练与推理；
- Sampling、temperature、top-p；
- 指令微调、偏好优化只需先懂概念；
- 上下文窗口、KV cache、量化的基本作用；
- RAG：切分、检索、重排、引用和评测。

#### Agent 基础

- 模型、消息、工具、状态、观察、动作；
- Function calling / structured output；
- Reflection、planning、tool use、multi-agent；
- Agent loop、停止条件、重试和预算；
- Memory 与状态持久化；
- MCP 的 Host、Client、Server、Tool、Resource、Prompt；
- 可观测性：trace、事件、决策记录、回放；
- 评测：任务成功率、步骤数、成本、延迟、安全违规率。

原则：先用 Python 自己写一个最小 Agent loop，再使用 LangGraph、LlamaIndex 或 smolagents。否则容易只会拼框架。

### 2.6 传统安全基础

Agent 安全不是“提示词技巧”的同义词。必须补齐传统安全：

- CIA：机密性、完整性、可用性；
- 身份认证与授权；
- RBAC、ABAC、能力安全（capability-based security）；
- 最小权限、默认拒绝、纵深防御、零信任；
- Web 安全：注入、SSRF、XSS、CSRF、路径穿越、命令注入；
- 操作系统：进程、文件权限、环境变量、系统调用、沙箱；
- 网络：DNS、TLS、HTTP、代理、出站控制；
- 密钥管理：系统 Keychain、短期凭证、轮换、撤销；
- 供应链：依赖、签名、SBOM、漏洞扫描；
- 审计：append-only、哈希链、时间、身份、完整性验证；
- 隐私：PII 分类、数据最小化、脱敏、保留期限。

### 2.7 Agent 安全核心

学习时必须区分四类风险面：

1. **输入与上下文**：直接/间接提示注入、恶意文档、记忆污染、检索污染。
2. **模型与规划**：错误推理、目标劫持、过度自主、不可控循环。
3. **工具与执行**：越权、参数注入、命令执行、SSRF、敏感文件访问、跨工具组合攻击。
4. **供应链与多主体**：恶意 MCP Server、工具描述投毒、依赖污染、Agent 间信任传播。

OWASP 2025 LLM Top 10 当前包括：Prompt Injection、Sensitive Information Disclosure、Supply Chain、Data and Model Poisoning、Improper Output Handling、Excessive Agency、System Prompt Leakage、Vector and Embedding Weaknesses、Misinformation、Unbounded Consumption。

Agentic AI 还需特别关注：

- 工具能力是否过大；
- Agent 是否能自行改变权限或安全策略；
- 工具描述、返回值和外部网页是否被当成可信指令；
- 身份和授权是否在每次动作时重新校验；
- 多 Agent 间是否发生权限洗白；
- 长期记忆是否可被投毒；
- 人类审批是否会被疲劳、误导或绕过；
- 出站数据是否经过目的地和敏感性检查；
- 失败时是否 fail closed；
- 日志是否泄露原始密钥或个人信息。

---

## 3. Vigils 专项知识与产品学习图

官网当前把 Vigils 定位为 “Local AI Agent Control Plane”，核心包括策略引擎、审计链、凭证租约、人工审批、沙箱、PII 脱敏、浏览器拦截和 MCP Gateway。这意味着你需要的不只是模型知识，而是“AI + 安全 + 系统”的组合能力。

| Vigils 模块 | 应学理论 | 工程验收 |
|---|---|---|
| Policy Engine | ABAC、能力系统、规则优先级、冲突消解、形式化状态机 | 属性化测试证明 Deny > Approve > Allow；未知动作默认拒绝 |
| Audit Chain | 哈希、链式完整性、规范序列化、时间与重放 | 修改任意历史记录后验证必然失败；并发写入不破坏顺序 |
| Credential Lease | Secret management、TTL、scope、撤销、最小权限 | 密钥不进入 prompt/log/UI；超时、崩溃和重试均可撤销 |
| Approval Queue | TOCTOU、审批绑定、重放攻击、疲劳攻击 | 审批必须绑定动作摘要、参数、目标和时限；修改参数后旧审批失效 |
| Sandbox | 进程隔离、Wasm、系统调用、文件/网络能力 | 默认无网络、无环境变量、无宿主文件；预算超限自动终止 |
| PII Scanner | NER、规则、精确率/召回率、校准、对抗样本 | 多语言、混淆字符、分片密钥、Base64、误报/漏报基准集 |
| Browser Guard | DOM 事件、MV3、内容脚本、旁路路径 | 覆盖粘贴、拖拽、脚本赋值、表单提交、富文本、iframe 等路径 |
| MCP Gateway | 协议、身份、授权、工具 schema、供应链 | Server 身份固定；schema 变化告警；每个 tool call 产生决策记录 |

### 对官网安全声明的处理原则

安全产品的可信度来自可验证证据。官网中的测试数量、第三方审计、SOC 2、ISO 27001、零误报等声明，都应对应可公开核验的报告、证书范围、测试代码、提交哈希和复现说明。未来时间点或路线图内容必须明确标注为“计划”，不能呈现为已经完成。

建议新增以下公开材料：

- Threat Model；
- Security Invariants；
- Security Architecture；
- Red-team corpus 与通过率定义；
- 漏洞披露政策和安全联系方式；
- 第三方审计报告或摘要；
- 性能、误报、漏报的可复现实验；
- 对 MCP、浏览器、桌面端各自信任边界的说明。

---

## 4. 市面课程与资料怎么选

不可能穷举互联网上“所有课程”，而且大量课程重复、过时或只教框架 API。更有效的做法是覆盖所有知识类别，并在每类选一个主课程、一个参考资料和一个项目。

### 4.1 数学

| 资源 | 定位 | 优点 | 局限 | 建议 |
|---|---|---|---|---|
| 3Blue1Brown 线性代数本质 | 直觉入门 | 视觉化极强 | 练习不足 | 先看，再做题 |
| MIT 18.06 | 系统线代 | 理论扎实 | 时间长 | 薄弱章节精学 |
| Khan Academy / 可汗学院 | 微积分、概率补缺 | 适合查漏 | 不面向 ML | 按测评结果使用 |
| StatQuest | 统计与 ML 直觉 | 清楚、短 | 数学深度有限 | 作为预习 |
| Boyd Convex Optimization | 优化进阶 | 权威 | 难度高 | 研一按需读，不必开学前通读 |

### 4.2 机器学习与深度学习

| 资源 | 适合人群 | 评价 | 选择建议 |
|---|---|---|---|
| Andrew Ng Machine Learning Specialization | 初学者 | 路径平滑、练习友好，理论深度有限 | 基础薄弱时作为第一门 |
| Stanford CS229 | 数学基础较好 | 理论系统。2026 夏季官网先修包括 Python/NumPy、概率、多元微积分与线代 | 作为研究生理论主线，不必追求听完全部视频 |
| Dive into Deep Learning（D2L） | 想边学边写代码 | 数学、图、代码和可执行 Notebook 结合，适合主教材 | **首选深度学习主线** |
| Deep Learning Specialization | 需要结构化课程 | 讲解成熟 | 部分内容偏经典 | 与 D2L 二选一为主，不要同时完整刷 |
| fast.ai Practical Deep Learning | 工程导向 | 快速得到结果 | 底层理论需要另补 | 时间紧、想增强实战时选 |
| CS231n | 视觉方向 | 经典且深入 | 与当前主线不完全匹配 | 非必修 |

### 4.3 推荐系统与图学习

| 资源 | 定位 | 建议 |
|---|---|---|
| Recommender Systems Specialization（University of Minnesota/Coursera） | 推荐系统概念与传统方法 | 入门可选，但不能替代论文与代码复现 |
| Google ML Recommendation Systems | 简短体系介绍 | 用于快速建立召回、排序、评测框架 |
| Microsoft Recommenders | 工程 Notebook | 参考实现，按需要取用 |
| RecBole | 统一研究实验框架 | **导师方向首选实验平台**；要检查数据切分和公平配置 |
| Stanford CS224W | 图机器学习 | **图推荐必学**。官网列出 GNN、知识图谱、图表示学习等内容，并公开课件/作业资源 |
| Graph Representation Learning（Hamilton） | 图表示教材 | 配合 CS224W 阅读 |
| 导师 5 篇代表论文 + 被引基础论文 | 最直接的研究入口 | 每篇做问题、方法、公式、实验、局限五栏笔记 |

### 4.4 LLM 与 Agent

| 资源 | 当前内容 | 评价与建议 |
|---|---|---|
| Hugging Face Agents Course | Agent 基础、smolagents、LlamaIndex、LangGraph、Agentic RAG、最终项目、可观测性与评测 | 免费、完整、项目化；官方建议每章约 3–4 小时。**首选 Agent 实战课** |
| DeepLearning.AI Agentic AI | Andrew Ng；约 9h55m；Reflection、Tool Use、Planning、Multi-Agent、评测与优化 | 结构紧凑，适合先建立设计模式；深度和安全内容需另补 |
| LangGraph Academy | 状态图、持久化、人机协作 | 当你决定用 LangGraph 时再学，避免框架先行 |
| Hugging Face LLM Course | Transformer、Tokenizer、模型使用与微调 | LLM 基础薄弱时选择 |
| Stanford CS224N | NLP/Transformer 理论 | 想深入语言模型时选重点章节 |
| Stanford CS336 | 从头构建语言模型 | 难度高、耗时大 | 研一后按研究需要，不是开学前主线 |
| Full Stack Deep Learning / LLM Bootcamp | 生产化与系统全景 | 适合补评测、部署、数据和产品化 |

课程顺序建议：先用 2–3 天手写最小工具调用循环，再学 DeepLearning.AI Agentic AI 或 Hugging Face Agents Course，最后才选一个框架深入。

### 4.5 安全、AI 安全与红队

| 资源 | 学什么 | 优先级 |
|---|---|---|
| PortSwigger Web Security Academy | Web 攻击与防御实操 | 高：Agent 工具最终大量连接 Web/API |
| OWASP Top 10 | 传统 Web 风险 | 高 |
| OWASP 2025 Top 10 for LLM/GenAI | LLM 应用风险分类与缓解 | **必读** |
| OWASP Agentic AI – Threats and Mitigations | Agent 专项威胁模型；OWASP ASI 系列的第一份指南 | **必读** |
| MITRE ATLAS | AI 攻击战术、技术和案例知识库 | **必读并用于攻击用例映射** |
| NIST AI RMF + Generative AI Profile | 治理、测量、风险管理 | 做企业产品时必读 |
| Lakera Gandalf | Prompt Injection 直观练习 | 入门体验，不可当完整安全训练 |
| promptfoo | 提示、模型与红队自动化测试 | 适合 CI 安全回归 |
| garak | LLM 漏洞扫描 | 适合学习探针思想和基准构建 |
| PyRIT | 生成式 AI 红队编排 | 适合构建系统化攻击流程 |
| Inspect AI | AI 安全评测框架 | 适合规范记录任务、模型、评分器与日志 |

安全课程常见误区：

- 只教 jailbreak，不教身份、权限、执行和网络；
- 只做聊天机器人，不测试真实工具副作用；
- 只展示攻击成功案例，没有对照组、分母和复现条件；
- 用“检测模型准确率”替代端到端风险降低；
- 只增加一个 guardrail 模型，没有结构性最小权限和沙箱。

### 4.6 Rust、桌面端和系统工程（Vigils 专项）

| 资源 | 用途 | 学习深度 |
|---|---|---|
| The Rust Book + Rustlings | 所有权、生命周期、错误、并发 | 必学 |
| Tokio 文档 | 异步服务 | 用到再系统学 |
| Tauri 2 文档 | 桌面 GUI 与权限边界 | 与产品同步学习 |
| Wasmtime 文档 | Wasm 沙箱、WASI、资源限制 | 核心模块需深入 |
| SQLite 文档 | 事务、WAL、FTS5 | 审计模块需深入 |
| OWASP ASVS / SAMM | 安全需求和开发流程 | 产品进入团队/企业阶段学习 |

---

## 5. 开学前 6 周冲刺计划

假设每周可投入 20–25 小时。如果少于 12 小时，保留标有“核心”的任务，删除拓展任务。

### 第 1 周：基线、工具与数学复习

核心任务：

- 做 Python、线代、概率、微积分自测；
- 配好 Python、PyTorch、Git、Jupyter 环境；
- 用 NumPy 实现线性回归和逻辑回归；
- 阅读导师 5 篇论文的摘要、引言、结论；
- 为 Vigils 画数据流图和信任边界图。

产出：`baseline.md`、两份 NumPy 实现、导师论文一页式总览、Vigils 威胁模型 v0。

### 第 2 周：PyTorch 与机器学习实验规范

核心任务：

- 学 D2L 的线性网络、MLP、优化、正则化；
- 写通用训练/验证循环；
- 学会 seed、early stopping、checkpoint、配置文件；
- 为一个分类任务报告完整指标和误差分析。

产出：可复用训练模板、实验记录模板、一次完整误差分析。

### 第 3 周：推荐系统基础

核心任务：

- 学协同过滤、矩阵分解、BPR、负采样；
- 实现或用 RecBole 跑通 MF/BPR；
- 再跑 LightGCN；
- 使用时间切分，报告 Recall@K、NDCG@K、MRR；
- 检查流行度基线和随机基线。

产出：至少两个模型的公平对比表、配置、日志和结果解释。

### 第 4 周：序列推荐、Transformer 与对比学习

核心任务：

- 学 Attention、Transformer、mask；
- 阅读 SASRec、BERT4Rec、InfoNCE 基础材料；
- 跑通 SASRec；
- 阅读导师前两篇 TKDE 论文，画出方法流程；
- 列出每个增强操作的假设与可能破坏的信息。

产出：SASRec 复现报告；一页公式推导；导师论文 1 次 10 分钟模拟汇报。

### 第 5 周：Agent 与 Agent 安全

核心任务：

- 手写最小 Agent loop：模型输出结构化工具调用、执行、观察、停止；
- 完成 Hugging Face Agents Course Unit 1，或 DeepLearning.AI Agentic AI 的核心模块；
- 阅读 OWASP LLM Top 10、OWASP Agentic 威胁指南；
- 把每类风险映射到 Vigils 的预防、检测、响应措施；
- 建立 30 条最小攻击用例。

产出：最小 Agent、风险矩阵、攻击测试集 v0。

### 第 6 周：Vigils 安全里程碑与导师沟通包

核心任务：

- 选一个 Vigils 模块做深入验证，优先 Policy Engine 或 Approval Queue；
- 建立 benign/malicious 两类 Agent 轨迹数据；
- 做第一版规则基线或序列异常检测基线；
- 写 3 页研究提案；
- 准备给导师的 10 页以内汇报。

最终产出：

1. 可复现实验仓库；
2. 威胁模型与安全不变量；
3. 至少 50 条攻击/正常测试；
4. 推荐模型或行为风险模型基线；
5. 研究提案和导师汇报。

---

## 6. 入学后 12 个月路线

### 第 1–3 个月：补齐基础与复现

- 系统完成 D2L 重点章节和 CS229 重点讲义；
- 完成 SASRec、LightGCN、导师一篇论文的复现；
- 学 CS224W 的 Node Embedding、GNN、Knowledge Graph；
- 建立论文阅读、实验配置和周报规范；
- 为 Vigils 建立持续安全回归测试。

目标：结果能复现、差异能解释、实验能重复。

### 第 4–6 个月：形成研究问题

- 收集和定义 Agent 行为轨迹数据 schema；
- 建立规则、传统 ML、Transformer/GNN 三层基线；
- 明确定义威胁模型、攻击者能力和安全指标；
- 做消融：动作、参数、工具图、时间间隔、语义文本各自贡献；
- 与导师确认研究问题是否具有新颖性和可发表性。

目标：形成一份完整开题式报告，而不只是产品功能说明。

### 第 7–9 个月：方法创新与严格实验

可能方法：

- 正常轨迹的自监督预训练；
- 结构/语义双视图对比学习；
- 工具调用异构图上的风险传播；
- 可学习的数据增强或损失权重；
- 安全约束下的审批推荐；
- OOD 与不确定性触发人工审批。

必须包含：强基线、多个数据集/场景、统计显著性、消融、效率、失败案例、攻击自适应性。

### 第 10–12 个月：论文与产品双向沉淀

- 将研究数据集、基准、评测脚本与 Vigils 解耦；
- 写论文初稿并内部评审；
- 将研究中有效的方法转成可解释、可降级的产品模块；
- 整理开源版本、模型卡、安全说明和复现说明；
- 选择合适会议/期刊，不为追热点牺牲实验质量。

---

## 7. 每周执行模板

### 时间安排（每周 20 小时示例）

- 6 小时：主课程/教材；
- 5 小时：代码与实验；
- 3 小时：论文精读；
- 3 小时：Vigils 安全测试；
- 2 小时：总结、写作与汇报；
- 1 小时：复盘与下周计划。

### 每周必须产生的证据

- 1 份周报；
- 1 个可运行提交；
- 1 张实验表或图；
- 1 篇论文卡片；
- 1 个失败案例及原因；
- 1 个下周可证伪的假设。

### 论文卡片模板

```markdown
# 论文标题

- 问题：作者真正解决了什么？
- 假设：方法依赖哪些成立条件？
- 方法：输入、模块、损失、训练、推理。
- 公式：最重要的 1–3 个公式及每个符号。
- 实验：数据、切分、基线、指标、显著性。
- 结论：哪些证据支持结论？
- 局限：哪些设置没测？
- 复现：代码、配置、差异、随机种子。
- 延伸：能否用于 Agent 行为安全？
```

---

## 8. 科研与安全评测规范

### 推荐系统实验

- 固定数据预处理和切分；
- 不允许测试集信息参与负采样、调参或早停；
- 报告随机种子和均值/方差；
- 与流行度、简单 MF 和强模型同时比较；
- 使用相同候选集、评测协议和资源预算；
- 记录参数量、训练时间和推理成本。

### Agent 安全实验

至少报告：

- Attack Success Rate；
- 对正常任务的通过率/任务成功率；
- Precision、Recall、FPR、FNR、PR-AUC；
- 审批次数和用户打扰成本；
- 延迟、吞吐、内存；
- 自适应攻击下的结果；
- 失败后是否产生真实副作用；
- 日志是否包含敏感信息。

安全评测的样本单位应尽量是“完整轨迹/真实副作用”，不能只判断一条文本是否像攻击。

### 威胁模型最小模板

```markdown
- 保护资产：代码、凭证、个人信息、文件、网络身份、审计记录。
- 攻击者：恶意用户、恶意网页/文档、恶意 MCP Server、供应链攻击者、被攻陷的 Agent。
- 攻击能力：能控制哪些输入、能否观察输出、能否多轮交互、能否修改工具描述。
- 信任边界：模型、Gateway、工具、沙箱、宿主机、浏览器、远端服务。
- 安全目标：禁止什么、允许什么、失败时如何处理。
- 非目标：当前版本明确不保证什么。
```

---

## 9. “必须学 / 后学 / 暂缓”清单

### 开学前必须学

- Python、NumPy、PyTorch；
- 线代、概率、梯度与优化；
- ML 基础与实验规范；
- Transformer；
- 协同过滤、矩阵分解、SASRec、LightGCN；
- 对比学习与 InfoNCE；
- Agent loop、工具调用和 MCP 基本概念；
- 威胁建模、最小权限、授权、审计、密钥管理；
- OWASP LLM Top 10 与 Agentic 威胁。

### 入学后按需深入

- 元学习与双层优化；
- 图对比学习；
- 因果推荐、公平性、去偏；
- LLM 微调与偏好优化；
- 形式化验证；
- 云原生安全和企业合规。

### 暂时不要投入过多

- 从零训练大模型；
- 同时学习多个 Agent 框架；
- 只为证书刷大量短课；
- 过早学习复杂 Kubernetes/MLOps；
- 追逐每周新出的 Agent 名词；
- 在没有威胁模型时堆叠多个 guardrail 模型。

---

## 10. 自测与阶段门槛

### 基础合格

- 能解释过拟合、正则化、偏差—方差；
- 能从零写 PyTorch 训练循环；
- 能正确做训练/验证/测试切分；
- 能读懂常见损失函数和梯度更新。

### 导师方向合格

- 能解释 BPR、SASRec、LightGCN、InfoNCE；
- 能复现至少两个推荐模型；
- 能指出数据切分、负采样和指标中的潜在不公平；
- 能用 10 分钟讲清导师一篇论文。

### Agent 安全合格

- 能画出 Agent 的信任边界；
- 能区分 prompt injection、tool injection、output handling 和 excessive agency；
- 能说明为什么 system prompt 不是安全边界；
- 能为工具调用设计最小权限和审批绑定；
- 能构建包含正常样本的攻击评测，而不是只测攻击样本。

### Vigils 产品合格

- 每次工具调用都有可验证决策记录；
- 未知动作默认拒绝；
- 密钥不进入模型上下文和日志；
- 审批不能被修改参数后复用；
- 沙箱默认无网络、无宿主权限；
- 官网重要安全声明有可核验证据。

---

## 11. 建议的第一批研究题目

### 题目 A：基于序列对比学习的 Agent 工具调用异常检测

- 输入：工具 ID、参数摘要、资源、权限、时间间隔、结果码；
- 基线：规则、Isolation Forest、LSTM、Transformer；
- 方法：轨迹增强 + InfoNCE + 风险分类；
- 难点：增强是否保持安全语义、真实攻击稀缺、跨 Agent 泛化；
- 优点：与导师序列推荐和对比学习高度一致。

### 题目 B：基于异构图学习的 MCP 工具供应链风险评估

- 图节点：Agent、用户、Server、Tool、资源、凭证；
- 图边：调用、读取、写入、授权、依赖；
- 基线：规则风险分、PageRank、LightGCN/GAT；
- 目标：恶意工具识别、风险传播、最小权限建议；
- 优点：与图协同过滤和 Vigils MCP Gateway 对齐。

### 题目 C：兼顾安全与用户打扰的审批策略学习

- 目标：降低漏报和审批次数；
- 建模：成本敏感排序、选择性预测、conformal prediction 或约束优化；
- 核心要求：高风险区域不可被个性化自动放行；
- 优点：具有推荐系统特色和直接产品价值。

建议先做 A，再以 B 或 C 作为延伸。

---

## 12. 官方资料索引

以下为本路线优先参考的官方或项目主页：

- Vigils：[https://vigils.ai/](https://vigils.ai/)
- Stanford CS229：[https://cs229.stanford.edu/](https://cs229.stanford.edu/)
- Stanford CS224W：[https://web.stanford.edu/class/cs224w/](https://web.stanford.edu/class/cs224w/)
- Dive into Deep Learning：[https://d2l.ai/](https://d2l.ai/)
- RecBole：[https://recbole.io/](https://recbole.io/)
- Hugging Face Agents Course：[https://huggingface.co/learn/agents-course/](https://huggingface.co/learn/agents-course/)
- DeepLearning.AI Agentic AI：[https://www.deeplearning.ai/courses/agentic-ai](https://www.deeplearning.ai/courses/agentic-ai)
- OWASP 2025 Top 10 for LLM/GenAI：[https://genai.owasp.org/llm-top-10/](https://genai.owasp.org/llm-top-10/)
- OWASP Agentic AI Threats and Mitigations：[https://genai.owasp.org/resource/agentic-ai-threats-and-mitigations/](https://genai.owasp.org/resource/agentic-ai-threats-and-mitigations/)
- MITRE ATLAS：[https://atlas.mitre.org/](https://atlas.mitre.org/)
- NIST AI RMF：[https://www.nist.gov/itl/ai-risk-management-framework](https://www.nist.gov/itl/ai-risk-management-framework)
- PortSwigger Web Security Academy：[https://portswigger.net/web-security](https://portswigger.net/web-security)
- promptfoo：[https://www.promptfoo.dev/](https://www.promptfoo.dev/)
- garak：[https://github.com/NVIDIA/garak](https://github.com/NVIDIA/garak)
- PyRIT：[https://github.com/Azure/PyRIT](https://github.com/Azure/PyRIT)
- Inspect AI：[https://inspect.aisi.org.uk/](https://inspect.aisi.org.uk/)

---

## 13. 用于定制下一版的关键信息

回答以下问题后，可以把本路线进一步改成精确到每天的个人版本：

1. 本科专业，以及线性代数、概率、微积分、Python、PyTorch 各自熟练度（0–5 分）。
2. 距离正式开学还有多少周，每周能稳定投入多少小时。
3. 英文论文和英文视频是否有明显障碍。
4. Vigils 当前团队人数、你负责的模块、已有代码量和主要技术栈。
5. 研一更优先考虑发论文、做产品、就业，还是三者平衡。
6. 可用硬件：本地 GPU 型号、内存、是否有服务器或云预算。

当前已知情况：计算机科学与技术本科；Python 1/5、PyTorch 0/5、线性代数 1/5、概率 0/5；2026-09-05 开学；每天约 6 小时；英文论文阅读尚可；在 Vigils 中负责架构规划和 AI 开发；研一优先论文。相应的具体执行安排见配套的 47 天个性化计划。
