// [SCW-*] — LƯỚI GHIM MÃ NGUỒN: điểm danh ⇒ sổ cái quyền học (khu vực KV4 "portal-gv").
//
// Test hành vi (tests/finance/quyen-hoc-diem-danh.test.ts, tests/hoc-bu/so-cai-quyen-hoc.test.ts) gọi thẳng `dongBoDongSauDiemDanh` / `diemDanhBe`, nên KHÔNG
// chạm được vào Server Action: gỡ lời gọi `docSoCaiDiemDanh` hoặc quên truyền `soCai` ở một trong ba đường lưu điểm danh là lỗi quay lại mà mọi test hành vi vẫn xanh.
// Lưới này ghim DÂY NỐI. Cách làm theo CLAUDE.md "Mẫu test: LƯỚI GHIM MÃ NGUỒN": bóc chú thích, neo chuỗi HẸP vào LỜI GỌI (không vào dòng import),
// đếm số lần khớp, KHÔNG neo vào chỗ đặt `await` hay thụt lề (chi tiết thi huống, không phải luật).
//
// [SCW-06] là lưới QUÉT CÂY: mọi chỗ ghi `Attendance` trong app/ lib/ phải được KHAI ở đây kèm quyết định (đã nối / không đổi bằng chứng / chưa nối + lý do).
// Chỗ ghi MỚI xuất hiện mà chưa khai ⇒ đỏ — đó là lúc buộc người viết hỏi "đường này có làm đổi bằng chứng của một bài đã học không?".
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const boChuThich = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((d) => !d.trim().startsWith("//"))
    .join("\n");
const ma = (p: string) => boChuThich(doc(p));
const dem = (s: string, x: string) => s.split(x).length - 1;

/** Thân một hàm `export async function ten(` đến hàm export kế tiếp. */
function than(src: string, ten: string): string {
  const dau = src.indexOf(`export async function ${ten}(`);
  expect(dau, `không thấy hàm ${ten}`).toBeGreaterThan(-1);
  const ke = src.indexOf("\nexport ", dau + 10);
  return src.slice(dau, ke === -1 ? undefined : ke);
}

const GV = "app/(teacher)/teacher/lop/_actions.ts";
const AD = "app/(admin)/admin/attendance/_actions.ts";
const PR = "app/(admin)/admin/parent-requests/actions.ts";
const DD = "lib/hoc-bu/dong-diem-danh.ts";
const CD = "lib/hoc-bu/case-diem-danh-db.ts";

