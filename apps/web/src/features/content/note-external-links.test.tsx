// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ProductMarkdownPreview } from "@/components/product/product-ui";

import { NoteExternalLinks } from "./note-external-links";

afterEach(cleanup);

describe("Note external URLs", () => {
  it("links standalone HTTP/HTTPS URLs without changing the plain-text preview", () => {
    const value =
      "Visit https://example.com and http://example.org for details.";
    const { container } = render(
      <>
        <ProductMarkdownPreview value={value} />
        <NoteExternalLinks value={value} />
      </>,
    );
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "https://example.com",
      "http://example.org",
    ]);
    for (const link of links) {
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.textContent).toContain("外部链接");
    }
    const preview = container.querySelector(".product-markdown-preview");
    expect(preview?.textContent).toBe(value);
    expect(preview?.querySelector("a")).toBeNull();
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "//example.com",
    "javascript:https://example.com",
    "data:text/plain,https://example.com",
    "[example](https://example.com)",
    '<a href="https://example.com">example</a>',
    "https://",
    "https://[invalid]",
    "https://user:password@example.com",
    "https://example.com\\@other.example",
  ])("keeps unsupported or malformed input non-interactive: %s", (value) => {
    render(<NoteExternalLinks value={value} />);
    expect(screen.queryAllByRole("link")).toEqual([]);
  });

  it("deduplicates URLs and excludes trailing sentence punctuation", () => {
    render(
      <NoteExternalLinks
        value={"https://example.com,\nhttps://example.com。"}
      />,
    );
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "https://example.com",
    );
  });

  it("does not execute or render markup adjacent to a URL", () => {
    const { container } = render(
      <NoteExternalLinks
        value={'https://example.com <img src=x onerror="alert(1)">'}
      />,
    );
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "https://example.com",
    );
    expect(container.querySelector("img,script")).toBeNull();
  });
});
