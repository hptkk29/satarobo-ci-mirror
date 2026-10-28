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

  it("phiên KHÔNG có dòng tiến độ ⇒ bỏ qua, không đoán", async () => {
    h.tienDo = null;
    const r = await quetMoCo(NOW);
    expect(r.daXet).toBe(0);
    expect(h.createMany).not.toHaveBeenCalled();
  });
});
