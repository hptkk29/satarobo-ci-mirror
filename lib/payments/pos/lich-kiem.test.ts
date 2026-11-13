// Ca [POS2-PL-07] · [POS2-QS-05] — LỊCH KIỂM của poller + khoá chuông theo giờ/ngày VN. THUẦN.
//
// Thiết kế: docs/pos-gd2-thiet-ke.md §3.1 (U10), §3.4 (U13), §5 (U14). Đồng hồ ĐÓNG BĂNG (luật 19).
import { describe, it, expect } from "vitest";
import {
  dieuKienPollerConHan,
  dieuKienPollerHetHan,
  chuongLoiKetNoiHeThong,
  khoaChuaXacDinhMay,
  khoaLoiKetNoiHeThong,
  khoaQuetSach,
  NGAN_SACH_POLLER_MS,
  NGAN_SACH_QUET_SACH_MS,
  NHIP_GIA_MS,
  NHIP_TRE_MS,
  TRAN_POLLER_CON_HAN,
  TRAN_POLLER_HET_HAN,
  TRAN_QUET_SACH,
  TRAN_THU_LAI_QUA_HAN_MS,
} from "./lich-kiem";
import { HAN_HIEN_THI_PHIEU_POS_MS } from "./phieu-pos-luat";

const NOW = new Date("2026-10-06T10:00:00Z");
const truoc = (ms: number) => new Date(NOW.getTime() - ms);

describe("[POS2-PL-07] điều kiện chọn phiếu của poller — hình dạng `where` với mốc đóng băng", () => {
  it("hằng: trần 30 + 30 phiếu/lượt, ngân sách 40 giây (< 60 ⇒ hai lượt cron không chồng), nhịp 50 giây / 10 phút", () => {
    expect(TRAN_POLLER_CON_HAN).toBe(30);
    expect(TRAN_POLLER_HET_HAN).toBe(30);
    expect(NGAN_SACH_POLLER_MS).toBe(40_000);
    expect(NGAN_SACH_POLLER_MS).toBeLessThan(60_000);
    expect(NHIP_TRE_MS).toBe(50_000);
    expect(NHIP_GIA_MS).toBe(10 * 60_000);
    expect(TRAN_QUET_SACH).toBe(300);
    // cron-call.sh --max-time 300 (deploy/cron-call.sh) ⇒ quét sạch phải xong trước đó.
    expect(NGAN_SACH_QUET_SACH_MS).toBe(240_000);
  });

  it("CÒN HẠN: phiếu MỞ · expiresAt > now · không tạo 'trong tương lai' · đến nhịp theo tuổi (mốc 30 phút)", () => {
    expect(dieuKienPollerConHan(NOW)).toEqual({
      status: { in: ["CHO_QUET", "THAT_BAI"] },
      expiresAt: { gt: NOW },
      createdAt: { lte: NOW },
      OR: [
        {
          createdAt: { gt: truoc(HAN_HIEN_THI_PHIEU_POS_MS) },
          OR: [{ lastCheckAt: null }, { lastCheckAt: { lte: truoc(50_000) } }],
        },
        {
          createdAt: { lte: truoc(HAN_HIEN_THI_PHIEU_POS_MS) },
          OR: [{ lastCheckAt: null }, { lastCheckAt: { lte: truoc(10 * 60_000) } }],
        },
      ],
    });
  });

  // [POS2-VA-02] (rà đối kháng 06/10, sửa CÓ CHỦ ĐÍCH): phiếu quá hạn mà lượt gần nhất CHƯA KẾT LUẬN được
  // (lỗi kết nối · pha tiền ném — `KIND_CHUA_KET_LUAN`) không bị ghi HET_HAN, nên phải được THỬ LẠI — nhưng
  // theo nhịp 10 phút và có trần tuổi, không hỏi mỗi phút mãi. Phiếu đã kết luận / chưa kiểm: như cũ.
  it("HẾT HẠN: phiếu MỞ có expiresAt ≤ now (biên `lte`); chưa kết luận ⇒ nhịp 10′, trần 6 ngày sau hạn", () => {
    expect(TRAN_THU_LAI_QUA_HAN_MS).toBe(6 * 24 * 60 * 60_000);
    expect(dieuKienPollerHetHan(NOW)).toEqual({
      status: { in: ["CHO_QUET", "THAT_BAI"] },
      expiresAt: { lte: NOW },
      OR: [
        { lastResultKind: null },
        { lastResultKind: { notIn: ["PROVIDER_ERROR", "PAID", "PAID_AMOUNT_MISMATCH"] } },
        {
          expiresAt: { gt: truoc(6 * 24 * 60 * 60_000) },
          OR: [{ lastCheckAt: null }, { lastCheckAt: { lte: truoc(10 * 60_000) } }],
        },
      ],
    });
  });
});

