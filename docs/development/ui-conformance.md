# UI 一致性检查

浏览器测试同时检查路由覆盖、主要操作、布局区域和响应式几何。测试入口是
[prototype-productization.spec.ts](../../tests/browser/prototype-productization.spec.ts)，共享断言位于
[glm-conformance.ts](../../tests/browser/glm-conformance.ts)。

## 固定测试输入

[ui-targets.json](../../tests/browser/fixtures/ui-targets.json) 保存版本化的路由、几何参数、参考图摘要及明确的差异记录。该清单是测试输入，不能随某次失败运行自动重写；修改时应审查相关页面和断言。

`reports/`、`test-results/` 和 `playwright-report/` 仅存放运行输出，不跟踪到 Git。

## 可选视觉参考

原始参考图不随源码分发。默认查找本地忽略目录 `.local/ui-reference`，也可通过 `LOGION_GLM_TARGET_ROOT` 指向受控参考目录。目录应包含清单的 `source.specs` 与 `assets` 所列文件。

参考目录缺失时，测试明确跳过原图摘要与篡改核验；路由清单、结构和页面几何检查仍应执行。跳过项不能记为原图核验通过。

## 修改与复核

1. 根据实际产品变更更新对应源码与测试输入。
2. 核对路由完整性、操作主次、键盘路径和窄屏布局。
3. 运行相关 Playwright 项目并阅读失败结果。
4. 需要保存截图时使用 CI artifacts，去除个人内容后再用于 PR 说明。
