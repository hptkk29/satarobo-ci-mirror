/* eslint-disable @typescript-eslint/no-explicit-any -- helper `hong` làm hỏng MỘT thứ trên bản sao sâu của dữ liệu `readonly`; kiểu `any` ở đây là cố ý (như `dat-truoc.test.ts`). */
// [GPG-*] — LÕI THUẦN của «gắn Payment.enrollmentId cho 9 khoản của 6 đơn» (PHASE B.2). Không DB. Mỗi mã lỗi có MỘT ca làm hỏng ĐÚNG MỘT điều kiện của dữ liệu hợp lệ (dữ liệu hợp lệ dựng từ SỐ ĐẾM của bảng cứng,
// nên ca vẫn đúng khi bảng đổi). Đã CẤY LỖI vào lõi (xem tài liệu 19 §Cấy lỗi).
//
// ⚠️ Tệp này lên gương CI công khai: KHÔNG có định danh tài chính thật. Mọi id/mã giao dịch dưới đây là chuỗi giả dựng từ mã đơn (`kh-<mã đơn>-<k>`, `gd-<mã đơn>-<k>`). Lưới `[GPG-W16]` canh điều đó.
import { describe, expect, it } from "vitest";
import {
  BANG_GAN_PAYMENT,
  HANH_DONG_GAN_PAYMENT_LUOT,
  KHUON_DONG_GAN_PAYMENT,
  MA_LOI_GAN_PAYMENT,
  dongDauRaGanPayment,
  dungBanGhiLuotGanPayment,
  khoaLuotChayGanPayment,
  lapKeHoachGanPayment,
  maGiaoDichTrongGhiChu,
  phanTichSoDuyetGanPayment,
  quyetDinhGhiGanPayment,
  shaKeHoachGanPayment,
  type DuLieuGanPayment,
  type MucGanPayment,
} from "./gan-payment-ghi-danh";

const MA = Object.keys(BANG_GAN_PAYMENT);
const CS = "co-so-test";
// Hằng thay cho dạng «khoá: chuỗi» của hai trạng thái khoản: lưới quét cả cây, kể cả chú thích (`ghi-nhan.test.ts`, `truc-a.test.ts`), cấm gõ tay hai điều kiện đó ngoài nhà của chúng —
// ở đây chúng là DỮ LIỆU MẪU của trạng thái khoản, không phải bộ lọc đọc tiền.
const DA_GHI_NHAN = "RECORDED";
const DA_XAC_NHAN = "CONFIRMED";

/** Số tiền giả của từng khoản: phân biệt nhau, cộng lại đúng giá đích. */
function soTien(m: MucGanPayment): number[] {
  const a = Array.from({ length: m.soKhoan - 1 }, (_x, k) => (k + 1) * 1_000);
  return [...a, m.giaDich - a.reduce((s, x) => s + x, 0)];
}
const idKhoan = (code: string, k: number) => `kh-${code}-${k}`;
const maGd = (code: string, k: number) => `gd-${code}-${k}`;
const ghiDanhDich = (code: string) => `ghi-danh-${code}`;
const dongDonId = (code: string) => `dong-${code}`;

function hopLe(code: string, bang: Readonly<Record<string, MucGanPayment>> = BANG_GAN_PAYMENT): DuLieuGanPayment {
  const m = bang[code]!;
  const hv = `hv-${code}`;
  const tien = soTien(m);
  const dich = ghiDanhDich(code);
  return {
    don: { id: `don-${code}`, code, type: "COURSE", deletedAt: null, studentId: hv, centerId: CS, totalAmount: m.giaDich, items: [{ id: dongDonId(code), type: "COURSE_ENROLLMENT", studentId: hv, enrollmentId: dich }] },
    ghiDanh: { id: dich, studentId: hv, status: "ACTIVE", centerId: CS, deletedAt: null, discountType: "PERCENT", tuition: m.giaDich, finalPrice: m.giaDich },
    paymentSong: tien.map((amount, k) => ({
      id: idKhoan(code, k), amount, paymentType: "PAYMENT", saleStatus: DA_GHI_NHAN, accountantStatus: DA_XAC_NHAN, enrollmentId: null, orderItemId: dongDonId(code), adjustmentOfId: null, centerId: CS,
      note: `Tiền về qua SEPAY ${maGd(code, k)} [auto:sepay:${maGd(code, k)}]`,
    })),
    paymentDaXoa: Array.from({ length: m.soKhoanDaXoa }, (_x, k) => ({ id: `xoa-${code}-${k}`, enrollmentId: null })),
    nganHang: tien.map((amount, k) => ({ id: `bt-${code}-${k}`, provider: "SEPAY", providerTxnId: maGd(code, k), amount, status: "MATCHED", centerId: CS, tongPhanBo: amount, phanBoVaoDon: amount })),
    tongPhanBoDon: m.giaDich,
    trongHoaDon: Object.fromEntries(Array.from({ length: m.soKhoanTrongHoaDon }, (_x, k) => [idKhoan(code, k), `hd-${code}`])),
    tacDungPhu: 0,
    paymentNgoaiGanGhiDanh: 0,
    plannerChuan: tien.map((amount, k) => ({ paymentId: idKhoan(code, k), ketQua: "GAN" as const, soPhan: 1, enrollmentId: dich, amount, giuNguyenTien: true, maBoQua: null })),
  };
}
const tatCa = () => MA.map((c) => hopLe(c));
/** Nhân bản sâu rồi cho `sua` làm hỏng MỘT thứ trên đơn `code`; trả toàn bộ dữ liệu 6 đơn. */
function hong(code: string, sua: (d: any) => void): DuLieuGanPayment[] {
  return MA.map((c) => {
    const d = structuredClone(hopLe(c)) as any;
    if (c === code) sua(d);
    return d as DuLieuGanPayment;
  });
}
/** Mọi khoản của mọi đơn đã gắn ĐÚNG ghi danh đích (trạng thái «chạy lại»). */
function daGanHetDu(sua?: (code: string, d: any) => void): DuLieuGanPayment[] {
  return MA.map((c) => {
    const d = structuredClone(hopLe(c)) as any;
    d.paymentSong.forEach((p: any) => (p.enrollmentId = ghiDanhDich(c)));
    d.plannerChuan = [];
    sua?.(c, d);
    return d as DuLieuGanPayment;
  });
}
const lap = (du: readonly DuLieuGanPayment[]) => lapKeHoachGanPayment({ bang: BANG_GAN_PAYMENT, du });
const maLoi = (du: readonly DuLieuGanPayment[]) => lap(du).loi.map((l) => l.ma);

