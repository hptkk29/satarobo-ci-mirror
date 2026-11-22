// @vitest-environment jsdom
/**
 * Bài video phát bằng LINK YOUTUBE — trình phát phải đo và chặn y như với tệp MP4.
 *
 * Trình phát viết cho thẻ `<video>`; với YouTube nó dùng chung MỘT bộ logic nhịp xem qua
 * một vỏ `MayPhat`. Test ở đây chạy component THẬT với trình phát YouTube GIẢ (điều khiển
 * được vị trí / tốc độ / trạng thái) và soi thứ thật sự gửi lên server:
 *  · nhịp 15 giây mang đúng khoảng đã xem;
 *  · tua tới bị kéo về, khoảng nhảy KHÔNG được báo là đã xem;
 *  · tốc độ vượt trần bị kẹp; rời trang vẫn gửi nhịp cuối bằng `sendBeacon`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import type { YtPlayer } from "@/lib/elearning/youtube-iframe";

type TuyChon = {
  videoId: string;
  chanTua?: boolean;
  onTrangThai?: (s: number) => void;
  onDoiTocDo?: () => void;
  onLoi?: (ma: number) => void;
};

const h = vi.hoisted(() => ({
  tuyChon: null as unknown,
  tao: null as unknown as (host: HTMLElement, o: unknown) => Promise<unknown>,
}));

vi.mock("@/lib/elearning/youtube-iframe", async (goc) => {
  const that = await goc<typeof import("@/lib/elearning/youtube-iframe")>();
  return {
    ...that,
    taoTrinhPhatYoutube: vi.fn((host: HTMLElement, o: unknown) => h.tao(host, o)),
  };
});

import { VideoPlayer } from "./video-player";
import { LoiYoutube, taoTrinhPhatYoutube } from "@/lib/elearning/youtube-iframe";

const MA = "aBcDeFg_H-1";
const NAC = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

let s: { t: number; rate: number; state: number };
let player: YtPlayer;
let bodies: Array<Record<string, unknown>>;
let coveredTraVe: number;

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
  youtubeId: MA,
  ve: "ve-da-ky",
  nhanMo: "Nguyễn Văn A · a@satarobo.vn",
  durationSec: 600,
  coveredSecBanDau: 0,
  maxPositionSecBanDau: 0,
  chanTua: true,
  tocDoToiDa: 1.5,
};

async function khoiDong(over: Partial<typeof PROPS> = {}) {
  const r = render(<VideoPlayer {...PROPS} {...over} />);
  // Cho `taoTrinhPhatYoutube(...).then(...)` chạy xong.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return r;
}

/** Phát liền `giay` giây: vị trí chạy 0.5s mỗi bước 500ms, đúng cách vòng theo dõi mong đợi. */
async function chay(giay: number) {
  s.state = 1;
  for (let i = 0; i < giay * 2; i++) {
    s.t += 0.5;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  dungPlayer();
  bodies = [];
  coveredTraVe = 150;
  h.tuyChon = null;
  h.tao = async (_host, o) => {
    h.tuyChon = o;
    return player;
  };
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          data: { coveredSec: coveredTraVe, coveragePercent: 25, status: "GHI_NHAN" },
        }),
      } as unknown as Response;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.mocked(taoTrinhPhatYoutube).mockClear();
});

