// [GKH-*] — LÕI THUẦN của «gắn thêm một khoản thu vào hoá đơn đã xác nhận» (`gan-them-khoan.ts`). Không DB.
//
// Fixture mang HÌNH DẠNG CA THẬT (đo 06/11/2026): đơn 8.976.000đ thu hai lần — đợt 1 1.000.000đ (đã nằm trong hoá đơn 1C26MAI-16),
// đợt 2 7.976.000đ (còn "Chờ xuất"). Tờ giấy MISA số 16 ghi 8.976.000đ.
import { describe, expect, it } from "vitest";
import {
  lapKeHoachGanKhoan,
  quyetDinhGhiGanKhoan,
  shaDongKy,
  type DuLieuGanKhoan,
  type KhoanUngVien,
} from "./gan-them-khoan";

const MUC = { maDon: "ORD-261011-000001", kyHieu: "1C26MAI", soHoaDon: "16", maGiaoDich: "FT26310040803067", tongTrenToGiay: 8_976_000 };

const khoanDot2 = (o: Partial<KhoanUngVien> = {}): KhoanUngVien => ({
  paymentId: "pay-dot2",
  rong: 7_976_000,
  laDongThuGoc: true,
  thuocDon: true,
  dangNamTrong: [],
  ...o,
});

function du(o: Partial<DuLieuGanKhoan> = {}): DuLieuGanKhoan {
  return {
    muc: MUC,
    don: { id: "don-1", code: MUC.maDon, daHuyHoacXoa: false },
    hoaDon: [
      {
        id: "hd-16",
        trangThai: "DA_XAC_NHAN",
        nguonPhatHanh: "TAI_LEN",
        tongTien: 1_000_000,
        soDongHub: 0,
        khoanSong: [{ paymentId: "pay-dot1", soTien: 1_000_000 }],
      },
    ],
    khoan: [khoanDot2()],
    yeuCauHoanChan: null,
    ...o,
  };
}

const maLoi = (d: DuLieuGanKhoan) => lapKeHoachGanKhoan(d).loi.map((l) => l.ma);

describe("[GKH-00] ca thật: gắn đợt 2 vào hoá đơn 16", () => {
  it("[GKH-00a] ra ĐÚNG một dòng ghi: số tiền = tiền ròng của khoản, tổng 1.000.000 → 8.976.000, khớp tờ giấy", () => {
    const kh = lapKeHoachGanKhoan(du());
    expect(kh.loi).toEqual([]);
    expect(kh.daXong).toBe(false);
    expect(kh.ghi).toEqual({ hoaDonId: "hd-16", paymentId: "pay-dot2", soTien: 7_976_000, tongTruoc: 1_000_000, tongSau: 8_976_000 });
    expect(kh.khopToGiay).toBe(true);
    expect(kh.dongDauRa).toEqual(["gan-khoan-hoa-don/v1|ORD-261011-000001|1C26MAI-16|hd-16|pay-dot2|7976000|1000000|8976000"]);
    expect(kh.sha).toBe(shaDongKy(kh.dongDauRa));
  });

  it("[GKH-00b] dùng tiền RÒNG, không dùng số tiền gốc: khoản đã bị đảo một phần thì tổng sau theo số ròng", () => {
    const kh = lapKeHoachGanKhoan(du({ khoan: [khoanDot2({ rong: 7_000_000 })], muc: { ...MUC, tongTrenToGiay: 8_000_000 } }));
    expect(kh.ghi?.soTien).toBe(7_000_000);
    expect(kh.ghi?.tongSau).toBe(8_000_000);
  });

  it("[GKH-00c] dòng ký KHÔNG chứa tên / SĐT / email — chỉ mã đơn, số hoá đơn, id, số tiền", () => {
    const dong = lapKeHoachGanKhoan(du()).dongDauRa.join("\n");
    expect(dong).not.toMatch(/@|\b0\d{9}\b/);
  });

  it("[GKH-00d] đổi bất kỳ mục tiêu nào (đơn / số hoá đơn / khoản) là đổi dòng ký ⇒ đổi sha — chữ ký không dùng lại cho việc khác", () => {
    const goc = lapKeHoachGanKhoan(du()).sha;
    const khac = lapKeHoachGanKhoan(du({ khoan: [khoanDot2({ paymentId: "pay-khac" })] })).sha;
    const khacSo = lapKeHoachGanKhoan(du({ muc: { ...MUC, soHoaDon: "17" } })).sha;
    expect(new Set([goc, khac, khacSo]).size).toBe(3);
  });
});

