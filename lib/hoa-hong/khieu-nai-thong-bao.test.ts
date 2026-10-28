// @vitest-environment node
/**
 * [NHH-DSP-N*] — nội dung thông báo khiếu nại (THUẦN). 05 §3: KHÔNG số tiền trong title/body, không chép lý do của người khiếu nại, link mở được đích.
 */
import { describe, it, expect } from "vitest";

import { classifyNotification } from "@/lib/notifications/catalog";
import { kiemPii } from "@/lib/notifications/pii";

import { dungTinKhieuNaiKetQua, dungTinKhieuNaiMoi, hrefKhieuNai } from "./khieu-nai-thong-bao";

const ID = "cmuzmk8e3003vgnr9r5b9yjnk";

describe("[NHH-DSP-N1] tin 'khiếu nại mới' (gửi HR)", () => {
  it("dedupeKey đúng tiền tố đã khai trong catalog, nhóm 'cần thực hiện' mức 2; thân tin có mã khiếu nại + kỳ, KHÔNG tiền / SĐT", () => {
    for (const laKhoanThu of [false, true]) {
      const t = dungTinKhieuNaiMoi({ disputeId: ID, ky: "2026-10", laKhoanThu });
      expect(t.dedupeKey).toBe(`hoa-hong.khieu-nai-moi:${ID}`);
      const c = classifyNotification(t.dedupeKey);
      expect(c.known, "tiền tố phải được khai ở catalog.ts").toBe(true);
      expect(c.groupKey).toBe("action_required");
      expect(c.priority).toBe(2);
      expect(t.body).toContain("2026-10");
      expect(t.body).toContain(ID.slice(-6).toUpperCase());
      const p = kiemPii(`${t.title}\n${t.body}`);
      expect(p).toEqual({ coSdt: false, coTien: false });
    }
  });

  it("link mở thẳng khiếu nại (Sheet) và là đường admin clean-URL (không tiền tố /admin)", () => {
    const t = dungTinKhieuNaiMoi({ disputeId: ID, ky: "2026-10", laKhoanThu: false });
    expect(t.href).toBe(hrefKhieuNai(ID));
    expect(t.href.startsWith("/nguon-hoa-hong/khieu-nai?mo=")).toBe(true);
    expect(t.href).not.toMatch(/^\/admin/);
  });
});

describe("[NHH-DSP-N2] tin 'kết quả' (gửi người khiếu nại)", () => {
  it("ba kết quả có câu riêng; lý do an toàn được chép vào thân tin; dedupeKey đã khai trong catalog (nhóm hệ thống)", () => {
    const thuTu = ["DUOC_DUYET_DIEU_CHINH_TIEN", "DUOC_DUYET_DOI_NGUON", "TU_CHOI"] as const;
    const bodies = thuTu.map((ketQua) => dungTinKhieuNaiKetQua({ disputeId: ID, ketQua, lyDoQuyetDinh: "Đã đối chiếu biên bản thoả thuận" }));
    expect(new Set(bodies.map((b) => b.body)).size).toBe(3);
    for (const b of bodies) {
      expect(b.body).toContain("Lý do: Đã đối chiếu biên bản thoả thuận");
      const c = classifyNotification(b.dedupeKey);
      expect(c.known).toBe(true);
      expect(c.groupKey).toBe("system");
      expect(kiemPii(`${b.title}\n${b.body}`)).toEqual({ coSdt: false, coTien: false });
    }
  });

  it("lý do HR có SỐ TIỀN hoặc SĐT ⇒ KHÔNG chép vào thân tin (chỉ chỉ sang màn có kiểm quyền); thân tin vẫn sạch", () => {
    for (const lyDo of ["Bù 80.000đ cho phần còn thiếu", "Đã gọi 0818823720 xác nhận với phụ huynh", "Điều chỉnh 1.200.000 theo biên bản"]) {
      const t = dungTinKhieuNaiKetQua({ disputeId: ID, ketQua: "DUOC_DUYET_DIEU_CHINH_TIEN", lyDoQuyetDinh: lyDo });
      expect(t.body, lyDo).not.toContain(lyDo);
      expect(t.body).toContain("Xem lý do quyết định trong màn Khiếu nại");
      expect(kiemPii(`${t.title}\n${t.body}`), lyDo).toEqual({ coSdt: false, coTien: false });
    }
  });

  it("lý do quá dài bị cắt; lý do rỗng ⇒ chỉ chỉ sang màn Khiếu nại", () => {
    const dai = "Đã đối chiếu hồ sơ ".repeat(30);
    const t = dungTinKhieuNaiKetQua({ disputeId: ID, ketQua: "TU_CHOI", lyDoQuyetDinh: dai });
    expect(t.body.length).toBeLessThan(300);
    expect(t.body).toContain("…");
    expect(dungTinKhieuNaiKetQua({ disputeId: ID, ketQua: "TU_CHOI", lyDoQuyetDinh: "   " }).body).toContain("Xem lý do quyết định");
  });
});
