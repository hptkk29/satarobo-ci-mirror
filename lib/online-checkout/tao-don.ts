import type { Prisma, PrismaClient } from "@prisma/client";
import { writeAudit } from "@/lib/audit/audit-log";
import { banDuocLucNay } from "@/lib/elearning-online/danh-muc-cong-khai";
import { docTienDoKhoaTheoQuyen } from "@/lib/elearning-online/hoc-tap";
import { quyetDinhCap, type QuyenHienCo } from "@/lib/elearning-online/quyen-hoc";
import type { KyHan } from "@/lib/elearning-online/thoi-han";
import { nextInvoiceCode } from "@/lib/finance/invoice-code";
import { ngayVN } from "@/lib/format/thoi-gian-vn";
import { docMaChoDon, docMaTheoId } from "@/lib/khuyen-mai/chon-cho-don";
import { NHAN_LY_DO_LOAI, lyDoKhongDung, tienGiamCuaMa } from "@/lib/khuyen-mai/ap-vao-don";
import { ensureFullOrderRequest, paymentMatchKey } from "@/lib/payments/payment-request";
import { docPhutGiuKho } from "@/lib/inventory/cau-hinh";
import type { ThieuHang } from "@/lib/inventory/giu-kho";
import { chupChoDon, docCauHinhDangBat, noiDungChuyenKhoan } from "./cau-hinh-thanh-toan";
import { kiemGioHang, type DongGioHang } from "./gio-hang";
import { cauThieuHoSo, thieuHoSoHocVien, thieuHoSoPhuHuynh } from "./ho-so-mua";
import { chotHocCu, chuKyHocCu, chupGiaoHang, ghiHocCu, LoiGiaDoi, LoiHetHang, type DongHocCuDon, type HocCuDat, type LoiHocCu } from "./tao-don-hoc-cu";

/**
 * WORKSTREAM A — TẠO ĐƠN KHOÁ ONLINE từ giỏ hàng (cặp khoá × học viên), MỌI cổng đứng TRƯỚC khi có tiền.
 *
 * Sau thanh toán chỉ còn MỘT việc: gọi `capQuyenHoc` (idempotent) — xem `cap-quyen-sau-thanh-toan.ts`. Vì thế mọi lỗi người dùng sửa được
 * (thiếu hồ sơ, sai con, khoá không bán, tiên quyết, đã trọn đời, mã giảm sai) phải bị từ chối Ở ĐÂY, không để tới lúc đã thu tiền.
 *
 * Luật (mỗi cái có ca `[OTD-*]`):
 *  1. Phụ huynh (`parentUserId` từ PHIÊN, không từ client) + MỌI `studentId` phải là con của họ — sai ⇒ `SAI_PHU_HUYNH` (không phân biệt "không có" / "không phải của bạn").
 *  2. Hồ sơ PH + từng HV đủ (`ho-so-mua.ts`).
 *  3. Giá = `OnlCourse` đọc ở MÁY CHỦ (`salePrice`; gia hạn khi còn hạn ⇒ `renewalPrice ?? salePrice`). Client không gửi số tiền nào.
 *  4. Khoá phải ĐÃ PHÁT HÀNH và "đang bán lúc này" (`banDuocLucNay` — cùng hàm với catalog công khai và với cổng của `capQuyenHoc`).
 *  5. `quyetDinhCap({loai:"MUA"})` chạy TRƯỚC (thuần, cùng hàm lõi cấp quyền dùng) — đã trọn đời / không cho gia hạn ⇒ từ chối ngay, không thu tiền để rồi cấp thất bại.
 *  6. Tiên quyết `REQUIRED`: con phải có chứng nhận (ISSUED) HOẶC tiến độ hoàn thành của khoá tiên quyết. `RECOMMENDED`/`NONE` không chặn.
 *  7. Mã giảm giá mỗi dòng ≤ 1, kiểm bằng ĐÚNG hàm của kênh offline (`lyDoKhongDung`) với kênh ONLINE; trần lượt theo CON; giảm tối đa = tiền dòng.
 *  8. Tổng đơn phải > 0 (khoá miễn phí/giảm 100% đi đường quản trị `CAP_MIEN_PHI`, không đi đơn).
 *  9. Idempotent: bấm đúp / thử lại ⇒ cùng bộ cặp đang chờ thanh toán ⇒ TRẢ LẠI đơn cũ; trùng MỘT PHẦN ⇒ `DA_CO_DON_DANG_CHO`. Khoá dòng phụ huynh trong giao dịch.
 *
 * KHÔNG làm ở đây (cố ý): tạo QR/hướng dẫn chuyển khoản cho phụ huynh (xem `ONLINE-ORDER-CONTRACT.md` — BLOCKED_OWNER), hoá đơn, hoa hồng.
 */

type Db = PrismaClient;

export const MA_CO_SO_DON_ONLINE = "ONL";