describe("[GKH-01] đối chiếu với tờ giấy", () => {
  it("[GKH-01a] tổng SAU lệch tờ giấy ⇒ TỪ CHỐI, không có dòng ghi", () => {
    const kh = lapKeHoachGanKhoan(du({ muc: { ...MUC, tongTrenToGiay: 9_000_000 } }));
    expect(kh.loi.map((l) => l.ma)).toEqual(["TONG_KHONG_KHOP_TO_GIAY"]);
    expect(kh.ghi).toBeNull();
    expect(kh.khopToGiay).toBe(false);
  });

  it("[GKH-01b] chưa khai tờ giấy: CHẠY THỬ vẫn ra kế hoạch (để owner xem) nhưng GHI bị chặn", () => {
    const kh = lapKeHoachGanKhoan(du({ muc: { ...MUC, tongTrenToGiay: null } }));
    expect(kh.loi).toEqual([]);
    expect(kh.ghi).not.toBeNull();
    expect(kh.khopToGiay).toBeNull();
    expect(quyetDinhGhiGanKhoan({ kh, tongTrenToGiay: null, soDuyet: 1, ghiDuoc: true })).toMatch(/tờ hoá đơn giấy/);
  });
});

describe("[GKH-02] mỗi cổng từ chối đúng lý do của nó", () => {
  const hd = (o: Partial<DuLieuGanKhoan["hoaDon"][number]>) => [{ ...du().hoaDon[0]!, ...o }];
  const ca: [string, DuLieuGanKhoan, string][] = [
    ["không có đơn", du({ don: null }), "KHONG_THAY_DON"],
    ["đơn đã huỷ / xoá", du({ don: { id: "don-1", code: MUC.maDon, daHuyHoacXoa: true } }), "DON_DA_HUY"],
    ["không thấy hoá đơn", du({ hoaDon: [] }), "KHONG_THAY_HOA_DON"],
    ["hai hoá đơn cùng ký hiệu + số", du({ hoaDon: [...du().hoaDon, { ...du().hoaDon[0]!, id: "hd-khac" }] }), "NHIEU_HOA_DON_KHOP"],
    ["hoá đơn còn NHÁP", du({ hoaDon: hd({ trangThai: "NHAP" }) }), "HOA_DON_SAI_TRANG_THAI"],
    ["hoá đơn đã huỷ (THAY_THE)", du({ hoaDon: hd({ trangThai: "THAY_THE" }) }), "HOA_DON_SAI_TRANG_THAI"],
    ["hoá đơn do MISA API phát hành", du({ hoaDon: hd({ nguonPhatHanh: "MISA_API" }) }), "HOA_DON_KHONG_PHAI_TAI_LEN"],
    ["hoá đơn có dòng Hub", du({ hoaDon: hd({ soDongHub: 2 }) }), "HOA_DON_CO_DONG_HUB"],
    ["tổng đang lệch sẵn so với Σ khoản", du({ hoaDon: hd({ tongTien: 1_500_000 }) }), "TONG_DANG_LECH_SAN"],
    ["không thấy khoản", du({ khoan: [] }), "KHONG_THAY_KHOAN"],
    ["nhiều khoản cùng mã giao dịch", du({ khoan: [khoanDot2(), khoanDot2({ paymentId: "pay-x" })] }), "NHIEU_KHOAN_KHOP"],
    ["khoản thuộc đơn khác", du({ khoan: [khoanDot2({ thuocDon: false })] }), "KHOAN_KHONG_THUOC_DON"],
    ["khoản là bút toán đảo / đã xoá", du({ khoan: [khoanDot2({ laDongThuGoc: false })] }), "KHOAN_KHONG_PHAI_DONG_THU"],
    ["khoản hết tiền ròng", du({ khoan: [khoanDot2({ rong: 0 })] }), "KHOAN_KHONG_CON_TIEN"],
    [
      "khoản đang nằm trong hoá đơn NHÁP khác (kế toán đã bắt đầu tải số 17)",
      du({ khoan: [khoanDot2({ dangNamTrong: [{ hoaDonId: "hd-17", trangThai: "NHAP", kyHieu: "1C26MAI", soHoaDon: "17" }] })] }),
      "KHOAN_DANG_NAM_TRONG_HOA_DON_KHAC",
    ],
    [
      "khoản đang nằm trong hoá đơn KHÔNG XUẤT (đã đánh dấu «đã xuất ngoài hệ thống»)",
      du({ khoan: [khoanDot2({ dangNamTrong: [{ hoaDonId: "hd-kx", trangThai: "KHONG_XUAT", kyHieu: null, soHoaDon: null }] })] }),
      "KHOAN_DANG_NAM_TRONG_HOA_DON_KHAC",
    ],
    ["có yêu cầu hoàn chạm khoản", du({ yeuCauHoanChan: "Có yêu cầu hoàn học phí đang chờ" }), "CO_YEU_CAU_HOAN"],
  ];
  it.each(ca)("%s ⇒ %s", (_ten, d, ma) => {
    const kh = lapKeHoachGanKhoan(d);
    expect(kh.loi.map((l) => l.ma)).toContain(ma);
    expect(kh.ghi).toBeNull();
    expect(kh.dongDauRa).toEqual([]);
    expect(kh.daXong).toBe(false);
  });

  it("[GKH-02z] không cổng nào trả lỗi ở ca sạch (đối chứng dương cho cả bảng trên)", () => {
    expect(maLoi(du())).toEqual([]);
  });
});