const D1 = "ORD-260831-000001"; // 2 khoản, cả hai trong hoá đơn
const D2 = "ORD-260910-000002"; // có khoản xoá mềm
const D3 = "ORD-260910-000005";
const D8 = "ORD-260910-000008"; // 3 khoản

describe("[GPG-01] đường thuận", () => {
  it("[GPG-01a] dữ liệu hợp lệ ⇒ không lỗi, ghi ĐÚNG 9 khoản theo thứ tự bảng, 6/6 đơn nợ dự kiến 0, chưa 'gắn hết'", () => {
    const k = lap(tatCa());
    expect(k.loi).toEqual([]);
    expect(k.dung).toBe(false);
    expect(k.daGanHet).toBe(false);
    expect(k.ghi).toHaveLength(9);
    expect(k.muc.map((m) => m.trangThai)).toEqual(Array(6).fill("CHUA_GAN"));
    expect(k.muc.map((m) => m.noDuKien)).toEqual(Array(6).fill(0));
    expect(k.muc.map((m) => m.soChuaGan)).toEqual(MA.map((c) => BANG_GAN_PAYMENT[c]!.soKhoan));
    expect(k.ghi.map((g) => g.code)).toEqual(MA.flatMap((c) => Array(BANG_GAN_PAYMENT[c]!.soKhoan).fill(c)));
    expect(k.ghi.map((g) => g.paymentId)).toEqual(MA.flatMap((c) => soTien(BANG_GAN_PAYMENT[c]!).map((_x, i) => idKhoan(c, i))));
  });

  it("[GPG-01b] dòng ký: đúng khuôn, 9 dòng, mang id khoản · số tiền · ghi danh · mã giao dịch của ỨNG VIÊN đọc từ dữ liệu · hoá đơn ('-' nếu không); sha là sha256 của các dòng nối '\\n'", () => {
    const k = lap(tatCa());
    expect(k.dongDauRa).toHaveLength(9);
    const d1 = k.dongDauRa[0]!.split("|");
    expect(d1).toEqual([KHUON_DONG_GAN_PAYMENT, "don-" + D1, D1, idKhoan(D1, 0), String(soTien(BANG_GAN_PAYMENT[D1]!)[0]), ghiDanhDich(D1), maGd(D1, 0), `hd-${D1}`]);
    expect(k.dongDauRa.filter((d) => d.endsWith("|-"))).toHaveLength(7); // 9 khoản − 2 khoản trong hoá đơn
    expect(k.dongDauRa).toEqual(dongDauRaGanPayment(k.ghi));
    expect(k.sha).toBe(shaKeHoachGanPayment(k.dongDauRa));
    expect(k.sha).toMatch(/^[0-9a-f]{64}$/);
  });

  it("[GPG-01b2] mã giao dịch trong dòng ký là mã của giao dịch ĐỌC ĐƯỢC từ dữ liệu, không phải chuỗi nào trong mã nguồn: đổi mã ở dữ liệu ⇒ dòng ký đổi theo", () => {
    const du = hong(D3, (d) => {
      d.nganHang[0].providerTxnId = "ma-doc-tu-du-lieu-xyz";
      d.paymentSong[0].note = null; // ghi chú không khai mã nào: tín hiệu phụ vắng, KHÔNG phải căn cứ quyết định
    });
    const k = lap(du);
    expect(k.loi).toEqual([]);
    expect(k.dongDauRa.find((r) => r.includes(`|${D3}|`))).toContain("|ma-doc-tu-du-lieu-xyz|");
  });

  it("[GPG-01c] thứ tự mảng đầu vào không đổi kế hoạch / sha (thứ tự lấy từ BẢNG)", () => {
    const a = lap(tatCa());
    const b = lap([...tatCa()].reverse());
    expect(b.dongDauRa).toEqual(a.dongDauRa);
    expect(b.sha).toBe(a.sha);
    // …và thứ tự khoản / giao dịch trong từng đơn cũng không đổi dòng ký.
    const dao = tatCa().map((d) => ({ ...d, paymentSong: [...d.paymentSong].reverse(), nganHang: [...d.nganHang].reverse() }));
    expect(lap(dao).dongDauRa).toEqual(a.dongDauRa);
  });

  it("[GPG-01d] CHẠY LẠI: cả 9 khoản đã gắn ĐÚNG ghi danh đích ⇒ không lỗi, ghi 0, daGanHet — không cần planner", () => {
    const k = lap(daGanHetDu());
    expect(k.loi).toEqual([]);
    expect(k.ghi).toHaveLength(0);
    expect(k.daGanHet).toBe(true);
    expect(k.muc.map((m) => m.trangThai)).toEqual(Array(6).fill("DA_GAN"));
    expect(k.muc.map((m) => m.soChuaGan)).toEqual(Array(6).fill(0));
    expect(k.dongDauRa).toEqual([]);
  });
});

