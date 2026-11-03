// @vitest-environment node
/**
 * EL-13 — quét mở cờ.
 *
 * Tệp này là chỗ bộ luật gắn cờ thật sự được THI HÀNH. Ba hỏng ở đây đều im lặng:
 * mở cờ trùng mỗi đêm cho cùng một lần xem · mở cờ không có người xử · và tệ nhất
 * là không mở nổi cờ nào mà cron vẫn báo chạy xong.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  phien: [] as unknown[],
  coSan: null as unknown,
  tienDo: null as unknown,
  vai: null as unknown,
  createMany: vi.fn(async (_a: { data: Record<string, unknown>[] }) => ({ count: 1 })),
  timPhien: vi.fn(async (_a: unknown) => [] as unknown[]),
}));

vi.mock("@/lib/db", () => ({
  db: {
    trnVideoSession: {
      findMany: vi.fn(async (a: unknown) => {
        await h.timPhien(a);
        return h.phien;
      }),
    },
    trnWatchFlag: {
      findFirst: vi.fn(async () => h.coSan),
      createMany: h.createMany,
    },
    trnLessonProgress: { findUnique: vi.fn(async () => h.tienDo) },
    userOrgRole: { findFirst: vi.fn(async () => h.vai) },
  },
}));

import { quetMoCo } from "@/lib/elearning/watch-flag-scan";
import { CUA_SO_KHIEU_NAI_NGAY } from "@/lib/elearning/watch-flag-rules";

const NOW = new Date("2026-08-25T22:00:00.000Z");

/** Một phiên KHAI KHỐNG: 10 phút nội dung trong 90 giây đồng hồ. */
const phienGian = {
  id: "s1",
  userId: "u1",
  lessonId: "les1",
  enrollmentId: "en1",
  startedAt: new Date("2026-08-25T20:00:00.000Z"),
  lastBeatAt: new Date("2026-08-25T20:01:30.000Z"),
  totalWatchSec: 600,
};

const tienDoGian = {
  coveredSec: 600,
  contentSec: 600,
  blockedSeekCount: 0,
  seekCount: 2,
  seq: 6,
  firstStartedAt: new Date("2026-08-25T20:00:00.000Z"),
  enrollment: {
    centerId: "cs1",
    orgUnitId: "ou1",
    assignment: { maxPlaybackRate: 1.5 },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  h.phien = [phienGian];
  h.coSan = null;
  h.tienDo = tienDoGian;
  h.vai = { userId: "daotao1" };
});

describe("mở cờ khi số liệu bất khả thi", () => {
  it("mở được cờ, có người xử, có hạn khiếu nại", async () => {
    const r = await quetMoCo(NOW);
    expect(r.daXet).toBe(1);
    expect(r.daMo).toBeGreaterThan(0);
    const rows = h.createMany.mock.calls[0]![0].data;
    expect(rows[0]!.handlerUserId).toBe("daotao1");
    expect(rows[0]!.subjectKind).toBe("VIDEO_SESSION");
    expect(rows[0]!.videoSessionId).toBe("s1");
  });

  it("hạn khiếu nại tính TỪ mốc truyền vào, không từ đồng hồ DB", async () => {
    // Hai nguồn thời gian cho cùng một bản ghi là hai con số lệch nhau vài giây,
    // và cron chốt hết hạn sẽ chạy trên con số không khớp với con số người dùng
    // nhìn thấy trên màn hình.
    await quetMoCo(NOW);
    const row = h.createMany.mock.calls[0]![0].data[0]!;
    const han = row.appealDeadline as Date;
    expect((han.getTime() - NOW.getTime()) / 86_400_000).toBe(CUA_SO_KHIEU_NAI_NGAY);
    expect(row.openedAt).toEqual(NOW);
  });

  it("ghi kép cơ sở và đơn vị", async () => {
    await quetMoCo(NOW);
    const row = h.createMany.mock.calls[0]![0].data[0]!;
    expect(row.centerId).toBe("cs1");
    expect(row.orgUnitId).toBe("ou1");
  });
});

describe("KHÔNG mở cờ trùng", () => {
  it("phiên đã có cờ ⇒ bỏ qua hẳn", async () => {
    // Cron chạy mỗi đêm và cửa sổ nhìn lại là 2 ngày. Không có bước này thì mỗi
    // phiên đáng ngờ sinh một cờ mới mỗi đêm, và người bị gắn nhận hai cờ cho
    // cùng một lần xem — mỗi cờ một hạn khiếu nại riêng.
    h.coSan = { id: "co-cu" };
    const r = await quetMoCo(NOW);
    expect(r.daMo).toBe(0);
    expect(r.daXet).toBe(0);
    expect(h.createMany).not.toHaveBeenCalled();
  });
});

