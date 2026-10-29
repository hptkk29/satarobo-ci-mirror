// @vitest-environment jsdom
/**
 * `seq` CỦA TRÌNH PHÁT — bàn giao từ trang học, đồng bộ lại sau phản hồi, và nhịp cuối lúc ẩn tab.
 *
 * Chạy component THẬT với trình phát YouTube GIẢ (cùng khuôn `video-player-youtube.test.tsx`) và soi thứ thật sự
 * gửi lên server. Logic nhịp dùng chung cho MP4 và YouTube nên một đường là đủ.
 *
 * Phía server của cùng hành vi (đi qua `ghiNhipXem` trên Postgres thật): `[VNX-N3*]` ở
 * `tests/elearning/video-nhip-xem-db.test.ts`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import type { YtPlayer } from "@/lib/elearning/youtube-iframe";

const h = vi.hoisted(() => ({
  tao: null as unknown as (host: HTMLElement, o: unknown) => Promise<unknown>,
  /** Phản hồi của server cho nhịp thứ `i` (0-based). */
  phanHoi: null as unknown as (i: number, body: Record<string, unknown>) => Record<string, unknown>,
}));

vi.mock("@/lib/elearning/youtube-iframe", async (goc) => {
  const that = await goc<typeof import("@/lib/elearning/youtube-iframe")>();
  return { ...that, taoTrinhPhatYoutube: vi.fn((host: HTMLElement, o: unknown) => h.tao(host, o)) };
});

import { VideoPlayer } from "./video-player";

const NAC = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
let s: { t: number; rate: number; state: number };
let player: YtPlayer;
let bodies: Array<Record<string, unknown>>;

function dungPlayer() {
  s = { t: 0, rate: 1, state: -1 };
  player = {
    getCurrentTime: vi.fn(() => s.t),
    getDuration: vi.fn(() => 600),
    getPlaybackRate: vi.fn(() => s.rate),
    setPlaybackRate: vi.fn((r: number) => {
      s.rate = r;
    }),
    getAvailablePlaybackRates: vi.fn(() => NAC),
    getPlayerState: vi.fn(() => s.state),
    playVideo: vi.fn(() => {
      s.state = 1;
    }),
    pauseVideo: vi.fn(() => {
      s.state = 2;
    }),
    seekTo: vi.fn((giay: number) => {
      s.t = giay;
    }),
    destroy: vi.fn(),
  };
}

const PROPS = {
  enrollmentId: "e1",
  lessonId: "l1",
  videoKey: null,
  youtubeId: "aBcDeFg_H-1",
  ve: "ve-da-ky",
  nhanMo: "Nguyễn Văn A · a@satarobo.vn",
  durationSec: 600,
  coveredSecBanDau: 0,
  maxPositionSecBanDau: 0,
  chanTua: true,
  tocDoToiDa: 1.5,
};