describe("[GPG-01e] 'đã gắn hết' chỉ khi KHÔNG lỗi", () => {
  it("[GPG-01e] cả 9 khoản đã gắn đúng NHƯNG tiền một khoản lệch giá đích ⇒ lỗi + daGanHet=false (không báo «xong» trên lô có lỗi)", () => {
    const k = lap(daGanHetDu((c, d) => { if (c === D1) d.paymentSong[0].amount += 1; }));
    expect(k.dung).toBe(true);
    expect(k.daGanHet).toBe(false);
    expect(k.ghi).toEqual([]);
  });

  it("[GPG-01f] lỗi CẤP LÔ với mọi đơn đã gắn đúng (hai đơn cùng ghi danh đích, đọc từ DỮ LIỆU) ⇒ daGanHet=false — mức đơn không thấy lỗi này nên `!dung` KHÔNG thừa", () => {
    const [a, b] = MA as [string, string];
    const du = daGanHetDu((c, d) => {
      if (c !== b) return;
      d.don.items[0].enrollmentId = ghiDanhDich(a);
      d.ghiDanh.id = ghiDanhDich(a);
      d.paymentSong.forEach((p: any) => (p.enrollmentId = ghiDanhDich(a)));
    });
    const k = lap(du);
    expect(k.muc.every((m) => m.loi.length === 0 && m.trangThai === "DA_GAN")).toBe(true);
    expect(k.loi.map((l) => l.ma)).toEqual(["TRUNG_GHI_DANH"]);
    expect(k.dung).toBe(true);
    expect(k.daGanHet).toBe(false);
  });
});

/**
 * BẢN AUDIT ĐỘC LẬP (đo trên PROD 24/10/2026): bảng cứng là dữ liệu NHẬP TAY, mà dữ liệu dựng từ chính bảng thì không bao giờ bắt được lỗi gõ nhầm một ký tự/chữ số.
 * Danh sách dưới đây được chép riêng từ kết quả audit; lệch với `BANG_GAN_PAYMENT` là đỏ. Chỉ gồm mã đơn · giá đích · số đếm — không định danh tài chính.
 */
const AUDIT_24_10: ReadonlyArray<readonly [string, number, number, number, number]> = [
  // [mã đơn, giá đích, khoản sống, khoản xoá mềm, khoản trong hoá đơn]
  ["ORD-260831-000001", 8_976_000, 2, 0, 2],
  ["ORD-260908-000003", 8_976_000, 1, 0, 0],
  ["ORD-260910-000002", 8_976_000, 1, 1, 0],
  ["ORD-260910-000005", 8_976_000, 1, 0, 0],
  ["ORD-260910-000006", 9_792_000, 1, 0, 0],
  ["ORD-260910-000008", 8_976_000, 3, 0, 0],
];

describe("[GPG-08] bảng cứng khớp bản audit độc lập", () => {
  it("[GPG-08a] 6 đơn · giá đích · số khoản sống · khoản xoá mềm · khoản trong hoá đơn khớp từng chữ số; tổng đúng 9 khoản / 6 đơn", () => {
    const tuBang = Object.entries(BANG_GAN_PAYMENT).map(([code, m]) => [code, m.giaDich, m.soKhoan, m.soKhoanDaXoa, m.soKhoanTrongHoaDon] as const);
    expect(tuBang).toEqual(AUDIT_24_10);
    expect(Object.values(BANG_GAN_PAYMENT).reduce((s, m) => s + m.soKhoan, 0)).toBe(9);
    expect(Object.keys(BANG_GAN_PAYMENT)).toHaveLength(6);
  });
  it("[GPG-08b] giá đích mỗi đơn: 5 đơn Sata3 = 8.976.000, ORD-260910-000006 = 9.792.000 (PHASE B.1)", () => {
    expect(Object.entries(BANG_GAN_PAYMENT).map(([c, m]) => [c, m.giaDich])).toEqual([
      ["ORD-260831-000001", 8_976_000], ["ORD-260908-000003", 8_976_000], ["ORD-260910-000002", 8_976_000], ["ORD-260910-000005", 8_976_000], ["ORD-260910-000006", 9_792_000], ["ORD-260910-000008", 8_976_000],
    ]);
  });
  it("[GPG-08c] bảng cứng KHÔNG mang định danh: kiểu `MucGanPayment` chỉ có 4 khoá số, không khoá nào là chuỗi", () => {
    for (const [code, m] of Object.entries(BANG_GAN_PAYMENT)) {
      expect(Object.keys(m).sort(), code).toEqual(["giaDich", "soKhoan", "soKhoanDaXoa", "soKhoanTrongHoaDon"]);
      for (const v of Object.values(m)) expect(typeof v, code).toBe("number");
    }
  });
});

