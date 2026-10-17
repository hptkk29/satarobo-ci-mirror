/**
 * LƯỚI GHIM MÃ NGUỒN — các cổng "case trial" (23/09/2026).
 *
 * Luật cần khoá có dạng "Server Action này PHẢI gọi cổng kia" — loại luật mà test thuần
 * không chứng minh được: `kiemCaseThuocLop`, `quyenGoHocVien`… đều có test riêng và xanh,
 * trong khi con bug thật là một cửa ghi QUÊN GỌI chúng. Đó đúng là thứ đã xảy ra: cửa THÊM
 * case gác khung giờ, cửa SỬA case thì không — đo được trên app thật 23/09, Sale sửa case
 * của mình sang ngày khác lúc 22:00 và server nhận.
 *
 * Cách đọc (mẫu LƯỚI GHIM, CLAUDE.md): đọc chính `_actions.ts`, BỎ CHÚ THÍCH, cắt đúng thân
 * từng hàm, rồi đếm SỐ LẦN gọi — không dùng cờ `/s`, không so khớp rộng (luật 11). Chú
 * thích giải thích bản vá thường chứa đúng tên cổng, nên phải bỏ chú thích trước khi đếm.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const NGUON = readFileSync(
  resolve(process.cwd(), "app/(admin)/admin/lop-trial/_actions.ts"),
  "utf8",
);

/** Bỏ chú thích khối và chú thích dòng — tên cổng trong chú thích không phải lời gọi. */
function boChuThich(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/.*$/gm, "");
}

/** Thân của một `export async function <ten>(` — tới hàm export kế tiếp. */
function thanHam(ten: string): string {
  const src = boChuThich(NGUON);
  const dau = src.indexOf(`export async function ${ten}(`);
  if (dau < 0) throw new Error(`Không thấy hàm ${ten} trong _actions.ts`);
  const sau = src.indexOf("\nexport ", dau + 1);
  return src.slice(dau, sau < 0 ? undefined : sau);
}

function dem(than: string, loiGoi: string): number {
  return than.split(loiGoi).length - 1;
}

describe("[CC-01] cửa THÊM và cửa SỬA case cùng gác khung giờ + ngày lớp", () => {
  // Trước bản vá: addLopTrialSessionAction = 1, updateLopTrialSessionAction = 0.
  it("addLopTrialSessionAction gọi kiemCaseThuocLop đúng 1 lần", () => {
    expect(dem(thanHam("addLopTrialSessionAction"), "kiemCaseThuocLop(")).toBe(1);
  });
  it("[CC-01b] updateLopTrialSessionAction gọi kiemCaseThuocLop đúng 1 lần", () => {
    expect(dem(thanHam("updateLopTrialSessionAction"), "kiemCaseThuocLop(")).toBe(1);
  });
});

/**
 * Cổng = GỌI hàm quyền VÀ dùng kết quả để CHẶN. Chỉ đếm lời gọi là lưới mù: đã cấy thử
 * `void quyen;` thay cho câu chặn (23/09/2026) — hàm vẫn được gọi, lưới vẫn xanh, trong
 * khi cửa gỡ mở toang. Nên mỗi cổng phải có ĐÚNG MỘT câu `if (!<biến>.duoc)`.
 */
function coChan(than: string, bien: string): number {
  return dem(than, `if (!${bien}.duoc)`);
}

describe("[CC-02] cổng chủ case / khách của người khác", () => {
  it("sửa case: quyenSuaCase + quyenDoiGioCase (dời giờ case đang giữ khách người khác)", () => {
    const than = thanHam("updateLopTrialSessionAction");
    expect(dem(than, "quyenSuaCase(")).toBe(1);
    expect(dem(than, "quyenDoiGioCase(")).toBe(1);
    expect(coChan(than, "quyen")).toBe(1);
    expect(coChan(than, "doiGio")).toBe(1);
  });
  it("huỷ case: quyenXoaCase (huỷ case = gỡ hàng loạt trá hình)", () => {
    const than = thanHam("cancelLopTrialSessionAction");
    expect(dem(than, "quyenXoaCase(")).toBe(1);
    expect(coChan(than, "quyen")).toBe(1);
  });
  it("[CC-02c] GỠ học viên: quyenGoHocVien — trước 23/09 cửa này không có cổng nào", () => {
    // Đo được: `trials:manage` là khoá của MỌI Sale, nên mọi Sale gỡ được khách của mọi Sale.
    const than = thanHam("unenrollLeadChildLopTrialAction");
    expect(dem(than, "quyenGoHocVien(")).toBe(1);
    expect(coChan(than, "quyen")).toBe(1);
  });
  it("CHUYỂN case: quyenChuyenCase — cùng luật với gỡ (chuyển case là đổi giờ hẹn)", () => {
    // `quyenChuyenCase` bọc ĐÚNG luật của `quyenGoHocVien`, chỉ đổi câu chữ sang "chuyển"
    // (lib/trial/quyen-case.ts, ca [QC-06]).
    const than = thanHam("xepCaseHocVienAction");
    expect(dem(than, "quyenChuyenCase(")).toBe(1);
    expect(coChan(than, "quyen")).toBe(1);
  });
});

