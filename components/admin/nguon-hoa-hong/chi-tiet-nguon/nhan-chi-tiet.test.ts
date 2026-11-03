// @vitest-environment node
/**
 * [CTN-NH-*] Nhãn + dựng dòng thời gian của trang CHI TIẾT NGUỒN (SPEC nguồn động §4 mục 4). Thuần — không DB, không DOM.
 *
 *   [CTN-NH-01] mọi nhóm nguồn / loại người giới thiệu có nhãn VN (Record theo enum Prisma ⇒ thêm giá trị mà quên nhãn là LỖI BIÊN DỊCH; ca này khoá thêm: nhãn không rỗng, không trùng mã)
 *   [CTN-NH-02] mọi hành động audit mà `danh-muc-ghi` có thể ghi đều có nhãn — KHÔNG in mã thô «NGUON_DOI_CUA_SO» ra màn hình; mã lạ thì in nguyên mã (không đoán)
 *   [CTN-NH-03] dòng thời gian KHÔNG in id thô (cuid của nhân sự/đơn vị) và định dạng ngày theo lịch VN; trường nhạy cảm in «Đã chỉ định», không in mã
 *   [CTN-NH-04] mục TẠO in giá trị mới, không in «— → X»; mục SỬA có cũ rỗng in «(trống)» (khác mục tạo)
 *   [CTN-NH-05] gán Page đọc đúng cặp cũ/mới, gỡ Page in «(không gán)»
 */
import { describe, expect, it } from "vitest";
import { tenHanhDongSua, tenHanhDongTrangThai, TAT_CA_TRUONG_SUA, TRANG_THAI_NGUON, type TruongSua } from "@/lib/nguon/danh-muc-ghi-dau-vao";
import type { MucLichSuNguon } from "@/lib/nguon/doc-chi-tiet-nguon";
import {
  NHAN_LOAI_GIOI_THIEU,
  NHAN_LOAI_NGUON,
  dungMucThoiGian,
  nhanHanhDong,
  nhanLoaiNguon,
  nhanTruong,
} from "./nhan-chi-tiet";

const muc = (p: Partial<MucLichSuNguon> & Pick<MucLichSuNguon, "hanhDong">): MucLichSuNguon => ({
  id: "a1",
  luc: "2026-10-09T03:30:00.000Z",
  nguoi: "Quản trị A",
  lyDo: null,
  truongDoi: [],
  cu: null,
  moi: null,
  ...p,
});

describe("[CTN-NH-01] nhãn nhóm nguồn / loại người giới thiệu", () => {
  it("mỗi giá trị enum có nhãn riêng, không rỗng, khác mã", () => {
    for (const [ma, nhan] of Object.entries(NHAN_LOAI_NGUON)) {
      expect(nhan.length, ma).toBeGreaterThan(2);
      expect(nhan, ma).not.toBe(ma);
    }
    expect(new Set(Object.values(NHAN_LOAI_NGUON)).size).toBe(Object.keys(NHAN_LOAI_NGUON).length);
    expect(Object.keys(NHAN_LOAI_GIOI_THIEU).sort()).toEqual(["AFFILIATE", "EMPLOYEE", "PARENT"]);
  });
  it("mã lạ ⇒ in nguyên mã (nhãn sai nghĩa tệ hơn nhãn thô)", () => {
    expect(nhanLoaiNguon("SOMETHING_NEW")).toBe("SOMETHING_NEW");
    expect(nhanLoaiNguon("MARKETING")).toBe(NHAN_LOAI_NGUON.MARKETING);
  });
});

describe("[CTN-NH-02] nhãn hành động audit", () => {
  it("MỌI tên hành động mà đường ghi có thể sinh ra đều có nhãn", () => {
    const sinhRa = new Set<string>();
    // đủ các tổ hợp trường đổi mà `tenHanhDongSua` phân biệt
    const nhom: TruongSua[][] = [["attributionWindowDays"], ["ownerEmployeeId"], ["ownerOrgUnitId", "ownerEmployeeId"], ["commissionEnabled"], ["name"], ["name", "commissionEnabled"], []];
    for (const n of nhom) sinhRa.add(tenHanhDongSua(n));
    for (const tu of TRANG_THAI_NGUON) for (const den of TRANG_THAI_NGUON) sinhRa.add(tenHanhDongTrangThai(tu, den));
    sinhRa.add("NGUON_TAO");
    sinhRa.add("PAGE_MAPPING");
    for (const ma of sinhRa) {
      const nhan = nhanHanhDong(ma);
      expect(nhan, ma).not.toBe(ma);
      expect(nhan, ma).not.toMatch(/^[A-Z_]+$/);
    }
    expect(sinhRa.size).toBeGreaterThanOrEqual(10);
  });
  it("mã lạ ⇒ in nguyên mã", () => {
    expect(nhanHanhDong("NGUON_CHUA_BIET")).toBe("NGUON_CHUA_BIET");
  });
  it("mọi trường của biểu mẫu sửa có nhãn tiếng Việt", () => {
    for (const k of [...TAT_CA_TRUONG_SUA, "status"]) expect(nhanTruong(k), k).not.toBe(k);
  });
});