describe("[GPG-02] lô lai ⇒ dừng", () => {
  it("[GPG-02a] một khoản của một đơn đã gắn, khoản kia chưa ⇒ LO_HON_HOP (mức đơn), không ghi gì", () => {
    const k = lap(hong(D1, (d) => (d.paymentSong[0].enrollmentId = ghiDanhDich(D1))));
    expect(k.loi.map((l) => l.ma)).toContain("LO_HON_HOP");
    expect(k.dung).toBe(true);
    expect(k.ghi).toEqual([]);
  });

  it("[GPG-02b] một ĐƠN đã gắn hết, đơn khác chưa ⇒ LO_HON_HOP (mức lô), không ghi gì", () => {
    const du = MA.map((c) => {
      const d = structuredClone(hopLe(c)) as any;
      if (c === D1) {
        d.paymentSong.forEach((p: any) => (p.enrollmentId = ghiDanhDich(c)));
        d.plannerChuan = [];
      }
      return d as DuLieuGanPayment;
    });
    const k = lap(du);
    expect(k.loi.map((l) => l.ma)).toEqual(["LO_HON_HOP"]);
    expect(k.dung).toBe(true);
    expect(k.ghi).toEqual([]);
    expect(k.daGanHet).toBe(false);
  });
});

/** Mỗi mã lỗi: [mã, đơn, cách làm hỏng ĐÚNG một điều kiện]. */
const CA_LOI: ReadonlyArray<readonly [string, string, (d: any) => void]> = [
  ["DON_DA_XOA", D1, (d) => (d.don.deletedAt = new Date("2026-10-01"))],
  ["DON_KHONG_PHAI_KHOA_HOC", D1, (d) => (d.don.type = "KIT")],
  ["SO_DONG_KHONG_DUNG", D1, (d) => d.don.items.push({ id: "x", type: "KIT", studentId: null, enrollmentId: null })],
  ["TONG_DON_LECH", D1, (d) => (d.don.totalAmount += 1)],
  ["DON_CHUA_GAN_DANH_TINH", D1, (d) => (d.don.items[0].enrollmentId = null)],
  ["DON_CHUA_GAN_DANH_TINH", D1, (d) => (d.ghiDanh = null)],
  ["GHI_DANH_LECH_DICH", D1, (d) => (d.don.items[0].enrollmentId = "ghi-danh-la")],
  ["GHI_DANH_DA_XOA", D1, (d) => (d.ghiDanh.deletedAt = new Date("2026-10-02"))],
  ["GHI_DANH_KHONG_ACTIVE", D1, (d) => (d.ghiDanh.status = "WITHDREW")],
  ["GHI_DANH_LECH_HOC_VIEN", D1, (d) => (d.ghiDanh.studentId = "hv-khac")],
  ["GHI_DANH_LECH_CO_SO", D1, (d) => (d.ghiDanh.centerId = "co-so-khac")],
  ["GIA_GHI_DANH_CHUA_CHUAN", D1, (d) => (d.ghiDanh.finalPrice = 10_560_000)], // PHASE B.1 chưa chạy
  ["GIA_GHI_DANH_CHUA_CHUAN", D1, (d) => (d.ghiDanh.tuition = 0)],
  ["GIA_GHI_DANH_CHUA_CHUAN", D1, (d) => (d.ghiDanh.discountType = "SCHOLARSHIP")],
  ["TAP_PAYMENT_LECH", D1, (d) => d.paymentSong.pop()],
  ["TAP_PAYMENT_LECH", D1, (d) => d.paymentSong.push({ ...d.paymentSong[0], id: "khoan-la" })],
  ["PAYMENT_KHONG_PHAI_THU", D1, (d) => (d.paymentSong[0].paymentType = "ADJUSTMENT")],
  ["PAYMENT_KHONG_GHI_NHAN", D1, (d) => (d.paymentSong[0].saleStatus = "DRAFT")],
  ["PAYMENT_KHONG_XAC_NHAN", D1, (d) => (d.paymentSong[0].accountantStatus = "PENDING")],
  ["PAYMENT_LA_BUT_TOAN_DIEU_CHINH", D1, (d) => (d.paymentSong[0].adjustmentOfId = "goc")],
  ["PAYMENT_LECH_CO_SO", D1, (d) => (d.paymentSong[0].centerId = "co-so-khac")],
  ["PAYMENT_LECH_CO_SO", D1, (d) => (d.paymentSong[0].centerId = null)],
  ["PAYMENT_LECH_DONG_DON", D1, (d) => (d.paymentSong[0].orderItemId = "dong-khac")],
  ["PAYMENT_LECH_DONG_DON", D1, (d) => (d.paymentSong[0].orderItemId = null)],
  ["PAYMENT_GAN_SAI_GHI_DANH", D1, (d) => (d.paymentSong[0].enrollmentId = "ghi-danh-khac")],
  ["TIEN_PAYMENT_LECH", D1, (d) => (d.paymentSong[0].amount -= 1)],
  ["TIEN_PAYMENT_LECH", D1, (d) => (d.paymentSong[0].amount += 1)],
  ["TIEN_PHAN_BO_LECH", D1, (d) => (d.tongPhanBoDon -= 1)],
  // ── giao dịch ngân hàng: MỖI điều kiện một mã riêng ──
  ["GIAO_DICH_KHONG_UNG_VIEN", D1, (d) => (d.nganHang = [])],
  ["GIAO_DICH_KHONG_UNG_VIEN", D3, (d) => (d.nganHang = [])],
  ["GIAO_DICH_KHONG_UNG_VIEN", D1, (d) => (d.nganHang[0].status = "UNMATCHED")],
  ["GIAO_DICH_NHIEU_UNG_VIEN", D1, (d) => d.nganHang.push({ ...d.nganHang[0], id: "bt-trung", providerTxnId: "gd-trung" })],
  ["GIAO_DICH_NHIEU_UNG_VIEN", D3, (d) => d.nganHang.push({ ...d.nganHang[0], id: "bt-trung", providerTxnId: "gd-trung" })],
  ["GIAO_DICH_LECH_SO_TIEN", D1, (d) => (d.nganHang[0].amount += 1)],
  ["GIAO_DICH_LECH_SO_TIEN", D1, (d) => (d.paymentSong[0].amount += 1)],
  ["GIAO_DICH_LECH_SO_TIEN", D3, (d) => (d.nganHang[0].amount -= 1)],
  ["GIAO_DICH_PHAN_BO_LECH", D1, (d) => (d.nganHang[0].tongPhanBo -= 1)],
  ["GIAO_DICH_PHAN_BO_LECH", D1, (d) => (d.nganHang[0].phanBoVaoDon -= 1)],
  ["GIAO_DICH_PHAN_BO_LECH", D3, (d) => (d.nganHang[0].tongPhanBo += 1)],
  ["GIAO_DICH_KHONG_MATCHED", D1, (d) => (d.nganHang[0].status = "UNMATCHED")],
  ["GIAO_DICH_KHONG_MATCHED", D3, (d) => d.nganHang.push({ ...d.nganHang[0], id: "bt-cho", providerTxnId: "gd-cho", amount: 777, status: "PENDING" })],
  ["GIAO_DICH_LECH_CO_SO", D1, (d) => (d.nganHang[0].centerId = "co-so-khac")],
  ["GIAO_DICH_LECH_CO_SO", D1, (d) => (d.nganHang[0].centerId = null)],
  ["GIAO_DICH_THUA", D1, (d) => d.nganHang.push({ ...d.nganHang[0], id: "bt-la", providerTxnId: "gd-la", amount: 12_345, tongPhanBo: 12_345, phanBoVaoDon: 12_345 })],
  ["GIAO_DICH_THUA", D3, (d) => d.nganHang.push({ ...d.nganHang[0], id: "bt-trung", providerTxnId: "gd-trung" })],
  ["GIAO_DICH_GHI_CHU_LECH", D1, (d) => (d.paymentSong[0].note = "Tiền về qua SEPAY [auto:sepay:ma-khac-hoan-toan]")],
  ["GIAO_DICH_GHI_CHU_LECH", D1, (d) => (d.paymentSong[0].note = "Ghi tay [ma-gd:ma-khac-hoan-toan]")],
  ["TRUNG_GIAO_DICH", D1, (d) => { d.paymentSong[1].amount = d.paymentSong[0].amount; d.nganHang.pop(); }], // hai khoản cùng số tiền, chỉ MỘT giao dịch ⇒ cùng chọn một giao dịch
  ["PAYMENT_XOA_LECH", D2, (d) => (d.paymentDaXoa[0].enrollmentId = "ghi-danh")],
  ["PAYMENT_XOA_LECH", D2, (d) => (d.paymentDaXoa = [])],
  ["PAYMENT_XOA_LECH", D1, (d) => d.paymentDaXoa.push({ id: "xoa-la", enrollmentId: null })],
  ["HOA_DON_LECH", D1, (d) => (d.trongHoaDon = {})],
  ["HOA_DON_LECH", D1, (d) => (d.trongHoaDon[Object.keys(d.trongHoaDon)[0]!] = "hoa-don-khac")], // hai khoản, hai hoá đơn khác nhau
  ["HOA_DON_LECH", D8, (d) => (d.trongHoaDon = { [d.paymentSong[0].id]: "hd-moi" })],
  ["CO_TAC_DUNG_PHU", D1, (d) => (d.tacDungPhu = 1)],
  ["GHI_DANH_CO_PAYMENT_NGOAI", D1, (d) => (d.paymentNgoaiGanGhiDanh = 1)],
  ["KE_HOACH_CHUAN_LECH", D1, (d) => (d.plannerChuan[0].ketQua = "TACH")],
  ["KE_HOACH_CHUAN_LECH", D1, (d) => (d.plannerChuan[0].ketQua = "BO_QUA")],
  ["KE_HOACH_CHUAN_LECH", D1, (d) => (d.plannerChuan[0].soPhan = 2)],
  ["KE_HOACH_CHUAN_LECH", D1, (d) => (d.plannerChuan[0].giuNguyenTien = false)],
  ["KE_HOACH_CHUAN_LECH", D1, (d) => (d.plannerChuan[0].enrollmentId = "ghi-danh-khac")],
  ["KE_HOACH_CHUAN_LECH", D1, (d) => (d.plannerChuan[0].amount = 1)],
  ["KE_HOACH_CHUAN_LECH", D1, (d) => d.plannerChuan.pop()],
  ["KE_HOACH_CHUAN_LECH", D8, (d) => (d.plannerChuan = [])],
  ["NO_DU_KIEN_KHAC_0", D1, (d) => (d.paymentSong[0].accountantStatus = "PENDING")], // thực thu thiếu ⇒ nợ ≠ 0 (kèm PAYMENT_KHONG_XAC_NHAN)
];

