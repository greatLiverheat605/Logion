/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KnowledgeSpaceVC } from "./knowledge-space-vc";

afterEach(cleanup);

/* ----------------------------------------------------------
   jsdom does not run requestAnimationFrame callbacks.
   Mock it to execute synchronously so focus-shift tests work.
   ---------------------------------------------------------- */
beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

/* ----------------------------------------------------------
   Helper: render the VC and return useful queries.
   ---------------------------------------------------------- */
function renderVC() {
  return render(<KnowledgeSpaceVC />);
}

/* ----------------------------------------------------------
   SVG attribute helper — jsdom SVG namespace prevents
   getAttribute from returning presentation attributes.
   ---------------------------------------------------------- */
function svgAttr(el: Element | null, name: string): string | null {
  if (!el) return null;
  return el.getAttributeNS(null, name) ?? el.getAttribute(name);
}

/* ===========================================================
   1 — Review semantics
   =========================================================== */

describe("review-state semantics", () => {
  it("pending node shows accept/edit/reject buttons", () => {
    renderVC();

    // Select a pending node via the mobile tree button
    const topic3Btn = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("交错练习"));
    expect(topic3Btn).toBeDefined();
    fireEvent.click(topic3Btn!);

    // The inspector should show the review actions section
    expect(screen.getByText("审批操作（本地模拟）")).toBeDefined();
    expect(screen.getByRole("button", { name: "采纳交错练习" })).toBeDefined();
  });

  it("confirmed node hides the review actions section", () => {
    renderVC();

    // "间隔重复" has confirmState "confirmed"
    const btn = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("间隔重复"));
    expect(btn).toBeDefined();
    fireEvent.click(btn!);

    expect(screen.queryByText("审批操作（本地模拟）")).toBeNull();
  });

  it("clicking accept on a pending node resolves it to confirmed", () => {
    renderVC();

    const btn = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("交错练习"));
    fireEvent.click(btn!);

    const acceptBtn = screen.getByRole("button", { name: "采纳交错练习" });
    expect(acceptBtn).toBeDefined();
    fireEvent.click(acceptBtn);

    // After accept: review actions section should be gone
    expect(screen.queryByText("审批操作（本地模拟）")).toBeNull();
  });

  it("accepted node does not show 待验证 tag simultaneously", () => {
    renderVC();

    const btn = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("交错练习"));
    fireEvent.click(btn!);
    fireEvent.click(screen.getByRole("button", { name: "采纳交错练习" }));

    // 待验证 should no longer appear for the selected (now confirmed) node
    // Other nodes may still show 待验证, so check within the inspector
    const inspector = document.querySelector(".ks-inspector");
    expect(inspector).not.toBeNull();
    expect(inspector!.querySelectorAll(".ks-inspector-tags")).toBeDefined();
    // The selected node's tag group should show 已确认, not 待验证
    const allTags = inspector!.querySelectorAll("span");
    const tagTexts = Array.from(allTags).map((t) => t.textContent ?? "");
    // For the selected confirmed node, no 待验证 tag should appear
    expect(tagTexts.filter((t) => t === "待验证").length).toBe(0);
  });

  it("accept button is removed from DOM after accepting", () => {
    renderVC();

    const btn = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("交错练习"));
    fireEvent.click(btn!);

    const acceptBtn = screen.getByRole("button", { name: "采纳交错练习" });
    expect(acceptBtn.hasAttribute("disabled")).toBe(false);
    fireEvent.click(acceptBtn);

    // After accept, the entire review section is hidden
    expect(screen.queryByRole("button", { name: "采纳交错练习" })).toBeNull();
  });
});

/* ===========================================================
   2 — Desktop SVG accessibility
   =========================================================== */

