// lib/finance/hoa-don/loc-hang-cho.ts — bộ lọc CƠ SỞ + THÁNG của màn Hoá đơn điện tử. THUẦN, client dùng được.
//
// Kế hoạch: docs/ke-toan-hoa-don/PLAN.md §10 (wireframe "[CS1 ▾] [Tháng 9 ▾]") + mục "Điều chỉnh khi thi
// công GĐ 4" số 7. Test: `loc-hang-cho.test.ts` ([LHC-*]).
//
// Luật:
//   · Ngăn "Đã xuất" / "Không xuất" (sổ ĐÃ XONG) giới hạn theo THÁNG — mặc định tháng hiện tại. Ngăn
//     việc tồn (chờ · lệch · nháp · cần điều chỉnh · đơn huỷ) KHÔNG giới hạn tháng: việc tồn phải thấy hết.
//   · Lọc ở CÂU TRA (`dieuKienDonHangCho`) — không nạp toàn bộ lịch sử rồi lọc. Câu tra chỉ lọc được tới
//     mức ĐƠN (một đơn có thể giữ hoá đơn của nhiều tháng) ⇒ còn một phép lọc DÒNG (`giuDongTheoThang`),
//     và hai phép phải nói CÙNG một luật tháng (`dieuKienHoaDonTrongThang` ⇔ `thangCuaHoaDon`, ca [LHC-04]).
//   · Tháng tính theo giờ Việt Nam (+07) TƯỜNG MINH — không đọc múi giờ của máy chủ.
//   · Cơ sở chỉ nhận cơ sở trong phạm vi KẾ TOÁN của người xem. Bộ lọc chỉ THU HẸP: tầm nhìn vẫn là
//     `scopedDb`; cơ sở ngoài phạm vi ⇒ bỏ lọc (fail-closed — không bao giờ mở rộng).
//
// ⚠️ Không import `@prisma/client` ở dạng giá trị — tệp này đi xuống bundle trình duyệt (ô chọn tháng).

import type { Prisma } from "@prisma/client";
import { TRANG_THAI_DON_DA_HUY } from "./du-dieu-kien";
import { LY_DO_DA_XUAT_NGOAI } from "./ly-do-khong-xuat";
import { dieuKienDonCoHoan, TRANG_THAI_HOAN_DA_DUYET } from "./hoan-tien-don";

export type BoLoc = {
  /** `null` = mọi cơ sở trong tầm nhìn. */
  coSo: string | null;
  /** "YYYY-MM" theo giờ Việt Nam — luôn có (mặc định tháng hiện tại). */
  thang: string;
};

/** Bộ lọc NẰM TRÊN URL — tháng mặc định không ghi (`null`) để đường dẫn gọn và không "đóng băng" tháng cũ. */
export type LocUrl = { coSo: string | null; thang: string | null };

export type PhamViKeToan = "ALL" | readonly string[];

const LECH_VN_MS = 7 * 3600_000;
const DANG_THANG = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Tháng ("YYYY-MM") của một mốc giờ theo lịch Việt Nam (UTC+7, không giờ mùa hè). */
export function thangVN(d: Date): string {
  return new Date(d.getTime() + LECH_VN_MS).toISOString().slice(0, 7);
}

/**
 * Khoảng [từ, đến) của một tháng VN, hai dạng:
 *   · `ngay*` — cho cột NGÀY LỊCH (`@db.Date`, lưu nửa đêm UTC): ngày 01 → ngày 01 tháng sau.
 *   · `luc*`  — cho cột MỐC GIỜ (timestamptz): 00:00 giờ VN = 17:00 UTC hôm trước.
 */
export function khoangThang(thang: string): { ngayTu: Date; ngayDen: Date; lucTu: Date; lucDen: Date } {
  const m = DANG_THANG.exec(thang);
  if (!m) throw new Error(`Tháng không hợp lệ: ${thang}`);
  const nam = Number(m[1]);
  const t = Number(m[2]);
  const ngayTu = new Date(Date.UTC(nam, t - 1, 1));
  const ngayDen = new Date(Date.UTC(nam, t, 1));
  return {
    ngayTu,
    ngayDen,
    lucTu: new Date(ngayTu.getTime() - LECH_VN_MS),
    lucDen: new Date(ngayDen.getTime() - LECH_VN_MS),
  };
}