describe("[GPG-03] từng điều kiện fail-closed — hỏng ĐÚNG MỘT thứ ⇒ cả lô dừng, ghi 0, đúng mã lỗi", () => {
  it.each(CA_LOI.map((c, i) => [i, ...c] as const))("[GPG-03-%i] %s · %s", (_i, ma, code, sua) => {
    const k = lap(hong(code, sua));
    expect(k.loi.map((l) => l.ma), JSON.stringify(k.loi)).toContain(ma);
    expect(k.dung).toBe(true);
    expect(k.ghi).toEqual([]);
    expect(k.dongDauRa).toEqual([]);
    // Lỗi chỉ ở đơn bị hỏng — 5 đơn còn lại vẫn sạch (không lan lỗi giả).
    expect(new Set(k.loi.map((l) => l.code))).toEqual(new Set([code]));
  });

  it("[GPG-03x] BAO PHỦ: mọi mã lỗi trong `MA_LOI_GAN_PAYMENT` có ít nhất một ca (hoặc nằm ở nhóm ca cấp lô bên dưới)", () => {
    const capLo = new Set(["THIEU_DON", "KHONG_CO_MUC_TIEU", "TRUNG_GHI_DANH", "LO_HON_HOP"]);
    const phu = new Set(CA_LOI.map((c) => c[0]));
    const thieu = Object.values(MA_LOI_GAN_PAYMENT).filter((m) => !phu.has(m) && !capLo.has(m));
    expect(thieu).toEqual([]);
  });

  it("[GPG-03y] ghi chú CHỈ là tín hiệu phụ: ghi chú rỗng / không có marker / marker khớp ⇒ KHÔNG lỗi; không marker nào thì không phải căn cứ dừng", () => {
    for (const note of [null, "", "chuyển khoản học phí", "[auto:order-confirm]", "Tiền về [auto:sepay:gd-ORD-260831-000001-0]"]) {
      const k = lap(hong(D1, (d) => (d.paymentSong[0].note = note)));
      expect(k.loi, String(note)).toEqual([]);
    }
  });
});

