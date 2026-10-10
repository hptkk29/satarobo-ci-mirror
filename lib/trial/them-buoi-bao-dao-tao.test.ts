/**
 * THÊM BUỔI TRẢI NGHIỆM MÀ KHÔNG CHỌN GIÁO VIÊN ⇒ PHẢI BÁO ĐÀO TẠO.
 *
 * ── VÌ SAO BỘ NÀY RA ĐỜI ─────────────────────────────────────────────────────────────────
 * Sự cố 13/09/2026. Chủ dự án bật thông báo đẩy, thêm một buổi học thử để thử, và không nhận
 * được gì. Truy ra: ô "Giáo viên" ở form mặc định TRỐNG, lớp trải nghiệm sinh ra đã
 * `teacherId: null`, và KHÔNG màn nào gán giáo viên cấp lớp — nên đường tự nhiên nhất của
 * người dùng là tạo ra một buổi KHÔNG AI DẠY. Nhánh đó trước đợt này im lặng tuyệt đối: không
 * chuông, không dòng đẩy, không log.
 *
 * Đó không phải lỗi của kênh đẩy. Đó là một việc cần làm mà hệ thống không nói với ai.
 *
 * ⚠️ Hàm `baoDaoTaoChoPhanCong` đã TỪNG tồn tại sẵn cho việc này và nằm chết nhiều tuần —
 * viết xong, không ai gọi, không ca nào canh. Bộ này canh đúng chỗ đó: không chỉ "hàm chạy
 * đúng" mà "hàm CÓ ĐƯỢC GỌI".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const trangThai = {
    lop: {
      id: "tc1",
      name: "Lớp trải nghiệm T7",
      centerId: "cs1",
      teacherId: null as string | null,
      roomId: null as string | null,
      status: "SCHEDULED" as string,
    },
    nguoiDaoTao: [{ id: "u_daotao" }] as { id: string }[],
  };
  const notifyStaff = vi.fn(async (_p: Record<string, unknown>) => 1);
  const userFindMany = vi.fn(async (_a: unknown) => trangThai.nguoiDaoTao);
  const userFindUnique = vi.fn(async (_a: unknown) => ({ centerId: "cs1" }));

  const mockDb = {
    trialClassV2: { findUnique: vi.fn(async (_a: unknown) => trangThai.lop) },
    user: { findUnique: userFindUnique, findMany: userFindMany },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        trialClassSession: {
          aggregate: vi.fn(async () => ({ _max: { seq: 3 } })),
          create: vi.fn(async () => ({ id: "ts_moi" })),
        },
      }),
    ),
  };
  return { trangThai, notifyStaff, userFindMany, mockDb };
});

vi.mock("@/lib/db", () => ({ db: h.mockDb }));
vi.mock("@/lib/notifications/notify", () => ({ notifyStaff: h.notifyStaff }));

import { addTrialSession } from "./service";

/** Tham số của lần `notifyStaff` gần nhất. */
function tinCuoi(): Record<string, unknown> {
  const c = h.notifyStaff.mock.calls.at(-1)?.[0];
  if (!c) throw new Error("notifyStaff chưa được gọi lần nào");
  return c;
}

const THAM_SO = {
  trialClassId: "tc1",
  date: new Date("2026-09-20T00:00:00.000Z"),
  startTime: "18:00",
  endTime: "19:30",
  actorId: "u_admin",
};

beforeEach(() => {
  vi.clearAllMocks();
  h.trangThai.lop.teacherId = null;
  h.trangThai.nguoiDaoTao = [{ id: "u_daotao" }];
  h.notifyStaff.mockResolvedValue(1);
});