describe("[GKH-03] idempotent — chạy lại sau khi ghi", () => {
  const daGan = () =>
    du({
      hoaDon: [
        {
          ...du().hoaDon[0]!,
          tongTien: 8_976_000,
          khoanSong: [
            { paymentId: "pay-dot1", soTien: 1_000_000 },
            { paymentId: "pay-dot2", soTien: 7_976_000 },
          ],
        },
      ],
      khoan: [khoanDot2({ dangNamTrong: [{ hoaDonId: "hd-16", trangThai: "DA_XAC_NHAN", kyHieu: "1C26MAI", soHoaDon: "16" }] })],
    });

  it("[GKH-03a] khoản đã nằm đúng hoá đơn này và tổng đã đủ ⇒ daXong, KHÔNG lỗi, KHÔNG dòng ký (không qua cổng, không claim)", () => {
    const kh = lapKeHoachGanKhoan(daGan());
    expect(kh.loi).toEqual([]);
    expect(kh.daXong).toBe(true);
    expect(kh.ghi).toBeNull();
    expect(kh.dongDauRa).toEqual([]);
  });

  it("[GKH-03b] khoản đã gắn nhưng tổng KHÔNG khớp Σ khoản ⇒ không coi là xong (báo lệch, không im lặng)", () => {
    const d = daGan();
    d.hoaDon[0]!.tongTien = 1_000_000;
    const kh = lapKeHoachGanKhoan(d);
    expect(kh.daXong).toBe(false);
    expect(kh.loi.map((l) => l.ma)).toContain("TONG_DANG_LECH_SAN");
  });
});

describe("[GKH-04] cổng quyết định GHI (`quyetDinhGhiGanKhoan`)", () => {
  const kh = lapKeHoachGanKhoan(du());
  const ok = { kh, tongTrenToGiay: 8_976_000, soDuyet: 1, ghiDuoc: true as boolean | null };
  it("[GKH-04a] đủ điều kiện ⇒ null (được ghi)", () => expect(quyetDinhGhiGanKhoan(ok)).toBeNull());
  it("[GKH-04b] thiếu / sai --expect ⇒ chặn", () => {
    expect(quyetDinhGhiGanKhoan({ ...ok, soDuyet: null })).toMatch(/--expect/);
    expect(quyetDinhGhiGanKhoan({ ...ok, soDuyet: 2 })).toMatch(/--expect=2/);
  });
  it("[GKH-04c] không kiểm được / không có quyền ghi ⇒ chặn (không ghi khi KHÔNG BIẾT)", () => {
    expect(quyetDinhGhiGanKhoan({ ...ok, ghiDuoc: null })).toMatch(/Không kiểm được/);
    expect(quyetDinhGhiGanKhoan({ ...ok, ghiDuoc: false })).toMatch(/không có quyền ghi/);
  });
  it("[GKH-04d] kế hoạch có lỗi ⇒ chặn, kể cả khi đã đủ --expect", () => {
    const loi = lapKeHoachGanKhoan(du({ khoan: [] }));
    expect(quyetDinhGhiGanKhoan({ ...ok, kh: loi })).toMatch(/KHONG_THAY_KHOAN/);
  });
  it("[GKH-04e] đã xong ⇒ null (chạy lại là không-làm-gì, không đòi --expect)", () => {
    const xong = { ...kh, daXong: true, ghi: null, dongDauRa: [] };
    expect(quyetDinhGhiGanKhoan({ kh: xong, tongTrenToGiay: null, soDuyet: null, ghiDuoc: true })).toBeNull();
  });
});
