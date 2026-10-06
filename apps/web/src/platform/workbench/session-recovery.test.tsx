/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { WorkbenchProvider, useWorkbench } from "./provider";
import { errorMessage, workbenchRequest } from "./api";

const mocks = vi.hoisted(() => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  return { fetch, replace: vi.fn() };
});
vi.mock("next/navigation", () => ({
  usePathname: () => "/plan",
  useRouter: () => ({ replace: mocks.replace }),
}));

const session = {
  session_expires_at: "2099-01-01T00:00:00Z",
  user: {
    id: "synthetic-owner",
    email: "owner@example.com",
    status: "active",
    created_at: "2026-01-01T00:00:00Z",
    email_verified_at: "2026-01-01T00:00:00Z",
  },
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const expired = () =>
  json(
    {
      code: "AUTH_INVALID_SESSION",
      message: "Expired",
      request_id: "test",
      retryable: false,
    },
    401,
  );

beforeEach(() => {
  vi.clearAllMocks();
  document.cookie = "logion_csrf=synthetic-csrf; path=/";
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => cleanup());

function Editor() {
  const { preferences } = useWorkbench();
  const [body, setBody] = useState("");
  const [message, setMessage] = useState("");
  return (
    <>
      <span>{preferences["appearance.theme"]}</span>
      <input
        aria-label="Draft"
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      <button
        onClick={() =>
          void workbenchRequest("/api/v1/test-write", {
            method: "POST",
            body: JSON.stringify({ body }),
          }).then(
            () => setMessage("saved"),
            (error) => setMessage(errorMessage(error)),
          )
        }
      >
        Save
      </button>
      <p role="status">{message}</p>
    </>
  );
}

async function arrange() {
  let accessExpired = false;
  let completeRefresh!: (value: Response) => void;
  mocks.fetch.mockImplementation(async (url: string) => {
    if (url === "/api/v1/auth/session")
      return accessExpired ? expired() : json(session);
    if (url === "/api/v1/auth/refresh")
      return new Promise<Response>((resolve) => {
        completeRefresh = (response) => {
          accessExpired = !response.ok;
          resolve(response);
        };
      });
    if (url === "/api/v1/users/me/settings")
      return json({
        settings: [{ key: "appearance.theme", value: '"dark"', version: 1 }],
      });
    if (url === "/api/v1/workspaces") return json({ workspaces: [] });
    if (url === "/api/v1/test-write")
      return accessExpired ? expired() : json({ saved: true });
    throw new Error(`Unexpected test request: ${url}`);
  });
  render(
    <WorkbenchProvider>
      <Editor />
    </WorkbenchProvider>,
  );
  const input = await screen.findByRole("textbox", { name: "Draft" });
  fireEvent.change(input, { target: { value: "Unsaved synthetic draft" } });
  accessExpired = true;
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(completeRefresh).toBeTypeOf("function"));
  return (response: Response) => act(async () => completeRefresh(response));
}

it("keeps the editor and cache until refresh completes and allows explicit retry", async () => {
  const completeRefresh = await arrange();
  expect(mocks.replace).not.toHaveBeenCalled();
  expect(
    (screen.getByRole("textbox", { name: "Draft" }) as HTMLInputElement).value,
  ).toBe("Unsaved synthetic draft");
  expect(screen.getByText("dark")).toBeTruthy();
  await completeRefresh(json(session));
  expect(mocks.replace).not.toHaveBeenCalled();
  expect(
    mocks.fetch.mock.calls.filter(([url]) => url === "/api/v1/test-write"),
  ).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("saved");
  expect(
    mocks.fetch.mock.calls.filter(([url]) => url === "/api/v1/test-write"),
  ).toHaveLength(2);
  expect(
    mocks.fetch.mock.calls.filter(([url]) => url === "/api/v1/auth/refresh"),
  ).toHaveLength(1);
  expect(
    mocks.fetch.mock.calls.filter(
      ([url]) => url === "/api/v1/users/me/settings",
    ),
  ).toHaveLength(1);
});

it("redirects and removes private editor state when refresh confirms logout", async () => {
  const completeRefresh = await arrange();
  await completeRefresh(expired());
  await waitFor(() =>
    expect(mocks.replace).toHaveBeenCalledWith("/auth/login?next=%2Fplan"),
  );
  expect(screen.queryByRole("textbox", { name: "Draft" })).toBeNull();
});