describe("[YTP-01] dựng trình phát đúng nguồn", () => {
  it("bài YouTube ⇒ KHÔNG có thẻ <video>, dựng trình phát với đúng mã video", async () => {
    const { container } = await khoiDong();
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector('[data-nguon="youtube"]')).not.toBeNull();
    expect(taoTrinhPhatYoutube).toHaveBeenCalledTimes(1);
    expect((h.tuyChon as TuyChon).videoId).toBe(MA);
  });

  it("bài MP4 ⇒ có thẻ <video> mang vé, và KHÔNG dựng trình phát YouTube", async () => {
    const { container } = await khoiDong({ videoKey: "elearning/master/l1/a.mp4", youtubeId: null } as never);
    const v = container.querySelector("video");
    expect(v).not.toBeNull();
    expect(v!.getAttribute("src")).toContain("/api/elearning/media/elearning/master/l1/a.mp4?ve=ve-da-ky");
    expect(taoTrinhPhatYoutube).not.toHaveBeenCalled();
  });

  it("hình mờ mang định danh người xem phủ lên khung YouTube", async () => {
    await khoiDong();
    expect(screen.getByText("Nguyễn Văn A · a@satarobo.vn")).toBeTruthy();
  });

  it("gỡ trang ⇒ huỷ trình phát", async () => {
    const { unmount } = await khoiDong();
    unmount();
    expect(player.destroy).toHaveBeenCalledTimes(1);
  });

  it("gỡ trang TRƯỚC khi trình phát sẵn sàng ⇒ vẫn huỷ khi nó về tới nơi", async () => {
    let xong!: (p: unknown) => void;
    h.tao = () => new Promise((r) => (xong = r));
    const { unmount } = render(<VideoPlayer {...PROPS} />);
    unmount();
    xong(player);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(player.destroy).toHaveBeenCalledTimes(1);
  });
});

describe("[YTP-02] nhịp xem gửi lên server", () => {
  it("🔴 xem liền 15 giây ⇒ MỘT nhịp mang đúng khoảng 0→15, tốc độ và vé", async () => {
    await khoiDong();
    await chay(15);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      ve: "ve-da-ky",
      enrollmentId: "e1",
      lessonId: "l1",
      tuSec: 0,
      denSec: 15,
      tocDo: 1,
      tabHien: true,
      seq: 1,
    });
  });

  it("server trả đã phủ bao nhiêu ⇒ hiện đúng % cho người học", async () => {
    coveredTraVe = 300; // 300/600 = 50%
    await khoiDong();
    await chay(15);
    expect(screen.getByText(/50%/)).toBeTruthy();
  });

  it("tạm dừng ⇒ gửi nhịp ngay (khoảng đã xem không chờ đủ 15 giây)", async () => {
    await khoiDong();
    await chay(6);
    expect(bodies).toHaveLength(0);
    s.state = 2;
    await act(async () => {
      (h.tuyChon as TuyChon).onTrangThai!(2);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ tuSec: 0, denSec: 6 });
  });

  it("hết video ⇒ gửi nhịp cuối", async () => {
    await khoiDong();
    await chay(4);
    await act(async () => {
      (h.tuyChon as TuyChon).onTrangThai!(0);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(bodies).toHaveLength(1);
  });

  it("đang tạm dừng ⇒ vòng 15 giây KHÔNG gửi nhịp", async () => {
    await khoiDong();
    s.state = 2;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(bodies).toHaveLength(0);
  });

  it("🔴 rời trang ⇒ nhịp cuối đi bằng sendBeacon, mang khoảng chưa gửi", async () => {
    await khoiDong();
    await chay(7);
    const beacon = vi.fn((_u: string, _b: Blob) => true);
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
    window.dispatchEvent(new Event("pagehide"));
    expect(beacon).toHaveBeenCalledTimes(1);
    const body = JSON.parse(await beacon.mock.calls[0]![1].text());
    expect(body).toMatchObject({ tuSec: 0, denSec: 7, tabHien: false });
  });

  it("rời tab ⇒ DỪNG video", async () => {
    await khoiDong();
    await chay(2);
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(player.pauseVideo).toHaveBeenCalled();
  });
});