async function khoiDong(over: Partial<typeof PROPS & { seqBanDau: number }> = {}) {
  const r = render(<VideoPlayer {...PROPS} {...over} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return r;
}

async function chay(giay: number) {
  s.state = 1;
  for (let i = 0; i < giay * 2; i++) {
    s.t += 0.5;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
  }
}

const ghiNhan = (seq: number) => ({
  ok: true,
  data: { coveredSec: 0, coveragePercent: 0, status: "GHI_NHAN", meta: { seq } },
});

beforeEach(() => {
  vi.useFakeTimers();
  dungPlayer();
  bodies = [];
  h.tao = async () => player;
  h.phanHoi = (_i, body) => ghiNhan(Number(body.seq));
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const i = bodies.length;
      bodies.push(body);
      return { ok: true, status: 200, json: async () => h.phanHoi(i, body) } as unknown as Response;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("[VSP-01] bộ đếm nhịp đi TIẾP từ số server đã lưu", () => {
  it("🔴 không truyền seqBanDau (bài mới) ⇒ nhịp đầu mang seq = 1", async () => {
    await khoiDong();
    await chay(15);
    expect(bodies[0]).toMatchObject({ seq: 1 });
  });

  it("🔴 trang học truyền seq đã lưu = 7 ⇒ nhịp đầu của lượt mới mang seq = 8, KHÔNG phải 1", async () => {
    // Bản cũ khởi tạo `useRef(0)`: nhịp đầu mang seq = 1 ≤ 7 và server bỏ như 'đến muộn'.
    await khoiDong({ seqBanDau: 7 });
    await chay(15);
    expect(bodies[0]).toMatchObject({ seq: 8 });
    await chay(15);
    expect(bodies[1]).toMatchObject({ seq: 9 });
  });
});

describe("[VSP-02] phản hồi BO_QUA — server KHÔNG nhận nhịp, trình phát không được coi là đã gửi", () => {
  it("🔴 BO_QUA ⇒ KHÔNG nhích mốc (nhịp sau gửi lại đúng khoảng) và ĐỒNG BỘ seq với số server giữ", async () => {
    // Nhịp đầu bị bỏ: server đang giữ seq = 12 (tab kia đã đi trước).
    h.phanHoi = (i, body) =>
      i === 0
        ? { ok: true, data: { coveredSec: 0, coveragePercent: 0, status: "BO_QUA", meta: { seq: 12 } } }
        : ghiNhan(Number(body.seq));
    await khoiDong({ seqBanDau: 3 });
    await chay(15);
    expect(bodies[0]).toMatchObject({ seq: 4, tuSec: 0, denSec: 15 });
    await chay(15);
    // Nhịp 2: số thứ tự nhảy lên 13 (= 12 + 1) và khoảng vẫn bắt đầu từ 0 — khoảng 0→15 chưa bị coi là đã gửi.
    expect(bodies[1]).toMatchObject({ seq: 13, tuSec: 0, denSec: 30 });
  });

  it("nhịp được NHẬN ⇒ mốc nhích như cũ (đối chứng: BO_QUA không làm hỏng đường bình thường)", async () => {
    await khoiDong();
    await chay(15);
    await chay(15);
    expect(bodies[1]).toMatchObject({ tuSec: 15, denSec: 30 });
  });

  it("phản hồi mang seq THẤP hơn số hiện có ⇒ không bao giờ lùi bộ đếm", async () => {
    h.phanHoi = (_i, _b) => ghiNhan(1);
    await khoiDong({ seqBanDau: 5 });
    await chay(15);
    await chay(15);
    expect(bodies.map((b) => b.seq)).toEqual([6, 7]);
  });
});

describe("[VSP-03] tab ẩn ⇒ dừng VÀ gửi nốt khoảng đã xem", () => {
  it("🔴 ẩn tab sau 7 giây phát ⇒ một nhịp gửi NGAY (không chờ đủ 15 giây) mang 0→7, và video dừng", async () => {
    await khoiDong();
    await chay(7);
    expect(bodies).toHaveLength(0);
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(player.pauseVideo).toHaveBeenCalled();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ tuSec: 0, denSec: 7, tabHien: false });
  });

  it("ẩn tab khi chưa xem được 1 giây ⇒ KHÔNG gửi nhịp thừa", async () => {
    await khoiDong();
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(bodies).toHaveLength(0);
  });

  it("tab hiện lại ⇒ KHÔNG gửi thêm nhịp nào (chỉ ẩn mới gửi nốt)", async () => {
    await khoiDong();
    await chay(7);
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    const truoc = bodies.length;
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(bodies).toHaveLength(truoc);
  });
});

describe("[VSP-04] server báo `meta.denNhan` — phần chưa nhận được XIN LẠI ở nhịp sau", () => {
  it("🔴 nhịp 0→15 chỉ được nhận tới 9 ⇒ nhịp sau bắt đầu từ 9 (không phải 15) — không mất 9→15", async () => {
    h.phanHoi = (i, body) =>
      i === 0
        ? { ok: true, data: { coveredSec: 5, coveragePercent: 1, status: "GHI_NHAN", meta: { seq: Number(body.seq), denNhan: 9 } } }
        : ghiNhan(Number(body.seq));
    await khoiDong();
    await chay(15);
    expect(bodies[0]).toMatchObject({ tuSec: 0, denSec: 15 });
    await chay(15);
    expect(bodies[1]).toMatchObject({ tuSec: 9, denSec: 30 });
  });

  it("đối chứng: không có `denNhan` ⇒ nhận trọn, mốc nhích tới điểm kết thúc như cũ", async () => {
    await khoiDong();
    await chay(15);
    await chay(15);
    expect(bodies[1]).toMatchObject({ tuSec: 15, denSec: 30 });
  });

  it("`denNhan` THẤP hơn điểm bắt đầu (số lạ) không kéo mốc lùi dưới điểm bắt đầu của nhịp vừa gửi", async () => {
    h.phanHoi = (i, body) =>
      i === 0
        ? { ok: true, data: { coveredSec: 0, coveragePercent: 0, status: "GHI_NHAN", meta: { seq: Number(body.seq), denNhan: -50 } } }
        : ghiNhan(Number(body.seq));
    await khoiDong();
    await chay(15);
    await chay(15);
    expect(bodies[1]!.tuSec).toBe(0);
  });

  it("phản hồi BO_QUA mang `denNhan` KHÔNG làm mốc nhích (server không nhận nhịp ấy)", async () => {
    h.phanHoi = (i, body) =>
      i === 0
        ? { ok: true, data: { coveredSec: 0, coveragePercent: 0, status: "BO_QUA", meta: { seq: 3, denNhan: 12 } } }
        : ghiNhan(Number(body.seq));
    await khoiDong({ seqBanDau: 3 });
    await chay(15);
    await chay(15);
    expect(bodies[1]!.tuSec).toBe(0);
  });
});