describe("[POS2-QS-05] khoá chuông theo NGÀY / GIỜ Việt Nam, không theo UTC", () => {
  it("quét sạch: 16:30Z ngày 06 = 23:30 VN ⇒ khoá ngày 06; 17:05Z ngày 06 = 00:05 VN ngày 07", () => {
    expect(khoaQuetSach(new Date("2026-10-06T16:30:00Z"))).toBe("pos.quet-sach:2026-10-06");
    expect(khoaQuetSach(new Date("2026-10-06T17:05:00Z"))).toBe("pos.quet-sach:2026-10-07");
  });

  it("lỗi kết nối từ nguồn máy: một khoá TOÀN HỆ THỐNG mỗi giờ VN", () => {
    expect(khoaLoiKetNoiHeThong(new Date("2026-10-06T10:00:00Z"))).toBe("pos.loi-ket-noi:he-thong:2026-10-06T17");
    expect(khoaLoiKetNoiHeThong(new Date("2026-10-06T10:59:59Z"))).toBe("pos.loi-ket-noi:he-thong:2026-10-06T17");
    expect(khoaLoiKetNoiHeThong(new Date("2026-10-06T17:00:00Z"))).toBe("pos.loi-ket-noi:he-thong:2026-10-07T00");
  });
});

describe("[POS2-VA-06] chuông lỗi kết nối TOÀN HỆ THỐNG trỏ Nhật ký của ĐÚNG NGÀY VN phát chuông", () => {
  // Rà đối kháng 06/10/2026: href cũ không mang ngày ⇒ màn nhật ký mặc định lọc "hôm nay" của người BẤM ⇒
  // chuông phát 23:40 VN, mở sáng hôm sau ra danh sách rỗng ("không có lỗi"). Biên ngày VN: 16:59:59Z / 17:00Z.
  it("16:59:59Z ngày 06 = 23:59:59 VN ngày 06 ⇒ tu=den=2026-10-06, thân ghi ngày 06/10 + khung 23:00–00:00", () => {
    const c = chuongLoiKetNoiHeThong(new Date("2026-10-06T16:59:59Z"), "TCB_FILE_DB");
    expect(c.dedupeKey).toBe("pos.loi-ket-noi:he-thong:2026-10-06T23");
    expect(c.href).toBe("/bien-dong-so-du/nhat-ky-pos?ketQua=PROVIDER_ERROR&tu=2026-10-06&den=2026-10-06");
    expect(c.body).toContain("ngày 06/10");
    expect(c.body).toContain("23:00–00:00");
    expect(c.title).toContain("TCB_FILE_DB");
  });

  it("17:00Z ngày 06 = 00:00 VN ngày 07 ⇒ tu=den=2026-10-07; mã lỗi trống ⇒ KHONG_RO", () => {
    const c = chuongLoiKetNoiHeThong(new Date("2026-10-06T17:00:00Z"), null);
    expect(c.dedupeKey).toBe("pos.loi-ket-noi:he-thong:2026-10-07T00");
    expect(c.href).toBe("/bien-dong-so-du/nhat-ky-pos?ketQua=PROVIDER_ERROR&tu=2026-10-07&den=2026-10-07");
    expect(c.body).toContain("ngày 07/10");
    expect(c.title).toContain("KHONG_RO");
  });

  it("nội dung ỔN ĐỊNH trong một giờ (không mang phút) — poller mỗi phút không ghi lại chuông vô ích", () => {
    const a = chuongLoiKetNoiHeThong(new Date("2026-10-06T10:00:05Z"), "X");
    const b = chuongLoiKetNoiHeThong(new Date("2026-10-06T10:59:00Z"), "X");
    expect(b).toEqual(a);
  });
});

describe("[POS2-VA-05a] khoá chuông 'chưa xác định' khi MÁY tự kiểm: một chuông / phiếu / NGÀY VN", () => {
  // Rà đối kháng 06/10/2026: khoá theo GIỜ + nhịp poller ⇒ ~24 chuông/phiếu/người tới khi hết hạn.
  it("cùng ngày VN ⇒ cùng khoá; biên 17:00Z sang ngày mới", () => {
    expect(khoaChuaXacDinhMay("i1", new Date("2026-10-06T10:00:00Z"))).toBe("pos.chua-xac-dinh:i1:2026-10-06");
    expect(khoaChuaXacDinhMay("i1", new Date("2026-10-06T16:59:59Z"))).toBe("pos.chua-xac-dinh:i1:2026-10-06");
    expect(khoaChuaXacDinhMay("i1", new Date("2026-10-06T17:00:00Z"))).toBe("pos.chua-xac-dinh:i1:2026-10-07");
  });
});