describe("desktop SVG accessible structure", () => {
  it("SVG has aria-label describing keyboard interaction", () => {
    renderVC();

    const wrap = document.querySelector(".ks-graph-svg-wrap");
    expect(wrap).not.toBeNull();
    const svg = wrap!.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.outerHTML).toContain("方向键");
  });

  it("SVG does not use role=img (would hide interactive children)", () => {
    renderVC();

    const svg = document.querySelector("svg");
    expect(svg).not.toBeNull();
    const role = svgAttr(svg, "role");
    expect(role).not.toBe("img");
  });

  it("node groups have role=button and tabIndex=0", () => {
    renderVC();

    const nodeGroups = document.querySelectorAll("[data-node-id]");
    expect(nodeGroups.length).toBeGreaterThan(0);

    for (const g of nodeGroups) {
      expect(svgAttr(g, "role")).toBe("button");
      expect(svgAttr(g, "tabindex")).toBe("0");
    }
  });

  it("node groups have descriptive aria-label", () => {
    renderVC();

    const node = document.querySelector('[data-node-id="topic-1"]');
    expect(node).not.toBeNull();
    const label = svgAttr(node, "aria-label");
    expect(label).toContain("间隔重复");
    expect(label).toContain("主题");
    expect(label).toContain("已确认");
  });

  it("SVG graph nodes activate with Enter key", () => {
    renderVC();

    const node = document.querySelector(
      '[data-node-id="topic-3"]',
    ) as HTMLElement;
    expect(node).not.toBeNull();
    node.focus();

    fireEvent.keyDown(node, { key: "Enter" });

    expect(screen.getByText("审批操作（本地模拟）")).toBeDefined();
  });

  it("SVG graph nodes activate with Space key", () => {
    renderVC();

    const node = document.querySelector(
      '[data-node-id="topic-3"]',
    ) as HTMLElement;
    expect(node).not.toBeNull();
    node.focus();

    fireEvent.keyDown(node, { key: " " });

    expect(screen.getByText("审批操作（本地模拟）")).toBeDefined();
  });

  it("ArrowRight selects the next node", () => {
    renderVC();

    const firstNode = document.querySelector(
      '[data-node-id="topic-1"]',
    ) as HTMLElement;
    firstNode.focus();

    fireEvent.keyDown(firstNode, { key: "ArrowRight" });

    // onSelect was called — verify the inspector shows the next node's data
    // (the next node after topic-1 in NODE_ORDER is evidence-1)
    const inspectorTitle = document.querySelector(".ks-inspector-title");
    expect(inspectorTitle).not.toBeNull();
    expect(inspectorTitle!.textContent).not.toBe("间隔重复");
  });

  it("Escape deselects the current node", () => {
    renderVC();

    const node = document.querySelector(
      '[data-node-id="topic-3"]',
    ) as HTMLElement;
    fireEvent.keyDown(node, { key: "Enter" });
    expect(screen.getByText("审批操作（本地模拟）")).toBeDefined();

    fireEvent.keyDown(node, { key: "Escape" });

    expect(screen.queryByText("审批操作（本地模拟）")).toBeNull();
  });
});

/* ===========================================================
   3 — Mobile grouped list structure
   =========================================================== */

describe("mobile grouped list", () => {
  it("mobile list has nav landmark", () => {
    renderVC();

    const nav = document.querySelector("nav.ks-mobile-tree");
    expect(nav).not.toBeNull();
    expect(nav!.getAttribute("aria-label")).toBe("知识空间节点列表");
  });

  it("mobile list uses section groups with aria-label", () => {
    renderVC();

    const sections = document.querySelectorAll(
      "nav.ks-mobile-tree section.ks-mobile-group",
    );
    expect(sections.length).toBe(4);

    for (const s of sections) {
      expect(s.getAttribute("aria-label")).toBeDefined();
      expect(s.getAttribute("aria-label")!).toContain("节点组");
    }
  });

  it("mobile buttons have aria-pressed for selection state", () => {
    renderVC();

    const btns = document.querySelectorAll(
      "nav.ks-mobile-tree button.ks-mobile-item",
    );
    expect(btns.length).toBeGreaterThan(0);

    for (const btn of btns) {
      expect(btn.hasAttribute("aria-pressed")).toBe(true);
    }
  });

  it("mobile does not use tree or treeitem roles", () => {
    renderVC();

    expect(document.querySelector('[role="tree"]')).toBeNull();
    expect(document.querySelector('[role="treeitem"]')).toBeNull();
  });

  it("mobile preserves all 15 nodes", () => {
    renderVC();

    const btns = document.querySelectorAll(
      "nav.ks-mobile-tree button.ks-mobile-item",
    );
    expect(btns.length).toBe(15);
  });
});

/* ===========================================================
   4 — Projection tabs structure
   =========================================================== */

