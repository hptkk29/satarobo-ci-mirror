"use client";

// components/chat/attachments/use-attachment-uploads.ts — US-11 AC4: chọn ảnh → upload
// thẳng lên kho, CÓ TIẾN TRÌNH và HUỶ ĐƯỢC.
//
// Hai bước đầu của F-FILE nằm gọn ở đây:
//   1. xin ticket: POST /api/chat/upload-url  (server kiểm quyền + magic bytes + cỡ)
//   2. PUT thẳng lên kho bằng `uploadUrl` trong ticket
// Bước 3 (xin URL đọc) do `attachment-gallery.tsx` lo.
//
// ⚠️ KHÔNG BIẾT VÀ KHÔNG ĐƯỢC BIẾT bucket/host: `uploadUrl` đến từ API, component chỉ
// PUT vào đúng thứ server đưa. Việc kho ảnh chat nằm ở bucket nào là chuyện của
// `lib/chat/attachments.ts` — hardcode ở đây là hẹn ngày hỏng khi kho đổi chỗ.
//
// ⚠️ DÙNG XMLHttpRequest CHỨ KHÔNG `fetch`: AC4 đòi **tiến trình** upload, mà `fetch`
// không có sự kiện progress cho phần gửi lên (ReadableStream duplex chưa dùng được rộng
// rãi trên Safari/WebView). XHR cho cả `upload.onprogress` lẫn `abort()` — đúng hai thứ
// AC4 cần.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CHAT_IMAGE_HEAD_BYTES,
  bytesToBase64,
  pickChatImages,
  type ChatAttachmentPayload,
} from "./rules";

export type ChatUploadStatus = "preparing" | "uploading" | "ready" | "error";

export type ChatPendingUpload = {
  localId: string;
  fileName: string;
  sizeBytes: number;
  mimeType: string;
  /** Object URL để xem trước ngay — không chờ upload xong. */
  previewUrl: string;
  /** 0..100. */
  progress: number;
  status: ChatUploadStatus;
  errorMessage?: string;
  /** Key kho ảnh do server cấp — đính vào tin khi gửi. */
  storagePath?: string;
  /** Tên file server đã làm sạch (bỏ đường dẫn/ký tự điều khiển) — ghi vào DB. */
  safeFileName?: string;
};

export type UseAttachmentUploadsResult = {
  uploads: ChatPendingUpload[];
  /** Thêm ảnh vào tin đang soạn. */
  addFiles: (files: readonly File[]) => void;
  /** AC4 — huỷ một ảnh: cắt kết nối đang upload, bỏ khỏi danh sách. */
  cancel: (localId: string) => void;
  /** Đang còn ảnh chưa upload xong ⇒ chưa cho bấm Gửi. */
  busy: boolean;
  /** Số ảnh đã sẵn sàng đính vào tin. */
  readyCount: number;
  /**
   * Lấy danh sách ảnh sẵn sàng + dọn ô soạn. Object URL KHÔNG bị thu hồi ở đây —
   * bong bóng tin vừa gửi còn đang hiển thị bằng chính chúng; hook thu hồi tất cả
   * khi unmount.
   */
  takeReady: () => { payloads: ChatAttachmentPayload[]; previewUrls: string[] };
  /** Bỏ hết ảnh đang chờ (huỷ upload + thu hồi URL) — dùng khi rời hội thoại. */
  discardAll: () => void;
};

type TicketResponse = {
  ok?: boolean;
  data?: {
    files?: {
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      storagePath: string;
      uploadUrl: string;
    }[];
  };
  error?: { code?: string; message?: string };
};

async function readHead(file: File): Promise<string> {
  const buf = await file.slice(0, CHAT_IMAGE_HEAD_BYTES).arrayBuffer();
  return bytesToBase64(new Uint8Array(buf));
}

