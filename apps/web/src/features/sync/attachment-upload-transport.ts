import type {
  AttachmentUploadTransport,
  UploadableAttachmentQueueEntry,
} from "@logion/offline";

import {
  browserApiClient,
  LogionApiError,
  type ApiClient,
} from "@/lib/api/client";

interface AttachmentState {
  status: string;
  version: number;
}

export class ApiAttachmentUploadTransport implements AttachmentUploadTransport {
  private failure: LogionApiError | null = null;

  constructor(private readonly api: ApiClient = browserApiClient) {}

  get lastError(): LogionApiError | null {
    return this.failure;
  }

  private async capture<T>(operation: () => Promise<T>): Promise<T> {
    this.failure = null;
    try {
      return await operation();
    } catch (error) {
      if (error instanceof LogionApiError) this.failure = error;
      throw error;
    }
  }

  private base(entry: UploadableAttachmentQueueEntry): string {
    return `/api/v1/workspaces/${entry.workspace_id}/spaces/${entry.space_id}/attachments`;
  }

  async initiate(
    entry: UploadableAttachmentQueueEntry,
  ): Promise<{ version: number }> {
    const response = await this.capture(() =>
      this.api.request<AttachmentState>(`${this.base(entry)}/init`, {
        method: "POST",
        csrf: true,
        body: JSON.stringify({
          id: entry.attachment_id,
          target_type: entry.target_type,
          target_id: entry.target_id,
          filename: entry.filename,
          declared_mime: entry.media_type,
          size_bytes: entry.byte_size,
          sha256: entry.sha256,
        }),
      }),
    );
    return { version: response.version };
  }

  async upload(
    entry: UploadableAttachmentQueueEntry,
  ): Promise<{ version: number }> {
    const response = await this.capture(() =>
      this.api.request<AttachmentState>(
        `${this.base(entry)}/${entry.attachment_id}/content`,
        {
          method: "PUT",
          csrf: true,
          headers: { "Content-Type": "application/octet-stream" },
          body: entry.blob,
          timeoutMs: 60_000,
        },
      ),
    );
    return { version: response.version };
  }

  async complete(
    entry: UploadableAttachmentQueueEntry,
    expectedVersion: number,
  ): Promise<{ status: string; version: number }> {
    return this.capture(() =>
      this.api.request<AttachmentState>(
        `${this.base(entry)}/${entry.attachment_id}/complete`,
        {
          method: "POST",
          csrf: true,
          body: JSON.stringify({ expected_version: expectedVersion }),
        },
      ),
    );
  }
}
