import type { UploadableAttachmentQueueEntry } from "@logion/offline";
import { describe, expect, it, vi } from "vitest";

import type { ApiClient } from "@/lib/api/client";

import { ApiAttachmentUploadTransport } from "./attachment-upload-transport";

const entry: UploadableAttachmentQueueEntry = {
  attachment_id: "00000000-0000-7000-8000-000000000001",
  workspace_id: "00000000-0000-7000-8000-000000000002",
  space_id: "00000000-0000-7000-8000-000000000003",
  device_id: "00000000-0000-7000-8000-000000000004",
  target_type: "note",
  target_id: "00000000-0000-7000-8000-000000000005",
  filename: "result.txt",
  media_type: "text/plain",
  byte_size: 6,
  sha256: `sha256:${"a".repeat(64)}`,
  state: "pending_upload",
  blob: new Blob(["result"], { type: "text/plain" }),
  queued_at: "2026-07-23T00:00:00Z",
  last_error_code: null,
  server_version: null,
};

describe("attachment upload transport", () => {
  it("uses the authenticated init, binary upload and complete protocol", async () => {
    const requestMock = vi
      .fn()
      .mockResolvedValueOnce({ version: 1 })
      .mockResolvedValueOnce({ version: 2 })
      .mockResolvedValueOnce({ version: 3, status: "verified" });
    const api: ApiClient = {
      request: <T>(path: string, options?: object) =>
        requestMock(path, options) as Promise<T>,
    };
    const transport = new ApiAttachmentUploadTransport(api);

    await expect(transport.initiate(entry)).resolves.toEqual({ version: 1 });
    await expect(transport.upload(entry)).resolves.toEqual({ version: 2 });
    await expect(transport.complete(entry, 2)).resolves.toEqual({
      version: 3,
      status: "verified",
    });
    expect(requestMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(`/${entry.attachment_id}/content`),
      expect.objectContaining({
        method: "PUT",
        csrf: true,
        body: entry.blob,
        headers: { "Content-Type": "application/octet-stream" },
      }),
    );
    expect(requestMock).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining(`/${entry.attachment_id}/complete`),
      expect.objectContaining({
        body: JSON.stringify({ expected_version: 2 }),
      }),
    );
  });
});
