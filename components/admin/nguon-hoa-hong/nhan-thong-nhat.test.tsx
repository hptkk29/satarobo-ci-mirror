// @vitest-environment jsdom
/**
 * [W4-NH-*] MỘT TÊN cho một giá trị — trạng thái nguồn và «người nhập phải chọn gì» (rà soát giao diện gt1 R2-M6, W4).
 *
 * Trước đợt này: INACTIVE là «Tạm ngừng» (bảng · chi tiết) / «Đã ngừng» (trình soạn) / «Ngừng» (nút); ACTIVE là «Đang dùng» (bảng) / «Đang hoạt động» (trình soạn); và cùng một
 * ý «nhân sự giới thiệu» có hai từ (Nhân viên / Nhân sự). Đối chiếu từng bề mặt NÓI VỚI NGƯỜI DÙNG với MỘT bảng gốc — thêm bề mặt thứ N mà gõ tay là đỏ ở đây.
 *
 *   [W4-NH-01] bảng gốc phủ ĐỦ enum SourceStatus (thêm trạng thái ở schema mà quên nhãn là đỏ) và danh sách bộ lọc đi từ chính nó
 *   [W4-NH-02] pill ở bảng · khoá trạng thái của trình soạn · nhật ký chi tiết cùng nói MỘT chữ cho cùng một trạng thái
 *   [W4-NH-03] «người nhập phải chọn gì»: nhãn ngắn ở bảng/chi tiết = nhãn của biểu mẫu (cùng bảng gốc), «nhân sự» không còn «nhân viên»
 */
import { SourceStatus } from "@prisma/client";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { dungMucThoiGian } from "./chi-tiet-nguon/nhan-chi-tiet";
import { NHAN_YEU_CAU_NGUOI, THU_TU_YEU_CAU_NGUOI } from "./nhan-danh-muc";
import { NHAN_NGUOI_GIOI_THIEU, yeuCauNhap } from "./nhan-nguon";
import { NguonStatusPill } from "./nguon-status-pill";
import { DANH_SACH_TRANG_THAI_NGUON, NHAN_TRANG_THAI_NGUON, NHAN_TRANG_THAI_NGUON_DB, nhanTrangThaiNguon } from "@/lib/nguon/nhan-hien-thi";

afterEach(cleanup);

const TAT_CA = Object.values(SourceStatus) as SourceStatus[];

describe("[W4-NH-01] bảng gốc trạng thái nguồn", () => {
  it("phủ ĐỦ mọi giá trị enum SourceStatus, mỗi nhãn khác rỗng và KHÔNG trùng nhau", () => {
    expect(Object.keys(NHAN_TRANG_THAI_NGUON_DB).sort()).toEqual([...TAT_CA].sort());
    const nhan = TAT_CA.map((s) => NHAN_TRANG_THAI_NGUON_DB[s]);
    expect(nhan.every((n) => n.length > 2)).toBe(true);
    expect(new Set(nhan).size).toBe(nhan.length);
  });
  it("danh sách bộ lọc = đúng các giá trị enum, mỗi giá trị MỘT lần", () => {
    expect([...DANH_SACH_TRANG_THAI_NGUON].sort()).toEqual([...TAT_CA].sort());
    expect(DANH_SACH_TRANG_THAI_NGUON).toHaveLength(TAT_CA.length);
  });
  it("mã lạ in nguyên (nhãn sai nghĩa tệ hơn nhãn thô)", () => {
    expect(nhanTrangThaiNguon("ACTIVE")).toBe("Đang dùng");
    expect(nhanTrangThaiNguon("TRANG_THAI_MOI")).toBe("TRANG_THAI_MOI");
  });
});

describe("[W4-NH-02] một trạng thái — một chữ trên mọi bề mặt", () => {
  it("pill ở bảng danh mục = bảng gốc, cho từng trạng thái", () => {
    for (const s of TAT_CA) {
      const { container, unmount } = render(<NguonStatusPill status={s} />);
      expect(container.textContent, s).toBe(NHAN_TRANG_THAI_NGUON_DB[s]);
      unmount();
    }
  });
  it("khoá trạng thái trình soạn (HOAT_DONG · NHAP · NGUNG · LUU_TRU) = nhãn của trạng thái DB tương ứng", () => {
    expect(NHAN_TRANG_THAI_NGUON.HOAT_DONG).toBe(NHAN_TRANG_THAI_NGUON_DB.ACTIVE);
    expect(NHAN_TRANG_THAI_NGUON.NHAP).toBe(NHAN_TRANG_THAI_NGUON_DB.DRAFT);
    expect(NHAN_TRANG_THAI_NGUON.NGUNG).toBe(NHAN_TRANG_THAI_NGUON_DB.INACTIVE);
    expect(NHAN_TRANG_THAI_NGUON.LUU_TRU).toBe(NHAN_TRANG_THAI_NGUON_DB.ARCHIVED);
  });
  it("nhật ký chi tiết nguồn in đúng chữ ấy cho mọi trạng thái", () => {
    for (const s of TAT_CA) {
      const m = dungMucThoiGian({
        id: "m",
        luc: "2026-10-09T03:30:00.000Z",
        hanhDong: "NGUON_SUA",
        truongDoi: ["status"],
        cu: { status: "DRAFT" },
        moi: { status: s },
        lyDo: null,
        nguoi: "A",
      } as Parameters<typeof dungMucThoiGian>[0]);
      expect(m.thayDoi?.[0]?.moi, s).toBe(NHAN_TRANG_THAI_NGUON_DB[s]);
    }
  });
});

describe("[W4-NH-03] «người nhập phải chọn gì»", () => {
  it("nhãn ngắn của bảng/chi tiết đi từ CHÍNH bảng của biểu mẫu (không bảng thứ hai)", () => {
    for (const y of THU_TU_YEU_CAU_NGUOI) expect(NHAN_NGUOI_GIOI_THIEU[y], y).toBe(NHAN_YEU_CAU_NGUOI[y].ngan);
  });
  it("«nhân sự» (không «nhân viên») ở mọi nơi nói về EMPLOYEE", () => {
    expect(NHAN_NGUOI_GIOI_THIEU.EMPLOYEE).toBe("Nhân sự");
    expect(NHAN_YEU_CAU_NGUOI.EMPLOYEE.nhan).toMatch(/Nhân sự/);
    expect(yeuCauNhap({ referrerRequirement: "EMPLOYEE", requiresNote: false, selectable: true })).toBe("Chọn nhân sự");
  });
});