/** Đọc bộ lọc từ URL. Tháng sai dạng ⇒ tháng hiện tại; cơ sở ngoài phạm vi kế toán ⇒ `null` (không lọc). */
export function docBoLoc(
  sp: { coSo?: string | null; thang?: string | null },
  ctx: { phamViKeToan: PhamViKeToan; now: Date },
): BoLoc {
  const thang = sp.thang && DANG_THANG.test(sp.thang) ? sp.thang : thangVN(ctx.now);
  const coSoThu = sp.coSo?.trim() || null;
  const coSo =
    coSoThu && (ctx.phamViKeToan === "ALL" || ctx.phamViKeToan.includes(coSoThu)) ? coSoThu : null;
  return { coSo, thang };
}

/**
 * Tháng của MỘT hoá đơn — phép lọc DÒNG. `null` = không thuộc sổ tháng nào (nháp, trạng thái khác).
 *   · ĐÃ XÁC NHẬN: theo NGÀY TRÊN TỜ (ngày phát hành — thứ kế toán đối chiếu với MISA); thiếu thì theo
 *     lúc xác nhận.
 *   · KHÔNG XUẤT: theo lúc đánh dấu (bản ghi sinh thẳng ở trạng thái đó — `createdAt`).
 */
export function thangCuaHoaDon(hd: {
  trangThai: string;
  ngayPhatHanh: Date | null;
  xacNhanLuc: Date | null;
  createdAt: Date;
}): string | null {
  if (hd.trangThai === "DA_XAC_NHAN") {
    if (hd.ngayPhatHanh) return hd.ngayPhatHanh.toISOString().slice(0, 7);
    return hd.xacNhanLuc ? thangVN(hd.xacNhanLuc) : null;
  }
  if (hd.trangThai === "KHONG_XUAT") return thangVN(hd.createdAt);
  return null;
}

/** Cùng luật với `thangCuaHoaDon`, viết thành điều kiện câu tra (các nhánh OR) — ca [LHC-04] khoá hai bên. */
export function dieuKienHoaDonTrongThang(thang: string): Prisma.HoaDonDienTuWhereInput[] {
  const k = khoangThang(thang);
  return [
    { trangThai: "DA_XAC_NHAN", ngayPhatHanh: { gte: k.ngayTu, lt: k.ngayDen } },
    { trangThai: "DA_XAC_NHAN", ngayPhatHanh: null, xacNhanLuc: { gte: k.lucTu, lt: k.lucDen } },
    { trangThai: "KHONG_XUAT", createdAt: { gte: k.lucTu, lt: k.lucDen } },
  ];
}

/** Khoản có thể còn chưa có hoá đơn — sàng thô ở SQL; luật đầy đủ là `phanLoaiKhoan`. */
export const KHOAN_UNG_VIEN = {
  deletedAt: null,
  paymentType: "PAYMENT",
  amount: { gt: 0 },
  accountantStatus: { not: "REJECTED" },
  hoaDonKhoan: { none: { hieuLuc: true } },
} satisfies Prisma.PaymentWhereInput;

// Bước 1 MISA (30/09): hai trạng thái của máy phát hành cũng là hoá đơn còn hiệu lực (giữ khoản, sinh dòng
// ở ngăn "Phát hành MISA") — thiếu ở đây thì khoản đang phát hành rơi lại hàng chờ và bị tải tay lần hai.
export const TRANG_THAI_CON_HIEU_LUC = ["NHAP", "DA_XAC_NHAN", "KHONG_XUAT", "DANG_PHAT_HANH", "LOI_PHAT_HANH"] as const;
/** Trạng thái của việc TỒN không lọc theo tháng (ngăn "Đã tải tệp" + "Phát hành MISA"). */
export const TRANG_THAI_VIEC_TON = ["NHAP", "DANG_PHAT_HANH", "LOI_PHAT_HANH"] as const;

