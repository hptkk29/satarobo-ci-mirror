// @vitest-environment node
/**
 * ADR-0001 (phương án A) — KHÔNG TỰ QUYẾT trên hồ sơ của chính mình.
 *
 * Bốn lớp, từ HÀNH VI tới NGUỒN:
 *  1. Hàm dùng chung: trùng ⇒ `SELF_APPROVAL`, khác ⇒ im lặng, KHÔNG miễn theo vai.
 *  2. Từng hành động trong sáu hành động mới được chặn: tự quyết ⇒ `SELF_APPROVAL` + KHÔNG ghi gì;
 *     ĐỐI CHỨNG DƯƠNG (luật 11) — người khác quyết thì đi qua cổng và tới đúng lỗi/ghi kế tiếp.
 *  3. LƯỚI NGUỒN: lời gọi nằm TRƯỚC phép ghi đầu tiên (`return` không rollback — luật rollback CLAUDE.md).
 *  4. MA TRẬN: mọi `cauHinh*` được xuất ở lib/elearning đều có mặt trong bảng phân loại bên dưới — thêm hành động
 *     mới mà quên phân loại là đỏ, buộc người thêm quyết "hành động này có chủ thể là một người cụ thể không".
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ActionError } from "@/lib/actions/factory";

const h = vi.hoisted(() => ({
  ghiXong: vi.fn(async () => undefined),
  cuon: vi.fn(async () => undefined),
  capChungNhanChoLuot: vi.fn(async () => ({ ok: false as const, lyDo: "chưa đủ điều kiện" })),
}));
vi.mock("@/lib/elearning/exam-taking", () => ({ ghiXongBaiThi: h.ghiXong }));
vi.mock("@/lib/elearning/rollup", () => ({ cuonKhoaSauKhiXongBai: h.cuon }));
vi.mock("@/lib/elearning/_handlers/issue-certificate", () => ({ capChungNhanChoLuot: h.capChungNhanChoLuot }));

import { assertKhongTuQuyet } from "@/lib/elearning/self-decision";
import { cauHinhChamLuotThi } from "@/lib/elearning/exam-manual-grading";
import { cauHinhChamBaiTap } from "@/lib/elearning/task-grading";
import { cauHinhMoKhoaThi } from "@/lib/elearning/exam-unlock";
import { cauHinhQuyetCo } from "@/lib/elearning/watch-flag-appeal";
import { cauHinhCapChungNhanTay } from "@/lib/elearning/certificate-issue-manual";
import { cauHinhDiemDanhBuoi } from "@/lib/elearning/equivalence";
import { cauHinhDuyetPhieuNhuCau } from "@/lib/elearning/training-need";

const NGUOI_QUYET = "gv1";
const actor = { userId: NGUOI_QUYET } as never;

async function batLoi(p: Promise<unknown>): Promise<ActionError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ActionError) return e;
    throw e;
  }
  throw new Error("phải ném ActionError");
}

/** DB mà hễ chạm vào là ném — chứng minh cổng đứng TRƯỚC mọi truy vấn. */
const dbCam = () =>
  new Proxy({}, { get: (_t, p) => { throw new Error(`chạm db.${String(p)} trước cổng tự quyết`); } }) as never;

beforeEach(() => vi.clearAllMocks());

describe("hàm dùng chung", () => {
  it("trùng người ⇒ ném SELF_APPROVAL, mang đúng thông điệp và field", () => {
    expect(() => assertKhongTuQuyet("a", "a", "câu chặn", "userId")).toThrowError(
      expect.objectContaining({ code: "SELF_APPROVAL", message: "câu chặn", field: "userId" }),
    );
  });
  it("ĐỐI CHỨNG DƯƠNG: khác người ⇒ không ném", () => {
    expect(() => assertKhongTuQuyet("a", "b", "x")).not.toThrow();
  });
  it("hàm KHÔNG nhận vai/actor ⇒ không thể có nhánh 'admin đi qua' (chữ ký chỉ hai id + câu chữ)", () => {
    expect(assertKhongTuQuyet.length).toBeGreaterThanOrEqual(3);
    expect(assertKhongTuQuyet.toString()).not.toMatch(/role|SUPER_ADMIN|isAdmin/i);
  });
});