export type MaLoiTaoDon =
  | "GIO_RONG" | "QUA_NHIEU_DONG" | "THIEU_HOC_VIEN" | "THIEU_KHOA" | "TRUNG_CAP_KHOA_HOC_VIEN" | "DU_LIEU_SAI"
  | "SAI_PHU_HUYNH" | "THIEU_HO_SO_PHU_HUYNH" | "THIEU_HO_SO_HOC_VIEN"
  | "KHOA_KHONG_TON_TAI" | "KHOA_CHUA_PHAT_HANH" | "KHOA_KHONG_DANG_BAN" | "GIA_KHONG_HOP_LE"
  | "DA_TRON_DOI" | "KHOA_KHONG_CHO_GIA_HAN" | "KY_HAN_THIEU" | "CHUA_CO_QUYEN_DE_GIA_HAN" | "CHUA_DU_TIEN_QUYET"
  | "MA_KHONG_TON_TAI" | "MA_KHONG_DUNG_DUOC" | "MA_HET_LUOT_CUA_CON" | "MA_HET_SUAT"
  | "DON_0_DONG" | "DA_CO_DON_DANG_CHO" | "CAU_HINH_THU_TIEN_KHONG_HOP_LE"
  | "HET_HANG" | "KHONG_BAN_ONLINE" | "SAN_PHAM_KHONG_TON_TAI" | "SO_LUONG_VUOT_TOI_DA" | "GIA_DA_DOI" | "THIEU_DIA_CHI" | "CHUA_CHON_PHUONG_THUC_GIAO" | "PHUONG_THUC_GIAO_KHONG_HOP_LE";

export type DongDonOnline = {
  orderItemId: string;
  courseId: string;
  studentId: string;
  tenKhoa: string;
  loaiMua: "MUA" | "GIA_HAN";
  donGia: number;
  giam: number;
  thanhTien: number;
};

export type KetQuaTaoDon =
  | {
      ok: true;
      daCo: boolean;
      orderId: string;
      orderCode: string;
      /** gồm phí giao hàng (nếu có học cụ) */
      tongTien: number;
      giamTong: number;
      dong: DongDonOnline[];
      /** V8.43 — chỉ có khi đơn có học cụ */
      dongHocCu?: DongHocCuDon[];
      phiVanChuyen?: number;
      /** V8.43 — hạn GIỮ KHO (ISO). null/thiếu = đơn không có học cụ hoặc không còn phần giữ hiệu lực */
      giuKho?: { hanGiuLuc: string } | null;
    }
  | { ok: false; ma: MaLoiTaoDon; thongBao: string; viTri?: number; thieu?: ThieuHang[]; cartItemIds?: string[] };

const loi = (ma: MaLoiTaoDon, thongBao: string, viTri?: number): Extract<KetQuaTaoDon, { ok: false }> => ({ ok: false, ma, thongBao, viTri });
const loiHocCu = (l: LoiHocCu): Extract<KetQuaTaoDon, { ok: false }> => ({ ok: false, ma: l.ma, thongBao: l.thongBao, ...(l.thieu ? { thieu: l.thieu } : {}), ...(l.cartItemIds ? { cartItemIds: l.cartItemIds } : {}) });

/** Hàng đã chốt ở bước đọc — dùng lại trong giao dịch, không đọc lại giá. */
type DongDaChot = {
  courseId: string;
  studentId: string;
  voucherId: string | null;
  tenKhoa: string;
  loaiMua: "MUA" | "GIA_HAN";
  donGia: number;
  giam: number;
  validityMonths: number | null;
  /** V8.34 — hạn MỚI nếu thanh toán NGAY BÂY GIỜ (cùng `quyetDinhCap` với lúc cấp quyền thật; null = trọn đời). Chỉ dùng cho XEM TRƯỚC — hạn thật tính lại lúc cấp. */
  hetHanMoi: Date | null;
  lyDoGiam: string | null;
  /** Ảnh chụp khuyến mãi LÚC TẠO ĐƠN (ghi vào metadata dòng) — đổi giá/mã về sau không làm đổi lịch sử. null = không dùng mã. */
  khuyenMai: { voucherId: string; ma: string; maVanBan: string; giamUng: number } | null;
};

type ChotGio = {
  ok: true;
  user: { id: string; name: string | null; phone: string | null; email: string | null };
  tenCon: Map<string, string>;
  sdtPh: string;
  daChot: DongDaChot[];
};

export type KetQuaXemTruoc =
  | { ok: true; tongTien: number; giamTong: number; dong: Array<Omit<DongDonOnline, "orderItemId"> & { maGiamGia: string | null; /** ISO; null = trọn đời. Hạn mới nếu thanh toán ngay bây giờ (gia hạn cộng từ hạn hiện tại nếu còn hạn). */ hetHanMoi: string | null }> }
  | { ok: false; ma: MaLoiTaoDon; thongBao: string; viTri?: number };

type Loi = Extract<KetQuaTaoDon, { ok: false }>;

