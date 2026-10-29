// @vitest-environment node
/**
 * Vỏ `MayPhat` quanh trình phát YouTube: trình phát (`video-player.tsx`) viết cho thẻ
 * `<video>` và đọc/ghi `currentTime`, `playbackRate`, `paused`, `ended`, `pause()`, `play()`.
 * Test ở đây khẳng định vỏ bọc DỊCH đúng từng thứ sang API của YouTube.
 */
import { describe, it, expect, vi } from "vitest";
import {
  mayPhatTuYoutube,
  nacTocDoKhongVuot,
  thongBaoLoiYoutube,
  docThoiLuongYoutube,
  LoiYoutube,
  type YtPlayer,
} from "@/lib/elearning/youtube-iframe";

const NAC = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function gia(o: { t?: number; rate?: number; state?: number; dur?: number } = {}) {
  const s = { t: o.t ?? 0, rate: o.rate ?? 1, state: o.state ?? -1, dur: o.dur ?? 0 };
  const p = {
    getCurrentTime: vi.fn(() => s.t),
    getDuration: vi.fn(() => s.dur),
    getPlaybackRate: vi.fn(() => s.rate),
    setPlaybackRate: vi.fn((r: number) => {
      s.rate = r;
    }),
    getAvailablePlaybackRates: vi.fn(() => NAC),
    getPlayerState: vi.fn(() => s.state),
    playVideo: vi.fn(),
    pauseVideo: vi.fn(),
    seekTo: vi.fn(),
    destroy: vi.fn(),
  } satisfies YtPlayer;
  return { p, s };
}

describe("[YTI-01] vị trí và tua", () => {
  it("đọc `currentTime` = getCurrentTime()", () => {
    const { p } = gia({ t: 42.5 });
    expect(mayPhatTuYoutube(p).currentTime).toBe(42.5);
  });

  it("gán `currentTime` = seekTo(giây, true)", () => {
    const { p } = gia();
    mayPhatTuYoutube(p).currentTime = 90;
    expect(p.seekTo).toHaveBeenCalledWith(90, true);
  });
});

describe("[YTI-02] trạng thái dừng / hết", () => {
  const paused = (state: number) => mayPhatTuYoutube(gia({ state }).p).paused;

  it("đang phát và đang tải đệm KHÔNG phải dừng", () => {
    expect(paused(1)).toBe(false);
    expect(paused(3)).toBe(false);
  });

  it("chưa bắt đầu / tạm dừng / hết / đã nạp ⇒ dừng", () => {
    for (const s of [-1, 0, 2, 5]) expect(paused(s), String(s)).toBe(true);
  });

  it("`ended` chỉ đúng ở trạng thái 0", () => {
    expect(mayPhatTuYoutube(gia({ state: 0 }).p).ended).toBe(true);
    expect(mayPhatTuYoutube(gia({ state: 2 }).p).ended).toBe(false);
  });

  it("pause()/play() gọi đúng lệnh", async () => {
    const { p } = gia();
    const may = mayPhatTuYoutube(p);
    may.pause();
    await may.play();
    expect(p.pauseVideo).toHaveBeenCalledTimes(1);
    expect(p.playVideo).toHaveBeenCalledTimes(1);
  });
});

describe("[YTI-03] tốc độ — kẹp về nấc KHÔNG VƯỢT trần", () => {
  it("trần là một nấc có sẵn ⇒ đặt đúng nấc đó", () => {
    const { p } = gia();
    mayPhatTuYoutube(p).playbackRate = 1.5;
    expect(p.setPlaybackRate).toHaveBeenCalledWith(1.5);
  });

  it("🔴 trần 1.2 (không phải nấc) ⇒ hạ xuống 1, KHÔNG lên 1.25", () => {
    // YouTube làm tròn tới nấc gần nhất: đặt 1.2 thì ra 1.25 > trần, trình phát lại kẹp,
    // YouTube lại làm tròn lên… vòng vô hạn. Chọn nấc dưới trần là thứ chặn vòng đó.
    expect(nacTocDoKhongVuot(NAC, 1.2)).toBe(1);
    const { p } = gia();
    mayPhatTuYoutube(p).playbackRate = 1.2;
    expect(p.setPlaybackRate).toHaveBeenCalledWith(1);
  });

  it("trần thấp hơn mọi nấc ⇒ lấy nấc thấp nhất", () => {
    expect(nacTocDoKhongVuot(NAC, 0.1)).toBe(0.25);
  });

  it("danh sách nấc rỗng ⇒ đặt đúng giá trị yêu cầu", () => {
    expect(nacTocDoKhongVuot([], 1.5)).toBe(1.5);
  });

  it("đọc `playbackRate` = getPlaybackRate()", () => {
    expect(mayPhatTuYoutube(gia({ rate: 1.75 }).p).playbackRate).toBe(1.75);
  });
});