describe("[CTN-NH-03] dòng thời gian không lộ id thô, ngày theo lịch VN", () => {
  it("đổi người phụ trách: không có cuid trong chữ in ra", () => {
    const m = dungMucThoiGian(
      muc({
        hanhDong: "NGUON_DOI_PHU_TRACH",
        truongDoi: ["ownerEmployeeId"],
        cu: { ownerEmployeeId: null },
        moi: { ownerEmployeeId: "cmgxyzabc1234567890abcdef" },
        lyDo: "Chuyển cho bạn Lan phụ trách",
      }),
    );
    const chu = JSON.stringify(m);
    expect(chu).not.toMatch(/cmgxyz/);
    expect(m.tieuDe).toBe("Đổi người phụ trách");
    expect(m.thayDoi).toEqual([{ truong: "Người phụ trách", cu: "(trống)", moi: "Đã chỉ định" }]);
    expect(m.lyDo).toBe("Chuyển cho bạn Lan phụ trách");
  });
  it("hiệu lực: mốc 17:00Z hôm trước = 00:00 VN hôm sau (không lệch một ngày)", () => {
    const m = dungMucThoiGian(
      muc({
        hanhDong: "NGUON_SUA",
        truongDoi: ["effectiveFrom"],
        cu: { effectiveFrom: null },
        moi: { effectiveFrom: "2026-10-31T17:00:00.000Z" },
        lyDo: "Mở nguồn từ đầu tháng 11",
      }),
    );
    expect(m.thayDoi?.[0]).toEqual({ truong: "Hiệu lực từ", cu: "(trống)", moi: "01/11/2026" });
  });
  it("cửa sổ riêng ↔ mặc định hệ thống; cờ boolean ↔ Có/Không; nhóm nguồn có nhãn", () => {
    const m = dungMucThoiGian(
      muc({
        hanhDong: "NGUON_SUA",
        truongDoi: ["attributionWindowDays", "commissionEnabled", "sourceType"],
        cu: { attributionWindowDays: null, commissionEnabled: false, sourceType: "OTHER" },
        moi: { attributionWindowDays: 45, commissionEnabled: true, sourceType: "MARKETING" },
      }),
    );
    expect(m.thayDoi).toEqual([
      { truong: "Cửa sổ ghi công", cu: "Mặc định hệ thống", moi: "45 ngày" },
      { truong: "Hoa hồng theo nguồn", cu: "Không", moi: "Có" },
      { truong: "Nhóm nguồn", cu: NHAN_LOAI_NGUON.OTHER, moi: NHAN_LOAI_NGUON.MARKETING },
    ]);
  });
  it("thời điểm giữ nguyên là Date đúng mốc", () => {
    expect(dungMucThoiGian(muc({ hanhDong: "NGUON_NGUNG" })).luc.toISOString()).toBe("2026-10-09T03:30:00.000Z");
  });
});

describe("[CTN-NH-04] mục TẠO khác mục SỬA", () => {
  it("TẠO: cũ = «—» (AuditTimeline in riêng giá trị mới); không liệt kê trường rỗng", () => {
    const m = dungMucThoiGian(
      muc({
        hanhDong: "NGUON_TAO",
        moi: { code: "ZALO_OA", name: "Zalo OA", description: null, sourceType: "MARKETING", requiresNote: false, ownerEmployeeId: null },
        lyDo: "Tạo nguồn «Zalo OA» (ZALO_OA)",
      }),
    );
    expect(m.tieuDe).toBe("Tạo nguồn");
    const tr = m.thayDoi ?? [];
    expect(tr.every((t) => t.cu === "—")).toBe(true);
    expect(tr.map((t) => t.truong)).toEqual(["Mã", "Tên", "Nhóm nguồn", "Bắt buộc giải trình"]);
    expect(tr.find((t) => t.truong === "Bắt buộc giải trình")?.moi).toBe("Không");
  });
  it("đổi trạng thái: nhãn trạng thái tiếng Việt", () => {
    const m = dungMucThoiGian(muc({ hanhDong: "NGUON_NGUNG", truongDoi: ["status"], cu: { status: "ACTIVE" }, moi: { status: "INACTIVE" }, lyDo: "Ngừng chiến dịch cũ" }));
    expect(m.thayDoi).toEqual([{ truong: "Trạng thái", cu: "Đang dùng", moi: "Tạm ngừng" }]);
  });
});

describe("[CTN-NH-05] gán / gỡ Page", () => {
  it("gán: nhóm + chiến dịch", () => {
    const m = dungMucThoiGian(
      muc({
        hanhDong: "PAGE_MAPPING",
        cu: { pageId: "p1", nguon: null },
        moi: { pageId: "p1", nguon: { groupCode: "PAID_ADS", campaignCode: "THANG10" } },
        lyDo: "Gán Page p1",
      }),
    );
    expect(m.tieuDe).toBe("Gán Page vào nguồn");
    expect(m.thayDoi).toEqual([{ truong: "Page p1", cu: "(không gán)", moi: "PAID_ADS · chiến dịch THANG10" }]);
  });
  it("gỡ: mới = (không gán)", () => {
    const m = dungMucThoiGian(muc({ hanhDong: "PAGE_MAPPING", cu: { pageId: "p1", nguon: { groupCode: "PAID_ADS" } }, moi: { pageId: "p1", nguon: null } }));
    expect(m.thayDoi).toEqual([{ truong: "Page p1", cu: "PAID_ADS", moi: "(không gán)" }]);
  });
});
