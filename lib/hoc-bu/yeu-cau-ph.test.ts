// lib/hoc-bu/yeu-cau-ph.test.ts — [YCT-*] luật THUẦN của "QLCS tạo dòng cần bù theo yêu cầu phụ huynh" + lưới ghim dây nối.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TOI_DA_BUOI_MOI_YEU_CAU, buoiBuDuoc, kiemYeuCauBu } from "./yeu-cau-ph";
import { NGUON_BU_YEU_CAU_PH, batBuocPhi, laDongMienPhi, trangThaiPhi } from "./xep-case";

const LY_DO = "Phụ huynh xin bù các buổi vào lớp muộn";
const NOW = new Date("2026-10-21T05:00:00.000Z");

describe("[YCT] kiemYeuCauBu / buoiBuDuoc", () => {
  it("[YCT-01] hợp lệ ⇒ null; thiếu buổi, quá trần, chọn phí sai, lý do ngắn ⇒ câu từ chối", () => {
    expect(kiemYeuCauBu({ soBuoi: 1, chonPhi: "TINH_PHI", lyDo: LY_DO })).toBeNull();
    expect(kiemYeuCauBu({ soBuoi: TOI_DA_BUOI_MOI_YEU_CAU, chonPhi: "KHONG_TINH_PHI", lyDo: LY_DO })).toBeNull();
    expect(kiemYeuCauBu({ soBuoi: 0, chonPhi: "TINH_PHI", lyDo: LY_DO })).toContain("ít nhất một buổi");
    expect(kiemYeuCauBu({ soBuoi: TOI_DA_BUOI_MOI_YEU_CAU + 1, chonPhi: "TINH_PHI", lyDo: LY_DO })).toContain("tối đa");
    expect(kiemYeuCauBu({ soBuoi: 1, chonPhi: "", lyDo: LY_DO })).toContain("tính phí");
    expect(kiemYeuCauBu({ soBuoi: 1, chonPhi: "TINH_PHI", lyDo: "ngắn" })).toContain("ít nhất");
    expect(kiemYeuCauBu({ soBuoi: 1, chonPhi: "KHONG_TINH_PHI", lyDo: "          " })).toContain("ít nhất"); // khoảng trắng không phải lý do
  });

  it("[YCT-02] buổi: huỷ · chưa diễn ra · chưa gắn bài ⇒ từ chối; buổi đã qua có bài ⇒ null", () => {
    const qua = new Date("2026-09-01T11:00:00.000Z");
    expect(buoiBuDuoc({ date: qua, status: "COMPLETED", lessonId: "b1" }, NOW)).toBeNull();
    expect(buoiBuDuoc({ date: qua, status: "CANCELLED", lessonId: "b1" }, NOW)).toContain("huỷ");
    expect(buoiBuDuoc({ date: new Date("2026-12-01T11:00:00.000Z"), status: "SCHEDULED", lessonId: "b1" }, NOW)).toContain("chưa diễn ra");
    expect(buoiBuDuoc({ date: qua, status: "COMPLETED", lessonId: null }, NOW)).toContain("chưa gắn bài");
  });

  it("[YCT-03] nhãn YEU_CAU_PH KHÔNG miễn phí (khác HOC_VUOT / PHUC_HOC); batBuocPhi chỉ đúng với nhãn này; QLCS miễn phí qua freeApprovedAt", () => {
    expect(batBuocPhi({ nguon: NGUON_BU_YEU_CAU_PH })).toBe(true);
    for (const n of [null, "PHUC_HOC", "HOC_VUOT", "VAO_TRE"]) expect(batBuocPhi({ nguon: n })).toBe(false);
    expect(laDongMienPhi({ freeApprovedAt: null, nguon: NGUON_BU_YEU_CAU_PH })).toBe(false);
    expect(laDongMienPhi({ freeApprovedAt: new Date(), nguon: NGUON_BU_YEU_CAU_PH })).toBe(true);
    // Đòi phí dù còn lượt: ép conLuot = 0 ⇒ CAN_THU; không ép ⇒ LUOT.
    expect(trangThaiPhi({ conLuot: 0, freeApproved: false, phi: null }).loai).toBe("CAN_THU");
    expect(trangThaiPhi({ conLuot: 2, freeApproved: false, phi: null }).loai).toBe("LUOT");
  });
});

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
/** Bỏ dòng chú thích trước khi đếm (luật 11). */
const boChuThich = (s: string) => s.split("\n").filter((d) => !["//", "/*", "*"].some((dau) => d.trim().startsWith(dau))).join("\n");
const dem = (s: string, ct: string) => s.split(ct).length - 1;

describe("[YCT-W] lưới ghim dây nối", () => {
  const ACTIONS = boChuThich(doc("app/(admin)/admin/hoc-bu/_actions.ts"));
  const DANH_SACH = boChuThich(doc("lib/hoc-bu/danh-sach-db.ts"));
  const DB = boChuThich(doc("lib/hoc-bu/yeu-cau-ph-db.ts"));
  const PAGE = boChuThich(doc("app/(admin)/admin/classes/[id]/students/page.tsx"));

  it("[YCT-W1] hai action đều gác bằng makeup:waive (quyết định tiền của QLCS) TRƯỚC khi làm gì", () => {
    for (const ten of ["layBuoiDeBuAction", "taoBuTheoYeuCauAction"]) {
      const tu = ACTIONS.indexOf(`export async function ${ten}`);
      expect(tu).toBeGreaterThan(-1);
      const khoi = ACTIONS.slice(tu, tu + 600);
      expect(khoi).toContain('cong("makeup:waive")');
      expect(khoi.indexOf('cong("makeup:waive")')).toBeLessThan(khoi.indexOf("try {"));
    }
  });

  it("[YCT-W2] danh sách bù: dòng bắt buộc phí ép conLuot = 0 ĐÚNG MỘT chỗ (màn hình và server cùng đọc)", () => {
    expect(dem(DANH_SACH, "conLuot: batBuocPhi(n) ? 0 : con,")).toBe(1);
  });

  it("[YCT-W3] tạo dòng đi qua cửa DUY NHẤT taoDongHocBu (MANUAL + nhãn YEU_CAU_PH), có nhật ký, và không tạo đơn phí / không xếp case", () => {
    expect(dem(DB, "taoDongHocBu(tx,")).toBe(1);
    expect(DB).toContain('nguon: "MANUAL"');
    expect(DB).toContain("nguonBaoLuu: NGUON_BU_YEU_CAU_PH");
    expect(DB).toContain('action: "hoc-bu.tao-theo-yeu-cau"');
    expect(DB).not.toMatch(/taoPhiBu|taoCaseVaXep|ensureFullOrderRequest|makeupCase\./);
  });

  it("[YCT-W4] roster chỉ hiện nút khi có makeup:waive (cùng quyền với action)", () => {
    expect(PAGE).toContain('checkPermission("makeup:waive", { centerId: cls.centerId })');
    expect(PAGE).toContain("canYeuCauBu={canYeuCauBu}");
  });
});