/**
 * CÁC CA CHỦ DỰ ÁN LIỆT KÊ (24/10/2026) cho giao dịch ngân hàng — mỗi ca khẳng định ĐÚNG mã của điều kiện đó và KHÔNG chấp nhận mã khác thay thế (mã này không được nuốt mã kia):
 * duy nhất MATCHED · 0 ứng viên · >1 ứng viên · lệch số tiền · lệch phân bổ · khoản đã có enrollmentId.
 */
describe("[GPG-09] giao dịch ngân hàng — ứng viên suy từ dữ liệu", () => {
  const tim = (du: readonly DuLieuGanPayment[], ma: string) => lap(du).loi.filter((l) => l.ma === ma);
  it("[GPG-09a] đúng 1 giao dịch MATCHED cùng số tiền, phân bổ đủ vào đơn ⇒ hợp lệ; mỗi khoản của đơn 3 khoản nhận ĐÚNG giao dịch của nó", () => {
    const k = lap(tatCa());
    expect(k.loi).toEqual([]);
    const cua8 = k.ghi.filter((g) => g.code === D8);
    expect(cua8.map((g) => g.providerTxnId)).toEqual([0, 1, 2].map((i) => maGd(D8, i)));
  });
  it("[GPG-09b] 0 ứng viên ⇒ GIAO_DICH_KHONG_UNG_VIEN (không phải mã khác)", () => {
    const l = tim(hong(D3, (d) => (d.nganHang = [])), "GIAO_DICH_KHONG_UNG_VIEN");
    expect(l).toHaveLength(1);
    expect(maLoi(hong(D3, (d) => (d.nganHang = [])))).not.toContain("GIAO_DICH_NHIEU_UNG_VIEN");
  });
  it("[GPG-09c] >1 ứng viên (hai giao dịch MATCHED cùng số tiền, cùng phân bổ vào đơn) ⇒ GIAO_DICH_NHIEU_UNG_VIEN, không dòng nào được ghi", () => {
    const du = hong(D3, (d) => d.nganHang.push({ ...d.nganHang[0], id: "bt-trung", providerTxnId: "gd-trung" }));
    expect(tim(du, "GIAO_DICH_NHIEU_UNG_VIEN")).toHaveLength(1);
    expect(lap(du).ghi).toEqual([]);
  });
  it("[GPG-09d] lệch số tiền (giao dịch ≠ khoản, cùng số lượng) ⇒ GIAO_DICH_LECH_SO_TIEN riêng, kèm 0 ứng viên", () => {
    const du = hong(D3, (d) => (d.nganHang[0].amount += 1));
    expect(tim(du, "GIAO_DICH_LECH_SO_TIEN")).toHaveLength(1);
    expect(tim(du, "GIAO_DICH_KHONG_UNG_VIEN")).toHaveLength(1);
  });
  it("[GPG-09e] lệch phân bổ (tổng phân bổ của giao dịch ≠ số tiền, hoặc phân bổ vào đơn ≠ số tiền) ⇒ GIAO_DICH_PHAN_BO_LECH, và giao dịch VẪN là ứng viên duy nhất", () => {
    for (const sua of [(d: any) => (d.nganHang[0].tongPhanBo -= 1), (d: any) => (d.nganHang[0].phanBoVaoDon -= 1), (d: any) => (d.nganHang[0].tongPhanBo += 5)]) {
      const du = hong(D3, sua);
      expect(tim(du, "GIAO_DICH_PHAN_BO_LECH")).toHaveLength(1);
      expect(tim(du, "GIAO_DICH_KHONG_UNG_VIEN")).toHaveLength(0);
    }
  });
  it("[GPG-09f] khoản đã có enrollmentId: đã gắn SAI ⇒ PAYMENT_GAN_SAI_GHI_DANH; một phần ⇒ LO_HON_HOP; đã gắn ĐÚNG hết ⇒ DA_GAN (chạy lại)", () => {
    expect(maLoi(hong(D3, (d) => (d.paymentSong[0].enrollmentId = "ghi-danh-khac")))).toContain("PAYMENT_GAN_SAI_GHI_DANH");
    expect(maLoi(hong(D1, (d) => (d.paymentSong[0].enrollmentId = ghiDanhDich(D1))))).toContain("LO_HON_HOP");
    expect(lap(daGanHetDu()).daGanHet).toBe(true);
  });
  it("[GPG-09g] một giao dịch ngân hàng do HAI đơn cùng chọn ⇒ TRUNG_GIAO_DICH (mức lô), không ghi gì", () => {
    const du = MA.map((c) => {
      const d = structuredClone(hopLe(c)) as any;
      if (c === D3) d.nganHang[0].id = `bt-${D2}-0`; // trỏ đúng giao dịch của đơn D2 (cùng số tiền)
      return d as DuLieuGanPayment;
    });
    const k = lap(du);
    expect(k.loi.map((l) => l.ma)).toEqual(["TRUNG_GIAO_DICH"]);
    expect(k.ghi).toEqual([]);
  });
  it("[GPG-09h] `maGiaoDichTrongGhiChu`: chỉ hai họ marker; marker của provider khác / marker không phải giao dịch không được tính", () => {
    expect(maGiaoDichTrongGhiChu("Tiền về [auto:sepay:abc]", "SEPAY")).toEqual(["abc"]);
    expect(maGiaoDichTrongGhiChu("Gõ tay [ma-gd:xyz]", "SEPAY")).toEqual(["xyz"]);
    expect(maGiaoDichTrongGhiChu("[auto:sepay:a] [ma-gd:b]", "SEPAY").sort()).toEqual(["a", "b"]);
    expect(maGiaoDichTrongGhiChu("[auto:payos:abc]", "SEPAY")).toEqual([]);
    expect(maGiaoDichTrongGhiChu("[auto:order-confirm]", "SEPAY")).toEqual([]);
    expect(maGiaoDichTrongGhiChu(null, "SEPAY")).toEqual([]);
    expect(maGiaoDichTrongGhiChu("[auto:sepay:chua-dong", "SEPAY")).toEqual([]);
  });
});