describe("projection tabs structure", () => {
  it("has role=tablist with 3 tabs", () => {
    renderVC();

    const tablist = document.querySelector('[role="tablist"]');
    expect(tablist).not.toBeNull();

    const tabs = tablist!.querySelectorAll('[role="tab"]');
    expect(tabs.length).toBe(3);
  });

  it("active tab has tabIndex=0, inactive tabs have tabIndex=-1", () => {
    renderVC();

    const tabs = document.querySelectorAll('[role="tab"]');
    const activeTabs = Array.from(tabs).filter(
      (t) => t.getAttribute("aria-selected") === "true",
    );
    const inactiveTabs = Array.from(tabs).filter(
      (t) => t.getAttribute("aria-selected") === "false",
    );

    expect(activeTabs.length).toBe(1);
    expect(activeTabs[0]!.getAttribute("tabindex")).toBe("0");

    for (const t of inactiveTabs) {
      expect(t.getAttribute("tabindex")).toBe("-1");
    }
  });

  it("each tab has aria-controls linking to its panel", () => {
    renderVC();

    const tabs = document.querySelectorAll('[role="tab"]');
    for (const tab of tabs) {
      const controls = tab.getAttribute("aria-controls");
      expect(controls).toBeTruthy();
      const panel = document.getElementById(controls!);
      expect(panel).not.toBeNull();
      expect(panel!.getAttribute("role")).toBe("tabpanel");
    }
  });

  it("panel has aria-labelledby linking back to its tab", () => {
    renderVC();

    const panel = document.querySelector('[role="tabpanel"]');
    expect(panel).not.toBeNull();

    const labelledby = panel!.getAttribute("aria-labelledby");
    expect(labelledby).toBeTruthy();
    const tab = document.getElementById(labelledby!);
    expect(tab).not.toBeNull();
    expect(tab!.getAttribute("role")).toBe("tab");
  });

  it("each tab shows its own projection-specific count", () => {
    renderVC();

    const tabs = document.querySelectorAll('[role="tab"]');
    const counts: number[] = [];
    for (const tab of tabs) {
      const countEl = tab.querySelector(".ks-projection-tab-count");
      expect(countEl).not.toBeNull();
      counts.push(Number(countEl!.textContent));
    }

    for (const c of counts) {
      expect(c).toBeGreaterThan(0);
    }

    // today <= records (review may have 0 pending items)
    const todayCount = counts[0]!;
    const recordsCount = counts[2]!;
    expect(todayCount).toBeLessThanOrEqual(recordsCount);
  });

  it("ArrowRight on last tab wraps to first", () => {
    renderVC();

    const tabs = document.querySelectorAll('[role="tab"]');
    const lastTab = tabs[tabs.length - 1] as HTMLElement;
    lastTab.focus();

    fireEvent.keyDown(lastTab, { key: "ArrowRight" });

    // The first tab should now be active and focused
    const firstTab = tabs[0] as HTMLElement;
    expect(firstTab.getAttribute("aria-selected")).toBe("true");
  });

  it("Home key moves focus to first tab", () => {
    renderVC();

    const tabs = document.querySelectorAll('[role="tab"]');
    const lastTab = tabs[tabs.length - 1] as HTMLElement;
    lastTab.focus();

    fireEvent.keyDown(lastTab, { key: "Home" });

    const firstTab = tabs[0] as HTMLElement;
    expect(firstTab.getAttribute("aria-selected")).toBe("true");
  });
});

/* ===========================================================
   5 — Online-only copy
   =========================================================== */

describe("online-only scenario copy", () => {
  it("mentions graph generation and online requirement without claiming offline list", () => {
    renderVC();

    // Switch to online-only scenario
    const onlineOnlyBtn = screen.getByRole("button", { name: "仅在线" });
    fireEvent.click(onlineOnlyBtn);

    // Check heading
    const heading = screen.getByText("知识图谱在线功能受限");
    expect(heading).toBeDefined();

    // Check body — must mention the online requirement
    const body = document.querySelector(".ks-state-panel p");
    expect(body).not.toBeNull();
    const bodyText = body!.textContent ?? "";
    expect(bodyText).toContain("新知识关联与图谱生成均需在线连接");
    expect(bodyText).toContain("离线时不可用");

    // Must NOT claim a retained list exists offline
    expect(bodyText).not.toContain("已缓存");
    expect(bodyText).not.toContain("本地节点列表");
  });
});
