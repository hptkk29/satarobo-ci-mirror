// [KCC-*] Kết cục của case trial (chủ dự án 21/10/2026): không bé nào có mặt ⇒ TỰ HUỶ, GV không công.
// Tầng DB (completeTrialSession · rescheduleTrialEnrollment · goHocVienKhoiCase · unenrollLeadChild ghi CANCELLED thật):
// `tests/e2e/r7/trial-case-gates.spec.ts` [TCG-16..20] + [TRIAL-EMPTY-01..10].
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LY_DO_HUY_CASE_DA_GO,
  LY_DO_HUY_CASE_DA_RUT,
  LY_DO_HUY_CASE_TRONG,
  LY_DO_HUY_KHONG_AI_CO_MAT,
  TRANG_THAI_GHI_DANH_HIEU_LUC,
  canHuyCaseTrong,
  ketCucKhiHoanTat,
  laCaseTrongQuaHan,
  laGhiDanhHieuLuc,
} from "./ket-cuc-case";

describe("[KCC] ketCucKhiHoanTat", () => {
  it("[KCC-01] có ≥1 bé có mặt ⇒ hoàn tất; 0 ⇒ huỷ kèm lý do", () => {
    expect(ketCucKhiHoanTat({ soCoMat: 1 })).toEqual({ loai: "HOAN_TAT" });
    expect(ketCucKhiHoanTat({ soCoMat: 3 })).toEqual({ loai: "HOAN_TAT" });
    expect(ketCucKhiHoanTat({ soCoMat: 0 })).toEqual({ loai: "HUY", lyDo: LY_DO_HUY_KHONG_AI_CO_MAT });
  });
});

describe("[KCC] canHuyCaseTrong", () => {
  const goc = { lopTheoKhung: true, trangThaiCase: "SCHEDULED" as const, soBeHieuLuc: 0, soCoMat: 0, kyDaChot: false, viec: "DOI" as const };
  it("[KCC-02] lớp theo khung, case trống, chưa ai có mặt ⇒ huỷ — cả case SCHEDULED lẫn case đã COMPLETED", () => {
    expect(canHuyCaseTrong(goc)).toEqual({ huy: true, lyDo: LY_DO_HUY_CASE_TRONG });
    expect(canHuyCaseTrong({ ...goc, trangThaiCase: "COMPLETED" })).toEqual({ huy: true, lyDo: LY_DO_HUY_CASE_TRONG });
  });
  it("[KCC-03] còn bé hiệu lực / đã có bé có mặt / đã huỷ ⇒ giữ nguyên", () => {
    expect(canHuyCaseTrong({ ...goc, soBeHieuLuc: 1 })).toEqual({ huy: false });
    expect(canHuyCaseTrong({ ...goc, soCoMat: 1 })).toEqual({ huy: false });
    expect(canHuyCaseTrong({ ...goc, trangThaiCase: "CANCELLED" })).toEqual({ huy: false });
  });
  it("[KCC-04] lớp slot CŨ (NULL = học cả lớp) ⇒ KHÔNG BAO GIỜ huỷ theo số bé đang trỏ vào case", () => {
    expect(canHuyCaseTrong({ ...goc, lopTheoKhung: false })).toEqual({ huy: false });
  });
  it("[KCC-05] lý do theo việc làm bé rời case — luật giống hệt nhau", () => {
    expect(canHuyCaseTrong({ ...goc, viec: "GO" })).toEqual({ huy: true, lyDo: LY_DO_HUY_CASE_DA_GO });
    expect(canHuyCaseTrong({ ...goc, viec: "RUT" })).toEqual({ huy: true, lyDo: LY_DO_HUY_CASE_DA_RUT });
  });
  it("[KCC-06] case ĐÃ HOÀN TẤT mà kỳ công tháng đó đã chốt ⇒ giữ (không rút công đã chốt); case chưa diễn ra thì vẫn huỷ", () => {
    expect(canHuyCaseTrong({ ...goc, trangThaiCase: "COMPLETED", kyDaChot: true })).toEqual({ huy: false });
    expect(canHuyCaseTrong({ ...goc, kyDaChot: true })).toEqual({ huy: true, lyDo: LY_DO_HUY_CASE_TRONG });
  });
  it("[KCC-07] ghi danh hiệu lực = ACTIVE + COMPLETED (đã dự đủ buổi); WITHDRAWN thì không", () => {
    expect(laGhiDanhHieuLuc("ACTIVE")).toBe(true);
    expect(laGhiDanhHieuLuc("COMPLETED")).toBe(true);
    expect(laGhiDanhHieuLuc("WITHDRAWN")).toBe(false);
    expect([...TRANG_THAI_GHI_DANH_HIEU_LUC]).toEqual(["ACTIVE", "COMPLETED"]);
  });
});

