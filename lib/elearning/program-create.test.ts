// @vitest-environment node
/**
 * EL-08 — tạo chương trình + phiếu nhu cầu, chạy qua `runAction` thật.
 *
 * Luật §8.1 ("không được tạo chương trình nếu không gắn phiếu nhu cầu đã duyệt")
 * là lý do tồn tại của cả bảng `TrnTrainingNeed`. Nếu nó không được thi hành ở
 * đây thì bảng kia chỉ là một cái form không ai bắt buộc điền.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  can: vi.fn(() => true),
  audit: vi.fn(async () => undefined),
  need: null as unknown,
  lonNhat: null as unknown,
  taoProgram: vi.fn(async (_a: { data: Record<string, unknown> }) => ({
    id: "p1",
    code: "SR.DT.KD.2026.001",
  })),
  demNeed: vi.fn(async () => 0),
  needTrung: null as unknown,
  taoNeed: vi.fn(async (_a: { data: Record<string, unknown> }) => ({
    id: "n1",
    code: "NC.2026.001",
  })),
  capNhatNeed: vi.fn(async (_a: { where: unknown; data: Record<string, unknown> }) => ({})),
}));

vi.mock("@/lib/auth/can", () => ({ can: h.can }));
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: h.audit }));
vi.mock("@/lib/db-scope", () => ({
  scopedDb: () => ({
    trnTrainingNeed: {
      findFirst: vi.fn(async () => h.need),
      findUnique: vi.fn(async () => h.needTrung),
      count: h.demNeed,
      create: h.taoNeed,
      update: h.capNhatNeed,
    },
    trnProgram: {
      findFirst: vi.fn(async () => h.lonNhat),
      create: h.taoProgram,
    },
  }),
}));

import { runAction } from "@/lib/actions/factory";
import { cauHinhTaoChuongTrinh } from "@/lib/elearning/program-create";
import {
  cauHinhTaoPhieuNhuCau,
  cauHinhDuyetPhieuNhuCau,
} from "@/lib/elearning/training-need";

const actor = (id = "u-dt") =>
  ({
    userId: id,
    isSuperAdmin: false,
    isHoLevel: true,
    orgRoles: [],
    permissions: [],
    visibleCenterIds: [],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  }) as unknown as Parameters<typeof runAction>[1];

const CO_BAN = {
  title: "An toàn lớp học",
  objectives: ["Nêu 5 rủi ro", "Xử lý sự cố", "Ghi biên bản"],
  primaryFunctionTag: "SALE" as const,
  functionTags: ["SALE"] as const,
  levelTags: ["L1"] as const,
  stageTag: "NEW_HIRE" as const,
  durationTag: "S" as const,
  natureTag: "RECOMMENDED" as const,
  formatTag: "ELEARNING" as const,
  securityTag: "INTERNAL" as const,
  contentOwnerUserId: "u-chu",
  needExemptReason: "Khoá thử nghiệm nội bộ, chưa có phiếu",
};

const tao = (input: Record<string, unknown> = {}) =>
  runAction(cauHinhTaoChuongTrinh, actor(), { ...CO_BAN, ...input }, {
    actorName: "Đào tạo",
  });

const duLieu = () => h.taoProgram.mock.calls[0]?.[0].data;

beforeEach(() => {
  h.need = null;
  h.lonNhat = null;
  h.needTrung = null;
  h.can.mockReturnValue(true);
  h.taoProgram.mockClear();
  h.taoNeed.mockClear();
  h.capNhatNeed.mockClear();
  h.demNeed.mockResolvedValue(0);
  h.taoProgram.mockResolvedValue({ id: "p1", code: "SR.DT.KD.2026.001" });
});

describe("§8.1 — phiếu nhu cầu đã duyệt, hoặc lý do miễn", () => {
  it("có lý do miễn ⇒ tạo được", async () => {
    const { res } = await tao();
    expect(res.ok).toBe(true);
  });

  it("không phiếu, không lý do ⇒ TỪ CHỐI", async () => {
    const { res } = await tao({ needExemptReason: null });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NEED_REQUIRED");
    expect(h.taoProgram).not.toHaveBeenCalled();
  });

  it("phiếu CHƯA duyệt ⇒ từ chối", async () => {
    // Chấp nhận phiếu chưa duyệt là biến "phải có phiếu ĐÃ DUYỆT" thành "phải có
    // ai đó đã gõ một cái phiếu".
    h.need = { id: "n1", status: "NEW" };
    const { res } = await tao({ needId: "n1", needExemptReason: null });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NEED_NOT_APPROVED");
  });

  it("phiếu ĐÃ duyệt ⇒ tạo được", async () => {
    h.need = { id: "n1", status: "APPROVED" };
    const { res } = await tao({ needId: "n1", needExemptReason: null });
    expect(res.ok).toBe(true);
    expect(duLieu()?.needId).toBe("n1");
  });

  it("gắn phiếu KHÔNG tồn tại ⇒ từ chối, không im lặng bỏ qua", async () => {
    h.need = null;
    const { res } = await tao({ needId: "khong-co", needExemptReason: null });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_FOUND");
  });
});

describe("ràng buộc giữa các thẻ", () => {
  it("khoá TUÂN THỦ mà thiếu số tháng hiệu lực ⇒ từ chối", async () => {
    // Không có hạn tái chứng nhận thì bằng chứng "đã đào tạo" sống mãi — đúng
    // thứ mà luật tuân thủ sinh ra để chống.
    const { res } = await tao({ natureTag: "MANDATORY_COMPLIANCE" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.field).toBe("validityMonths");
  });

  it("khoá tuân thủ CÓ số tháng ⇒ tạo được", async () => {
    const { res } = await tao({ natureTag: "MANDATORY_COMPLIANCE", validityMonths: 12 });
    expect(res.ok).toBe(true);
  });

  it("chức năng chính không nằm trong tập chức năng ⇒ từ chối", async () => {
    // Lệch nhau thì mã chương trình nói một đằng, bộ lọc theo thẻ trả một nẻo.
    const { res } = await tao({ primaryFunctionTag: "HR", functionTags: ["SALE"] });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.field).toBe("primaryFunctionTag");
  });

  it("thiếu người chịu trách nhiệm nội dung ⇒ từ chối", async () => {
    const { res } = await tao({ contentOwnerUserId: "" });
    expect(res.ok).toBe(false);
  });

  it("mục tiêu ít hơn 3 hoặc nhiều hơn 5 ⇒ từ chối", async () => {
    expect((await tao({ objectives: ["a", "b"] })).res.ok).toBe(false);
    expect((await tao({ objectives: ["a", "b", "c", "d", "e", "f"] })).res.ok).toBe(false);
  });
});

describe("sinh số thứ tự", () => {
  it("chưa có chương trình nào ⇒ bắt đầu từ 1", async () => {
    await tao();
    expect(duLieu()?.seq).toBe(1);
    expect(duLieu()?.code).toBe("SR.DT.KD.2026.001");
  });

  it("đã có số 7 ⇒ số kế tiếp là 8", async () => {
    h.lonNhat = { seq: 7 };
    await tao();
    expect(duLieu()?.seq).toBe(8);
  });

  it("VA KHOÁ một lần ⇒ thử lại chứ không báo lỗi ra người dùng", async () => {
    // Hai người bấm Tạo cùng lúc là chuyện có thật. Đường đúng là đọc lại số lớn
    // nhất và thử lại, không phải ném lỗi Prisma thô ra màn hình.
    h.taoProgram.mockRejectedValueOnce(new Error("Unique constraint failed"));
    const { res } = await tao();
    expect(res.ok).toBe(true);
    expect(h.taoProgram).toHaveBeenCalledTimes(2);
  });

  it("va khoá mãi ⇒ báo lỗi có nghĩa, không treo", async () => {
    h.taoProgram.mockRejectedValue(new Error("Unique constraint failed"));
    const { res } = await tao();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("CONFLICT");
  });
});

describe("phiếu nhu cầu: ai đề nghị, ai duyệt", () => {
  const duyet = (id: string, needId = "n1") =>
    runAction(cauHinhDuyetPhieuNhuCau, actor(id), { needId }, {
      actorName: "Quản lý",
      reason: "Đúng nhu cầu quý này",
    });

  it("người đề nghị KHÔNG tự duyệt phiếu của mình", async () => {
    // Đây là điểm duy nhất của luồng có tính kiểm soát; bỏ nó đi thì "phải có
    // phiếu đã duyệt" chỉ còn là một thao tác bấm thêm một nút.
    h.need = { id: "n1", status: "NEW", requesterUserId: "u-a", code: "NC.2026.001" };
    const { res } = await duyet("u-a");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("SELF_APPROVAL");
    expect(h.capNhatNeed).not.toHaveBeenCalled();
  });

  it("người khác duyệt thì được", async () => {
    h.need = { id: "n1", status: "NEW", requesterUserId: "u-a", code: "NC.2026.001" };
    const { res } = await duyet("u-b");
    expect(res.ok).toBe(true);
    expect(h.capNhatNeed.mock.calls[0]?.[0].data.approvedByUserId).toBe("u-b");
  });

  it("duyệt LẠI phiếu đã duyệt ⇒ từ chối, không ghi đè dấu vết", async () => {
    // Ghi đè `approvedByUserId`/`approvedAt` là xoá dấu vết ai duyệt THẬT SỰ.
    h.need = { id: "n1", status: "APPROVED", requesterUserId: "u-a", code: "NC.2026.001" };
    const { res } = await duyet("u-b");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("ALREADY_DONE");
  });

  it("duyệt bắt buộc nhập lý do", async () => {
    h.need = { id: "n1", status: "NEW", requesterUserId: "u-a", code: "NC.2026.001" };
    const { res } = await runAction(
      cauHinhDuyetPhieuNhuCau,
      actor("u-b"),
      { needId: "n1" },
      { actorName: "Quản lý", reason: null },
    );
    expect(res.ok).toBe(false);
  });

  it("tạo phiếu: quý dự kiến phải đúng dạng `2026-Q3`", async () => {
    const co = {
      title: "Cần đào tạo tư vấn",
      targetGroupText: "Tư vấn viên mới",
      reason: "Tỉ lệ chốt thấp ở nhóm mới vào",
      expectedOutcome: "Nâng tỉ lệ chốt lên 30%",
    };
    const xau = await runAction(
      cauHinhTaoPhieuNhuCau,
      actor(),
      { ...co, proposedQuarter: "quý 3" },
      { actorName: "NV" },
    );
    expect(xau.res.ok).toBe(false);

    const tot = await runAction(
      cauHinhTaoPhieuNhuCau,
      actor(),
      { ...co, proposedQuarter: "2026-Q3" },
      { actorName: "NV" },
    );
    expect(tot.res.ok).toBe(true);
  });
});