/**
 * Điều kiện ĐƠN của câu tra màn hoá đơn. `null` (đường thu hẹp theo đơn — route phiếu chờ, action) ⇒
 * đúng hình dạng CŨ: mọi đơn còn khoản ứng viên hoặc còn hoá đơn hiệu lực.
 *
 * Có bộ lọc ⇒ đơn lọt vào nếu thuộc MỘT trong các nhánh; CHỈ hai nhánh sổ đã xong mang mốc tháng:
 *   1. còn khoản ứng viên (ngăn chờ · lệch · đơn huỷ)           — không mốc
 *   2. còn bản nháp (ngăn "Đã tải tệp")                          — không mốc
 *   3. hoá đơn ĐÃ XÁC NHẬN trong tháng (ngăn "Đã xuất")          — mốc tháng
 *   4. hoá đơn KHÔNG XUẤT trong tháng (ngăn "Không xuất")        — mốc tháng
 *   5–6. "Cần điều chỉnh" (`canDieuChinh`) — hoá đơn tháng NÀO cũng phải thấy:
 *      5. đơn đã huỷ / hoàn mà còn bản đã xác nhận;
 *      6. bản đã xác nhận có khoản bị đảo / điều chỉnh (`adjustments`) hoặc bị xoá mềm — hai đường làm
 *         số ròng lệch tổng trên tờ. (Sửa thẳng `amount` của khoản đã khoá bị `khoa-khoan.ts` chặn.)
 *         29/09 (Q3): cả bản KHONG_XUAT "Đã xuất ngoài hệ thống" (`DA_XUAT_CO_TO`).
 *      7. (29/09 — Q1) đơn có yêu cầu hoàn học phí ĐÃ DUYỆT mà còn bản đã xuất (`DA_XUAT_CO_TO`).
 *      Các nhánh này RỘNG hơn luật thuần (không so mốc `xacNhanLuc`, không so tổng) — dòng thừa bị phép
 *      lọc dòng bỏ, vì dòng không cần điều chỉnh rơi vào ngăn "Đã xuất" và bị cắt theo tháng.
 */
export function dieuKienDonHangCho(boLoc: BoLoc | null): Prisma.OrderWhereInput {
  const coKhoanUngVien: Prisma.OrderWhereInput = { payments: { some: KHOAN_UNG_VIEN } };
  if (!boLoc) {
    return {
      OR: [coKhoanUngVien, { hoaDonDienTu: { some: { trangThai: { in: [...TRANG_THAI_CON_HIEU_LUC] } } } }],
    };
  }
  const [daXuatTheoNgay, daXuatTheoLuc, khongXuat] = dieuKienHoaDonTrongThang(boLoc.thang);
  return {
    ...(boLoc.coSo ? { centerId: boLoc.coSo } : {}),
    OR: [
      coKhoanUngVien,
      { hoaDonDienTu: { some: { trangThai: { in: [...TRANG_THAI_VIEC_TON] } } } },
      { hoaDonDienTu: { some: { OR: [daXuatTheoNgay!, daXuatTheoLuc!] } } },
      { hoaDonDienTu: { some: khongXuat! } },
      { status: { in: [...TRANG_THAI_DON_DA_HUY] }, hoaDonDienTu: { some: { trangThai: "DA_XAC_NHAN" } } },
      {
        hoaDonDienTu: {
          some: {
            OR: DA_XUAT_CO_TO,
            khoan: {
              some: {
                hieuLuc: true,
                payment: { OR: [{ adjustments: { some: { deletedAt: null } } }, { deletedAt: { not: null } }] },
              },
            },
          },
        },
      },
      // 7. (29/09 — Q1) đơn có yêu cầu hoàn học phí ĐÃ DUYỆT mà còn bản đã xuất (xác nhận / ngoài hệ thống).
      { AND: [dieuKienDonCoHoan(TRANG_THAI_HOAN_DA_DUYET), { hoaDonDienTu: { some: { OR: DA_XUAT_CO_TO } } }] },
    ],
  };
}

