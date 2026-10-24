// @vitest-environment node
/**
 * [XLR-*] — MÁY TRẠNG THÁI + LUẬT NHẬP LIỆU của xử lý tay referral (AFF-L3b). THUẦN.
 *
 *   [XLR-01] bảng (hành động × trạng thái) ĐẦY ĐỦ 5×5: đúng 9 ô cho phép, mọi ô còn lại bị từ chối
 *   [XLR-02] VALID · REJECTED · REJECTED_DUPLICATE là CUỐI: không hành động nào đi tiếp; câu từ chối chỉ đường «Đổi nguồn»
 *   [XLR-03] «xin/bổ sung bằng chứng» GIỮ trạng thái; DUYỆT → VALID; TỪ CHỐI → REJECTED; TRANH CHẤP → DISPUTED chỉ từ MANUAL_REVIEW
 *   [XLR-04] `cacHanhDongChoPhep` (thứ giao diện vẽ) KHỚP `chuyenTrangThai` (thứ máy chủ kiểm) ở mọi trạng thái — luật 12
 *   [XLR-05] lý do ≥ 10 ký tự SAU trim; ghi chú bằng chứng cùng ngưỡng; cả hai từ chối SĐT/email khách (mọi dạng), cho qua mã hợp đồng
 *   [XLR-06] `dangChoBangChung`: «xin» mới nhất chưa có «bổ sung» sau nó
 */
import { describe, expect, it } from "vitest";
import { TRANG_THAI_REFERRAL, type TrangThaiReferral } from "./ghi-referral-dau-vao";
import {
  HANH_DONG_CAN_GHI_CHU,
  HANH_DONG_XU_LY,
  LOAI_SU_KIEN,
  NHAN_HANH_DONG,
  NHAN_LOAI_SU_KIEN,
  TRANG_THAI_CON_XU_LY,
  cacHanhDongChoPhep,
  chuaPiiKhach,
  chuyenTrangThai,
  dangChoBangChung,
  kiemGhiChuBangChung,
  kiemLyDo,
  type HanhDongXuLy,
} from "./xu-ly-referral";

// Bảng sự thật VIẾT TAY, độc lập với bảng trong mã — khớp nó là bằng chứng, chép lại thì chỉ là tautology.
const MONG: Record<HanhDongXuLy, Partial<Record<TrangThaiReferral, TrangThaiReferral>>> = {
  DUYET: { MANUAL_REVIEW: "VALID", DISPUTED: "VALID" },
  TU_CHOI: { MANUAL_REVIEW: "REJECTED", DISPUTED: "REJECTED" },
  DANH_DAU_TRANH_CHAP: { MANUAL_REVIEW: "DISPUTED" },
  XIN_BANG_CHUNG: { MANUAL_REVIEW: "MANUAL_REVIEW", DISPUTED: "DISPUTED" },
  BO_SUNG_BANG_CHUNG: { MANUAL_REVIEW: "MANUAL_REVIEW", DISPUTED: "DISPUTED" },
};

describe("[XLR-01] bảng (hành động × trạng thái)", () => {
  for (const h of HANH_DONG_XU_LY) {
    for (const t of TRANG_THAI_REFERRAL) {
      const den = MONG[h][t];
      it(`${h} từ ${t} ⇒ ${den ?? "TỪ CHỐI"}`, () => {
        const r = chuyenTrangThai(t, h);
        if (den === undefined) expect(r.ok).toBe(false);
        else expect(r).toEqual({ ok: true, den });
      });
    }
  }
  it("tổng số ô cho phép = 9 (không thêm lặng lẽ một đường nào)", () => {
    let n = 0;
    for (const h of HANH_DONG_XU_LY) for (const t of TRANG_THAI_REFERRAL) if (chuyenTrangThai(t, h).ok) n += 1;
    expect(n).toBe(9); // DUYỆT 2 + TỪ CHỐI 2 + TRANH CHẤP 1 + XIN 2 + BỔ SUNG 2
  });
});