describe("[YTP-03] chặn tua", () => {
  it("🔴 nhảy tới phần chưa xem ⇒ kéo về mốc đã xem, báo người học", async () => {
    await khoiDong();
    await chay(15); // server nhận nhịp ⇒ mốc đã xem = 15
    (player.seekTo as ReturnType<typeof vi.fn>).mockClear();

    s.t = 400; // người học kéo thanh tua
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(player.seekTo).toHaveBeenCalledWith(15, true);
    expect(screen.getByRole("alert").textContent).toContain("không cho tua");
  });

  it("🔴 khoảng NHẢY không bị tính là đã xem (nhịp sau bắt đầu từ mốc đã xem, không từ 400)", async () => {
    await khoiDong();
    await chay(15);
    s.t = 400;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    bodies.length = 0;
    await chay(15);
    // Sau khi bị kéo về ~15, xem tiếp 15 giây ⇒ khoảng ~15→30, không phải 0→… hay 400→….
    expect(Number(bodies[0]!.tuSec)).toBeGreaterThanOrEqual(15);
    expect(Number(bodies[0]!.tuSec)).toBeLessThan(17);
    expect(Number(bodies[0]!.denSec)).toBeLessThanOrEqual(31);
  });

  it("nhảy nhỏ hơn dung sai (timer chậm, vị trí lệch ~1s) ⇒ KHÔNG kéo về", async () => {
    // Chặn sát là chặn nhầm liên tục: trình phát báo vị trí lệch vài trăm mili giây là chuyện thường.
    await khoiDong();
    await chay(15);
    (player.seekTo as ReturnType<typeof vi.fn>).mockClear();
    s.t += 0.5 + 1.2;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(player.seekTo).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("lượt giao CHO tua (chanTua = false) ⇒ không kéo về", async () => {
    await khoiDong({ chanTua: false });
    await chay(15);
    (player.seekTo as ReturnType<typeof vi.fn>).mockClear();
    s.t = 400;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(player.seekTo).not.toHaveBeenCalled();
  });

  it("chanTua được truyền cho trình phát (tắt phím mũi tên tua của YouTube)", async () => {
    await khoiDong();
    expect((h.tuyChon as TuyChon).chanTua).toBe(true);
  });
});

describe("[YTP-04] trần tốc độ", () => {
  it("🔴 người học chọn 2x (trần 1.5x) ⇒ kẹp về 1.5", async () => {
    await khoiDong();
    s.rate = 2;
    await act(async () => {
      (h.tuyChon as TuyChon).onDoiTocDo!();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(player.setPlaybackRate).toHaveBeenCalledWith(1.5);
  });

  it("dưới trần ⇒ không đụng", async () => {
    await khoiDong();
    s.rate = 1.25;
    await act(async () => {
      (h.tuyChon as TuyChon).onDoiTocDo!();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(player.setPlaybackRate).not.toHaveBeenCalled();
  });

  it("🔴 trần lẻ (1.2x) ⇒ hạ xuống nấc 1, không nhảy lên 1.25 rồi lặp vô hạn", async () => {
    await khoiDong({ tocDoToiDa: 1.2 });
    s.rate = 2;
    await act(async () => {
      (h.tuyChon as TuyChon).onDoiTocDo!();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(player.setPlaybackRate).toHaveBeenCalledWith(1);
  });

  it("nhịp mang tốc độ THẬT của trình phát để server tự kiểm", async () => {
    await khoiDong();
    s.rate = 1.25;
    await chay(15);
    expect(bodies[0]).toMatchObject({ tocDo: 1.25 });
  });
});

describe("[YTP-05] lỗi", () => {
  it("video bị tắt nhúng / riêng tư sau khi sẵn sàng ⇒ báo người học chỗ để báo", async () => {
    await khoiDong();
    await act(async () => {
      (h.tuyChon as TuyChon).onLoi!(150);
    });
    expect(screen.getByRole("alert").textContent).toContain("Đào tạo");
  });

  it("không nạp được script YouTube ⇒ gợi ý mạng / trình chặn quảng cáo", async () => {
    h.tao = async () => {
      throw new LoiYoutube(0);
    };
    render(<VideoPlayer {...PROPS} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("alert").textContent).toContain("chặn quảng cáo");
  });

  it("mất mạng khi gửi nhịp ⇒ KHÔNG báo lỗi, không dừng video", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new TypeError("mạng chớp"));
    await khoiDong();
    await chay(15);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(player.pauseVideo).not.toHaveBeenCalled();
  });
});