/**
 * Bản "đã xuất" mà khách CÓ tờ hoá đơn — thứ `canDieuChinh` hỏi: bản đã xác nhận, và (29/09 — Q3) bản
 * KHONG_XUAT mang lý do "Đã xuất ngoài hệ thống". Nhánh 6–7 của câu tra dùng CHUNG, không mốc ngày.
 */
const DA_XUAT_CO_TO: Prisma.HoaDonDienTuWhereInput[] = [
  { trangThai: "DA_XAC_NHAN" },
  { trangThai: "KHONG_XUAT", lyDo: LY_DO_DA_XUAT_NGOAI },
];

/** Điều kiện câu tra CƠ SỞ cho ô chọn — chỉ cơ sở trong phạm vi kế toán, và có mã (khoá tệp cần mã). */
export function dieuKienCoSoChon(phamVi: PhamViKeToan): Prisma.CenterWhereInput {
  return phamVi === "ALL" ? { code: { not: null } } : { id: { in: [...phamVi] }, code: { not: null } };
}

const NGAN_THEO_THANG = new Set(["da-xuat", "khong-xuat"]);

/**
 * Phép lọc DÒNG: chỉ hai ngăn sổ đã xong bị cắt theo tháng (theo `thangCuaHoaDon` của hoá đơn giữ dòng);
 * mọi ngăn việc tồn giữ nguyên. Hoá đơn không rõ tháng ⇒ bỏ (không bịa ra tháng).
 */
export function giuDongTheoThang<T extends { ngan: string; hoaDon: { id: string } | null }>(
  dong: readonly T[],
  thangTheoHoaDon: ReadonlyMap<string, string | null>,
  thang: string,
): T[] {
  return dong.filter((d) => !NGAN_THEO_THANG.has(d.ngan) || (d.hoaDon != null && thangTheoHoaDon.get(d.hoaDon.id) === thang));
}

export function nhanThang(thang: string): string {
  return `Tháng ${Number(thang.slice(5, 7))}/${thang.slice(0, 4)}`;
}

/** Ô chọn tháng: 12 tháng gần nhất (mới nhất trước); tháng đang chọn nằm ngoài thì thêm vào CUỐI. */
export function cacThangChon(thangHienTai: string, thangDangChon: string): { gia: string; nhan: string }[] {
  const nam = Number(thangHienTai.slice(0, 4));
  const t = Number(thangHienTai.slice(5, 7));
  const ds: string[] = [];
  for (let i = 0; i < 12; i++) ds.push(new Date(Date.UTC(nam, t - 1 - i, 1)).toISOString().slice(0, 7));
  if (!ds.includes(thangDangChon)) ds.push(thangDangChon);
  return ds.map((gia) => ({ gia, nhan: nhanThang(gia) }));
}

/** Bộ lọc → phần nằm trên URL (tháng mặc định bỏ đi). */
export function locUrlTu(boLoc: BoLoc, thangMacDinh: string): LocUrl {
  return { coSo: boLoc.coSo, thang: boLoc.thang === thangMacDinh ? null : boLoc.thang };
}

/** Chuỗi query của màn — ngăn + dòng chọn TRƯỚC, bộ lọc SAU. Mọi chỗ đổi URL của màn đi qua đây. */
/** `ngan` bỏ trống ⇒ trang tự chọn ngăn theo dòng đang chọn (`chonNgan`) — dùng khi ngăn của dòng đích chưa biết (gộp lần thu). */
export function queryHoaDon(loc: LocUrl, o: { ngan?: string | null; chon?: string | null }): string {
  const q = new URLSearchParams();
  if (o.ngan) q.set("ngan", o.ngan);
  if (o.chon) q.set("chon", o.chon);
  if (loc.coSo) q.set("coSo", loc.coSo);
  if (loc.thang) q.set("thang", loc.thang);
  return q.toString();
}
