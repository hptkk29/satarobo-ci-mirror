// @vitest-environment node
/**
 * [NHH-DOI-*] — "Dời sang kỳ sau": MỘT câu hỏi "hàng chờ này dời được không?" (`lyDoKhongDoiDuoc` trong hang-cho-so-nhom.ts), THUẦN.
 *
 * Nút ở dòng hàng chờ (tab Sổ) và bước kiểm của điều phối server (`doiHangChoSangKyHanhDong`) CÙNG gọi hàm này — vẽ nút theo một điều kiện mà server kiểm theo điều kiện khác là
 * lời hứa suông (luật 12). Tập mã lấy từ 04 §10.5: bảng ghi «(trừ khi dời kỳ)» ở các hàng chờ cứng cần người/văn bản quyết (`MANUAL_REVIEW_REQUIRED`, `PENDING_REGULATION`);
 * `POLICY_OVERLAP`/`CAP_EXCEEDED` ghi «sửa chính sách rồi Tính lại» — dời kỳ không giải được gì nên không có nút.
 */
import { CommissionHoldCode } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { kiemGiaiHangCho } from "./dieu-chinh";
import type { MaHold } from "./hang-cho";
import { MA_DOI_DUOC_SANG_KY_SAU, NHAN_MA_HANG_CHO, laDoiDuocSangKySau, lyDoKhongDoiDuoc } from "./hang-cho-so-nhom";

const TAT_CA = Object.values(CommissionHoldCode) as MaHold[];
const dang = (code: MaHold, p: Partial<{ status: string; blockingPeriodId: string | null }> = {}) => ({ code, status: "OPEN", blockingPeriodId: "ky-1", ...p });

describe("[NHH-DOI-01] tập mã dời được", () => {
  it("đúng hai mã cứng mà 04 §10.5 ghi «trừ khi dời kỳ»; MỌI mã còn lại bị từ chối với mã lỗi HANG_CHO_KHONG_DOI_DUOC và câu nêu tên loại", () => {
    expect([...MA_DOI_DUOC_SANG_KY_SAU].sort()).toEqual(["MANUAL_REVIEW_REQUIRED", "PENDING_REGULATION"]);
    for (const ma of TAT_CA) {
      const r = lyDoKhongDoiDuoc(dang(ma));
      if (MA_DOI_DUOC_SANG_KY_SAU.includes(ma)) {
        expect(r, `${ma} phải dời được`).toBeNull();
        expect(laDoiDuocSangKySau(dang(ma))).toBe(true);
      } else {
        expect(r?.ma, ma).toBe("HANG_CHO_KHONG_DOI_DUOC");
        expect(r?.loi, ma).toContain(NHAN_MA_HANG_CHO[ma]);
        expect(laDoiDuocSangKySau(dang(ma))).toBe(false);
      }
    }
  });
});

describe("[NHH-DOI-02] điều kiện trạng thái", () => {
  it("không còn OPEN ⇒ HANG_CHO_KHONG_MO; không chặn kỳ nào (blockingPeriodId NULL) ⇒ HANG_CHO_KHONG_CHAN — cả khi mã dời được (đối chứng dương: OPEN + có kỳ ⇒ null)", () => {
    expect(lyDoKhongDoiDuoc(dang("PENDING_REGULATION"))).toBeNull();
    expect(lyDoKhongDoiDuoc(dang("PENDING_REGULATION", { status: "RESOLVED" }))?.ma).toBe("HANG_CHO_KHONG_MO");
    expect(lyDoKhongDoiDuoc(dang("PENDING_REGULATION", { status: "DISMISSED" }))?.ma).toBe("HANG_CHO_KHONG_MO");
    expect(lyDoKhongDoiDuoc(dang("MANUAL_REVIEW_REQUIRED", { blockingPeriodId: null }))?.ma).toBe("HANG_CHO_KHONG_CHAN");
    // trạng thái đứng TRƯỚC mã: hàng chờ đã đóng thì không bàn tới loại
    expect(lyDoKhongDoiDuoc(dang("CAP_EXCEEDED", { status: "RESOLVED" }))?.ma).toBe("HANG_CHO_KHONG_MO");
    // hàng chờ mềm "treo" không chặn kỳ nào ⇒ không có gì để dời
    expect(lyDoKhongDoiDuoc(dang("UNRESOLVED_BENEFICIARY", { blockingPeriodId: null }))?.ma).toBe("HANG_CHO_KHONG_CHAN");
  });
});

describe("[NHH-DOI-03] câu chữ không hứa điều nút không làm", () => {
  it("câu từ chối giải-hàng-chờ chỉ nhắc 'dời sang kỳ sau' khi mã ĐÓ dời được; mã không dời được thì chỉ nói sửa dữ liệu/chính sách rồi Tính lại", () => {
    const nhac = (code: MaHold) => kiemGiaiHangCho({ code, trangThai: "OPEN", quyetDinh: "AP_DUNG" }) ?? "";
    for (const ma of TAT_CA) {
      const cau = nhac(ma);
      if (ma === "INPUT_DRIFT" || ma === "PAYMENT_WITHDRAWN") {
        expect(cau, `${ma} giải được bằng áp dụng/giữ nguyên`).toBe("");
        continue;
      }
      expect(cau, ma).toMatch(/không giải bằng áp dụng\/giữ nguyên/);
      expect(/dời sang kỳ sau/.test(cau), `${ma}: lời hứa dời kỳ phải khớp tập mã dời được`).toBe(MA_DOI_DUOC_SANG_KY_SAU.includes(ma));
    }
  });
});