describe("[GPG-04] lỗi cấp lô", () => {
  it("[GPG-04a] thiếu một đơn ⇒ THIEU_DON; hai đơn cùng mã ⇒ THIEU_DON; đơn ngoài phạm vi ⇒ KHONG_CO_MUC_TIEU", () => {
    expect(maLoi(tatCa().slice(1))).toContain("THIEU_DON");
    expect(maLoi([...tatCa(), hopLe(D1)])).toContain("THIEU_DON");
    const la = structuredClone(hopLe(D1)) as any;
    la.don.code = "ORD-LA-000001";
    expect(maLoi([...tatCa(), la])).toContain("KHONG_CO_MUC_TIEU");
    for (const du of [tatCa().slice(1), [...tatCa(), hopLe(D1)], [...tatCa(), la]]) {
      const k = lap(du);
      expect(k.dung).toBe(true);
      expect(k.ghi).toEqual([]);
    }
  });

  it("[GPG-04b] hai đơn cùng trỏ MỘT ghi danh (đọc từ dòng đơn) ⇒ TRUNG_GHI_DANH, không ghi gì", () => {
    const [a, b] = MA as [string, string];
    const du = MA.map((c) => {
      const d = structuredClone(hopLe(c)) as any;
      if (c === b) {
        d.don.items[0].enrollmentId = ghiDanhDich(a);
        d.ghiDanh.id = ghiDanhDich(a);
        d.plannerChuan.forEach((p: any) => (p.enrollmentId = ghiDanhDich(a)));
      }
      return d as DuLieuGanPayment;
    });
    const k = lap(du);
    expect(k.loi.map((l) => l.ma)).toContain("TRUNG_GHI_DANH");
    expect(k.ghi).toEqual([]);
  });
});