/** BƯỚC ĐỌC (0–4): chốt giỏ + giá + mã giảm — KHÔNG ghi gì. Dùng chung cho tạo đơn và xem trước giá để hai bên không thể lệch nhau. */
async function chotGio(db: Db, input: { parentUserId: string; gioHang: unknown; now: Date; choPhepRong?: boolean }): Promise<ChotGio | Loi> {
  // ── 0. Giỏ ── (đơn CHỈ có học cụ: phần khoá được phép rỗng; mọi trường hợp khác vẫn đòi ≥ 1 dòng)
  const gh: ReturnType<typeof kiemGioHang> = input.choPhepRong && Array.isArray(input.gioHang) && input.gioHang.length === 0 ? { ok: true, dong: [] } : kiemGioHang(input.gioHang);
  if (!gh.ok) return loi(gh.ma, gh.thongBao, gh.viTri);
  const dong: DongGioHang[] = gh.dong;

  // Nhập MÃ (chữ) → voucherId, ở MÁY CHỦ, không phân biệt hoa/thường; mã lạ ⇒ MA_KHONG_TON_TAI (không bỏ qua rồi lưu tiếp). Một dòng không được mang cả hai.
  if (dong.some((d) => d.maGiamGia)) {
    const { ma: tatCa } = await docMaChoDon();
    for (const [i, d] of dong.entries()) {
      if (!d.maGiamGia) continue;
      if (d.voucherId) return loi("DU_LIEU_SAI", `Dòng ${i + 1}: chỉ gửi mã giảm giá HOẶC mã nội bộ, không gửi cả hai`, i) as Loi;
      const khop = tatCa.find((m) => m.ma.toUpperCase() === d.maGiamGia!.toUpperCase());
      if (!khop) return loi("MA_KHONG_TON_TAI", `Dòng ${i + 1}: mã khuyến mãi không tồn tại hoặc đã bị gỡ`, i) as Loi;
      d.voucherId = khop.voucherId;
    }
  }

  // ── 1. Phụ huynh + con (sở hữu) ──
  const user = await db.user.findFirst({
    where: { id: input.parentUserId, isActive: true, deletedAt: null, OR: [{ role: "PARENT" }, { roles: { has: "PARENT" } }] },
    select: { id: true, name: true, phone: true, email: true },
  });
  if (!user) return loi("SAI_PHU_HUYNH", "Không tìm thấy tài khoản phụ huynh");
  const thieuPh = thieuHoSoPhuHuynh(user);
  if (thieuPh.length > 0) return loi("THIEU_HO_SO_PHU_HUYNH", cauThieuHoSo(thieuPh, "phụ huynh"));

  const idCon = [...new Set(dong.map((d) => d.studentId))];
  const con = await db.student.findMany({ where: { id: { in: idCon }, parentUserId: user.id, deletedAt: null }, select: { id: true, name: true } });
  if (con.length !== idCon.length) {
    const viTri = dong.findIndex((d) => !con.some((c) => c.id === d.studentId));
    return loi("SAI_PHU_HUYNH", "Có học viên không thuộc tài khoản này", viTri);
  }
  for (const c of con) {
    const thieu = thieuHoSoHocVien(c);
    if (thieu.length > 0) return loi("THIEU_HO_SO_HOC_VIEN", cauThieuHoSo(thieu, "học viên"));
  }

  // ── 2. Khoá ──
  const idKhoa = [...new Set(dong.map((d) => d.courseId))];
  const khoa = await db.onlCourse.findMany({
    where: { id: { in: idKhoa }, deletedAt: null },
    select: { id: true, name: true, salePrice: true, renewalPrice: true, validityMonths: true, renewalEnabled: true, saleStatus: true, saleOpensAt: true, publishedVersionId: true, prerequisiteMode: true, prerequisiteCourseId: true },
  });
  const khoaTheoId = new Map(khoa.map((k) => [k.id, k]));

  // ── 3. Quyền hiện có của các cặp ──
  const quyen = await db.onlEntitlement.findMany({
    where: { OR: dong.map((d) => ({ studentId: d.studentId, courseId: d.courseId })) },
    select: { id: true, studentId: true, courseId: true, status: true, expiresAt: true, anchorDay: true },
  });
  const quyenTheoCap = new Map(quyen.map((q) => [`${q.studentId}\u0000${q.courseId}`, q]));

  // ── 4. Mã giảm giá ──
  const idMa = [...new Set(dong.map((d) => d.voucherId).filter((x): x is string => !!x))];
  const maTheoId = await docMaTheoId(idMa);
  const ngayXet = ngayVN(input.now);
  const sdtPh = (user.phone ?? "").trim();

  const daChot: DongDaChot[] = [];
  const luotTrongGio = new Map<string, number>(); // (mã × con) đã dùng trong CHÍNH giỏ này
  for (const [i, d] of dong.entries()) {
    const k = khoaTheoId.get(d.courseId);
    if (!k) return loi("KHOA_KHONG_TON_TAI", `Dòng ${i + 1}: khoá học không tồn tại`, i);
    if (!k.publishedVersionId) return loi("KHOA_CHUA_PHAT_HANH", `Dòng ${i + 1}: khoá "${k.name}" chưa phát hành`, i);
    if (!banDuocLucNay(k.saleStatus, k.saleOpensAt, input.now)) return loi("KHOA_KHONG_DANG_BAN", `Dòng ${i + 1}: khoá "${k.name}" hiện không mở bán`, i);

    // Cùng hàm lõi với `capQuyenHoc` — KHÔNG ghi gì.
    const q = quyenTheoCap.get(`${d.studentId}\u0000${d.courseId}`);
    const quyenHienCo: QuyenHienCo | null = q ? { trangThai: q.status, hetHan: q.expiresAt, anchorDay: q.anchorDay } : null;
    const ky: KyHan = k.validityMonths === null ? { loai: "TRON_DOI" } : { loai: "THANG", soThang: k.validityMonths };
    const qd = quyetDinhCap({ now: input.now, loai: "MUA", quyen: quyenHienCo, ky, choPhepGiaHan: k.renewalEnabled });
    if (!qd.ok) return loi(qd.ma, `Dòng ${i + 1}: ${qd.thongBao}`, i);
    const loaiMua = qd.hanhDong === "GIA_HAN" ? "GIA_HAN" : "MUA";

    const donGia = loaiMua === "GIA_HAN" ? (k.renewalPrice ?? k.salePrice) : k.salePrice;
    if (!Number.isInteger(donGia) || donGia <= 0) return loi("GIA_KHONG_HOP_LE", `Dòng ${i + 1}: khoá "${k.name}" chưa có giá bán hợp lệ`, i);

    // Tiên quyết bắt buộc.
    if (k.prerequisiteMode === "REQUIRED" && k.prerequisiteCourseId) {
      const dat = await daHoanThanhKhoa(db, d.studentId, k.prerequisiteCourseId);
      if (!dat) {
        const t = await db.onlCourse.findUnique({ where: { id: k.prerequisiteCourseId }, select: { name: true } });
        return loi("CHUA_DU_TIEN_QUYET", `Dòng ${i + 1}: cần hoàn thành khoá "${t?.name ?? "tiên quyết"}" trước khi học "${k.name}"`, i);
      }
    }

    // Mã giảm giá (≤ 1 mỗi dòng).
    let giam = 0;
    let lyDoGiam: string | null = null;
    if (d.voucherId) {
      const m = maTheoId.get(d.voucherId);
      if (!m) return loi("MA_KHONG_TON_TAI", `Dòng ${i + 1}: mã khuyến mãi không tồn tại hoặc đã bị gỡ`, i);
      const ly = lyDoKhongDung(m, { kenh: "ONLINE", courseId: d.courseId, phamViCoSo: [], ngay: ngayXet, tamTinhDong: donGia });
      if (ly) return loi("MA_KHONG_DUNG_DUOC", `Dòng ${i + 1}: ${m.ma} — ${NHAN_LY_DO_LOAI[ly]}`, i);

      const gioiHan = (await db.voucher.findUnique({ where: { id: d.voucherId }, select: { usageLimitPerUser: true } }))?.usageLimitPerUser ?? 1;
      const daDung = await db.voucherRedemption.count({ where: { voucherId: d.voucherId, customerPhone: sdtPh, orderItem: { studentId: d.studentId } } });
      const khoaLuot = `${d.voucherId}\u0000${d.studentId}`;
      const trongGio = luotTrongGio.get(khoaLuot) ?? 0;
      if (daDung + trongGio >= gioiHan) return loi("MA_HET_LUOT_CUA_CON", `Dòng ${i + 1}: ${m.ma} — con này đã dùng hết lượt của mã`, i);
      luotTrongGio.set(khoaLuot, trongGio + 1);

      giam = Math.min(donGia, tienGiamCuaMa(m, donGia));
      lyDoGiam = `Khuyến mãi ${m.maVanBan} · mã ${m.ma}`;
    }
    const maDung = d.voucherId ? maTheoId.get(d.voucherId) : undefined;
    daChot.push({ courseId: d.courseId, studentId: d.studentId, voucherId: d.voucherId, tenKhoa: k.name, loaiMua, donGia, giam, validityMonths: k.validityMonths, hetHanMoi: qd.hetHan, lyDoGiam, khuyenMai: maDung && giam > 0 ? { voucherId: maDung.voucherId, ma: maDung.ma, maVanBan: maDung.maVanBan, giamUng: giam } : null });
  }
  const tong = daChot.reduce((s, d) => s + d.donGia - d.giam, 0);
  if (daChot.length > 0 && tong <= 0) return loi("DON_0_DONG", "Đơn 0 đồng không đi qua giỏ hàng — khoá miễn phí được cấp bởi quản trị");

  const tenCon = new Map(con.map((c) => [c.id, c.name]));
  return { ok: true, user, tenCon, sdtPh, daChot };
}