describe("[SCW] điểm danh ⇒ sổ cái quyền học — dây nối", () => {
  it("[SCW-01] ba đường lưu điểm danh: MỘT `docSoCaiDiemDanh(` ĐỌC CỜ trước `giaoDichDiemDanh(`, rồi truyền `soCai` vào MỘT `dongBoDongSauDiemDanh(`", () => {
    const loi: Array<[string, string]> = [
      [AD, "markAttendance"],
      [GV, "saveClassAttendanceAction"],
      [PR, "resolveAbsence"],
    ];
    for (const [f, ham] of loi) {
      const t = than(ma(f), ham);
      expect(dem(t, "docSoCaiDiemDanh("), `${f}: đúng một lần đọc cờ`).toBe(1);
      expect(dem(t, "giaoDichDiemDanh("), f).toBe(1);
      expect(t.indexOf("docSoCaiDiemDanh("), `${f}: cờ đọc NGOÀI giao dịch (trước giaoDichDiemDanh)`).toBeLessThan(t.indexOf("giaoDichDiemDanh("));
      expect(dem(t, "dongBoDongSauDiemDanh("), f).toBe(1);
      const goi = t.slice(t.indexOf("dongBoDongSauDiemDanh("));
      expect(/[,{]\s*soCai\s*[,}]/.test(goi.slice(0, goi.indexOf("});") + 3)), `${f}: truyền biến soCai (không phải null) vào dongBoDongSauDiemDanh`).toBe(true);
      expect(dem(t, "await docSoCaiDiemDanh({"), `${f}: có await`).toBe(1);
    }
  });

  it("[SCW-02] cờ đọc theo ĐÚNG cơ sở: lưới admin/GV theo cơ sở của lớp; phiếu báo vắng theo cơ sở của học viên", () => {
    expect(ma(AD)).toMatch(/docSoCaiDiemDanh\(\{\s*centerId,/);
    expect(ma(GV)).toMatch(/docSoCaiDiemDanh\(\{\s*centerId,/);
    expect(ma(PR)).toMatch(/docSoCaiDiemDanh\(\{\s*centerId: req\.student\?\.centerId \?\? null,/);
  });

  it("[SCW-03] xoá điểm danh (admin): cờ TẮT giữ nguyên `sdb.attendance.delete(`, cờ BẬT đi `xoaDiemDanhVaDongBoSoCai(` (xoá + huỷ sổ cái cùng giao dịch)", () => {
    const t = than(ma(AD), "deleteAttendance");
    expect(dem(t, "await docSoCaiDiemDanh({")).toBe(1);
    expect(dem(t, "sdb.attendance.delete(")).toBe(1);
    expect(dem(t, "xoaDiemDanhVaDongBoSoCai(")).toBe(1);
    expect(t).toMatch(/if \(soCai === null\) await sdb\.attendance\.delete\(/);
    expect(t.indexOf("docSoCaiDiemDanh(")).toBeLessThan(t.indexOf("sdb.attendance.delete("));
  });

  it("[SCW-04] `dongBoDongSauDiemDanh`: `soCai` BẮT BUỘC (kiểu `SoCaiDiemDanh | null`, không optional) và `dongBoSoCaiNeuBat(` chạy SAU vòng dòng cần bù, truyền `p.soCai`", () => {
    const src = ma(DD);
    const t = than(src, "dongBoDongSauDiemDanh");
    expect(t).toMatch(/soCai: SoCaiDiemDanh \| null\b/);
    expect(t).not.toMatch(/soCai\?:/);
    expect(dem(t, "dongBoSoCaiNeuBat(")).toBe(1);
    expect(t.indexOf("thuHoiDongKhiCoMat(")).toBeLessThan(t.indexOf("dongBoSoCaiNeuBat("));
    expect(t.indexOf("taoDongHocBu(")).toBeLessThan(t.indexOf("dongBoSoCaiNeuBat("));
    expect(t).toMatch(/soCai: p\.soCai/);
    // Xoá điểm danh: một lời xoá + một lần đồng bộ, CÙNG giao dịch.
    const x = than(src, "xoaDiemDanhVaDongBoSoCai");
    expect(dem(x, "giaoDichDiemDanh(")).toBe(1);
    expect(x.indexOf("tx.attendance.delete(")).toBeLessThan(x.indexOf("dongBoSoCaiNeuBat("));
  });

  it("[SCW-05] case dạy bù: cờ đọc NGOÀI giao dịch ở CẢ `diemDanhBe` lẫn `suaDiemDanhBe`; đồng bộ chỉ khi mục chuyển VÀO/RA khỏi COMPLETED, theo BUỔI LỠ, sau mọi sự kiện", () => {
    const src = ma(CD);
    for (const ham of ["diemDanhBe", "suaDiemDanhBe"]) {
      const t = than(src, ham);
      expect(dem(t, "docSoCaiChoBe("), ham).toBe(1);
      expect(dem(t, "db.$transaction("), ham).toBe(1);
      expect(t.indexOf("docSoCaiChoBe("), `${ham}: cờ trước giao dịch`).toBeLessThan(t.indexOf("db.$transaction("));
      expect(/\bsoCai,\n/.test(t) || /\bsoCai,\s/.test(t), `${ham}: truyền soCai vào ganDiemDanhBeTrongTx`).toBe(true);
    }
    expect(src).toMatch(/soCai: SoCaiDiemDanh \| null;/);
    expect(dem(src, "dongBoSoCaiNeuBat(")).toBe(1);
    expect(src).toContain('(v.den === "COMPLETED") !== (v.tu === "COMPLETED")');
    expect(src).toContain("makeupNeed.missedSessionId");
    expect(src.indexOf("phatHoanThanh(tx, sk)")).toBeLessThan(src.indexOf("dongBoSoCaiNeuBat("));
    expect(src.indexOf("phatBeVang(tx, sk)")).toBeLessThan(src.indexOf("dongBoSoCaiNeuBat("));
    expect(src.indexOf("chotLaiCaseTrongTx(tx, be.caseId")).toBeLessThan(src.indexOf("dongBoSoCaiNeuBat("));
  });
});

// ── QUÉT CÂY: mọi chỗ ghi Attendance ─────────────────────────────────────────────────────────────────────────────────
type QuyetDinh = { readonly soLanGhi: number; readonly quyetDinh: "DA_NOI" | "KHONG_DOI_BANG_CHUNG" | "CHUA_NOI"; readonly lyDo: string };

/** Phép ghi `<x>.attendance.(create|update|upsert|delete|…)(` ở mã chạy thật (app/, lib/, components/; bỏ test). */
const GHI_ATTENDANCE: Readonly<Record<string, QuyetDinh>> = {
  "app/(admin)/admin/attendance/_actions.ts": {
    soLanGhi: 2,
    quyetDinh: "DA_NOI",
    lyDo: "markAttendance (upsert, qua dongBoDongSauDiemDanh) + deleteAttendance (xoá, qua xoaDiemDanhVaDongBoSoCai khi cờ BẬT; cờ TẮT giữ sdb.attendance.delete).",
  },
  "app/(teacher)/teacher/lop/_actions.ts": { soLanGhi: 1, quyetDinh: "DA_NOI", lyDo: "saveClassAttendanceAction: upsert trong giaoDichDiemDanh + dongBoDongSauDiemDanh." },
  "app/(admin)/admin/parent-requests/actions.ts": { soLanGhi: 1, quyetDinh: "DA_NOI", lyDo: "resolveAbsence: chỉ ghi VẮNG ⇒ chỉ có thể huỷ một dòng sổ cái đã có; đi qua dongBoDongSauDiemDanh." },
  "lib/hoc-bu/dong-diem-danh.ts": { soLanGhi: 1, quyetDinh: "DA_NOI", lyDo: "xoaDiemDanhVaDongBoSoCai: xoá + đồng bộ cùng giao dịch." },
  "lib/hoc-bu/case-diem-danh-db.ts": {
    soLanGhi: 2,
    quyetDinh: "KHONG_DOI_BANG_CHUNG",
    lyDo: "Chỉ đổi `makeupStatus` (MADE_UP ↔ NEEDS_MAKEUP) của điểm danh GỐC, KHÔNG đổi `status`. Bằng chứng bù đã được nối ở chính hàm này (ganDiemDanhBeTrongTx).",
  },
  "lib/makeup/service.ts": { soLanGhi: 1, quyetDinh: "KHONG_DOI_BANG_CHUNG", lyDo: "completeMakeup: chỉ đổi makeupStatus/makeupSessionId; hàm KHÔNG có nơi gọi ở mã chạy thật (đo 19/10/2026)." },
  "lib/notify/attendance.ts": { soLanGhi: 1, quyetDinh: "KHONG_DOI_BANG_CHUNG", lyDo: "Chỉ ghi mốc `notifiedAt` (đã gửi thông báo điểm danh), không đổi trạng thái có mặt/vắng." },
  "lib/hoc-bu/sua-du-lieu-db.ts": {
    soLanGhi: 1,
    quyetDinh: "CHUA_NOI",
    lyDo: "suaTV20: công cụ vận hành chạy tay (--expect) khôi phục `status` VẮNG từ nhật ký. Có thể làm mất bằng chứng CLASS của một bài mà không đồng bộ sổ cái — câu hỏi mở số 5 trong docs/thu-hoc-phi-pham-vi/DIEM-DANH-SO-CAI.md.",
  },
  "lib/lms/attendance-record.ts": { soLanGhi: 2, quyetDinh: "CHUA_NOI", lyDo: "recordAttendance: KHÔNG có nơi gọi ở mã chạy thật (chỉ test R3). Gỡ ở T16; nếu ai nối lại thì phải nối sổ cái." },
};

/** Đường xoá cứng buổi (kéo theo xoá điểm danh của buổi bằng ON DELETE CASCADE). */
const XOA_BUOI: Readonly<Record<string, QuyetDinh>> = {
  "app/(admin)/admin/sessions/_actions.ts": {
    soLanGhi: 1,
    quyetDinh: "CHUA_NOI",
    lyDo: "deleteSession: buổi có điểm danh bị xoá theo ⇒ bằng chứng mất mà sổ cái không được huỷ. Câu hỏi mở số 4 trong DIEM-DANH-SO-CAI.md.",
  },
};

function quet(mau: string): Map<string, number> {
  let ra: string;
  try {
    ra = execFileSync("git", ["grep", "--untracked", "-nE", mau, "--", "app", "lib", "components"], { encoding: "utf8" });
  } catch {
    ra = ""; // git grep thoát 1 khi không có kết quả
  }
  const dem = new Map<string, number>();
  for (const dong of ra.split("\n").filter(Boolean)) {
    const [tep, , ...noiDung] = dong.split(":");
    const f = tep!.replace(/\\/g, "/");
    if (/\.test\.tsx?$/.test(f)) continue;
    const code = noiDung.join(":").trim();
    if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) continue;
    dem.set(f, (dem.get(f) ?? 0) + 1);
  }
  return dem;
}

describe("[SCW-07] QUÉT CÂY — mọi chỗ ghi/xoá điểm danh phải khai quyết định", () => {
  it("[SCW-07a] danh sách chỗ ghi Attendance khớp CHÍNH XÁC bản khai (thêm một chỗ ghi mới ⇒ đỏ, buộc quyết định nối/không nối)", () => {
    const thuc = quet(String.raw`\.attendance\.(create|createMany|upsert|update|updateMany|delete|deleteMany)\(`);
    const khai = new Map(Object.entries(GHI_ATTENDANCE).map(([f, q]) => [f, q.soLanGhi]));
    expect(Object.fromEntries([...thuc].sort())).toEqual(Object.fromEntries([...khai].sort()));
  });

  it("[SCW-07b] đường xoá cứng buổi học khớp bản khai", () => {
    const thuc = quet(String.raw`\.(classSession|class)\.(delete|deleteMany)\(`);
    const khai = new Map(Object.entries(XOA_BUOI).map(([f, q]) => [f, q.soLanGhi]));
    expect(Object.fromEntries([...thuc].sort())).toEqual(Object.fromEntries([...khai].sort()));
  });

  it("[SCW-07c] mỗi mục khai có lý do đủ dài và đúng một trong ba quyết định", () => {
    for (const [f, q] of [...Object.entries(GHI_ATTENDANCE), ...Object.entries(XOA_BUOI)]) {
      expect(q.lyDo.trim().length, f).toBeGreaterThanOrEqual(30);
      expect(["DA_NOI", "KHONG_DOI_BANG_CHUNG", "CHUA_NOI"], f).toContain(q.quyetDinh);
    }
  });

  it("[SCW-07d] mục khai DA_NOI thì tệp đó THẬT SỰ có dấu vết nối (docSoCaiDiemDanh / dongBoSoCaiNeuBat / xoaDiemDanhVaDongBoSoCai)", () => {
    for (const [f, q] of Object.entries(GHI_ATTENDANCE)) {
      if (q.quyetDinh !== "DA_NOI") continue;
      expect(/docSoCaiDiemDanh\(|dongBoSoCaiNeuBat\(|dongBoDongSauDiemDanh\(|giaoDichDiemDanh\(/.test(ma(f)), f).toBe(true);
    }
  });
});