describe("🔴 chấm lượt thi tự luận", () => {
  const dbVoi = (luot: Record<string, unknown>) => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const upsert = vi.fn(async () => ({}));
    const tx = vi.fn(async (fn: (t: unknown) => unknown) => fn({ trnExamAttempt: { updateMany }, trnExamAnswer: { upsert } }));
    const db = {
      trnExamAttempt: { findFirst: vi.fn(async () => luot), updateMany },
      trnExamQuestion: { findMany: vi.fn(async () => []) },
      trnExamAnswer: { findMany: vi.fn(async () => []), upsert },
      trnEnrollment: { findFirst: vi.fn(async () => null) },
      $transaction: tx,
    };
    return { db: db as never, updateMany, upsert, tx };
  };
  const goi = (db: never) =>
    cauHinhChamLuotThi.handler({ db, actor, input: { attemptId: "lt1", diem: [{ examQuestionId: "eq1", score: 1 }] } } as never);
  const luot = (userId: string, status = "PENDING_GRADE") => ({
    id: "lt1", examId: "de1", userId, enrollmentId: "en1", status, attemptNo: 1, exam: { passScore: 6 },
  });

  it("tự chấm bài thi của mình ⇒ SELF_APPROVAL, không ghi gì", async () => {
    const t = dbVoi(luot(NGUOI_QUYET));
    const e = await batLoi(goi(t.db));
    expect(e.code).toBe("SELF_APPROVAL");
    expect(t.updateMany).not.toHaveBeenCalled();
    expect(t.upsert).not.toHaveBeenCalled();
    expect(t.tx).not.toHaveBeenCalled();
  });
  it("ĐỐI CHỨNG DƯƠNG: bài của người khác đi qua cổng tới kiểm tra trạng thái kế tiếp", async () => {
    const e = await batLoi(goi(dbVoi(luot("u1", "GRADED")).db));
    expect(e.code).toBe("LUOT_KHONG_CHO_CHAM");
  });
});

describe("🔴 chấm bài tập", () => {
  const dbVoi = (lan: Record<string, unknown>) => {
    const ghi = vi.fn(async () => ({ count: 1 }));
    const db = {
      trnSubmission: { findFirst: vi.fn(async () => lan), updateMany: ghi },
      trnRubric: { findFirst: vi.fn(async () => null) },
      trnRubricScore: { upsert: ghi },
      $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn({})),
    };
    return { db: db as never, ghi };
  };
  const goi = (db: never) =>
    cauHinhChamBaiTap.handler({ db, actor, input: { submissionId: "s1", diem: [{ criterionId: "c1", levelIndex: 0 }] } } as never);
  const lan = (userId: string, status = "SUBMITTED") => ({
    id: "s1", lessonId: "l1", enrollmentId: "en1", userId, attemptNo: 1, status, rubricId: "r1", dueGradeAt: null, slaBuNgayLam: 0,
  });

  it("tự chấm bài nộp của mình ⇒ SELF_APPROVAL, không ghi gì", async () => {
    const t = dbVoi(lan(NGUOI_QUYET));
    expect((await batLoi(goi(t.db))).code).toBe("SELF_APPROVAL");
    expect(t.ghi).not.toHaveBeenCalled();
  });
  it("ĐỐI CHỨNG DƯƠNG: bài của người khác đi qua cổng", async () => {
    expect((await batLoi(goi(dbVoi(lan("u1", "GRADED")).db))).code).toBe("LUOT_KHONG_CHO_CHAM");
  });
});

describe("🔴 mở khoá thi lại", () => {
  const goi = (db: never, userId: string) =>
    cauHinhMoKhoaThi.handler({ db, actor, input: { examId: "de1", userId, reason: "lý do đủ dài để qua" } } as never);

  it("tự mở khoá cho mình ⇒ SELF_APPROVAL TRƯỚC cả lượt đọc đề (db không bị chạm)", async () => {
    expect((await batLoi(goi(dbCam(), NGUOI_QUYET))).code).toBe("SELF_APPROVAL");
  });
  it("ĐỐI CHỨNG DƯƠNG: mở cho người khác đi qua cổng tới kiểm tra số lượt", async () => {
    const db = {
      trnExam: { findFirst: vi.fn(async () => ({ id: "de1", title: "Đề", maxAttempts: 3 })) },
      trnExamAttempt: { count: vi.fn(async () => 1) },
      trnExamUnlock: { create: vi.fn() },
    } as never;
    expect((await batLoi(goi(db, "u1"))).code).toBe("CHUA_HET_LUOT");
  });
});

