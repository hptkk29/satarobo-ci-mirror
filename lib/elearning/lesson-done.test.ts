// @vitest-environment node
/**
 * GHI MỘT BÀI LÀ XONG — nguồn sự thật duy nhất.
 *
 * Tệp này giữ một luật đã bị CHÉP BA LẦN rồi trôi khỏi nhau: guard `REVOKED`.
 * `cuonTienDoKhoa` không có nhánh `REVOKED` — đủ bài `DONE` là nó trả `COMPLETED`.
 * Đường nào quên tự chặn sẽ biến người đã bị rút khỏi khoá thành người "hoàn thành"
 * nó, trên báo cáo tuân thủ gửi thẳng quản lý trực tiếp, có ghi tên.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ghiXongBai } from "@/lib/elearning/lesson-done";

const h = vi.hoisted(() => ({
  cuon: vi.fn<() => Promise<unknown>>(async () => ({})),
}));
vi.mock("@/lib/elearning/rollup", () => ({ cuonKhoaSauKhiXongBai: h.cuon }));

const NOW = new Date("2026-08-26T09:00:00.000Z");

type Ban = {
  ghiDanh: unknown;
  tienDoCu: { verifiedAt: Date | null } | null;
  upsert: ReturnType<typeof vi.fn<(a: unknown) => Promise<unknown>>>;
};
let b: Ban;

const dbGia = () =>
  ({
    trnEnrollment: { findFirst: vi.fn(async () => b.ghiDanh) },
    trnLessonProgress: {
      findUnique: vi.fn(async () => b.tienDoCu),
      upsert: b.upsert,
    },
  }) as never;

const goi = () =>
  ghiXongBai(dbGia(), {
    enrollmentId: "en1",
    lessonId: "b1",
    userId: "u1",
    now: NOW,
  });

beforeEach(() => {
  vi.clearAllMocks();
  b = {
    ghiDanh: { id: "en1", status: "IN_PROGRESS" },
    tienDoCu: null,
    upsert: vi.fn(async (_a: unknown) => ({})),
  };
});

describe("🔴 lượt ghi danh ĐÃ THU HỒI", () => {
  it("KHÔNG ghi tiến độ và KHÔNG cuộn lên cấp khoá", async () => {
    // Đây là cả lý do tệp này tồn tại. Không có guard thì người bị rút khỏi khoá
    // bỗng "hoàn thành" nó — không lỗi, không cảnh báo.
    b.ghiDanh = { id: "en1", status: "REVOKED" };
    const r = await goi();
    expect(r).toEqual({ ghi: false, vi: "THU_HOI" });
    expect(b.upsert).not.toHaveBeenCalled();
    expect(h.cuon).not.toHaveBeenCalled();
  });

  it("nói RÕ lý do, để chỗ gọi báo lại đúng người", async () => {
    b.ghiDanh = { id: "en1", status: "REVOKED" };
    const r = await goi();
    expect(r.ghi === false && r.vi).toBe("THU_HOI");
  });

  it("không có lượt ghi danh ⇒ lý do KHÁC, không gộp với thu hồi", async () => {
    // Hai ca này cần hai câu nói khác nhau: một là "bạn bị rút khỏi khoá", một là
    // "dữ liệu lệch, báo kỹ thuật".
    b.ghiDanh = null;
    const r = await goi();
    expect(r).toEqual({ ghi: false, vi: "KHONG_CO_GHI_DANH" });
    expect(b.upsert).not.toHaveBeenCalled();
  });
});

describe("ghi lần ĐẦU", () => {
  it("đặt `verifiedAt` + `completedAt`, và cuộn lên cấp khoá", async () => {
    const r = await goi();
    expect(r).toEqual({ ghi: true, vuaXongLanDau: true });
    const arg = b.upsert.mock.calls[0]![0] as {
      update: { verifiedAt?: Date };
      create: { verifiedAt: Date; status: string };
    };
    expect(arg.update.verifiedAt).toEqual(NOW);
    expect(arg.create.status).toBe("DONE");
    expect(h.cuon).toHaveBeenCalledTimes(1);
  });
});

describe("🔴 gọi LẦN HAI — idempotent", () => {
  beforeEach(() => {
    b.tienDoCu = { verifiedAt: new Date("2026-07-01T00:00:00.000Z") };
  });

  it("KHÔNG đẩy mốc `verifiedAt` về sau", async () => {
    // Đẩy mốc là biến một bài nộp ĐÚNG HẠN thành nộp TRỄ, chỉ vì người ta mở lại
    // bài vào tháng sau.
    await goi();
    const arg = b.upsert.mock.calls[0]![0] as {
      update: Record<string, unknown>;
    };
    expect(arg.update.verifiedAt).toBeUndefined();
    expect(arg.update.completedAt).toBeUndefined();
    expect(arg.update.status).toBe("DONE");
  });

  it("KHÔNG cuộn lại lên cấp khoá", async () => {
    // Cuộn mỗi lần làm lại là ba câu đếm cho một việc đã xong, và một lời chúc
    // mừng mới mỗi lần trong hộp thư người học.
    const r = await goi();
    expect(r).toEqual({ ghi: true, vuaXongLanDau: false });
    expect(h.cuon).not.toHaveBeenCalled();
  });

  it("vẫn cập nhật `lastActivityAt` — họ có mở bài thật", async () => {
    await goi();
    const arg = b.upsert.mock.calls[0]![0] as { update: { lastActivityAt: Date } };
    expect(arg.update.lastActivityAt).toEqual(NOW);
  });
});

describe("khoá theo ĐÚNG cặp lượt-ghi-danh × bài", () => {
  it("dùng khoá tổ hợp, không dò theo một cột", async () => {
    // Dò theo `lessonId` trần là ghi "đã xong" vào lượt ghi danh của người khác
    // cùng học bài đó.
    await goi();
    const arg = b.upsert.mock.calls[0]![0] as {
      where: { enrollmentId_lessonId: { enrollmentId: string; lessonId: string } };
    };
    expect(arg.where.enrollmentId_lessonId).toEqual({
      enrollmentId: "en1",
      lessonId: "b1",
    });
  });
});
