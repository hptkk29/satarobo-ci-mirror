// @vitest-environment node
/**
 * EL-06 — ghi nhận sự cố hệ thống + gia hạn cả lượt giao.
 *
 * Đường này tồn tại vì một kịch bản cụ thể của tuần đầu: 16h50 ngày hạn, video
 * không chạy trên điện thoại của bốn người. Không có nó thì cách xử duy nhất là
 * sửa tay từng dòng, và không để lại dấu vết nào.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  can: vi.fn(() => true),
  audit: vi.fn(async () => undefined),
  rows: [] as unknown[],
  taoSuCo: vi.fn(async (_a: { data: Record<string, unknown> }) => ({ id: "sc1" })),
  update: vi.fn(async (_a: { where: unknown; data: Record<string, unknown> }) => ({})),
}));

vi.mock("@/lib/auth/can", () => ({ can: h.can }));
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: h.audit }));

const fakeTx = {
  trnIncident: { create: h.taoSuCo },
  trnEnrollment: { update: h.update },
};

vi.mock("@/lib/db-scope", () => ({
  scopedDb: () => ({
    trnEnrollment: { findMany: vi.fn(async () => h.rows) },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx),
  }),
}));

import { runAction } from "@/lib/actions/factory";
import { cauHinhGhiNhanSuCo } from "@/lib/elearning/incident";

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

const ngay = (s: string) => new Date(`${s}T00:00:00.000Z`);

const CO_BAN = {
  title: "Video không chạy trên điện thoại",
  scope: "ASSIGNMENT" as const,
  assignmentId: "a1",
  extendDays: 2,
};

const chay = (input: Record<string, unknown> = {}, reason: string | null = "Người trực xác nhận") =>
  runAction(cauHinhGhiNhanSuCo, ACTOR, { ...CO_BAN, ...input }, {
    actorName: "Người trực",
    reason,
  });

beforeEach(() => {
  h.rows = [{ id: "en1", status: "OVERDUE", dueAt: ngay("2026-08-01") }];
  h.can.mockReturnValue(true);
  h.taoSuCo.mockClear();
  h.update.mockClear();
});

const duLieuSuCo = () => h.taoSuCo.mock.calls[0]?.[0].data;

describe("người xác nhận phải CÓ TÊN, lấy từ actor", () => {
  it("`confirmedByUserId` là người bấm nút", () => {
    return chay().then(() => {
      expect(duLieuSuCo()?.confirmedByUserId).toBe("u-truc");
    });
  });

  it("input KHÔNG có chỗ truyền `confirmedByUserId`", async () => {
    // Cho phép truyền vào là mở đường ghi tên người khác vào ô "ai xác nhận".
    const { res } = await runAction(
      cauHinhGhiNhanSuCo,
      ACTOR,
      { ...CO_BAN, confirmedByUserId: "u-khac" },
      { actorName: "Người trực", reason: "x" },
    );
    expect(res.ok).toBe(false);
  });
});

describe("gia hạn đi kèm, và KHÔNG đụng `dueAtOriginal`", () => {
  it("dòng quá hạn được gia hạn, tính từ bây giờ", async () => {
    const { res } = await chay();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.soGiaHan).toBe(1);
    expect(JSON.stringify(h.update.mock.calls)).not.toContain("dueAtOriginal");
  });

  it("người đang quá hạn được đưa lại `IN_PROGRESS`", async () => {
    await chay();
    expect(h.update.mock.calls[0]?.[0].data.status).toBe("IN_PROGRESS");
  });

  it("lý do ghi rõ đây là sự cố, không phải gia hạn thường", async () => {
    // Đọc sổ về sau phải phân biệt được "nới hạn vì sự cố hệ thống" với "nới hạn
    // vì người học xin" — hai chuyện khác hẳn về trách nhiệm.
    await chay();
    expect(String(h.update.mock.calls[0]?.[0].data.extensionReason)).toContain(
      "Sự cố hệ thống",
    );
  });

  it("`appliedCount` khớp số dòng thật sự gia hạn", async () => {
    h.rows = [
      { id: "en1", status: "OVERDUE", dueAt: ngay("2026-08-01") },
      { id: "en2", status: "COMPLETED", dueAt: ngay("2026-08-01") },
    ];
    await chay();
    expect(duLieuSuCo()?.appliedCount).toBe(1);
  });
});

describe("kiểm tra đầu vào", () => {
  it("phạm vi một lượt giao mà thiếu `assignmentId` ⇒ từ chối", async () => {
    const { res } = await chay({ assignmentId: null });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.field).toBe("assignmentId");
  });

  it("mốc phát hiện ở TƯƠNG LAI ⇒ từ chối", async () => {
    // Mốc ở tương lai làm mọi phép đo thời gian xử lý ra số âm.
    const mai = new Date(Date.now() + 86400000).toISOString();
    const { res } = await chay({ detectedAt: mai });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.field).toBe("detectedAt");
  });

  it("mốc phát hiện ở QUÁ KHỨ thì hợp lệ", async () => {
    // Sự cố thường được xác nhận SAU khi nó xảy ra.
    const { res } = await chay({ detectedAt: ngay("2026-08-20").toISOString() });
    expect(res.ok).toBe(true);
  });

  it("bắt buộc nhập lý do", async () => {
    const { res } = await chay({}, null);
    expect(res.ok).toBe(false);
    expect(h.taoSuCo).not.toHaveBeenCalled();
  });

  it("thiếu quyền `assignment:extend` ⇒ từ chối, không ghi sổ sự cố", async () => {
    h.can.mockReturnValue(false);
    const { res } = await chay();
    expect(res.ok).toBe(false);
    expect(h.taoSuCo).not.toHaveBeenCalled();
  });
});

describe("sổ sự cố ghi đủ để đối chiếu sau", () => {
  it("`appliedAt` đặt ngay, không để trạng thái treo", async () => {
    // Để trống rồi hẹn cập nhật sau là mở ra trạng thái "đã ghi nhận nhưng chưa
    // áp dụng" mà không có gì đảm bảo sẽ có ai đóng lại.
    await chay();
    expect(duLieuSuCo()?.appliedAt).toBeInstanceOf(Date);
  });

  it("giữ nguyên số ngày gia hạn đã chọn", async () => {
    await chay({ extendDays: 5 });
    expect(duLieuSuCo()?.extendDays).toBe(5);
  });
});
