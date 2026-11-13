// @vitest-environment node
/**
 * EL-15d — nhắc NGƯỜI CHẤM.
 *
 * Hai hướng hỏng, và hướng nào cũng làm cái nhắc thành vô dụng:
 *  · nhắc quá dày ⇒ người ta tắt thông báo, và cái nhắc THẬT cũng mất theo;
 *  · nhắc nhầm người ⇒ giục người nộp, trong khi họ đã làm xong phần của mình và
 *    không có hành động nào để làm.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  luot: [] as unknown[],
  vai: ["gv1", "gv2"] as string[],
  notify: vi.fn(async (_p: Record<string, unknown>) => 1),
}));

vi.mock("@/lib/db", () => ({
  db: { trnSubmission: { findMany: vi.fn(async () => h.luot) } },
}));
vi.mock("@/lib/notifications/notify", () => ({ notifyStaff: h.notify }));
vi.mock("@/lib/elearning/_handlers/notify", () => ({
  userIdCuaVai: vi.fn(async () => h.vai),
}));

import { nhacNguoiCham } from "@/lib/elearning/grader-reminder";

// 2026-08-24 là thứ Hai (UTC).
const NOW = new Date("2026-08-24T09:00:00.000Z");
const treTu = (n: number) => ({
  dueGradeAt: new Date(NOW.getTime() - n * 86_400_000),
});

beforeEach(() => {
  vi.clearAllMocks();
  h.luot = [];
  h.vai = ["gv1", "gv2"];
  h.notify.mockResolvedValue(1);
});

describe("khi nào KHÔNG nhắc", () => {
  it("hàng đợi sạch ⇒ im lặng", async () => {
    const r = await nhacNguoiCham(NOW);
    expect(r.daGui).toBe(0);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("🔴 chưa CHẠM ngưỡng ⇒ chưa nhắc", async () => {
    // Một bài trễ nửa ngày là chuyện thường của hàng đợi đang chạy. Nhắc từ bài đầu
    // tiên là dạy người ta bỏ qua thông báo — rồi cái nhắc thật cũng bị bỏ qua.
    h.luot = [treTu(1), treTu(1)];
    const r = await nhacNguoiCham(NOW);
    expect(r.quaHan).toBe(2);
    expect(r.daGui).toBe(0);
    expect(h.notify).not.toHaveBeenCalled();
  });
});

describe("khi nhắc", () => {
  beforeEach(() => {
    h.luot = [treTu(9), treTu(2), treTu(1)];
  });

  it("gửi cho NGƯỜI CHẤM, đúng một thông báo cho CẢ hàng đợi", async () => {
    // Ba mươi bài trễ mà gửi ba mươi dòng là làm ngập hộp thư đúng người cần đọc.
    const r = await nhacNguoiCham(NOW);
    expect(r.daGui).toBe(2);
    expect(h.notify).toHaveBeenCalledTimes(1);
    const p = h.notify.mock.calls[0]![0] as { userIds: string[] };
    expect(p.userIds).toEqual(["gv1", "gv2"]);
  });

  it("🔴 khoá chống trùng mang NGÀY ⇒ một lần mỗi ngày, dù cron chạy 96 lượt", async () => {
    await nhacNguoiCham(NOW);
    const p = h.notify.mock.calls[0]![0] as { dedupeKey: string };
    expect(p.dedupeKey).toContain("2026-08-24");
  });

  it("nói SỐ BÀI và TUỔI bài chờ lâu nhất", async () => {
    // "Có bài quá hạn" không cho người chấm biết nên bỏ việc gì để làm việc này.
    await nhacNguoiCham(NOW);
    const p = h.notify.mock.calls[0]![0] as { title: string; body: string };
    expect(p.title).toContain("3");
    expect(p.body).toMatch(/ngày làm việc/);
  });

  it("🔴 nói rõ hạn người nộp ĐANG ĐƯỢC NỚI — đừng để người chấm tưởng đang hại ai", async () => {
    await nhacNguoiCham(NOW);
    const p = h.notify.mock.calls[0]![0] as { body: string };
    expect(p.body).toContain("không bị tính trễ");
  });

  it("dẫn thẳng tới hàng đợi chấm bài tập", async () => {
    await nhacNguoiCham(NOW);
    const p = h.notify.mock.calls[0]![0] as { href: string };
    expect(p.href).toBe("/elearning/cham-bai-tap");
  });
});

describe("🔴 KHÔNG có ai để nhắc", () => {
  it("nói ra, không im lặng coi như xong", async () => {
    // Một hàng đợi tắc mà không ai nhận được nhắc là cái hỏng khó thấy nhất — cron
    // báo "xong" và mọi chỉ số vẫn xanh.
    h.luot = [treTu(9), treTu(2), treTu(1)];
    h.vai = [];
    const r = await nhacNguoiCham(NOW);
    expect(r.daGui).toBe(0);
    expect(r.thieuNguoiNhan).toContain("TRAINING");
    expect(h.notify).not.toHaveBeenCalled();
  });
});