export function useAttachmentUploads({
  conversationId,
  onError,
}: {
  conversationId: string;
  /** Hiện thông điệp lỗi (toast) — hook không tự quyết định cách báo cho người dùng. */
  onError?: (message: string) => void;
}): UseAttachmentUploadsResult {
  const [uploads, setUploads] = useState<ChatPendingUpload[]>([]);

  const uploadsRef = useRef<ChatPendingUpload[]>(uploads);
  uploadsRef.current = uploads;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  /** XHR đang chạy, theo localId — để `cancel` cắt đúng cái cần cắt. */
  const xhrRef = useRef(new Map<string, XMLHttpRequest>());
  /** MỌI object URL hook này tạo ra — thu hồi hết lúc unmount (chống rò bộ nhớ). */
  const ownedUrlsRef = useRef(new Set<string>());
  const seqRef = useRef(0);

  const patch = useCallback((localId: string, next: Partial<ChatPendingUpload>) => {
    setUploads((prev) =>
      prev.map((u) => (u.localId === localId ? { ...u, ...next } : u)),
    );
  }, []);

  const startPut = useCallback(
    (
      localId: string,
      file: File,
      ticket: { uploadUrl: string; storagePath: string; fileName: string; mimeType: string },
    ) => {
      const xhr = new XMLHttpRequest();
      xhrRef.current.set(localId, xhr);
      xhr.open("PUT", ticket.uploadUrl, true);
      // CHỈ đặt Content-Type: server ký URL với đúng một header này (ghi chú A1 ở
      // `lib/chat/attachments.ts`). Thêm header khác ⇒ kho trả 403 SignatureDoesNotMatch.
      xhr.setRequestHeader("Content-Type", ticket.mimeType);

      xhr.upload.onprogress = (ev) => {
        if (!ev.lengthComputable || ev.total <= 0) return;
        patch(localId, {
          status: "uploading",
          // Chốt 99%: 100% chỉ được đặt khi kho đã XÁC NHẬN nhận xong, không phải khi
          // trình duyệt đẩy xong byte cuối.
          progress: Math.min(99, Math.round((ev.loaded / ev.total) * 100)),
        });
      };
      xhr.onload = () => {
        xhrRef.current.delete(localId);
        if (xhr.status >= 200 && xhr.status < 300) {
          patch(localId, {
            status: "ready",
            progress: 100,
            storagePath: ticket.storagePath,
            safeFileName: ticket.fileName,
          });
          return;
        }
        patch(localId, {
          status: "error",
          errorMessage: "Tải ảnh lên không thành công — bỏ ảnh này rồi chọn lại.",
        });
      };
      xhr.onerror = () => {
        xhrRef.current.delete(localId);
        patch(localId, {
          status: "error",
          errorMessage: "Mất kết nối khi tải ảnh — bỏ ảnh này rồi chọn lại.",
        });
      };
      xhr.onabort = () => xhrRef.current.delete(localId);
      xhr.send(file);
    },
    [patch],
  );

  const addFiles = useCallback(
    (files: readonly File[]) => {
      const { accepted, error } = pickChatImages(uploadsRef.current.length, files);
      if (error) onErrorRef.current?.(error);
      if (accepted.length === 0) return;

      const entries = accepted.map((file) => {
        seqRef.current += 1;
        const localId = `up-${seqRef.current}-${file.size}`;
        const previewUrl = URL.createObjectURL(file);
        ownedUrlsRef.current.add(previewUrl);
        return { localId, file, previewUrl };
      });

      setUploads((prev) => [
        ...prev,
        ...entries.map(({ localId, file, previewUrl }) => ({
          localId,
          fileName: file.name,
          sizeBytes: file.size,
          mimeType: file.type,
          previewUrl,
          progress: 0,
          status: "preparing" as const,
        })),
      ]);

      void (async () => {
        const failAll = (message: string) => {
          for (const e of entries) patch(e.localId, { status: "error", errorMessage: message });
        };
        try {
          const heads = await Promise.all(entries.map((e) => readHead(e.file)));
          const res = await fetch("/api/chat/upload-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              conversationId,
              files: entries.map((e, i) => ({
                fileName: e.file.name,
                mimeType: e.file.type,
                sizeBytes: e.file.size,
                headBase64: heads[i],
              })),
            }),
          });
          const json = (await res.json().catch(() => null)) as TicketResponse | null;
          if (!res.ok || !json?.ok || !json.data?.files) {
            const message =
              json?.error?.message ?? "Không xin được quyền tải ảnh lên — vui lòng thử lại.";
            onErrorRef.current?.(message);
            failAll(message);
            return;
          }
          // Ticket trả về ĐÚNG THỨ TỰ `files` gửi lên (hợp đồng của createChatUploadTicket).
          json.data.files.forEach((ticket, i) => {
            const entry = entries[i];
            if (!entry) return;
            startPut(entry.localId, entry.file, ticket);
          });
        } catch {
          const message = "Không tải được ảnh lên — kiểm tra kết nối rồi thử lại.";
          onErrorRef.current?.(message);
          failAll(message);
        }
      })();
    },
    [conversationId, patch, startPut],
  );

  const cancel = useCallback((localId: string) => {
    xhrRef.current.get(localId)?.abort();
    xhrRef.current.delete(localId);
    setUploads((prev) => {
      const target = prev.find((u) => u.localId === localId);
      if (target && ownedUrlsRef.current.has(target.previewUrl)) {
        URL.revokeObjectURL(target.previewUrl);
        ownedUrlsRef.current.delete(target.previewUrl);
      }
      return prev.filter((u) => u.localId !== localId);
    });
  }, []);

  const takeReady = useCallback(() => {
    const ready = uploadsRef.current.filter((u) => u.status === "ready" && u.storagePath);
    const payloads: ChatAttachmentPayload[] = ready.map((u) => ({
      storagePath: u.storagePath as string,
      fileName: u.safeFileName ?? u.fileName,
      mimeType: u.mimeType,
      sizeBytes: u.sizeBytes,
    }));
    const previewUrls = ready.map((u) => u.previewUrl);
    // Chỉ dọn những ảnh ĐÃ lấy đi; ảnh đang upload/lỗi vẫn nằm lại ô soạn.
    const takenIds = new Set(ready.map((u) => u.localId));
    setUploads((prev) => prev.filter((u) => !takenIds.has(u.localId)));
    return { payloads, previewUrls };
  }, []);

  const discardAll = useCallback(() => {
    for (const xhr of xhrRef.current.values()) xhr.abort();
    xhrRef.current.clear();
    setUploads((prev) => {
      for (const u of prev) {
        if (ownedUrlsRef.current.has(u.previewUrl)) {
          URL.revokeObjectURL(u.previewUrl);
          ownedUrlsRef.current.delete(u.previewUrl);
        }
      }
      return [];
    });
  }, []);

  useEffect(() => {
    const xhrs = xhrRef.current;
    const urls = ownedUrlsRef.current;
    return () => {
      for (const xhr of xhrs.values()) xhr.abort();
      xhrs.clear();
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  return {
    uploads,
    addFiles,
    cancel,
    busy: uploads.some((u) => u.status === "preparing" || u.status === "uploading"),
    readyCount: uploads.filter((u) => u.status === "ready").length,
    takeReady,
    discardAll,
  };
}
