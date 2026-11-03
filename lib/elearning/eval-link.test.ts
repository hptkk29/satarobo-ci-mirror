// @vitest-environment node
/**
 * EL-21 — mức gắn đánh giá (QĐ-CDA-06b).
 *
 * Bảng này quyết định kết quả học có ảnh hưởng LƯƠNG của người ta hay không. Mọi
 * đường sai ở đây đều sai về phía trừ tiền của một con người, nên mọi mặc định phải
 * ngả về `REPORT_ONLY`.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  cauHinhDatMucGanDanhGia,
  cauMucGan,
  mucGanHienHanh,
} from "@/lib/elearning/eval-link";

const D = (s: string) => new Date(s);
const NOW = D("2026-06-01T00:00:00Z");

describe("🔴 resolver — mọi ngả về đều là REPORT_ONLY", () => {
  it("KHÔNG có dòng cấu hình ⇒ chỉ báo cáo", () => {
    // Vắng mặt một bản ghi không bao giờ được đọc thành "cho phép trừ lương ai đó".
    expect(mucGanHienHanh(null, NOW)).toBe("REPORT_ONLY");
  });

  it("LINKED và đã tới ngày ⇒ có liên kết", () => {
    expect(
      mucGanHienHanh({ mode: "LINKED", effectiveFrom: D("2026-05-01") }, NOW),
    ).toBe("LINKED");
  });

  it("LINKED nhưng CHƯA tới ngày ⇒ vẫn chỉ báo cáo", () => {
    // Bật trước, áp sau: người ta phải được báo trước khi luật đổi.
    expect(
      mucGanHienHanh({ mode: "LINKED", effectiveFrom: D("2026-12-01") }, NOW),
    ).toBe("REPORT_ONLY");
  });

  it("🔴 LINKED mà `effectiveFrom` NULL ⇒ vẫn chỉ báo cáo", () => {
    // Zod đã chặn ở đường ghi, nhưng đường ĐỌC không được tin rằng đường ghi luôn
    // đúng: dữ liệu cũ, seed tay, hay một migration đều có thể để lại dòng như vậy.
    expect(mucGanHienHanh({ mode: "LINKED", effectiveFrom: null }, NOW)).toBe(
      "REPORT_ONLY",
    );
  });

  it("đúng ngày hiệu lực ⇒ đã có liên kết", () => {
    expect(mucGanHienHanh({ mode: "LINKED", effectiveFrom: NOW }, NOW)).toBe("LINKED");
  });
});

describe("câu giải thích — cột rỗng phải có lý do", () => {
  it("chưa bật thì nói rõ chỉ báo cáo nghĩa là gì", () => {
    // "Chỉ báo cáo" KHÔNG có nghĩa là im lặng — người vận hành hay hiểu nhầm rằng
    // bật chế độ này là tắt luôn nhắc nhở.
    const c = cauMucGan("REPORT_ONLY", null);
    expect(c).toContain("vẫn gửi thông báo");
    expect(c).toContain("không leo thang");
  });

  it("đã bật nhưng chưa tới ngày thì nói RA ngày đó", () => {
    const c = cauMucGan("REPORT_ONLY", {
      mode: "LINKED",
      effectiveFrom: D("2026-12-01T00:00:00Z"),
    });
    expect(c).toContain("chưa tới ngày");
    expect(c).toContain("2026");
  });
});

describe("cấu hình action", () => {
  it("dùng `program:manage` — KHÔNG mở khoá quyền thứ 18", () => {
    // Bộ khoá của module giữ đúng 17. Kiểm soát của màn này nằm ở HAI CHỮ KÝ trong
    // bản ghi (Nhân sự + Đào tạo), không ở một khoá mới.
    expect(cauHinhDatMucGanDanhGia.permission).toBe("elearning:program:manage");
  });

  it("BẮT BUỘC lý do — luật 3 đòi audit có cũ/mới và lý do", () => {
    expect(cauHinhDatMucGanDanhGia.requireReason).toBe(true);
  });

  it("REPORT_ONLY lưu được mà không cần gì thêm", () => {
    const r = cauHinhDatMucGanDanhGia.schema.safeParse({
      programId: "p1",
      mode: "REPORT_ONLY",
    });
    expect(r.success).toBe(true);
  });

  it("🔴 LINKED thiếu bất kỳ thứ nào trong SÁU thứ ⇒ bác", () => {
    const day = {
      programId: "p1",
      mode: "LINKED" as const,
      criteria: ["ON_TIME" as const],
      weightOnTime: 100,
      effectiveFrom: D("2026-12-01"),
      decisionDocCode: "SR.QD.231/PL-01",
      decisionDocEffectiveAt: D("2026-11-01"),
      hrApprovedByUserId: "u-hr",
    };
    expect(cauHinhDatMucGanDanhGia.schema.safeParse(day).success).toBe(true);

    for (const bo of [
      "decisionDocCode",
      "decisionDocEffectiveAt",
      "hrApprovedByUserId",
      "effectiveFrom",
    ] as const) {
      const thieu = { ...day, [bo]: null };
      expect(
        cauHinhDatMucGanDanhGia.schema.safeParse(thieu).success,
        `thiếu ${bo} mà vẫn lưu được`,
      ).toBe(false);
    }
    expect(
      cauHinhDatMucGanDanhGia.schema.safeParse({ ...day, criteria: [] }).success,
    ).toBe(false);
  });

  it("tổng trọng số phải bằng 100", () => {
    const r = cauHinhDatMucGanDanhGia.schema.safeParse({
      programId: "p1",
      mode: "LINKED",
      criteria: ["ON_TIME", "EXAM_SCORE"],
      weightOnTime: 40,
      weightExamScore: 40,
      effectiveFrom: D("2026-12-01"),
      decisionDocCode: "SR.QD.231/PL-01",
      decisionDocEffectiveAt: D("2026-11-01"),
      hrApprovedByUserId: "u-hr",
    });
    expect(r.success).toBe(false);
  });

  it("ngày áp dụng KHÔNG được sớm hơn ngày hiệu lực quyết định", () => {
    const r = cauHinhDatMucGanDanhGia.schema.safeParse({
      programId: "p1",
      mode: "LINKED",
      criteria: ["ON_TIME"],
      weightOnTime: 100,
      effectiveFrom: D("2026-10-01"),
      decisionDocCode: "SR.QD.231/PL-01",
      decisionDocEffectiveAt: D("2026-11-01"),
      hrApprovedByUserId: "u-hr",
    });
    expect(r.success).toBe(false);
  });
});

describe("🔴 cờ ELEARNING_EVAL_LINK_ENABLED — OFF ⇒ action bị chặn, không ghi gì", () => {
  afterEach(() => {
    delete process.env.ELEARNING_EVAL_LINK_ENABLED;
  });

  const chay = (db: unknown) =>
    cauHinhDatMucGanDanhGia.handler({
      db,
      actor: { userId: "u-dt" },
      input: { programId: "p1", mode: "REPORT_ONLY" },
    } as never);

  it("cờ OFF ⇒ NOT_FOUND và KHÔNG đụng DB", async () => {
    delete process.env.ELEARNING_EVAL_LINK_ENABLED;
    const findFirst = vi.fn();
    const create = vi.fn();
    const db = { trnProgram: { findFirst }, trnEvalLinkConfig: { findFirst, create, update: create } };
    await expect(chay(db)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(findFirst).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("ĐỐI CHỨNG: cờ ON ⇒ đi tiếp tới DB (không bị chặn oan)", async () => {
    process.env.ELEARNING_EVAL_LINK_ENABLED = "true";
    const findFirst = vi.fn().mockResolvedValue(null); // chương trình không tồn tại
    const db = { trnProgram: { findFirst }, trnEvalLinkConfig: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() } };
    await expect(chay(db)).rejects.toMatchObject({ code: "NOT_FOUND", field: "programId" });
    expect(findFirst).toHaveBeenCalledTimes(1);
  });
});