/** XEM TRƯỚC GIÁ: chạy ĐÚNG các cổng của tạo đơn (con của mình, khoá bán được, đã trọn đời, mã giảm…) nhưng KHÔNG ghi gì, KHÔNG dùng lượt mã. */
export async function xemTruocDonOnline(db: Db, input: { parentUserId: string; gioHang: unknown; now: Date }): Promise<KetQuaXemTruoc> {
  const c = await chotGio(db, input);
  if (!c.ok) return c;
  const giamTong = c.daChot.reduce((s, d) => s + d.giam, 0);
  return {
    ok: true,
    tongTien: c.daChot.reduce((s, d) => s + d.donGia - d.giam, 0),
    giamTong,
    dong: c.daChot.map((d) => ({ courseId: d.courseId, studentId: d.studentId, tenKhoa: d.tenKhoa, loaiMua: d.loaiMua, donGia: d.donGia, giam: d.giam, thanhTien: d.donGia - d.giam, maGiamGia: d.khuyenMai?.ma ?? null, hetHanMoi: d.hetHanMoi ? d.hetHanMoi.toISOString() : null })),
  };
}

export async function taoDonOnline(
  db: Db,
  input: {
    parentUserId: string;
    gioHang: unknown;
    now: Date;
    /** V8.34 — chạy TRONG CÙNG giao dịch tạo đơn, sau khi đơn + phiếu thu đã ghi (chỉ khi TẠO MỚI, không chạy ở nhánh trả đơn cũ). Dùng cho giỏ hàng đã lưu: xoá dòng đã đặt nguyên tử với đơn. Ném ⇒ cả đơn rollback. */
    sauKhiTao?: (tx: Prisma.TransactionClient, orderId: string) => Promise<void>;
    /** V8.43 — phần HỌC CỤ của đơn hỗn hợp (giá/phí do máy chủ tính; client không gửi). Có ⇒ địa chỉ + phương thức giao BẮT BUỘC; giữ kho cả đơn trong cùng giao dịch. */
    hocCu?: { dong: HocCuDat[]; phuongThuc: string | null };
  },
): Promise<KetQuaTaoDon> {
  const chuKy = input.hocCu ? chuKyHocCu(input.hocCu.dong) : "";
  // Bấm đúp/thử lại cùng giỏ ⇒ trả lại ĐƠN CŨ TRƯỚC mọi cổng giá/mã (lượt mã của chính đơn cũ không được chặn lần thử lại).
  const gh0 = kiemGioHang(input.gioHang);
  if (gh0.ok) {
    const truoc = await docDonDangCho(db, input.parentUserId, gh0.dong.map((d) => ({ studentId: d.studentId, courseId: d.courseId })), chuKy);
    if (truoc?.kieu === "TRUNG") return truoc.ket;
  }
  const c = await chotGio(db, { ...input, choPhepRong: !!input.hocCu && input.hocCu.dong.length > 0 });
  if (!c.ok) return c;
  const { user, tenCon, sdtPh, daChot } = c;
  const hc = input.hocCu && input.hocCu.dong.length > 0 ? await chotHocCu(db, { parentUserId: user.id, dong: input.hocCu.dong, phuongThuc: input.hocCu.phuongThuc, tamTinhKhoa: daChot.reduce((s, d) => s + d.donGia, 0) }) : null;
  if (hc && !hc.ok) return loiHocCu(hc);
  if (daChot.length === 0 && !hc) return loi("GIO_RONG", "Giỏ hàng trống");
  const ttlGiuKho = hc ? await docPhutGiuKho() : 0;
  // V8.18: CHỤP thông tin nhận tiền + pháp nhân bán (SataRobo) ĐÚNG LÚC TẠO ĐƠN. Chưa có cấu hình hợp lệ ⇒ đơn vẫn tạo được nhưng KHÔNG có bản chụp (hướng dẫn thanh toán = BLOCKED_CONFIG).
  const chup = await docCauHinhDangBat(db);
  const banChup = chup.trangThai === "SAN_SANG" ? chup.cauHinh : null;

  // ── 5. GHI (một giao dịch) ──
  return db.$transaction(
    async (tx): Promise<KetQuaTaoDon> => {
      // Khoá dòng phụ huynh: hai lượt cùng giỏ xếp hàng ⇒ lượt sau thấy đơn đang chờ của lượt trước (idempotent).
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`;

      const trung = daChot.length > 0 ? await docDonDangCho(tx, user.id, daChot, chuKy) : null;
      if (trung?.kieu === "TRUNG") return trung.ket;
      if (trung?.kieu === "MOT_PHAN") return loi("DA_CO_DON_DANG_CHO", `Đã có đơn ${trung.code} đang chờ thanh toán cho một phần của giỏ hàng này — thanh toán hoặc huỷ đơn đó trước`);

      // Đếm LẠI lượt mã theo con DƯỚI khoá: số đếm ở `chotGio` đọc ngoài giao dịch nên hai giỏ KHÁC nhau gửi cùng lúc đều thấy «còn lượt». Đứng TRƯỚC phép ghi đầu tiên (`nextInvoiceCode`).
      await kiemLuotMaCuaConDuoiKhoa(tx, sdtPh, daChot);

      const code = await nextInvoiceCode(tx, MA_CO_SO_DON_ONLINE, input.now.getUTCFullYear());
      const subtotal = daChot.reduce((s, d) => s + d.donGia, 0) + (hc?.ok ? hc.tienHang : 0);
      const giamTong = daChot.reduce((s, d) => s + d.giam, 0);
      const phiGiao = hc?.ok ? hc.giao.phi : 0;
      const tongDon = subtotal - giamTong + phiGiao;
      const don = await tx.order.create({
        data: {
          code,
          type: "ONLINE",
          status: "PENDING_PAYMENT",
          customerName: user.name ?? "",
          customerPhone: sdtPh,
          customerEmail: user.email,
          centerId: null,
          createdById: user.id,
          subtotal,
          discountAmount: giamTong,
          totalAmount: tongDon,
          ...(hc?.ok ? { shippingFee: phiGiao, shippingMethodCode: hc.giao.phuongThuc, shippingAddress: chupGiaoHang(hc.giao) } : {}),
          ...(banChup ? { legalEntityId: banChup.phapNhan.id, onlinePaymentSnapshot: chupChoDon(banChup, input.now) as unknown as Prisma.InputJsonValue } : {}),
        },
        select: { id: true, code: true },
      });

      const ketQuaDong: DongDonOnline[] = [];
      for (const d of daChot) {
        const meta: Prisma.InputJsonValue = { kenh: "ONLINE", onlineCourseId: d.courseId, loaiMua: d.loaiMua, validityMonths: d.validityMonths, ...(d.khuyenMai ? { khuyenMai: d.khuyenMai } : {}) };
        const it = await tx.orderItem.create({
          data: {
            orderId: don.id,
            type: "ONLINE_COURSE",
            onlineCourseId: d.courseId,
            studentId: d.studentId,
            itemName: d.tenKhoa,
            itemDescription: `Học viên: ${tenCon.get(d.studentId) ?? ""}`,
            quantity: 1,
            unitPrice: d.donGia,
            totalPrice: d.donGia,
            discountAmount: d.giam,
            discountReason: d.lyDoGiam,
            metadata: meta,
          },
          select: { id: true },
        });
        await tx.orderOnlineGrant.create({ data: { orderItemId: it.id, orderId: don.id, studentId: d.studentId, courseId: d.courseId, status: "PENDING" } });

        if (d.voucherId && d.giam > 0) {
          await tx.voucherRedemption.create({ data: { voucherId: d.voucherId, orderId: don.id, orderItemId: it.id, customerPhone: sdtPh, discountApplied: d.giam } });
          // Chống đua bằng điều kiện trong `where` (khuôn của `createOrderManualAction`): hai đơn cùng giành suất cuối ⇒ đúng một thắng.
          const v = await tx.voucher.findUnique({ where: { id: d.voucherId }, select: { quantity: true, code: true } });
          if (v?.quantity == null) {
            await tx.voucher.update({ where: { id: d.voucherId }, data: { usedCount: { increment: 1 } } });
          } else {
            const thang = await tx.voucher.updateMany({ where: { id: d.voucherId, usedCount: { lt: v.quantity } }, data: { usedCount: { increment: 1 } } });
            // THROW (không return): đã ghi đơn rồi — luật rollback của repo.
            if (thang.count === 0) throw new LoiHetSuatMa(v.code);
          }
        }
        ketQuaDong.push({ orderItemId: it.id, courseId: d.courseId, studentId: d.studentId, tenKhoa: d.tenKhoa, loaiMua: d.loaiMua, donGia: d.donGia, giam: d.giam, thanhTien: d.donGia - d.giam });
      }

      // V8.43 — học cụ: dòng PRODUCT + fulfillment + GIỮ KHO cả đơn (thiếu hàng ⇒ ném ⇒ rollback toàn bộ đơn).
      const hocCuGhi = hc?.ok ? await ghiHocCu(tx, { orderId: don.id, dong: hc.dong, now: input.now, ttlPhut: ttlGiuKho }) : null;

      const phieuId = await ensureFullOrderRequest(tx, { id: don.id, code: don.code, totalAmount: tongDon, centerId: null });
      // V8.18: nội dung CK `SR{ma}` CHÍNH LÀ mã đối khớp (`matchKey`) của phiếu thu toàn đơn ⇒ webhook khớp theo SO BẰNG như mọi phiếu khác, không cần đổi lõi đối khớp.
      // Đặt NGAY lúc tạo (chưa có đồng nào, cùng giao dịch) — sau đó bất biến. Quá 25 ký tự ⇒ từ chối tạo đơn (không cắt ngầm: cắt làm mất mã).
      if (banChup && phieuId) {
        const memo = noiDungChuyenKhoan(banChup.memoPrefix, paymentMatchKey(don.code, 0));
        if (!memo) throw new LoiMemoQuaDai(don.code);
        await tx.paymentRequest.update({ where: { id: phieuId }, data: { matchKey: memo } });
      }
      await writeAudit({
        tx,
        actor: { id: user.id, name: user.name ?? user.id },
        module: "online-checkout",
        entityType: "Order",
        entityId: don.id,
        action: "CREATE",
        newValues: { code: don.code, tong: tongDon, soDong: daChot.length, ...(hocCuGhi ? { hocCu: hocCuGhi.dong.map((x) => ({ sp: x.productId, sl: x.soLuong })), phiVanChuyen: phiGiao } : {}), cap: daChot.map((d) => ({ khoa: d.courseId, hocVien: d.studentId, loai: d.loaiMua })) },
        orgUnitId: null,
      });
      if (input.sauKhiTao) await input.sauKhiTao(tx, don.id);
      return { ok: true, daCo: false, orderId: don.id, orderCode: don.code, tongTien: tongDon, giamTong, dong: ketQuaDong, ...(hocCuGhi ? { dongHocCu: hocCuGhi.dong, phiVanChuyen: phiGiao, giuKho: { hanGiuLuc: hocCuGhi.hanGiuLuc.toISOString() } } : {}) };
    },
    { timeout: 30_000, maxWait: 10_000 },
  ).catch((e: unknown) => {
    if (e instanceof LoiHetLuotCuaCon) return loi("MA_HET_LUOT_CUA_CON", `Dòng ${e.viTri + 1}: ${e.ma} — con này đã dùng hết lượt của mã`, e.viTri);
    if (e instanceof LoiMemoQuaDai) return loi("CAU_HINH_THU_TIEN_KHONG_HOP_LE", "Nội dung chuyển khoản (tiền tố + mã đơn) vượt 25 ký tự — Quản trị tối cao cần chọn tiền tố ngắn hơn");
    if (e instanceof LoiHetSuatMa) return loi("MA_HET_SUAT", `Mã ${e.ma} vừa hết suất — bỏ mã hoặc chọn chương trình khác`);
    if (e instanceof LoiHetHang) return loiHocCu({ ok: false, ma: "HET_HANG", thongBao: "Có sản phẩm không còn đủ hàng — xem lại giỏ hàng", thieu: e.thieu, cartItemIds: (input.hocCu?.dong ?? []).filter((d) => e.thieu.some((t) => t.productId === d.productId)).map((d) => d.cartItemId) });
    if (e instanceof LoiGiaDoi) return loiHocCu({ ok: false, ma: "GIA_DA_DOI", thongBao: "Giá sản phẩm vừa thay đổi — xem lại giỏ hàng", cartItemIds: (input.hocCu?.dong ?? []).filter((d) => e.productIds.includes(d.productId)).map((d) => d.cartItemId) });
    throw e;
  });
}

type DonTrung = { kieu: "TRUNG"; ket: Extract<KetQuaTaoDon, { ok: true }> } | { kieu: "MOT_PHAN"; code: string };

/**
 * Đơn ĐANG CHỜ THANH TOÁN của phụ huynh giao với các cặp (khoá × học viên) của giỏ.
 *   · TRÙNG = cùng ĐÚNG tập cặp ⇒ bấm đúp/thử lại ⇒ trả LẠI đơn cũ (idempotent).
 *   · MOT_PHAN = giao một phần ⇒ `DA_CO_DON_DANG_CHO`.
 * Chạy TRƯỚC bước chốt giá (V8.17): nếu không, giỏ có MÃ giảm (trần lượt/con) bị từ chối `MA_HET_LUOT_CUA_CON` ngay ở lần bấm thứ hai thay vì trả lại đơn cũ.
 * Chạy lại TRONG giao dịch (sau khoá dòng phụ huynh) để chặn đua. Chỉ nhìn đơn do CHÍNH phụ huynh tạo ⇒ không lộ đơn của người khác.
 */
async function docDonDangCho(cli: Db | Prisma.TransactionClient, userId: string, cap: ReadonlyArray<{ studentId: string; courseId: string }>, chuKy: string): Promise<DonTrung | null> {
  const dangCho = await cli.orderOnlineGrant.findMany({
    where: {
      status: "PENDING",
      OR: cap.map((d) => ({ studentId: d.studentId, courseId: d.courseId })),
      orderItem: { order: { status: "PENDING_PAYMENT", deletedAt: null, createdById: userId } },
    },
    select: { studentId: true, courseId: true, orderItem: { select: { order: { select: { id: true, code: true } } } } },
  });
  if (dangCho.length === 0) return null;
  const theoDon = new Map<string, { code: string; cap: Set<string> }>();
  for (const g of dangCho) {
    const o = g.orderItem.order;
    if (!theoDon.has(o.id)) theoDon.set(o.id, { code: o.code, cap: new Set<string>() });
  }
  // Tập cặp ĐẦY ĐỦ của từng đơn (không chỉ phần giao với giỏ): giỏ mới chỉ là TẬP CON của một đơn đang chờ thì KHÔNG phải cùng giỏ.
  const dayDu = await cli.orderOnlineGrant.findMany({ where: { orderId: { in: [...theoDon.keys()] } }, select: { orderId: true, studentId: true, courseId: true } });
  for (const g of dayDu) theoDon.get(g.orderId)!.cap.add(`${g.studentId}\u0000${g.courseId}`);
  const yeuCau = new Set(cap.map((d) => `${d.studentId}\u0000${d.courseId}`));
  for (const [orderId, e] of theoDon) {
    if (e.cap.size === yeuCau.size && [...e.cap].every((c) => yeuCau.has(c))) {
      const don = await cli.order.findUniqueOrThrow({ where: { id: orderId }, select: { id: true, code: true, totalAmount: true, discountAmount: true, shippingFee: true, items: { select: { id: true, type: true, productId: true, quantity: true, totalPrice: true, onlineCourseId: true, studentId: true, itemName: true, itemDescription: true, unitPrice: true, discountAmount: true, metadata: true } } } });
      // «Cùng giỏ» còn phải cùng BỘ HỌC CỤ — nếu không, giỏ mới (cùng khoá, học cụ khác) sẽ nhận nhầm đơn cũ thiếu hàng.
      const hangDonCu = don.items.filter((it) => it.type === "PRODUCT" && it.productId);
      if (chuKyHocCu(hangDonCu.map((it) => ({ productId: it.productId!, soLuong: it.quantity }))) !== chuKy) continue;
      const giuConHan = hangDonCu.length > 0 ? await cli.productReservation.findMany({ where: { orderItem: { orderId }, status: "ACTIVE" }, select: { expiresAt: true } }) : [];
      const hanMin = giuConHan.length > 0 ? new Date(Math.min(...giuConHan.map((r) => r.expiresAt.getTime()))) : null;
      return {
        kieu: "TRUNG",
        ket: {
          ok: true,
          daCo: true,
          orderId: don.id,
          orderCode: don.code,
          tongTien: don.totalAmount,
          giamTong: don.discountAmount,
          ...(hangDonCu.length > 0 ? { dongHocCu: hangDonCu.map((it) => ({ orderItemId: it.id, productId: it.productId!, sku: (it.metadata as { sku?: string } | null)?.sku ?? "", ten: it.itemName, soLuong: it.quantity, donGia: it.unitPrice, thanhTien: it.totalPrice })), phiVanChuyen: don.shippingFee, giuKho: hanMin ? { hanGiuLuc: hanMin.toISOString() } : null } : {}),
          dong: don.items.filter((it) => it.type === "ONLINE_COURSE").map((it) => ({
            orderItemId: it.id,
            courseId: it.onlineCourseId ?? "",
            studentId: it.studentId ?? "",
            tenKhoa: it.itemName,
            loaiMua: (it.metadata as { loaiMua?: string } | null)?.loaiMua === "GIA_HAN" ? ("GIA_HAN" as const) : ("MUA" as const),
            donGia: it.unitPrice,
            giam: it.discountAmount,
            thanhTien: it.unitPrice - it.discountAmount,
          })),
        },
      };
    }
  }
  return { kieu: "MOT_PHAN", code: [...theoDon.values()][0]!.code };
}

class LoiMemoQuaDai extends Error {
  constructor(public readonly maDon: string) {
    super(`MEMO_QUA_DAI:${maDon}`);
  }
}

/**
 * Trần lượt mã THEO CON, đọc dưới khoá dòng phụ huynh (mọi lượt tạo đơn của một phụ huynh xếp hàng ở đó, mà một con chỉ thuộc một phụ huynh).
 * Tính cả các lượt mà CHÍNH giỏ này sắp ghi. Vượt ⇒ NÉM (giao dịch bỏ trọn). Cùng phép đếm với `chotGio`.
 */
async function kiemLuotMaCuaConDuoiKhoa(tx: Prisma.TransactionClient, sdtPh: string, daChot: readonly DongDaChot[]): Promise<void> {
  const trongGio = new Map<string, number>();
  for (const [i, d] of daChot.entries()) {
    if (!d.voucherId || d.giam <= 0) continue; // cùng điều kiện với phép ghi `VoucherRedemption`
    const khoaLuot = `${d.voucherId}\u0000${d.studentId}`;
    const sapDung = (trongGio.get(khoaLuot) ?? 0) + 1;
    trongGio.set(khoaLuot, sapDung);
    const gioiHan = (await tx.voucher.findUnique({ where: { id: d.voucherId }, select: { usageLimitPerUser: true } }))?.usageLimitPerUser ?? 1;
    const daDung = await tx.voucherRedemption.count({ where: { voucherId: d.voucherId, customerPhone: sdtPh, orderItem: { studentId: d.studentId } } });
    if (daDung + sapDung > gioiHan) throw new LoiHetLuotCuaCon(i, d.khuyenMai?.ma ?? "mã đã chọn");
  }
}

class LoiHetLuotCuaCon extends Error {
  constructor(
    public readonly viTri: number,
    public readonly ma: string,
  ) {
    super(`MA_HET_LUOT_CUA_CON:${ma}`);
  }
}

class LoiHetSuatMa extends Error {
  constructor(public readonly ma: string) {
    super(`MA_HET_SUAT:${ma}`);
  }
}

/**
 * "Đã hoàn thành khoá" (cho tiên quyết `REQUIRED`) = có chứng nhận ISSUED của khoá đó, HOẶC tiến độ khoá hoàn thành.
 * Chứng nhận là bằng chứng bền (giữ qua phát hành bản mới); tiến độ có thể bị đặt lại ở bài phải học lại ⇒ hai vế OR.
 * ⚠️ ĐỀ XUẤT theo hợp đồng v0.2 §7.3 — "hoàn thành" chưa được chủ dự án định nghĩa bằng văn bản.
 */
export async function daHoanThanhKhoa(db: Db, studentId: string, courseId: string): Promise<boolean> {
  const cn = await db.onlCertificate.findFirst({ where: { studentId, courseId, status: "ISSUED" }, select: { id: true } });
  if (cn) return true;
  const q = await db.onlEntitlement.findUnique({ where: { studentId_courseId: { studentId, courseId } }, select: { id: true, course: { select: { publishedVersionId: true } } } });
  if (!q || !q.course.publishedVersionId) return false;
  const td = await docTienDoKhoaTheoQuyen(db, q.id, courseId);
  return td.hoanThanh;
}