describe("[YTI-04] đọc thời lượng", () => {
  it("có ngay ⇒ trả số giây làm tròn", async () => {
    expect(await docThoiLuongYoutube(gia({ dur: 301.4 }).p)).toBe(301);
  });

  it("về chậm (0 rồi mới có) ⇒ chờ được", async () => {
    const { p, s } = gia({ dur: 0 });
    setTimeout(() => {
      s.dur = 120;
    }, 300);
    expect(await docThoiLuongYoutube(p, 5_000)).toBe(120);
  });

  it("🔴 YouTube báo lỗi SAU onReady (Riêng tư / không có thật) ⇒ ném ĐÚNG mã đó, không chờ hết hạn", async () => {
    // Đo bằng trình duyệt thật: với video không tồn tại YouTube bắn onReady rồi mới onError(100).
    // Không nghe lỗi trong lúc chờ thì ra câu chung "không đọc được thời lượng".
    const { p } = gia({ dur: 0 });
    let loi: number | null = null;
    setTimeout(() => {
      loi = 100;
    }, 300);
    const bat = Date.now();
    const e = await docThoiLuongYoutube(p, 8_000, () => loi).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(LoiYoutube);
    expect((e as LoiYoutube).ma).toBe(100);
    expect(Date.now() - bat).toBeLessThan(2_000);
  });

  it("lỗi có sẵn từ trước khi hỏi ⇒ ném ngay, kể cả khi thời lượng đã đọc được", async () => {
    // Lỗi thắng thời lượng: một video bị tắt nhúng vẫn có thể báo thời lượng từ siêu dữ liệu.
    const e = await docThoiLuongYoutube(gia({ dur: 300 }).p, 1_000, () => 150).catch(
      (x: unknown) => x,
    );
    expect((e as LoiYoutube).ma).toBe(150);
  });

  it("hết hạn mà có lỗi muộn ⇒ vẫn báo mã lỗi đó thay vì mã 0", async () => {
    let loi: number | null = null;
    const e = await docThoiLuongYoutube(gia({ dur: 0 }).p, 300, () => {
      const v = loi;
      loi = 101; // lỗi chỉ lộ ra ở lần hỏi cuối
      return v;
    }).catch((x: unknown) => x);
    expect((e as LoiYoutube).ma).toBe(101);
  });

  it("mãi là 0 (video trực tiếp) ⇒ LoiYoutube(0), không treo", async () => {
    const e = await docThoiLuongYoutube(gia({ dur: 0 }).p, 400).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(LoiYoutube);
    expect((e as LoiYoutube).ma).toBe(0);
  });
});

describe("[YTI-05] thông báo lỗi nói đúng cách khắc phục", () => {
  it("người soạn: không tìm thấy (100) ⇒ nói link sai/đã xoá, nhắc chế độ Không công khai", () => {
    expect(thongBaoLoiYoutube(100, "soan")).toContain("Không tìm thấy");
    expect(thongBaoLoiYoutube(100, "soan")).toContain("Không công khai");
  });

  it("🔴 người soạn: 101/150 ⇒ nêu CẢ HAI nguyên nhân (Riêng tư và tắt nhúng) + cách sửa", () => {
    // Đo thật: video Riêng tư và mã không tồn tại đều ra 101/150 — câu chỉ nói "tắt nhúng" làm
    // người soạn đi bật nhúng cho một video Riêng tư và vẫn không phát được.
    for (const m of [101, 150]) {
      const t = thongBaoLoiYoutube(m, "soan");
      expect(t, String(m)).toContain("Riêng tư");
      expect(t, String(m)).toContain("Cho phép nhúng");
      expect(t, String(m)).toContain("Không công khai");
    }
  });

  it("người học: không lộ chi tiết kỹ thuật, chỉ chỉ chỗ báo", () => {
    expect(thongBaoLoiYoutube(100, "hoc")).toContain("Đào tạo");
    expect(thongBaoLoiYoutube(100, "hoc")).not.toContain("Riêng tư");
  });

  it("người học: không nạp được script (mã 0) ⇒ gợi ý mạng / trình chặn quảng cáo", () => {
    expect(thongBaoLoiYoutube(0, "hoc")).toContain("chặn quảng cáo");
  });
});