describe("[CC-03] lịch sử cấp CASE chỉ ghi cho khách TRONG case", () => {
  // Trước bản vá: cả hai hàm gọi layLeadTrongLopTrial ⇒ đổi giờ case của Sale 2 ghi "đổi
  // lịch" vào hồ sơ khách của Sale 1 ở case khác.
  for (const ten of ["updateLopTrialSessionAction", "cancelLopTrialSessionAction"]) {
    it(`${ten}: layLeadTrongCaseTrial, KHÔNG layLeadTrongLopTrial`, () => {
      const than = thanHam(ten);
      expect(dem(than, "layLeadTrongCaseTrial(")).toBe(1);
      expect(dem(than, "layLeadTrongLopTrial(")).toBe(0);
    });
  }
  it("huỷ LỚP thì vẫn đúng là cả lớp", () => {
    expect(dem(thanHam("cancelLopTrialClassAction"), "layLeadTrongLopTrial(")).toBe(1);
  });
});

describe("[CC-04] huỷ LỚP gác bằng khoá mở lớp, không bằng khoá của mọi Sale", () => {
  it('cancelLopTrialClassAction hỏi "trials:create-class", KHÔNG hỏi "trials:manage"', () => {
    const than = thanHam("cancelLopTrialClassAction");
    expect(dem(than, '"trials:create-class"')).toBe(1);
    expect(dem(than, '"trials:manage"')).toBe(0);
  });
});

describe("[CC-05] lô điểm danh kiểm CẢ LÔ trước khi ghi bé nào", () => {
  // Trước bản vá: vòng lặp ghi lần lượt, bé bị cổng `thuocCase` từ chối giữa chừng làm
  // lượt lưu dừng lửng — bé trước đã ghi, bé sau thì không.
  it("markLopTrialAttendanceAction: kiểm thuocCase cho cả lô và CHẶN khi có bé lệch", () => {
    const than = thanHam("markLopTrialAttendanceAction");
    expect(dem(than, "thuocCase(")).toBe(1);
    expect(dem(than, "if (lech.length > 0)")).toBe(1);
    // Khối kiểm phải đứng TRƯỚC vòng ghi — vị trí đầu tiên của lời gọi ghi đứng sau nó.
    expect(than.indexOf("if (lech.length > 0)")).toBeLessThan(than.indexOf("await markAttendance("));
  });
});

describe("[CC-06] ô tìm học viên CHE SĐT khi không có quyền xem PII lead", () => {
  // Đào tạo nay vào được ô tìm (quản lý khách trong lớp) nhưng KHÔNG có `leads:view-pii`.
  it("searchLopTrialCandidatesAction hỏi canViewLeadPii và che bằng maskLeadPiiFields", () => {
    // Gộp main 24/09: cách che của main (che CẢ SĐT lẫn tên phụ huynh qua helper dùng
    // chung `lib/lead/pii.ts`) thay bản `maskPhone` riêng của nhánh này — cùng mục đích.
    const than = thanHam("searchLopTrialCandidatesAction");
    expect(dem(than, "await canViewLeadPii()")).toBe(1);
    expect(dem(than, "maskLeadPiiFields(")).toBe(1);
    expect(dem(than, ", canViewPii)")).toBeGreaterThanOrEqual(1);
  });
});

