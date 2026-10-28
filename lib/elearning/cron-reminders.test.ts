// @vitest-environment node
/**
 * Cờ `ELEARNING_REMINDER_ENABLED` (đặc tả EL-06 mục 7) chỉ chặn việc NHẮC — không chặn vòng đời chứng
 * nhận chạy chung khe cron.
 *
 * Rà soát đối kháng 24/10/2026: cổng cờ đặt ở route (`return ok({skipped})` trước `runElearningReminders`)
 * nên cờ OFF cũng tắt luôn việc CHỐT chứng nhận hết hạn và GIAO LẠI vòng tái chứng nhận — hai việc không
 * phải "nhắc". Hệ quả: tắt nhắc (vd. TEST chưa xác nhận người nhận) làm đứng cả vòng đời chứng nhận mà
 * không lỗi nào báo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  thuTu: [] as string[],
  dongLuot: vi.fn(async (_now?: Date, _o?: { marginPhut: number }) => ({
    daXet: 0,
    daDong: 0,
    daBoQua: 0,
    conSot: 0,
    daVa: 0,
    daBaoNguoiHoc: 0,
    boQuaQuaCu: 0,
    loi: [] as string[],
  })),
  lichEnroll: vi.fn(async () => [] as unknown[]),
  guiNhac: vi.fn(async () => [] as unknown[]),
  nhacCham: vi.fn(async () => ({ quaHan: 0, daGui: 0, thieuNguoiNhan: null as string | null })),
  vongDoi: vi.fn(async (_now?: Date, _o?: { nhacBat: boolean }) => ({
    daNhac: 0,
    chotHetHan: 0,
    giaoLai: 0,
    khongGiaoLaiDuoc: 0,
    loi: [] as string[],
  })),
}));

vi.mock("@/lib/db", () => ({
  db: {
    trnEnrollment: {
      findMany: async (...a: unknown[]) => {
        h.thuTu.push("lap-lich");
        return h.lichEnroll(...(a as []));
      },
    },
    trnReminder: {
      createMany: async () => ({ count: 0 }),
      updateMany: async () => ({ count: 0 }),
      update: async () => ({}),
      findMany: async (...a: unknown[]) => {
        h.thuTu.push("gui-nhac");
        return h.guiNhac(...(a as []));
      },
    },
    trnCourse: { findMany: async () => [] },
  },
}));
vi.mock("@/lib/notifications/notify", () => ({ notifyStaff: vi.fn(async () => 1) }));
vi.mock("@/lib/elearning/grader-reminder", () => ({
  nhacNguoiCham: async (...a: unknown[]) => {
    h.thuTu.push("nhac-cham");
    return h.nhacCham(...(a as []));
  },
}));
vi.mock("@/lib/elearning/cron-cert-expiry", () => ({
  chayVongDoiChungNhan: async (now?: Date, o?: { nhacBat: boolean }) => {
    h.thuTu.push("vong-doi-chung-nhan");
    return h.vongDoi(now, o);
  },
}));

vi.mock("@/lib/elearning/cron-dong-luot-thi", () => ({
  dongLuotThiHetHan: async (now?: Date, o?: { marginPhut: number }) => {
    h.thuTu.push("dong-luot-thi");
    return h.dongLuot(now, o);
  },
}));

import { runElearningReminders } from "@/lib/elearning/cron-reminders";

const NOW = new Date("2026-10-24T03:00:00Z");

beforeEach(() => {
  h.thuTu = [];
  h.lichEnroll.mockClear();
  h.guiNhac.mockClear();
  h.nhacCham.mockClear();
  h.vongDoi.mockClear();
  h.dongLuot.mockClear();
  delete process.env.ELEARNING_EXAM_AUTO_CLOSE_MARGIN_MIN;
  delete process.env.ELEARNING_EXAM_AUTO_CLOSE_MAX_AGE_DAYS;
});

describe("🔴 cờ REMINDER tắt — chỉ việc NHẮC dừng, vòng đời chứng nhận vẫn chạy", () => {
  it("nhacBat = false ⇒ KHÔNG lập lịch, KHÔNG gửi nhắc, KHÔNG nhắc người chấm", async () => {
    await runElearningReminders(NOW, { nhacBat: false, dongLuotThiBat: false });
    expect(h.thuTu).not.toContain("lap-lich");
    expect(h.thuTu).not.toContain("gui-nhac");
    expect(h.thuTu).not.toContain("nhac-cham");
  });

  it("nhacBat = false ⇒ vòng đời chứng nhận VẪN chạy, và được báo `nhacBat: false`", async () => {
    await runElearningReminders(NOW, { nhacBat: false, dongLuotThiBat: false });
    expect(h.vongDoi).toHaveBeenCalledTimes(1);
    expect(h.vongDoi.mock.calls[0]![1]).toEqual({ nhacBat: false });
  });

  it("nhacBat = false ⇒ kết quả NÓI RA việc nhắc đã tắt (không im lặng báo 0)", async () => {
    const r = await runElearningReminders(NOW, { nhacBat: false, dongLuotThiBat: false });
    expect(r.nhacTat).toBe(true);
  });

  it("ĐỐI CHỨNG DƯƠNG: nhacBat = true ⇒ chạy cả bốn việc, truyền nhacBat=true xuống vòng đời chứng nhận", async () => {
    const r = await runElearningReminders(NOW, { nhacBat: true, dongLuotThiBat: false });
    expect(h.thuTu).toEqual(
      expect.arrayContaining(["lap-lich", "gui-nhac", "nhac-cham", "vong-doi-chung-nhan"]),
    );
    expect(h.vongDoi.mock.calls[0]![1]).toEqual({ nhacBat: true });
    expect(r.nhacTat).toBe(false);
  });
});

describe("🔴 F-05 — việc 6 (đóng lượt thi bỏ dở) có cờ riêng, mặc định TẮT", () => {
  it("dongLuotThiBat = false ⇒ KHÔNG chạy việc đóng lượt, và kết quả NÓI RA `dongLuotThiTat`", async () => {
    const r = await runElearningReminders(NOW, { nhacBat: true, dongLuotThiBat: false });
    expect(h.dongLuot).not.toHaveBeenCalled();
    expect(r.dongLuotThiTat).toBe(true);
    expect(r.dongLuotThi).toBeNull();
  });

  it("ĐỐI CHỨNG DƯƠNG: dongLuotThiBat = true ⇒ chạy với biên chờ mặc định 15 phút, kể cả khi cờ NHẮC tắt", async () => {
    const r = await runElearningReminders(NOW, { nhacBat: false, dongLuotThiBat: true });
    expect(h.dongLuot).toHaveBeenCalledTimes(1);
    expect(h.dongLuot.mock.calls[0]![1]).toEqual({ marginPhut: 15 });
    expect(r.dongLuotThiTat).toBe(false);
    expect(r.dongLuotThi).not.toBeNull();
  });

  it("biên chờ đọc từ env hợp lệ; SAI ⇒ TỪ CHỐI chạy và báo `loi` (không đoán giá trị cho hành vi chấm điểm)", async () => {
    process.env.ELEARNING_EXAM_AUTO_CLOSE_MARGIN_MIN = "30";
    await runElearningReminders(NOW, { nhacBat: false, dongLuotThiBat: true });
    expect(h.dongLuot.mock.calls[0]![1]).toEqual({ marginPhut: 30 });

    h.dongLuot.mockClear();
    for (const sai of ["4", "1441", "abc", "1.5", "-5"]) {
      process.env.ELEARNING_EXAM_AUTO_CLOSE_MARGIN_MIN = sai;
      const r = await runElearningReminders(NOW, { nhacBat: false, dongLuotThiBat: true });
      expect(h.dongLuot, sai).not.toHaveBeenCalled();
      expect(r.loi.join(" "), sai).toContain("ELEARNING_EXAM_AUTO_CLOSE_MARGIN_MIN");
    }
  });

  it("tuổi tối đa đọc từ env hợp lệ; SAI ⇒ TỪ CHỐI chạy; không đặt ⇒ không truyền giới hạn", async () => {
    await runElearningReminders(NOW, { nhacBat: false, dongLuotThiBat: true });
    expect(h.dongLuot.mock.calls[0]![1]).toEqual({ marginPhut: 15 });
    h.dongLuot.mockClear();
    process.env.ELEARNING_EXAM_AUTO_CLOSE_MAX_AGE_DAYS = "30";
    await runElearningReminders(NOW, { nhacBat: false, dongLuotThiBat: true });
    expect(h.dongLuot.mock.calls[0]![1]).toEqual({ marginPhut: 15, tuoiToiDaNgay: 30 });
    h.dongLuot.mockClear();
    for (const sai of ["0", "3651", "abc", "1.5", "-1"]) {
      process.env.ELEARNING_EXAM_AUTO_CLOSE_MAX_AGE_DAYS = sai;
      const r = await runElearningReminders(NOW, { nhacBat: false, dongLuotThiBat: true });
      expect(h.dongLuot, sai).not.toHaveBeenCalled();
      expect(r.loi.join(" "), sai).toContain("ELEARNING_EXAM_AUTO_CLOSE_MAX_AGE_DAYS");
    }
    delete process.env.ELEARNING_EXAM_AUTO_CLOSE_MAX_AGE_DAYS;
  });

  it("lỗi của việc 6 KHÔNG làm hỏng kết quả các việc khác", async () => {
    h.dongLuot.mockRejectedValueOnce(new Error("boom"));
    const r = await runElearningReminders(NOW, { nhacBat: true, dongLuotThiBat: true });
    expect(r.loi.join(" ")).toContain("dongLuotThi: boom");
    expect(h.vongDoi).toHaveBeenCalledTimes(1);
  });
});