describe("🔴 quyết định cờ nghi ngờ xem", () => {
  const dbVoi = (co: Record<string, unknown>) => {
    const update = vi.fn(async () => ({}));
    return { db: { trnWatchFlag: { findFirst: vi.fn(async () => co), update } } as never, update };
  };
  const goi = (db: never) =>
    cauHinhQuyetCo.handler({ db, actor, input: { flagId: "f1", giuCo: true } } as never);
  const co = (userId: string) => ({ id: "f1", status: "APPEALED", handlerUserId: "x", ruleCode: "R1", userId });

  it("tự quyết cờ gắn lên chính mình ⇒ SELF_APPROVAL, không ghi gì", async () => {
    const t = dbVoi(co(NGUOI_QUYET));
    expect((await batLoi(goi(t.db))).code).toBe("SELF_APPROVAL");
    expect(t.update).not.toHaveBeenCalled();
  });
  it("ĐỐI CHỨNG DƯƠNG: cờ của người khác ⇒ ghi quyết định", async () => {
    const t = dbVoi(co("u1"));
    await goi(t.db);
    expect(t.update).toHaveBeenCalledTimes(1);
  });
  it("câu `select` có kéo `userId` (thiếu nó thì so `undefined === id` luôn sai ⇒ cổng vô hiệu im lặng)", async () => {
    const t = dbVoi(co("u1"));
    await goi(t.db);
    const sel = (t.db as unknown as { trnWatchFlag: { findFirst: { mock: { calls: [{ select: Record<string, boolean> }][] } } } })
      .trnWatchFlag.findFirst.mock.calls[0]![0].select;
    expect(sel.userId).toBe(true);
  });
});

describe("🔴 cấp chứng nhận bằng tay", () => {
  const goi = (db: never) =>
    cauHinhCapChungNhanTay.handler({ db, actor, input: { enrollmentId: "en1" }, reason: "lý do" } as never);
  const gd = (userId: string | null) => ({
    id: "en1", userId, status: "COMPLETED", completedAt: new Date(), verifiedAt: null, revokedAt: null,
  });
  const dbVoi = (g: unknown) => {
    const update = vi.fn(async () => ({}));
    return { db: { trnEnrollment: { findFirst: vi.fn(async () => g), update } } as never, update };
  };

  it("tự cấp cho chính mình ⇒ SELF_APPROVAL và KHÔNG đóng dấu verifiedAt (cổng đứng trước phép update)", async () => {
    const t = dbVoi(gd(NGUOI_QUYET));
    expect((await batLoi(goi(t.db))).code).toBe("SELF_APPROVAL");
    expect(t.update).not.toHaveBeenCalled();
    expect(h.capChungNhanChoLuot).not.toHaveBeenCalled();
  });
  it("ĐỐI CHỨNG DƯƠNG: cấp cho người khác ⇒ đóng dấu và đi tới lõi cấp", async () => {
    const t = dbVoi(gd("u1"));
    const e = await batLoi(goi(t.db));
    expect(e.code).toBe("VALIDATION"); // lõi cấp (giả lập) từ chối vì lý do khác — nghĩa là cổng đã cho qua
    expect(t.update).toHaveBeenCalledTimes(1);
    expect(h.capChungNhanChoLuot).toHaveBeenCalledTimes(1);
  });
});

describe("🔴 điểm danh buổi trực tiếp", () => {
  const dbVoi = (userId: string) => {
    const upsert = vi.fn(async () => ({}));
    return {
      db: {
        trnLesson: { findFirst: vi.fn(async () => ({ id: "l1", kind: "LIVE_SESSION", title: "Buổi 1", module: { courseId: "c1" } })) },
        trnEnrollment: { findFirst: vi.fn(async () => ({ id: "en1", userId, courseId: "c1" })) },
        trnLessonProgress: { upsert },
      } as never,
      upsert,
    };
  };
  const goi = (db: never) =>
    cauHinhDiemDanhBuoi.handler({ db, actor, input: { lessonId: "l1", enrollmentId: "en1", daDu: true } } as never);

  it("tự điểm danh cho mình ⇒ SELF_APPROVAL, không ghi tiến độ, không cuộn khoá", async () => {
    const t = dbVoi(NGUOI_QUYET);
    expect((await batLoi(goi(t.db))).code).toBe("SELF_APPROVAL");
    expect(t.upsert).not.toHaveBeenCalled();
    expect(h.cuon).not.toHaveBeenCalled();
  });
  it("ĐỐI CHỨNG DƯƠNG: điểm danh người khác ⇒ ghi tiến độ và cuộn khoá", async () => {
    const t = dbVoi("u1");
    await goi(t.db);
    expect(t.upsert).toHaveBeenCalledTimes(1);
    expect(h.cuon).toHaveBeenCalledTimes(1);
  });
});