describe("[XLR-02] trạng thái CUỐI", () => {
  const CUOI: TrangThaiReferral[] = ["VALID", "REJECTED", "REJECTED_DUPLICATE"];
  it("không hành động nào đi tiếp từ trạng thái cuối — đặc biệt không REJECTED→VALID, VALID→REJECTED", () => {
    for (const t of CUOI) for (const h of HANH_DONG_XU_LY) expect(chuyenTrangThai(t, h).ok, `${h} từ ${t}`).toBe(false);
    expect(chuyenTrangThai("REJECTED", "DUYET").ok).toBe(false);
    expect(chuyenTrangThai("VALID", "TU_CHOI").ok).toBe(false);
  });
  it("câu từ chối nói «đã chốt» và chỉ đường «Đổi nguồn» (không câu chung chung)", () => {
    const r = chuyenTrangThai("REJECTED", "DUYET");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.loi).toContain("đã được chốt");
      expect(r.loi).toContain("Đổi nguồn");
    }
  });
  it("trạng thái còn xử lý được chỉ là MANUAL_REVIEW và DISPUTED", () => {
    expect([...TRANG_THAI_CON_XU_LY].sort()).toEqual(["DISPUTED", "MANUAL_REVIEW"]);
  });
  it("từ chối ở trạng thái CHƯA chốt thì câu nói theo hành động (không nói «đã chốt»)", () => {
    const r = chuyenTrangThai("DISPUTED", "DANH_DAU_TRANH_CHAP");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.loi).not.toContain("đã được chốt");
  });
});

describe("[XLR-04] nút vẽ ⇔ cổng máy chủ", () => {
  it("cacHanhDongChoPhep(t) = đúng tập hành động mà chuyenTrangThai(t, h).ok", () => {
    for (const t of TRANG_THAI_REFERRAL) {
      const mong = HANH_DONG_XU_LY.filter((h) => MONG[h][t] !== undefined);
      expect(cacHanhDongChoPhep(t), t).toEqual(mong);
    }
  });
  it("trạng thái cuối ⇒ KHÔNG nút nào; MANUAL_REVIEW ⇒ cả năm", () => {
    expect(cacHanhDongChoPhep("VALID")).toEqual([]);
    expect(cacHanhDongChoPhep("REJECTED")).toEqual([]);
    expect(cacHanhDongChoPhep("REJECTED_DUPLICATE")).toEqual([]);
    expect(cacHanhDongChoPhep("MANUAL_REVIEW")).toHaveLength(5);
    expect(cacHanhDongChoPhep("DISPUTED")).not.toContain("DANH_DAU_TRANH_CHAP");
  });
});

describe("[XLR-05] lý do · ghi chú bằng chứng · PII", () => {
  it("lý do: trim rồi mới đếm 10 ký tự; 9 ký tự (kể cả đệm khoảng trắng) bị từ chối", () => {
    expect(kiemLyDo("   tám ký tự ").ok).toBe(false); // 9 ký tự sau trim
    expect(kiemLyDo("không hợp lệ").ok).toBe(true); // 12
    expect(kiemLyDo("         x         ").ok).toBe(false);
    expect(kiemLyDo(undefined).ok).toBe(false);
    expect(kiemLyDo(123).ok).toBe(false);
    const ok = kiemLyDo("  Đã xác nhận qua biên nhận  ");
    expect(ok).toEqual({ ok: true, gia: "Đã xác nhận qua biên nhận" });
  });
  it("lý do tối đa 500 ký tự, ghi chú tối đa 2000", () => {
    expect(kiemLyDo("a".repeat(500)).ok).toBe(true);
    expect(kiemLyDo("a".repeat(501)).ok).toBe(false);
    expect(kiemGhiChuBangChung("a".repeat(2000)).ok).toBe(true);
    expect(kiemGhiChuBangChung("a".repeat(2001)).ok).toBe(false);
  });
  it("ghi chú bằng chứng cùng ngưỡng 10 ký tự", () => {
    expect(kiemGhiChuBangChung("ngắn quá").ok).toBe(false);
    expect(kiemGhiChuBangChung("Biên nhận số BN-2026-0042 do chị Lan ký").ok).toBe(true);
  });
  it("chặn SĐT mọi dạng: 0xxxxxxxxx · 84… · +84… · có cách/chấm/gạch · dán giữa câu", () => {
    for (const s of ["0907111222", "84907111222", "+84907111222", "0907 111 222", "0907.111.222", "0907-111-222", "khách gọi 0907111222 hôm qua", "+84 907 111 222", "907111222"]) {
      expect(chuaPiiKhach(s), s).toBe(true);
      expect(kiemLyDo(`Khách xác nhận qua số ${s} rồi`).ok, `lý do: ${s}`).toBe(false);
      expect(kiemGhiChuBangChung(`Biên nhận ghi số ${s} của khách`).ok, `ghi chú: ${s}`).toBe(false);
    }
  });
  it("chặn SĐT viết với ký tự trình bày lạ (gạch dưới · gạch chéo · ngoặc) và email viết né «[at]»", () => {
    for (const s of ["0907_111_222", "(0907)111/222", "(+84) 907-111-222", "0907 / 111 / 222", "ten [at] gmail [dot] com", "ten(at)gmail.com"]) {
      expect(chuaPiiKhach(s), s).toBe(true);
      expect(kiemLyDo(`Khách xác nhận qua ${s} rồi`).ok, `lý do: ${s}`).toBe(false);
      expect(kiemGhiChuBangChung(`Biên nhận ghi ${s} của khách`).ok, `ghi chú: ${s}`).toBe(false);
    }
  });
  it("chặn email", () => {
    expect(chuaPiiKhach("liên hệ khach@example.com")).toBe(true);
    expect(kiemGhiChuBangChung("Email khach.hang@gmail.com đã xác nhận").ok).toBe(false);
  });
  it("cho qua số hợp đồng / biên nhận / ngày không phải SĐT (đối chứng dương — chặn quá tay cũng là lỗi)", () => {
    for (const s of ["HD-20261013-0001", "biên nhận 2026101300", "Phiếu #A1B2C3 ngày 13/10/2026", "BN 12345", "mã 1234567890123", "BN_2026_10_13_0042", "Hợp đồng (HD) 2026/10/0042 ký ngày 13.10.2026", "Phiếu thu số 001/2026/PT (bản 2)"]) {
      expect(chuaPiiKhach(s), s).toBe(false);
    }
    expect(kiemLyDo("Theo biên nhận HD-20261013-0001 đã ký").ok).toBe(true);
  });
});

