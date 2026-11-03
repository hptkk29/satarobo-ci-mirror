// @vitest-environment node
/**
 * Vòng đời hết hiệu lực của chứng nhận (`chayVongDoiChungNhan`) — HÀNH VI.
 *
 * Hai điều rà soát đối kháng 24/10/2026 tìm ra:
 *  1. Chốt `EXPIRED` RỒI MỚI phát sự kiện, hai bước rời nhau: chết giữa chừng thì dòng đã sang EXPIRED và
 *     lần chạy sau (chỉ chọn `status = VALID`) không bao giờ chọn lại để phát — sự kiện hết hạn mất VĨNH
 *     VIỄN, và luật `CHUNG_NHAN_HET_HAN` của EL-18 trở thành luật chết lặng lẽ. Đúng thứ tự: PHÁT trước
 *     (khoá chống trùng làm lần phát lại vô hại), chốt sau — lỗi giữa chừng để dòng còn `VALID` và được
 *     chọn lại.
 *  2. Cờ REMINDER chỉ được chặn việc NHẮC (T-30/T-7), không chặn chốt hết hạn / giao lại vòng.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const NOW = new Date("2026-10-24T03:00:00Z");
const NGAY = 24 * 60 * 60 * 1000;

const h = vi.hoisted(() => ({
  thuTu: [] as string[],
  vuaHet: [] as Record<string, unknown>[],
  sapHet: [] as Record<string, unknown>[],
  daHet: [] as Record<string, unknown>[],
  publish: vi.fn(async (_t: string, _p: unknown, _o?: unknown) => null as unknown),
  notify: vi.fn(async (_a: Record<string, unknown>) => 1),
  taoGhiDanh: vi.fn(async (_a: unknown) => ({})),
  updateMany: vi.fn(async (_a: unknown) => ({ count: 1 })),
}));

vi.mock("@/lib/db", () => ({
  db: {
    trnCertificate: {
      findMany: async (a: { where: Record<string, unknown> }) => {
        const w = a.where as { status?: string; validUntil?: Record<string, unknown> };
        if (w.status === "EXPIRED") return h.daHet;
        if (w.validUntil && "gte" in w.validUntil) return h.sapHet;
        return h.vuaHet;
      },
      updateMany: async (a: unknown) => {
        h.thuTu.push("chot-het-han");
        return h.updateMany(a);
      },
      update: async () => ({}),
    },
    trnCourse: { findMany: async () => [] },
    trnEnrollment: { count: async () => 0, create: h.taoGhiDanh },
  },
}));
vi.mock("@/lib/events/publish", () => ({
  publishEvent: async (...a: [string, unknown, unknown?]) => {
    h.thuTu.push("phat-su-kien");
    return h.publish(...a);
  },
}));
vi.mock("@/lib/notifications/notify", () => ({ notifyStaff: h.notify }));
vi.mock("@/lib/auth/hosts", () => ({ elearningHomeUrl: () => "https://e-learning.test" }));

import { chayVongDoiChungNhan } from "@/lib/elearning/cron-cert-expiry";

const cn = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  userId: `u-${id}`,
  courseId: "k1",
  enrollmentId: `gd-${id}`,
  validUntil: new Date(NOW.getTime() - NGAY),
  revokedAt: null,
  centerId: "CS1",
  orgUnitId: "OU-CS1",
  enrollment: { cycle: 1, snapJobTitle: "GV", snapDepartmentId: "dep" },
  ...o,
});

beforeEach(() => {
  h.thuTu = [];
  h.vuaHet = [];
  h.sapHet = [];
  h.daHet = [];
  h.publish.mockReset();
  h.publish.mockResolvedValue(null);
  h.notify.mockClear();
  h.taoGhiDanh.mockClear();
  h.updateMany.mockClear();
});

describe("🔴 thứ tự: PHÁT sự kiện hết hạn TRƯỚC khi chốt EXPIRED", () => {
  it("mọi lần phát sự kiện nằm trước lần chốt", async () => {
    h.vuaHet = [cn("c1"), cn("c2")];
    await chayVongDoiChungNhan(NOW, { nhacBat: true });
    const iChot = h.thuTu.indexOf("chot-het-han");
    expect(iChot).toBeGreaterThan(-1);
    expect(h.thuTu.slice(0, iChot).filter((x) => x === "phat-su-kien")).toHaveLength(2);
  });

  it("phát LỖI giữa chừng ⇒ KHÔNG chốt EXPIRED (dòng còn VALID, lần chạy sau chọn lại), và lỗi được báo", async () => {
    h.vuaHet = [cn("c1"), cn("c2")];
    h.publish.mockRejectedValueOnce(new Error("hàng đợi sự kiện chết"));
    const r = await chayVongDoiChungNhan(NOW, { nhacBat: true });
    expect(h.updateMany).not.toHaveBeenCalled();
    expect(r.chotHetHan).toBe(0);
    expect(r.loi.join(" ")).toContain("hàng đợi sự kiện chết");
  });

  it("phát được ⇒ khoá chống trùng theo chứng nhận (chạy lại vô hại)", async () => {
    h.vuaHet = [cn("c1")];
    await chayVongDoiChungNhan(NOW, { nhacBat: true });
    const opt = h.publish.mock.calls[0]![2] as { dedupeKey: string };
    expect(opt.dedupeKey).toBe("el.cert.exp:c1");
  });
});

describe("🔴 cờ REMINDER (nhacBat) chỉ chặn việc NHẮC T-30/T-7", () => {
  it("nhacBat = false ⇒ không gửi nhắc, NHƯNG vẫn chốt hết hạn và giao lại vòng", async () => {
    h.sapHet = [cn("s1", { validUntil: new Date(NOW.getTime() + 7 * NGAY) })];
    h.vuaHet = [cn("v1")];
    h.daHet = [cn("d1")];
    const r = await chayVongDoiChungNhan(NOW, { nhacBat: false });
    expect(h.notify).not.toHaveBeenCalled();
    expect(r.daNhac).toBe(0);
    expect(r.chotHetHan).toBe(1);
    expect(h.taoGhiDanh).toHaveBeenCalledTimes(1);
    expect(r.giaoLai).toBe(1);
  });

  it("ĐỐI CHỨNG DƯƠNG: nhacBat = true ⇒ nhắc chứng nhận sắp hết hạn", async () => {
    h.sapHet = [cn("s1", { validUntil: new Date(NOW.getTime() + 7 * NGAY) })];
    const r = await chayVongDoiChungNhan(NOW, { nhacBat: true });
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(r.daNhac).toBe(1);
  });
});
