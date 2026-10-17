// @vitest-environment jsdom
/**
 * EL-10 — màn tải video: lượt tải HỎNG GIỮA CHỪNG phải tự gửi lệnh huỷ.
 *
 * Hồi quy 25/08/2026. Bản đầu viết `if (dangHuy) await huy()` trong nhánh `catch`,
 * với `dangHuy` là STATE. `tai()` chạy trọn trong MỘT lượt kết xuất, nên
 * `setDangHuy(...)` gọi ở giữa hàm chỉ xếp lịch cho lượt kết xuất SAU — biến đã
 * đóng gói trong chính lượt gọi này vẫn là `null`. Điều kiện luôn sai ⇒ lệnh huỷ
 * KHÔNG BAO GIỜ được gửi.
 *
 * Vì sao nó lọt: case canh nó là một phép so CHUỖI MÃ NGUỒN
 * (`toContain("if (dangHuy) await huy()")`). Chuỗi đó có mặt đầy đủ, nên guard
 * xanh — trong khi hành vi thật là mã chết. Đây là bài học lặp lại lần thứ hai
 * trong cùng ticket: guard so chuỗi chỉ chứng minh CÓ VIẾT, không chứng minh
 * CÓ CHẠY. Case dưới đây bấm thật, hỏng thật, rồi soi lệnh đã gửi.
 *
 * Hỏng im lặng, chỉ thấy trên hoá đơn: các phần đã tải nằm lại R2 và R2 tính tiền
 * chúng cho tới khi cron đêm dọn — sau 24 giờ.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { VideoUploader } from "./video-uploader";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

// Server action — import thật sẽ kéo cả chuỗi prisma vào jsdom.
vi.mock("../_actions", () => ({
  luuBaiVideoAction: vi.fn(async () => ({ ok: true, data: { durationSec: 600 } })),
}));

const KHOA = "elearning/master/lesson-1/uuid-1.mp4";
const UPLOAD_ID = "upload-abc";

/** Thân JSON theo khuôn `ok()` của `@/lib/api/response`. */
const than = (data: unknown) =>
  ({ json: async () => ({ ok: true, data }) }) as unknown as Response;

beforeAll(() => {
  // jsdom không giải mã media: `loadedmetadata` không bao giờ bắn, mà
  // `docSieuDuLieu` lại CHỜ đúng sự kiện đó. Không dựng thì test treo, không đỏ.
  Object.defineProperty(HTMLMediaElement.prototype, "duration", {
    get: () => 600,
    configurable: true,
  });
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", {
    get: () => 1280,
    configurable: true,
  });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", {
    get: () => 720,
    configurable: true,
  });
  Object.defineProperty(HTMLMediaElement.prototype, "src", {
    get: () => "",
    set(this: HTMLMediaElement) {
      queueMicrotask(() => this.onloadedmetadata?.(new Event("loadedmetadata")));
    },
    configurable: true,
  });
  URL.createObjectURL = vi.fn(() => "blob:giả-lập");
  URL.revokeObjectURL = vi.fn();
});

let buocDaGui: string[] = [];
let thanHuy: Record<string, unknown> | null = null;

/** Cho phép từng case quyết định lượt PUT lên R2 hỏng hay không. */
let phanHong = true;

beforeEach(() => {
  buocDaGui = [];
  thanHuy = null;
  phanHong = true;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);

      if (u.includes("/api/elearning/media/upload")) {
        const b = JSON.parse(String(init?.body)) as Record<string, unknown>;
        buocDaGui.push(String(b.buoc));
        if (b.buoc === "tao") {
          return than({ khoa: KHOA, uploadId: UPLOAD_ID, soPhan: 2, partSize: 8 * 1024 * 1024 });
        }
        if (b.buoc === "ky-phan") {
          return than({
            links: [
              { partNumber: 1, url: "https://r2.giả-lập/p1" },
              { partNumber: 2, url: "https://r2.giả-lập/p2" },
            ],
          });
        }
        if (b.buoc === "huy") {
          thanHuy = b;
          return than({ daHuy: true });
        }
        return than({});
      }

      // Lượt PUT thẳng lên R2.
      if (u.startsWith("https://r2.")) {
        return {
          ok: !phanHong,
          headers: { get: () => (phanHong ? null : '"etag-1"') },
        } as unknown as Response;
      }

      if (u.includes("/api/elearning/media/xac-minh")) {
        return {
          json: async () => ({
            ok: true,
            data: {
              durationSec: 600,
              rong: 1280,
              cao: 720,
              videoCodec: "avc1",
              audioCodec: "mp4a",
              brand: "isom",
            },
          }),
        } as unknown as Response;
      }

      throw new Error(`fetch không mong đợi: ${u}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function chonTep() {
  render(
    <VideoUploader
      lessonId="lesson-1"
      title="Bài 1"
      videoKeyHienCo={null}
      durationSecHienCo={null}
    />,
  );
  const o = screen.getByLabelText("Chọn tệp video MP4");
  const tep = new File([new Uint8Array(16)], "bai-1.mp4", { type: "video/mp4" });
  fireEvent.change(o, { target: { files: [tep] } });
}

describe("lượt tải hỏng giữa chừng", () => {
  it("🔴 PUT một phần thất bại ⇒ GỬI lệnh huỷ, đúng uploadId", async () => {
    chonTep();

    await waitFor(() => expect(buocDaGui).toContain("huy"), { timeout: 4000 });
    expect(thanHuy).toMatchObject({ buoc: "huy", khoa: KHOA, uploadId: UPLOAD_ID });
  });

  it("không hoàn tất lượt tải hỏng — `hoan-tat` KHÔNG được gửi", async () => {
    // Hoàn tất một lượt thiếu phần là để R2 ghép ra tệp hợp lệ về cấu trúc nhưng
    // hỏng nội dung, và không lỗi nào nổ ra.
    chonTep();

    await waitFor(() => expect(buocDaGui).toContain("huy"), { timeout: 4000 });
    expect(buocDaGui).not.toContain("hoan-tat");
  });
});

describe("lượt tải trót lọt", () => {
  it("tải xong thì KHÔNG gửi lệnh huỷ", async () => {
    // Guard hai chiều: nếu ai đó "vá" bằng cách gọi `huy()` vô điều kiện thì lượt
    // tải thành công cũng bị xoá tệp vừa tải lên.
    phanHong = false;
    chonTep();

    await waitFor(() => expect(buocDaGui).toContain("hoan-tat"), { timeout: 4000 });
    expect(buocDaGui).not.toContain("huy");
  });
});