describe("[XLR-03] bằng chứng bắt buộc theo hành động", () => {
  it("CẢ NĂM hành động đều cần ghi chú bằng chứng (brief: «bắt buộc ở MỌI hành động»)", () => {
    expect(HANH_DONG_CAN_GHI_CHU).toEqual({ DUYET: true, TU_CHOI: true, DANH_DAU_TRANH_CHAP: true, XIN_BANG_CHUNG: true, BO_SUNG_BANG_CHUNG: true });
  });
  it("nhãn tiếng Việt đủ cho mọi hành động và loại sự kiện", () => {
    for (const h of HANH_DONG_XU_LY) expect(NHAN_HANH_DONG[h].length).toBeGreaterThan(2);
    for (const l of LOAI_SU_KIEN) expect(NHAN_LOAI_SU_KIEN[l].length).toBeGreaterThan(2);
    expect(NHAN_LOAI_SU_KIEN.KHAI_TAY).toBe("Khai tay");
  });
});

describe("[XLR-06] đang chờ bằng chứng", () => {
  const e = (...l: Parameters<typeof dangChoBangChung>[0][number]["loai"][]) => l.map((loai) => ({ loai }));
  it("không có sự kiện / chưa từng xin ⇒ không chờ", () => {
    expect(dangChoBangChung([])).toBe(false);
    expect(dangChoBangChung(e("KHAI_TAY"))).toBe(false);
    expect(dangChoBangChung(e("DANH_DAU_TRANH_CHAP"))).toBe(false);
  });
  it("xin xong chưa bổ sung ⇒ chờ; bổ sung sau xin ⇒ hết chờ; xin lại sau bổ sung ⇒ chờ lại", () => {
    expect(dangChoBangChung(e("KHAI_TAY", "XIN_BANG_CHUNG"))).toBe(true);
    expect(dangChoBangChung(e("XIN_BANG_CHUNG", "BO_SUNG_BANG_CHUNG"))).toBe(false);
    expect(dangChoBangChung(e("XIN_BANG_CHUNG", "BO_SUNG_BANG_CHUNG", "XIN_BANG_CHUNG"))).toBe(true);
    expect(dangChoBangChung(e("XIN_BANG_CHUNG", "DANH_DAU_TRANH_CHAP"))).toBe(true); // chuyển sang tranh chấp không tự đóng yêu cầu bằng chứng
  });
});