describe("[GPG-05] nợ dự kiến dùng hàm của repo", () => {
  it("[GPG-05a] nợ dự kiến = finalPrice − thực thu (CONFIRMED/REFUNDED): thêm khoản hoàn ÂM ⇒ nợ ≠ 0 ⇒ NO_DU_KIEN_KHAC_0", () => {
    const k = lap(
      hong(D1, (d) => {
        d.paymentSong.push({ ...d.paymentSong[0], id: "hoan", amount: -50_000, accountantStatus: "REFUNDED", adjustmentOfId: null });
      }),
    );
    expect(k.loi.map((l) => l.ma)).toContain("NO_DU_KIEN_KHAC_0");
    expect(k.muc.find((m) => m.code === D1)!.noDuKien).toBe(50_000);
  });

  it("[GPG-05b] khoản REJECTED không tính vào thực thu ⇒ nợ = số tiền khoản đó", () => {
    const k = lap(hong(D8, (d) => (d.paymentSong[2].accountantStatus = "REJECTED")));
    expect(k.muc.find((m) => m.code === D8)!.noDuKien).toBe(soTien(BANG_GAN_PAYMENT[D8]!)[2]);
  });
});

describe("[GPG-06] cổng số duyệt / quyền", () => {
  const ok = lap(tatCa());
  const bad = lap(hong(D1, (d) => (d.tacDungPhu = 1)));
  it("[GPG-06a] thiếu --expect ⇒ chặn; NaN ⇒ chặn; kế hoạch dừng ⇒ chặn kèm danh sách lỗi", () => {
    expect(quyetDinhGhiGanPayment({ soDuyet: null, keHoach: ok, ghiDuoc: true })).toContain("--expect=<N>");
    expect(quyetDinhGhiGanPayment({ soDuyet: Number.NaN, keHoach: ok, ghiDuoc: true })).toContain("số nguyên không dấu");
    expect(quyetDinhGhiGanPayment({ soDuyet: 9, keHoach: bad, ghiDuoc: true })).toContain("CO_TAC_DUNG_PHU");
  });
  it("[GPG-06b] quyền UPDATE trên Payment: false ⇒ chặn, null ⇒ chặn ('không kiểm được'), true ⇒ qua", () => {
    expect(quyetDinhGhiGanPayment({ soDuyet: 9, keHoach: ok, ghiDuoc: false })).toContain("không có quyền UPDATE trên Payment");
    expect(quyetDinhGhiGanPayment({ soDuyet: 9, keHoach: ok, ghiDuoc: null })).toContain("Không kiểm được quyền UPDATE trên Payment");
    expect(quyetDinhGhiGanPayment({ soDuyet: 9, keHoach: ok, ghiDuoc: true })).toBeNull();
  });
  it("[GPG-06c] số duyệt ≠ số khoản của kế hoạch ⇒ chặn (cả lớn lẫn nhỏ hơn); đúng ⇒ qua", () => {
    for (const n of [0, 8, 10, 6]) expect(quyetDinhGhiGanPayment({ soDuyet: n, keHoach: ok, ghiDuoc: true }), String(n)).toContain("≠ kế hoạch lúc chạy 9");
    expect(quyetDinhGhiGanPayment({ soDuyet: 9, keHoach: ok, ghiDuoc: true })).toBeNull();
  });
  it("[GPG-06d] `--expect=` chặt: chỉ chữ số thập phân thuần", () => {
    expect(phanTichSoDuyetGanPayment(["--ghi"])).toBeNull();
    expect(phanTichSoDuyetGanPayment(["--ghi", "--expect=9"])).toBe(9);
    for (const x of ["--expect=", "--expect=9.0", "--expect=-9", "--expect=0x9", "--expect= 9", "--expect=9e0", "--expect=09a"]) expect(Number.isNaN(phanTichSoDuyetGanPayment([x])!), x).toBe(true);
    expect(Number.isNaN(phanTichSoDuyetGanPayment(["--expect=99999999999999999999"])!)).toBe(true);
  });
});

describe("[GPG-07] bản ghi mức lượt chạy", () => {
  const ok = lap(tatCa());
  const nguon = { runId: "123", runAttempt: "1", actor: "hptkk29", triggeringActor: "hptkk29" } as never;
  it("[GPG-07a] mang số duyệt · số thực ghi · sha · danh sách khoản · lý do; khoá theo run", () => {
    const b = dungBanGhiLuotGanPayment({ luot: { batDauLuc: new Date("2026-10-24T05:00:00Z"), nguonChay: nguon }, soDuyet: 9, keHoach: ok, daGhi: 9 });
    expect(b).toMatchObject({ cheDo: "APPLY", dryRun: false, expectedCount: 9, actualCount: 9, khop: true, keHoachSha: ok.sha });
    expect((b.khoanDaGan as string[]).length).toBe(9);
    expect(String(b.lyDo)).toContain("Payment.enrollmentId");
    expect(khoaLuotChayGanPayment(nguon)).toBe("luot:123:1");
    expect(HANH_DONG_GAN_PAYMENT_LUOT).toBe("GAN_PAYMENT_GHI_DANH_LUOT_CHAY");
  });
  it("[GPG-07b] thiếu / sai mốc thời gian ⇒ ném (lõi không đọc đồng hồ); số ghi ≠ số duyệt ⇒ khop=false", () => {
    expect(() => dungBanGhiLuotGanPayment({ luot: { batDauLuc: new Date("x"), nguonChay: nguon }, soDuyet: 9, keHoach: ok, daGhi: 9 })).toThrow(/batDauLuc/);
    expect(dungBanGhiLuotGanPayment({ luot: { batDauLuc: new Date(0), nguonChay: nguon }, soDuyet: 9, keHoach: ok, daGhi: 8 }).khop).toBe(false);
  });
});