describe("🔴 không có người xử thì KHÔNG mở cờ — và phải ĐẾM ĐƯỢC", () => {
  it("thiếu vai Đào tạo ở đơn vị ⇒ không tạo cờ", async () => {
    // Cờ không có người xử là thứ đặc tả CẤM tạo: không ai thấy mình phải trả
    // lời, và khiếu nại nằm đó tới khi hết hạn rồi tự chốt thành UPHELD.
    h.vai = null;
    const r = await quetMoCo(NOW);
    expect(h.createMany).not.toHaveBeenCalled();
    expect(r.daMo).toBe(0);
  });

  it("con số bị bỏ qua KHÔNG được nuốt im lặng", async () => {
    // Nuốt đi thì bộ giám sát trông như đang chạy trong khi nó không mở nổi một
    // cờ nào — và điều đó chỉ lộ ra khi có người hỏi "sao chưa từng thấy cờ nào".
    h.vai = null;
    const r = await quetMoCo(NOW);
    expect(r.thieuNguoiXu).toBeGreaterThan(0);
  });
});

describe("chỉ xét phiên ĐÃ ĐÓNG", () => {
  it("truy vấn chặn phiên còn đang chạy", async () => {
    // Phiên đang chạy thì mọi tỉ lệ đều dở dang: người tạm dừng đi họp 20 phút
    // trông y như người khai khống.
    await quetMoCo(NOW);
    const arg = h.timPhien.mock.calls[0]![0] as {
      where: { lastBeatAt: { lt: Date; gte: Date } };
    };
    expect(arg.where.lastBeatAt.lt.getTime()).toBeLessThan(NOW.getTime());
    expect(arg.where.lastBeatAt.gte.getTime()).toBeLessThan(
      arg.where.lastBeatAt.lt.getTime(),
    );
  });
});

describe("người học BÌNH THƯỜNG không sinh cờ", () => {
  it("xem một mạch đúng tốc độ ⇒ xét rồi thôi", async () => {
    h.phien = [
      {
        ...phienGian,
        lastBeatAt: new Date("2026-08-25T20:11:00.000Z"),
        totalWatchSec: 600,
      },
    ];
    const r = await quetMoCo(NOW);
    expect(r.daXet).toBe(1);
    expect(r.daMo).toBe(0);
    expect(h.createMany).not.toHaveBeenCalled();
  });

  it("🔴 phiên VỀ SAU của người xem nhiều lần (seq luỹ kế lớn) ⇒ KHÔNG gắn cờ nhịp dày oan", async () => {
    // `seq` đi tiếp qua các lần tải lại: 400 nhịp đời bài (vượt ngưỡng 132 của MỘT phiên 11 phút), nhưng phiên này mở
    // SAU nhịp đầu của bài — số 400 không phải số nhịp của phiên này.
    h.tienDo = { ...tienDoGian, seq: 400, firstStartedAt: new Date("2026-08-20T09:00:00.000Z") };
    h.phien = [
      { ...phienGian, lastBeatAt: new Date("2026-08-25T20:11:00.000Z"), totalWatchSec: 600 },
    ];
    const r = await quetMoCo(NOW);
    expect(r.daXet).toBe(1);
    expect(r.daMo).toBe(0);
    expect(h.createMany).not.toHaveBeenCalled();
  });

  it("ĐỐI CHỨNG: phiên ĐẦU TIÊN của bài với nhịp dày bất thường ⇒ VẪN gắn cờ HEARTBEAT_FLOOD", async () => {
    // Cùng 400 nhịp, nhưng đây là phiên ĐẦU (mốc mở phiên = mốc nhịp đầu của tiến độ): vượt ngưỡng 3 × (660 / 15) = 132.
    h.tienDo = { ...tienDoGian, seq: 400 };
    h.phien = [
      { ...phienGian, lastBeatAt: new Date("2026-08-25T20:11:00.000Z"), totalWatchSec: 600 },
    ];
    await quetMoCo(NOW);
    const rows = h.createMany.mock.calls[0]![0].data;
    expect(rows.map((x) => x.ruleCode)).toContain("HEARTBEAT_FLOOD");
  });

  it("phiên KHÔNG có dòng tiến độ ⇒ bỏ qua, không đoán", async () => {
    h.tienDo = null;
    const r = await quetMoCo(NOW);
    expect(r.daXet).toBe(0);
    expect(h.createMany).not.toHaveBeenCalled();
  });
});