describe("[KCC] laCaseTrongQuaHan — STALE_EMPTY_CASE (22/10/2026)", () => {
  const goc = { lopTheoKhung: true, trangThaiCase: "SCHEDULED" as const, daQuaGio: true, soBeHieuLuc: 0, soDongDiemDanh: 0, kyDaChot: false };
  it("[KCC-08] theo khung · SCHEDULED · qua giờ · 0 bé · 0 điểm danh · kỳ mở ⇒ case rỗng bị bỏ quên", () => {
    expect(laCaseTrongQuaHan(goc)).toBe(true);
  });
  it("[KCC-09] thiếu MỘT vế bất kỳ ⇒ không phải case rỗng quá hạn (từng vế một)", () => {
    expect(laCaseTrongQuaHan({ ...goc, lopTheoKhung: false })).toBe(false);
    expect(laCaseTrongQuaHan({ ...goc, trangThaiCase: "COMPLETED" })).toBe(false);
    expect(laCaseTrongQuaHan({ ...goc, trangThaiCase: "CANCELLED" })).toBe(false);
    expect(laCaseTrongQuaHan({ ...goc, daQuaGio: false })).toBe(false); // case mới mở, Sale chưa xếp bé — bình thường
    expect(laCaseTrongQuaHan({ ...goc, soBeHieuLuc: 1 })).toBe(false); // còn bé ⇒ không đoán "chưa điểm danh = vắng"
    expect(laCaseTrongQuaHan({ ...goc, soDongDiemDanh: 1 })).toBe(false); // đã có điểm danh (kể cả vắng) ⇒ không phải rỗng
    expect(laCaseTrongQuaHan({ ...goc, kyDaChot: true })).toBe(false);
  });
});

// Lưới ghim dây nối: test hành vi của action đều giả lập service, nên gỡ lời gọi phần sau-huỷ ở action thì không ca nào đỏ.
// Mã TRƯỚC 21/10: `completeLopTrialSessionAction` trả `{ ok: true }` thẳng sau `completeTrialSession`, không đọc `daHuy`;
// `xepCaseHocVienAction` không đọc `caseCuDaHuy`; nút "Hoàn tất buổi" không hỏi kết cục.
const bo = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
describe("[KCC-W] dây nối", () => {
  const A = bo(readFileSync(resolve(process.cwd(), "app/(admin)/admin/lop-trial/_actions.ts"), "utf8"));
  it("[KCC-W1] năm đường huỷ cùng gọi MỘT phần sau-huỷ: huỷ tay · tự huỷ khi hoàn tất · case trống sau dời · sau gỡ · sau rút", () => {
    expect(A.match(/await sauKhiHuyCaseTrenMan\(ctx,/g)?.length ?? 0).toBe(5);
    expect(A.match(/tuDong: true/g)?.length ?? 0).toBe(4);
    expect(A).toMatch(/if \(res\.daHuy\) \{/);
    // dời (xepCaseHocVienAction) · rút (unenrollLeadChildLopTrialAction) · gỡ (goKhoiCaseAction)
    expect(A.match(/if \(res\.caseCuDaHuy\) \{/g)?.length ?? 0).toBe(3);
    // Phần sau-huỷ chỉ có MỘT bản (lib/trial/sau-khi-huy-case.ts): action không tự đóng phân công Parttime khi huỷ.
    expect(A).not.toMatch(/"TRIAL_HUY"/);
    const L = bo(readFileSync(resolve(process.cwd(), "lib/trial/sau-khi-huy-case.ts"), "utf8"));
    expect(L.match(/"TRIAL_HUY"/g)?.length ?? 0).toBe(1);
  });
  it("[KCC-W2] nút trên màn hỏi đúng hàm luật mà server dùng", () => {
    const B = bo(readFileSync(resolve(process.cwd(), "app/(admin)/admin/lop-trial/_components/attendance-board.tsx"), "utf8"));
    expect(B.match(/ketCucKhiHoanTat\(\{ soCoMat:/g)?.length ?? 0).toBe(1);
    expect(B).toMatch(/if \(res\.daHuy\) toast\.warning\(/);
  });
});

// Lưới ghim: MỌI đường làm bé rời case trong service hỏi CÙNG một phép kiểm DB, với đúng việc của nó. Mã TRƯỚC 22/10:
// `goHocVienKhoiCase` và `unenrollLeadChild` không gọi gì — gỡ bé cuối cùng để case trống vẫn SCHEDULED/COMPLETED.
describe("[KCC-W3] mọi đường rời case gọi huyCaseNeuTrong", () => {
  const S = bo(readFileSync(resolve(process.cwd(), "lib/trial/service.ts"), "utf8"));
  it("[KCC-W3] dời · gỡ · rút — đúng ba lời gọi, không bản tự viết", () => {
    expect(S.match(/huyCaseNeuTrong\(tx, \{ sessionId: [^}]*viec: "DOI" \}\)/g)?.length ?? 0).toBe(1);
    expect(S.match(/huyCaseNeuTrong\(tx, \{ sessionId: [^}]*viec: "GO" \}\)/g)?.length ?? 0).toBe(1);
    expect(S.match(/huyCaseNeuTrong\(tx, \{ sessionId: [^}]*viec: "RUT" \}\)/g)?.length ?? 0).toBe(1);
    // không còn công thức đếm "bé còn xếp" chép tay trong service
    expect(S).not.toMatch(/canHuyCase/);
  });
  it("[KCC-W4] nút gỡ trên màn nói đúng khi case tự huỷ", () => {
    const B = bo(readFileSync(resolve(process.cwd(), "app/(admin)/admin/lop-trial/_components/bang-case.tsx"), "utf8"));
    expect(B).toMatch(/if \(res\.daHuy\) toast\.warning\(`Đã gỡ/);
  });
});