describe("[TRIAL-T40] thêm buổi KHÔNG chọn giáo viên", () => {
  it("⚠️ báo Đào tạo — trước 14/09 nhánh này im lặng hoàn toàn", async () => {
    const kq = await addTrialSession({ ...THAM_SO });
    expect(kq.ok).toBe(true);
    expect(h.notifyStaff).toHaveBeenCalledTimes(1);
    expect(tinCuoi().dedupeKey).toBe("trial.cho-phan-cong:ts_moi");
  });

  it("khoá gắn theo BUỔI — sửa đi sửa lại cùng buổi không dội chuông nhiều lần", async () => {
    await addTrialSession({ ...THAM_SO });
    expect(String(tinCuoi().dedupeKey)).toContain("ts_moi");
    // Không có dấu thời gian trong khoá: một buổi chưa có GV là MỘT việc cần làm.
    expect(String(tinCuoi().dedupeKey)).not.toMatch(/\d{13}/);
  });

  it("người nhận là bộ phận Đào tạo, KHÔNG phải người vừa bấm", async () => {
    // Người bấm vừa làm việc đó, họ biết rồi. Người cần biết là người đi phân công.
    await addTrialSession({ ...THAM_SO });
    expect(tinCuoi().userIds).toEqual(["u_daotao"]);
    expect(tinCuoi().userIds).not.toContain("u_admin");
  });

  it("nội dung nói rõ LỚP và BUỔI nào — thiếu thì người nhận phải đi dò", async () => {
    await addTrialSession({ ...THAM_SO });
    expect(String(tinCuoi().body)).toContain("Lớp trải nghiệm T7");
    expect(String(tinCuoi().body)).toContain("18:00");
  });

  it("không có ai thuộc Đào tạo ⇒ không ném, buổi vẫn tạo được", async () => {
    // Chuông hỏng KHÔNG được làm hỏng việc xếp lịch.
    h.trangThai.nguoiDaoTao = [];
    const kq = await addTrialSession({ ...THAM_SO });
    expect(kq.ok).toBe(true);
    expect(h.notifyStaff).not.toHaveBeenCalled();
  });

  it("chuông NÉM cũng không làm hỏng việc tạo buổi", async () => {
    h.notifyStaff.mockRejectedValue(new Error("DB chập"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const kq = await addTrialSession({ ...THAM_SO });
    expect(kq.ok).toBe(true);
    expect(kq.sessionId).toBe("ts_moi");
  });
});

describe("[TRIAL-T41] thêm buổi CÓ chọn giáo viên", () => {
  it("báo đúng giáo viên đó, KHÔNG báo Đào tạo", async () => {
    const kq = await addTrialSession({ ...THAM_SO, teacherId: "u_gv" });
    expect(kq.ok).toBe(true);
    expect(h.notifyStaff).toHaveBeenCalledTimes(1);
    expect(tinCuoi().dedupeKey).toBe("trial-session.assigned:ts_moi");
    expect(tinCuoi().userIds).toEqual(["u_gv"]);
  });

  it("tự gán MÌNH ⇒ không báo ai cả", async () => {
    // Không tự báo mình (mã cố ý), và cũng không phải việc của Đào tạo vì buổi ĐÃ có người dạy.
    const kq = await addTrialSession({ ...THAM_SO, teacherId: "u_admin" });
    expect(kq.ok).toBe(true);
    expect(h.notifyStaff).not.toHaveBeenCalled();
  });

  it("lớp có sẵn giáo viên + để trống ô ⇒ kế thừa, báo giáo viên đó", async () => {
    h.trangThai.lop.teacherId = "u_gv_lop";
    const kq = await addTrialSession({ ...THAM_SO });
    expect(kq.ok).toBe(true);
    expect(tinCuoi().dedupeKey).toBe("trial-session.assigned:ts_moi");
  });

  it("truyền teacherId = null ⇒ CỐ Ý để trống ⇒ vẫn báo Đào tạo", async () => {
    // `undefined` nghĩa là "kế thừa của lớp"; `null` nghĩa là "buổi này chưa gán ai".
    h.trangThai.lop.teacherId = "u_gv_lop";
    await addTrialSession({ ...THAM_SO, teacherId: null });
    expect(tinCuoi().dedupeKey).toBe("trial.cho-phan-cong:ts_moi");
  });
});