describe("[HBF] luật nhịp dày đếm THEO PHIÊN (`TrnVideoSession.soNhip`) — đúng cả khi seq luỹ kế và firstStartedAt vô nghĩa", () => {
  // Phiên 11 phút (660 giây đồng hồ): ngưỡng = 3 × 660 / 15 = 132 nhịp. Vượt (`>`) mới là nhịp dày.
  const phienMuoiMotPhut = { ...phienGian, lastBeatAt: new Date("2026-08-25T20:11:00.000Z"), totalWatchSec: 600 };
  const cac = async () => {
    await quetMoCo(NOW);
    return h.createMany.mock.calls[0]?.[0].data.map((x) => x.ruleCode) ?? [];
  };

  it("🔴 phiên VỀ SAU (firstStartedAt cũ, seq luỹ kế khớp hay không đều vô nghĩa) mà số nhịp CỦA PHIÊN dày ⇒ gắn cờ (trước đây null ⇒ im lặng)", async () => {
    h.tienDo = { ...tienDoGian, seq: 5, firstStartedAt: new Date("2026-08-20T09:00:00.000Z") };
    h.phien = [{ ...phienMuoiMotPhut, soNhip: 400 }];
    expect(await cac()).toContain("HEARTBEAT_FLOOD");
  });

  it("🔴 người vừa bị ĐẶT LẠI tiến độ (firstStartedAt = NULL sau khi bài đổi nguồn) mà phiên dày nhịp ⇒ VẪN gắn cờ — luật không tắt với nhóm này", async () => {
    h.tienDo = { ...tienDoGian, seq: 400, firstStartedAt: null };
    h.phien = [{ ...phienMuoiMotPhut, soNhip: 400 }];
    expect(await cac()).toContain("HEARTBEAT_FLOOD");
  });

  it("ĐỐI CHỨNG: cùng người đó, phiên nhịp bình thường (44 nhịp / 11 phút) dù seq luỹ kế 400 ⇒ KHÔNG cờ", async () => {
    h.tienDo = { ...tienDoGian, seq: 400, firstStartedAt: null };
    h.phien = [{ ...phienMuoiMotPhut, soNhip: 44 }];
    const r = await quetMoCo(NOW);
    expect(r.daXet).toBe(1);
    expect(h.createMany).not.toHaveBeenCalled();
  });

  it("biên: đúng 132 nhịp ⇒ KHÔNG cờ; 133 ⇒ cờ (luật so `>`)", async () => {
    h.phien = [{ ...phienMuoiMotPhut, soNhip: 132 }];
    await quetMoCo(NOW);
    expect(h.createMany).not.toHaveBeenCalled();
    h.createMany.mockClear();
    h.phien = [{ ...phienMuoiMotPhut, soNhip: 133 }];
    expect(await cac()).toContain("HEARTBEAT_FLOOD");
  });

  it("số nhịp của phiên THẮNG số seq luỹ kế khi cả hai có mặt: phiên đầu, seq = 400 nhưng phiên chỉ 40 nhịp ⇒ KHÔNG cờ", async () => {
    h.tienDo = { ...tienDoGian, seq: 400 }; // firstStartedAt = mốc mở phiên ⇒ cách cũ sẽ gắn cờ
    h.phien = [{ ...phienMuoiMotPhut, soNhip: 40 }];
    const r = await quetMoCo(NOW);
    expect(r.daXet).toBe(1);
    expect(h.createMany).not.toHaveBeenCalled();
  });

  it("phiên cũ (soNhip = 0, mở trước cột đếm) và không dựa được vào seq (firstStartedAt NULL) ⇒ BỎ QUA luật, không đoán", async () => {
    h.tienDo = { ...tienDoGian, seq: 400, firstStartedAt: null };
    h.phien = [{ ...phienMuoiMotPhut, soNhip: 0 }];
    const r = await quetMoCo(NOW);
    expect(r.daXet).toBe(1);
    expect(h.createMany).not.toHaveBeenCalled();
  });

  it("truy vấn phiên CHỌN cột `soNhip` (thiếu ⇒ luôn undefined ⇒ luật chết im lặng)", async () => {
    await quetMoCo(NOW);
    const a = h.timPhien.mock.calls[0]![0] as { select: Record<string, boolean> };
    expect(a.select.soNhip).toBe(true);
  });
});
