// @vitest-environment node
/**
 * EL-05 — action gia hạn & thu hồi, chạy qua `runAction` thật.
 *
 * Nút "sự cố hệ thống" của QĐ-CDA-15 chính là gia hạn với phạm vi `LUOT_GIAO`:
 * người trực xác nhận sự cố thì gia hạn CẢ lượt giao cho mọi người, không xét
 * từng đơn. Nên nhóm case nặng nhất ở đây là nhóm "lô hỗn hợp".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  can: vi.fn(() => true),
  audit: vi.fn(async () => undefined),
  rows: [] as unknown[],
  update: vi.fn((a: unknown) => a),
  updateMany: vi.fn(async (_a: unknown) => ({ count: 0 })),
  updateAssignment: vi.fn(async (_a: unknown) => ({})),
  tx: vi.fn(async (ops: unknown[]) => ops),
}));

vi.mock("@/lib/auth/can", () => ({ can: h.can }));
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: h.audit }));
vi.mock("@/lib/db-scope", () => ({
  scopedDb: () => ({
    trnEnrollment: {
      findMany: vi.fn(async () => h.rows),
      update: h.update,
      updateMany: h.updateMany,
    },
    trnAssignment: { update: h.updateAssignment },
    $transaction: h.tx,
  }),
}));

import { runAction } from "@/lib/actions/factory";
import { cauHinhGiaHan, cauHinhThuHoi } from "@/lib/elearning/assignment-lifecycle";

const ACTOR = {
  userId: "u-truc",
  isSuperAdmin: false,
  isHoLevel: true,
  orgRoles: [],
  permissions: [],
  visibleCenterIds: [],
  visibleOrgUnitIds: [],
  grantsAllow: new Set<string>(),
  assignedClassIds: new Set<string>(),
} as unknown as Parameters<typeof runAction>[1];

const LUOT = { kieu: "LUOT_GIAO" as const, assignmentId: "a1" };
const ngay = (s: string) => new Date(`${s}T00:00:00.000Z`);

// ⚠️ Mốc "không có lý do" là `null`, KHÔNG phải `undefined`: tham số mặc định của
// JS vẫn nhận giá trị mặc định khi truyền `undefined` — bản đầu của hai case
// "không lý do" dưới đây XANH GIẢ vì đúng cái bẫy đó.
const giaHan = (input: Record<string, unknown>, reason: string | null = "Sự cố hệ thống 22/08") =>
  runAction(cauHinhGiaHan, ACTOR, { pham: LUOT, ...input }, {
    actorName: "Người trực",
    reason,
  });

const thuHoi = (reason: string | null = "Đổi phạm vi đào tạo") =>
  runAction(cauHinhThuHoi, ACTOR, { pham: LUOT }, { actorName: "Đào tạo", reason });

beforeEach(() => {
  h.rows = [{ id: "en1", status: "IN_PROGRESS", dueAt: ngay("2026-08-30") }];
  h.can.mockReturnValue(true);
  h.update.mockClear();
  h.updateMany.mockClear();
  h.updateAssignment.mockClear();
  h.audit.mockClear();
});

const duLieuUpdate = () =>
  h.update.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);

describe("LUẬT KHÔNG ĐƯỢC PHÁ — gia hạn không đụng `dueAtOriginal`", () => {
  it("không lời gọi update nào chứa `dueAtOriginal`", async () => {
    // Ghi cả hai cột thì ai được gia hạn cũng thành "đúng hạn", và chỉ số đúng
    // hạn thành thứ đo được 100% mãi mãi. Đây cũng là lý do bảng có HAI cột.
    await giaHan({ themNgay: 3 });
    expect(JSON.stringify(duLieuUpdate())).not.toContain("dueAtOriginal");
    expect(duLieuUpdate()[0]?.dueAt).toBeInstanceOf(Date);
  });

  it("ghi lý do và người gia hạn", async () => {
    await giaHan({ themNgay: 3 });
    expect(duLieuUpdate()[0]?.extensionReason).toBe("Sự cố hệ thống 22/08");
    expect(duLieuUpdate()[0]?.extendedByUserId).toBe("u-truc");
  });
});

describe("bắt buộc nhập lý do", () => {
  it("gia hạn không lý do ⇒ từ chối", async () => {
    const { res } = await giaHan({ themNgay: 3 }, null);
    expect(res.ok).toBe(false);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("thu hồi không lý do ⇒ từ chối", async () => {
    const { res } = await thuHoi(null);
    expect(res.ok).toBe(false);
    expect(h.updateMany).not.toHaveBeenCalled();
  });
});

describe("chọn MỘT trong hai kiểu gia hạn", () => {
  it("không chọn kiểu nào ⇒ từ chối", async () => {
    const { res } = await giaHan({});
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.field).toBe("denNgay");
  });

  it("chọn CẢ HAI ⇒ từ chối, không im lặng chọn hộ", async () => {
    // Im lặng chọn một bên là đoán ý người vận hành trên đúng thứ họ đang cố
    // điều khiển.
    const { res } = await giaHan({ themNgay: 3, denNgay: "2026-12-01T00:00:00.000Z" });
    expect(res.ok).toBe(false);
  });
});

describe("nút sự cố hệ thống — lô hỗn hợp", () => {
  // Luật 19 — test KHÔNG đọc đồng hồ thật. Hạn mới = max(hạn riêng, BÂY GIỜ) + n ngày, mà fixture
  // dùng ngày TUYỆT ĐỐI (30/09, 01/08, 30/08). Từ 01/10/2026 "bây giờ" vượt mọi hạn ⇒ hai dòng ra
  // CÙNG một hạn ⇒ ca "từng dòng riêng" đỏ dù mã không đổi (CI 01/10 đỏ, tệp nằm im từ 23/08).
  // Đóng băng ở ngày sự cố mà fixture mô tả; chỉ giả `Date` để promise/timer vẫn chạy thật.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-22T03:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("gia hạn từng dòng RIÊNG, không `updateMany` ép cả lô một hạn", async () => {
    // Gia hạn theo số ngày tính từ `max(hạn riêng, bây giờ)` nên mỗi dòng ra một
    // hạn khác nhau. `updateMany` sẽ ép cả lô về cùng một hạn — sai với đúng
    // nhóm mà nút này phải cứu.
    // Luật 19 — ĐÓNG BĂNG đồng hồ: fixture mang ngày TUYỆT ĐỐI, còn hàm tính từ
    // `max(hạn riêng, bây giờ)`. Để đồng hồ thật chạy thì qua 30/09/2026 cả hai dòng đều
    // lấy "bây giờ" làm mốc ⇒ cùng một hạn ⇒ ca đỏ dù mã không đổi (đã nổ 01/10/2026).
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-15T03:00:00.000Z"));
    try {
      h.rows = [
        { id: "en1", status: "IN_PROGRESS", dueAt: ngay("2026-09-30") },
        { id: "en2", status: "OVERDUE", dueAt: ngay("2026-08-01") },
      ];
      await giaHan({ themNgay: 2 });
    } finally {
      vi.useRealTimers();
    }
    expect(h.update).toHaveBeenCalledTimes(2);
    const hans = duLieuUpdate().map((d) => (d.dueAt as Date).toISOString());
    expect(new Set(hans).size).toBe(2);
  });

  it("người đã hoàn thành / không hạn bị bỏ qua và có lý do trả về", async () => {
    h.rows = [
      { id: "en1", status: "COMPLETED", dueAt: ngay("2026-08-30") },
      { id: "en2", status: "NOT_STARTED", dueAt: null },
      { id: "en3", status: "IN_PROGRESS", dueAt: ngay("2026-08-30") },
    ];
    const { res } = await giaHan({ themNgay: 3 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.soGiaHan).toBe(1);
    expect(res.data.boQua.map((b) => b.lyDo).sort()).toEqual([
      "DA_HOAN_THANH",
      "KHONG_CO_HAN",
    ]);
  });

  it("người ĐANG QUÁ HẠN được đưa lại về `IN_PROGRESS`", async () => {
    // Có hạn mới mà trạng thái vẫn OVERDUE thì cổng ghi tiến độ vẫn khoá — người
    // học thấy hạn mới nhưng vẫn không học tiếp được.
    h.rows = [{ id: "en1", status: "OVERDUE", dueAt: ngay("2026-08-01") }];
    await giaHan({ themNgay: 5 });
    expect(duLieuUpdate()[0]?.status).toBe("IN_PROGRESS");
  });

  it("không có dòng nào để gia hạn ⇒ báo lỗi, không im lặng thành công", async () => {
    h.rows = [];
    const { res } = await giaHan({ themNgay: 3 });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_FOUND");
  });
});

describe("thu hồi", () => {
  it("người đã hoàn thành KHÔNG bị thu hồi", async () => {
    // Thu hồi họ là xoá bằng chứng của một việc đã làm thật — với khoá bắt buộc,
    // là xoá luôn cơ sở để nói người này đã được đào tạo.
    h.rows = [
      { id: "en1", status: "COMPLETED", dueAt: null },
      { id: "en2", status: "IN_PROGRESS", dueAt: null },
    ];
    const { res } = await thuHoi();
    expect(res.ok).toBe(true);
    const w = h.updateMany.mock.calls[0]?.[0] as { where: { id: { in: string[] } } };
    expect(w.where.id.in).toEqual(["en2"]);
  });

  it("thu hồi cả lượt giao thì ĐÓNG luôn lượt giao", async () => {
    // Không đóng thì đường ĐỘNG đêm sau lại nở ra đúng những người vừa bị thu
    // hồi, và họ nhận thông báo giao bài ngay sau thông báo thu hồi.
    await thuHoi();
    expect(h.updateAssignment).toHaveBeenCalled();
    const a = h.updateAssignment.mock.calls[0]?.[0] as { data: { status: string } };
    expect(a.data.status).toBe("REVOKED");
  });

  it("thu hồi MỘT người thì KHÔNG đụng lượt giao", async () => {
    await runAction(
      cauHinhThuHoi,
      ACTOR,
      { pham: { kieu: "MOT_NGUOI", enrollmentId: "en1" } },
      { actorName: "Đào tạo", reason: "Chuyển bộ phận" },
    );
    expect(h.updateAssignment).not.toHaveBeenCalled();
  });
});

describe("gác quyền", () => {
  it("thiếu `elearning:assignment:extend` ⇒ từ chối và không ghi gì", async () => {
    h.can.mockReturnValue(false);
    const { res } = await giaHan({ themNgay: 3 });
    expect(res.ok).toBe(false);
    expect(h.update).not.toHaveBeenCalled();
  });
});