describe("[CC-07] gỡ khỏi CASE: cùng cổng chủ lead với gỡ khỏi lớp, đứng TRƯỚC phép ghi", () => {
  // Chủ dự án 23/09: "học viên khi bị gỡ khỏi case thì phải về chưa xếp case". Cửa mới
  // `goKhoiCaseAction` cũng là một cửa gỡ — quên cổng ở đây là mở lại đúng lỗ [CC-02c]
  // ("mọi Sale gỡ được khách của mọi Sale", vì `trials:manage` là khoá của MỌI Sale).
  it("goKhoiCaseAction gọi quyenGoHocVien, CHẶN bằng kết quả, trước goHocVienKhoiCase", () => {
    const than = thanHam("goKhoiCaseAction");
    expect(dem(than, "quyenGoHocVien(")).toBe(1);
    expect(coChan(than, "quyen")).toBe(1);
    expect(dem(than, "await goHocVienKhoiCase(")).toBe(1);
    expect(than.indexOf("if (!quyen.duoc)")).toBeLessThan(than.indexOf("await goHocVienKhoiCase("));
  });
});

describe("[CC-08] điểm danh + hoàn tất: Sale KHÔNG làm thay case của Sale khác", () => {
  // Chủ dự án 23/09 — câu hỏi "Sale có được điểm danh và bấm Hoàn tất case của Sale
  // khác không?" → "không". Trước bản vá hai cửa chỉ hỏi `duocThaoTacBuoi` (= có
  // `trials:manage`), tức mọi Sale điểm danh + khoá được case của mọi Sale.
  const CUA: Array<[string, string]> = [
    ["markLopTrialAttendanceAction", "await markAttendance("],
    ["completeLopTrialSessionAction", "await completeTrialSession("],
  ];
  for (const [ten, phepGhi] of CUA) {
    it(`${ten}: quyenDiemDanhCuaBuoi, CHẶN bằng kết quả, trước phép ghi`, () => {
      const than = thanHam(ten);
      expect(dem(than, "quyenDiemDanhCuaBuoi(")).toBe(1);
      expect(coChan(than, "quyen")).toBe(1);
      expect(dem(than, phepGhi)).toBe(1);
      expect(than.indexOf("if (!quyen.duoc)")).toBeLessThan(than.indexOf(phepGhi));
    });
  }
});

describe("[CC-09] gỡ khỏi LỚP chỉ từ \"Chưa xếp case\" (lớp theo khung)", () => {
  // Chủ dự án 23/09: "gỡ khỏi case thì phải về chưa xếp case, rồi từ chưa xếp case mới
  // gỡ khỏi lớp". Case ĐÃ HUỶ không tính (bé trỏ vào case huỷ = chưa xếp case).
  it("unenrollLeadChildLopTrialAction từ chối bé đang ở case còn sống, trước phép ghi", () => {
    const than = thanHam("unenrollLeadChildLopTrialAction");
    expect(dem(than, "if (cls.theoKhung)")).toBe(1);
    expect(dem(than, 'if (ca && ca.status !== "CANCELLED")')).toBe(1);
    expect(dem(than, "await unenrollLeadChild(")).toBe(1);
    expect(than.indexOf('if (ca && ca.status !== "CANCELLED")')).toBeLessThan(
      than.indexOf("await unenrollLeadChild("),
    );
  });
});

describe("[CC-10] mở lớp cả kỳ cho NHIỀU cơ sở: kiểm quyền MỌI cơ sở trước lớp đầu tiên", () => {
  // Chủ dự án 23/09: "áp dụng cho cơ sở nào" — một lượt mở cho nhiều cơ sở. Kiểm quyền
  // trong vòng lặp (hoặc chỉ kiểm cơ sở đầu) là mở dở: vài cơ sở đã có lớp rồi mới báo
  // lỗi, hoặc tệ hơn, lọt lớp vào cơ sở ngoài quyền.
  it("taoLopTrialTheoThuAction lọc actorCanUseCenter trên CẢ danh sách, chặn trước createTrialClass", () => {
    const than = thanHam("taoLopTrialTheoThuAction");
    expect(dem(than, "coSos.filter((id) => !actorCanUseCenter(ctx.actor, id))")).toBe(1);
    expect(dem(than, "if (ngoaiQuyen.length > 0)")).toBe(1);
    expect(than.indexOf("if (ngoaiQuyen.length > 0)")).toBeLessThan(than.indexOf("await createTrialClass("));
  });
});