describe("🔴 duyệt phiếu nhu cầu (tiền lệ đã chuyển sang hàm dùng chung)", () => {
  const dbVoi = (requesterUserId: string) => {
    const update = vi.fn(async () => ({}));
    return {
      db: { trnTrainingNeed: { findFirst: vi.fn(async () => ({ id: "n1", status: "NEW", requesterUserId, code: "PN-1" })), update } } as never,
      update,
    };
  };
  const goi = (db: never) => cauHinhDuyetPhieuNhuCau.handler({ db, actor, input: { needId: "n1" }, reason: "lý do" } as never);
  it("người đề nghị tự duyệt phiếu của mình ⇒ SELF_APPROVAL, không ghi gì", async () => {
    const t = dbVoi(NGUOI_QUYET);
    expect((await batLoi(goi(t.db))).code).toBe("SELF_APPROVAL");
    expect(t.update).not.toHaveBeenCalled();
  });
  it("ĐỐI CHỨNG DƯƠNG: duyệt phiếu của người khác ⇒ ghi APPROVED", async () => {
    const t = dbVoi("u1");
    await goi(t.db);
    expect(t.update).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LƯỚI NGUỒN + MA TRẬN
// ─────────────────────────────────────────────────────────────────────────────

const GOC = process.cwd();
const chiMa = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const doc = (f: string) => chiMa(readFileSync(join(GOC, "lib/elearning", f), "utf8"));
const GHI = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g;

describe("🔴 lưới nguồn — lời gọi đứng TRƯỚC phép ghi đầu tiên của lõi", () => {
  const CAN_GOI: Array<{ tep: string; soLanGoi: number }> = [
    { tep: "exam-manual-grading.ts", soLanGoi: 1 },
    { tep: "task-grading.ts", soLanGoi: 1 },
    { tep: "exam-unlock.ts", soLanGoi: 1 },
    { tep: "watch-flag-appeal.ts", soLanGoi: 1 },
    { tep: "certificate-issue-manual.ts", soLanGoi: 1 },
    { tep: "equivalence.ts", soLanGoi: 2 }, // công nhận tương đương + điểm danh buổi trực tiếp
    { tep: "training-need.ts", soLanGoi: 1 },
  ];
  for (const { tep, soLanGoi } of CAN_GOI) {
    it(`${tep}: gọi assertKhongTuQuyet(...) đúng ${soLanGoi} lần, mỗi lần trước phép ghi kế tiếp`, () => {
      const src = doc(tep);
      const viTri = [...src.matchAll(/assertKhongTuQuyet\(\s*actor\.userId/g)].map((m) => m.index!);
      expect(viTri.length, "số lời gọi").toBe(soLanGoi);
      // Với mỗi lời gọi: từ đầu hàm xử lý (`handler: async`) chứa nó tới chính nó KHÔNG có phép ghi nào, và SAU nó
      // còn ít nhất một phép ghi (đối chứng dương: nếu tệp chẳng ghi gì thì lưới này không chứng minh được điều gì).
      const ghi = [...src.matchAll(GHI)].map((m) => m.index!);
      const dauHam = [...src.matchAll(/handler:\s*async/g)].map((m) => m.index!);
      for (const p of viTri) {
        const s = Math.max(...dauHam.filter((d) => d < p));
        expect(ghi.filter((g) => g > s && g < p), `phép ghi nằm TRƯỚC cổng trong cùng hàm xử lý`).toEqual([]);
        expect(ghi.some((g) => g > p), "có phép ghi nằm sau cổng").toBe(true);
      }
    });
  }
});

describe("🔴 giao diện nói thật — màn chấm không vẽ form cho bài của chính người xem (luật 12)", () => {
  const lap = (f: string) => chiMa(readFileSync(join(GOC, f), "utf8"));
  for (const f of [
    "app/(elearning)/elearning/cham-bai/[attemptId]/page.tsx",
    "app/(elearning)/elearning/cham-bai-tap/[submissionId]/page.tsx",
  ]) {
    it(`${f}: so nguoiHocUserId với phiên và có đường KHÔNG vẽ form`, () => {
      const src = lap(f);
      expect(src).toMatch(/luot\.nguoiHocUserId === session\.user\.id/);
      expect(src).toContain("không tự chấm được");
    });
  }
  it("hai loader trả nguoiHocUserId (thiếu nó thì trang so với undefined ⇒ luôn false ⇒ form luôn hiện)", () => {
    expect(lap("lib/elearning/exam-grading-queue.ts")).toMatch(/nguoiHocUserId: luot\.userId/);
    expect(lap("lib/elearning/task-grading-queue.ts")).toMatch(/nguoiHocUserId: lan\.userId/);
  });
});

/**
 * MA TRẬN actor × action. Khoá = mọi `export const cauHinh*` của lib/elearning.
 *  DA_CHAN        — quyết định về một người cụ thể; đã gọi `assertKhongTuQuyet`.
 *  CHU_THE_LA_MINH — thao tác của chính người học trên dữ liệu của mình (không có "người thứ hai" để đòi).
 *  CHO_OWNER      — quyết định trên hồ sơ người khác nhưng ADR-0001 CHƯA được owner chốt cho hành động này.
 *  CO_TAT         — có chủ thể nhưng cờ tính năng TẮT ⇒ chưa có đường ghi chạy (EL-21).
 *  KHONG_CO_CHU_THE — soạn nội dung / cấu hình / vận hành, không quyết định về hồ sơ của một người.
 */
type Loai = "DA_CHAN" | "CHU_THE_LA_MINH" | "CHO_OWNER" | "CO_TAT" | "KHONG_CO_CHU_THE";
const MA_TRAN: Record<string, Loai> = {
  cauHinhChamLuotThi: "DA_CHAN",
  cauHinhChamBaiTap: "DA_CHAN",
  cauHinhMoKhoaThi: "DA_CHAN",
  cauHinhQuyetCo: "DA_CHAN",
  cauHinhCapChungNhanTay: "DA_CHAN",
  cauHinhDiemDanhBuoi: "DA_CHAN",
  cauHinhCongNhanTuongDuong: "DA_CHAN",
  cauHinhDuyetPhieuNhuCau: "DA_CHAN",
  // CHỜ OWNER — xem docs/elearning/adr/0001-chong-tu-phe-duyet.md §7
  cauHinhThuHoiChungNhan: "CHO_OWNER", // thu hồi chứng nhận của CHÍNH MÌNH không đem lại lợi ích; owner chốt có chặn không
  cauHinhGiaHan: "CHO_OWNER", // thao tác LÔ trên nhiều lượt giao — "chủ thể" không đơn nhất
  cauHinhThuHoi: "CHO_OWNER", // idem
  // EL-21, ELEARNING_EVAL_LINK_ENABLED OFF. Luật hai người (người đồng duyệt ≠ người lưu) nay nằm ở `xacMinhNguoiNhanSuDuyet`
  // (nhan-su-chon.ts), KHÔNG ở lõi eval-link — nên không tính vào 8 `DA_CHAN`. Ca: tests/elearning/chon-nguoi-server.test.ts [EL-N4],
  // lưới dây nối: lib/elearning/chon-nguoi-wiring.test.ts.
  cauHinhDatMucGanDanhGia: "CO_TAT",
  // thao tác của chính người học
  cauHinhBatDauThi: "CHU_THE_LA_MINH",
  cauHinhLuuCauTraLoi: "CHU_THE_LA_MINH",
  cauHinhNopBai: "CHU_THE_LA_MINH",
  cauHinhNopBaiTap: "CHU_THE_LA_MINH",
  cauHinhKhieuNaiCo: "CHU_THE_LA_MINH",
  // không có chủ thể: soạn / cấu hình / vận hành
  cauHinhBatTatLuat: "KHONG_CO_CHU_THE",
  cauHinhDatBatBuoc: "KHONG_CO_CHU_THE",
  cauHinhDatTuanTu: "KHONG_CO_CHU_THE",
  cauHinhDongYeuCau: "KHONG_CO_CHU_THE",
  cauHinhGanDeVaoBai: "KHONG_CO_CHU_THE",
  cauHinhGanKhungVaoBai: "KHONG_CO_CHU_THE",
  cauHinhGhiNhanSuCo: "KHONG_CO_CHU_THE",
  cauHinhGoCauKhoiDe: "KHONG_CO_CHU_THE",
  cauHinhKhaiLuat: "KHONG_CO_CHU_THE",
  cauHinhKhaiYeuCau: "KHONG_CO_CHU_THE",
  cauHinhKichHoatDe: "KHONG_CO_CHU_THE",
  cauHinhKichHoatKhung: "KHONG_CO_CHU_THE",
  cauHinhLuuBaiVideo: "KHONG_CO_CHU_THE",
  // Cùng loại với `cauHinhLuuBaiVideo`: soạn nội dung của MỘT bài, không có "chủ thể thứ hai" nào
  // để tự quyết (không duyệt, không chấm, không cấp quyền học).
  cauHinhLuuBaiVideoYoutube: "KHONG_CO_CHU_THE",
  // Xem trước tác động của việc đổi nguồn bài video: CHỈ ĐỌC, cùng loại với hai đường lưu (soạn nội dung của MỘT bài, không có
  // "chủ thể thứ hai"); cổng cơ sở đi qua khoá của bài (`chanPhamViKhoa`), xem `[CS-DOI-NGUON]`/`[CSV-06]`.
  cauHinhXemTruocDoiNguon: "KHONG_CO_CHU_THE",
  cauHinhNhanBanKhoa: "KHONG_CO_CHU_THE",
  cauHinhSapThuTu: "KHONG_CO_CHU_THE",
  cauHinhSapXepDe: "KHONG_CO_CHU_THE",
  cauHinhSapXepTieuChi: "KHONG_CO_CHU_THE",
  cauHinhSoanLoTrinh: "KHONG_CO_CHU_THE",
  cauHinhSuaCauHoi: "KHONG_CO_CHU_THE",
  cauHinhSuaDe: "KHONG_CO_CHU_THE",
  cauHinhSuaKhung: "KHONG_CO_CHU_THE",
  cauHinhSuaTieuChi: "KHONG_CO_CHU_THE",
  cauHinhTaoBai: "KHONG_CO_CHU_THE",
  cauHinhTaoCauHoi: "KHONG_CO_CHU_THE",
  cauHinhTaoChuong: "KHONG_CO_CHU_THE",
  cauHinhTaoChuongTrinh: "KHONG_CO_CHU_THE",
  cauHinhTaoDe: "KHONG_CO_CHU_THE",
  cauHinhTaoKhoa: "KHONG_CO_CHU_THE",
  cauHinhTaoKhung: "KHONG_CO_CHU_THE",
  cauHinhTaoLuotGiao: "KHONG_CO_CHU_THE", // giao bài cho một tập đối tượng, không phải phê duyệt kết quả của ai
  cauHinhTaoPhieuNhuCau: "KHONG_CO_CHU_THE",
  cauHinhThemCauVaoDe: "KHONG_CO_CHU_THE",
  cauHinhThemCue: "KHONG_CO_CHU_THE",
  cauHinhThemTieuChi: "KHONG_CO_CHU_THE",
  cauHinhVongDoiKhoa: "KHONG_CO_CHU_THE",
  cauHinhXemTruoc: "KHONG_CO_CHU_THE",
  cauHinhXoaCauHoi: "KHONG_CO_CHU_THE",
  cauHinhXoaCue: "KHONG_CO_CHU_THE",
  cauHinhXoaTieuChi: "KHONG_CO_CHU_THE",
};

describe("🔴 ma trận actor × action — mọi hành động được phân loại", () => {
  const duocXuat = (() => {
    const kq: string[] = [];
    for (const f of readdirSync(join(GOC, "lib/elearning"))) {
      if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
      const src = readFileSync(join(GOC, "lib/elearning", f), "utf8");
      for (const m of src.matchAll(/^export const (cauHinh\w+)/gm)) kq.push(m[1]!);
    }
    return kq.sort();
  })();

  it("tập hành động được xuất = tập khoá của ma trận (thêm/bớt một hành động là phải phân loại)", () => {
    expect(duocXuat).toEqual(Object.keys(MA_TRAN).sort());
  });

  it("đúng 8 hành động DA_CHAN, và mỗi cái có lời gọi trong tệp xuất nó", () => {
    const daChan = Object.entries(MA_TRAN).filter(([, v]) => v === "DA_CHAN").map(([k]) => k);
    expect(daChan).toHaveLength(8);
    for (const ten of daChan) {
      const tep = readdirSync(join(GOC, "lib/elearning"))
        .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
        .find((f) => new RegExp(`^export const ${ten}\\b`, "m").test(readFileSync(join(GOC, "lib/elearning", f), "utf8")));
      expect(tep, ten).toBeDefined();
      expect(doc(tep!), ten).toContain("assertKhongTuQuyet(");
    }
  });
});
