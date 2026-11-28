import type { Prisma, PrismaClient } from "@prisma/client";

import { kiemGioHang } from "./gio-hang";
import { tinhPhiGiao, type KetQuaPhiGiao } from "./giao-hang";
import { laDongHopLe, xetDongHocCu, type DongHocCuDto } from "./gio-hang-hoc-cu";
import { soLuongToiDaCuaSanPham } from "./danh-muc-hoc-cu";
import { tinhKhaDung, tongDangGiu } from "@/lib/inventory/giu-kho";
import { huyDonOnlineChuaThanhToan } from "./phu-huynh";
import { taoDonOnline, xemTruocDonOnline, type KetQuaTaoDon, type MaLoiTaoDon } from "./tao-don";

/**
 * V8.34 — GIỎ HÀNG ĐÃ LƯU (Commerce v2, vòng 1: ONLINE_COURSE). Một giỏ/phụ huynh, dùng chung Web/Mobile, KHÔNG hết hạn theo thời gian.
 * Dịch vụ dùng chung — các route mobile (và web sau này) chỉ là lớp mỏng. KHÔNG có engine giá/thanh toán thứ hai:
 *   · MỖI dòng được xét bằng ĐÚNG cổng của tạo đơn (`xemTruocDonOnline` cho một dòng) — thêm dòng, xem giỏ và đặt hàng không thể lệch nhau;
 *   · đặt hàng gọi `taoDonOnline` (idempotent theo nội dung giỏ, khoá dòng phụ huynh, snapshot pháp nhân/tài khoản nhận) và xoá các dòng đã đặt TRONG CÙNG giao dịch tạo đơn (hook `sauKhiTao`);
 *   · giỏ KHÔNG chứa số tiền tính được: `donGiaLucThem` chỉ để báo «giá đã đổi».
 * Loại trừ OFFLINE là cấu trúc: dòng chỉ có FK tới `OnlCourse`/`Product` (xem migration `20261213090000_gio_hang_luu`); id khoá Offline thật ⇒ `LOAI_SAN_PHAM_CHUA_HO_TRO`.
 * `revision`: tăng ở MỌI thay đổi, dưới khoá dòng giỏ (FOR UPDATE) ⇒ ghi có điều kiện; kỳ vọng lệch ⇒ `GIO_DA_THAY_DOI` (app tự GET lại).
 */

type Db = PrismaClient;

export const TOI_DA_DONG_GIO_LUU = 50;
export type LoaiDongGio = "ONLINE_COURSE" | "PHYSICAL_GOOD";

export type MaLoiGio = "GIO_DA_THAY_DOI" | "DONG_KHONG_THUOC_GIO" | "GIO_TOI_DA_DONG" | "LOAI_SAN_PHAM_CHUA_HO_TRO" | "KHONG_CO_DONG_DE_DAT" | "HET_HANG" | "SO_LUONG_VUOT_TOI_DA" | "KHONG_BAN_ONLINE" | "SAN_PHAM_KHONG_TON_TAI" | "SAI_LOAI_DONG" | "DONG_DA_CO_TRONG_GIO" | "PHUONG_THUC_GIAO_KHONG_HOP_LE" | "GIA_DA_TANG";
export type LoiGio = { ok: false; ma: MaLoiGio | MaLoiTaoDon; thongBao: string; viTri?: number; /** dòng giỏ liên quan (HET_HANG/GIA_DA_TANG…) */ cartItemIds?: string[]; thieu?: Array<{ itemId: string | null; productId: string; yeuCau: number; conLai: number }> };

export type DongGioDto = {
  itemId: string;
  loai: "ONLINE_COURSE";
  khoaId: string | null;
  studentId: string | null;
  tenKhoa: string | null;
  tenCon: string | null;
  maGiamGia: string | null;
  /** giá (trước giảm) lúc thêm — CHỈ hiển thị «giá đã đổi». null nếu chưa ghi. */
  donGiaLucThem: number | null;
  giaDaDoi: boolean;
  /** Đơn Online CHƯA thanh toán của chính phụ huynh đã chứa cặp (khoá × con) này — chỉ để app báo SỚM («đã có đơn chờ»); KHÔNG đổi trạng thái dòng (đặt hàng vẫn trả đơn cũ hoặc 409 DA_CO_DON_DANG_CHO như lõi). null = không có. */
  donDangCho: { orderId: string; orderCode: string } | null;
  trangThai: "SAN_SANG" | "KHONG_MUA_DUOC";
  ma?: string;
  thongBao?: string;
  loaiMua?: "MUA" | "GIA_HAN";
  donGia?: number;
  giam?: number;
  thanhTien?: number;
  /** ISO; null = trọn đời. Hạn mới NẾU thanh toán ngay bây giờ. */
  hetHanMoi?: string | null;
};
export type KhuyenMaiGioDto = { ma: string; hopLe: boolean; apDungCho: Array<"ONLINE_COURSE">; khongApDungCho: Array<"HOC_CU">; moTa: string };
export type DongBiGoDto = { id: string; ten: string; lyDo: string; luc: string };
export type GioDto = {
  revision: number;
  dong: Array<DongGioDto | DongHocCuDto>;
  /** tổng các dòng HỢP LỆ TRƯỚC giảm giá và phí (do máy chủ — app không tự cộng) */
  tamTinh: number;
  tongTien: number;
  giamTong: number;
  /** phí vận chuyển do máy chủ tính (0 khi giỏ chỉ có khoá Online; học cụ: theo phương thức giao — P0-C) */
  phiVanChuyen: number;
  soDongSanSang: number;
  soDong: number;
  /** dòng KHÔNG hợp lệ (cần ba mẹ xử lý) — «Xử lý N dòng để thanh toán» */
  soDongCanXuLy: number;
  khuyenMai: KhuyenMaiGioDto | null;
  dongBiGo: DongBiGoDto[];
  gioMayChu: string;
  giaoHang: { yeuCau: boolean; phuongThuc: string | null; daCoDiaChi: boolean; /** vì sao CHƯA tính được phí (thiếu địa chỉ/chưa chọn/không áp dụng) — null khi đã đủ hoặc không cần giao */ vanDe: Extract<KetQuaPhiGiao, { ok: false }>["ma"] | null };
};

class LoiGioDaDoi extends Error {}

const loiGio = (ma: LoiGio["ma"], thongBao: string, viTri?: number): LoiGio => ({ ok: false, ma, thongBao, ...(viTri !== undefined ? { viTri } : {}) });
const khoaGio = async (tx: Prisma.TransactionClient, cartId: string) => {
  await tx.$queryRaw`SELECT "id" FROM "Cart" WHERE "id" = ${cartId} FOR UPDATE`;
  return tx.cart.findUniqueOrThrow({ where: { id: cartId }, select: { id: true, revision: true } });
};
/**
 * Lấy giỏ của phụ huynh, chưa có thì tạo. KHÔNG dùng `upsert` với `update: {}`: bản đó đọc rồi mới ghi (không nguyên tử) ⇒ nhiều yêu cầu đầu tiên đến cùng lúc (app tự gửi lại khi đứt mạng)
 * thì lượt thua ném P2002 trên `parentUserId` ⇒ 500. `createMany` + `skipDuplicates` là `ON CONFLICT DO NOTHING` — [CGT-09].
 */
const layHoacTaoGio = async (db: Db, parentUserId: string) => {
  const chon = { id: true, revision: true, lastCheckoutRevision: true, lastCheckoutOrderId: true, shippingMethodCode: true } as const;
  const co = await db.cart.findUnique({ where: { parentUserId }, select: chon });
  if (co) return co;
  await db.cart.createMany({ data: [{ parentUserId }], skipDuplicates: true });
  return db.cart.findUniqueOrThrow({ where: { parentUserId }, select: chon });
};

type DongDb = { id: string; itemType: string; onlineCourseId: string | null; productId: string | null; quantity: number; studentId: string | null; maGiamGia: string | null; donGiaLucThem: number | null };

/** Xét MỘT dòng bằng cổng của tạo đơn (không ghi gì, không tiêu lượt mã). */
async function xetMotDong(db: Db, parentUserId: string, d: { courseId: string; studentId: string; maGiamGia: string | null }, now: Date) {
  return xemTruocDonOnline(db, { parentUserId, gioHang: [{ courseId: d.courseId, studentId: d.studentId, voucherId: null, maGiamGia: d.maGiamGia }], now });
}

type KetQuaDung = { gio: GioDto; canGo: Array<{ itemId: string; ten: string; lyDo: "SAN_PHAM_NGUNG_BAN" }> };

async function dungGio(db: Db, parentUserId: string, cart: { id: string; revision: number; shippingMethodCode: string | null }, dongDb: DongDb[], now: Date): Promise<KetQuaDung> {
  const khoaRows = dongDb.filter((d) => d.itemType !== "PHYSICAL_GOOD");
  const idKhoa = [...new Set(khoaRows.map((d) => d.onlineCourseId).filter((x): x is string => !!x))];
  const idCon = [...new Set(khoaRows.map((d) => d.studentId).filter((x): x is string => !!x))];
  const [khoa, con, hocCu, thongBaoGo] = await Promise.all([
    idKhoa.length ? db.onlCourse.findMany({ where: { id: { in: idKhoa } }, select: { id: true, name: true } }) : [],
    idCon.length ? db.student.findMany({ where: { id: { in: idCon }, parentUserId }, select: { id: true, name: true } }) : [],
    xetDongHocCu(db, { rows: dongDb.filter((d) => d.itemType === "PHYSICAL_GOOD").map((d) => ({ id: d.id, productId: d.productId, quantity: d.quantity, donGiaLucThem: d.donGiaLucThem })), parentUserId, now }),
    db.cartRemovedNotice.findMany({ where: { cartId: cart.id, ackedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, ten: true, lyDo: true, createdAt: true } }),
  ]);
  const tenKhoa = new Map(khoa.map((k) => [k.id, k.name]));
  const tenCon = new Map(con.map((c) => [c.id, c.name]));
  const dangCho = idKhoa.length && idCon.length
    ? await db.orderItem.findMany({
        where: { type: "ONLINE_COURSE", onlineCourseId: { in: idKhoa }, studentId: { in: idCon }, order: { createdById: parentUserId, type: "ONLINE", status: "PENDING_PAYMENT", deletedAt: null } },
        select: { onlineCourseId: true, studentId: true, order: { select: { id: true, code: true } } },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const donCho = new Map<string, { orderId: string; orderCode: string }>();
  for (const x of dangCho) {
    const k = `${x.onlineCourseId}|${x.studentId}`;
    if (!donCho.has(k)) donCho.set(k, { orderId: x.order.id, orderCode: x.order.code });
  }
  const hocCuTheoId = new Map(hocCu.dong.map((x) => [x.itemId, x]));
  const dong: Array<DongGioDto | DongHocCuDto> = [];
  for (const d of dongDb) {
    if (d.itemType === "PHYSICAL_GOOD") {
      const x = hocCuTheoId.get(d.id);
      if (x) dong.push(x); // dòng bị GỠ (sản phẩm ngừng kinh doanh) không có trong `dong`
      continue;
    }
    const co: Pick<DongGioDto, "itemId" | "khoaId" | "studentId" | "tenKhoa" | "tenCon" | "maGiamGia" | "donGiaLucThem" | "donDangCho"> = {
      itemId: d.id,
      khoaId: d.onlineCourseId,
      studentId: d.studentId,
      tenKhoa: d.onlineCourseId ? (tenKhoa.get(d.onlineCourseId) ?? null) : null,
      tenCon: d.studentId ? (tenCon.get(d.studentId) ?? null) : null,
      maGiamGia: d.maGiamGia,
      donGiaLucThem: d.donGiaLucThem,
      donDangCho: d.onlineCourseId && d.studentId ? (donCho.get(`${d.onlineCourseId}|${d.studentId}`) ?? null) : null,
    };
    if (d.itemType !== "ONLINE_COURSE" || !d.onlineCourseId || !d.studentId) {
      // loại lạ (không thể tạo qua dịch vụ này) — hiển thị nhưng KHÔNG tính vào tổng
      dong.push({ ...co, loai: "ONLINE_COURSE", giaDaDoi: false, trangThai: "KHONG_MUA_DUOC", ma: "LOAI_SAN_PHAM_CHUA_HO_TRO", thongBao: "Loại sản phẩm này chưa được bán qua cửa hàng Online." });
      continue;
    }
    const r = await xetMotDong(db, parentUserId, { courseId: d.onlineCourseId, studentId: d.studentId, maGiamGia: d.maGiamGia }, now);
    if (!r.ok) {
      dong.push({ ...co, loai: "ONLINE_COURSE", giaDaDoi: false, trangThai: "KHONG_MUA_DUOC", ma: r.ma, thongBao: r.thongBao });
      continue;
    }
    const x = r.dong[0]!;
    dong.push({
      ...co,
      loai: "ONLINE_COURSE",
      giaDaDoi: d.donGiaLucThem !== null && d.donGiaLucThem !== x.donGia,
      trangThai: "SAN_SANG",
      loaiMua: x.loaiMua,
      donGia: x.donGia,
      giam: x.giam,
      thanhTien: x.thanhTien,
      hetHanMoi: x.hetHanMoi,
    });
  }
  const hopLe = dong.filter((x) => (x.loai === "HOC_CU" ? laDongHopLe(x.trangThai) : x.trangThai === "SAN_SANG"));
  const thanhTienDong = (x: DongGioDto | DongHocCuDto) => (x.loai === "HOC_CU" ? x.thanhTien : (x.thanhTien ?? 0));
  const giamDong = (x: DongGioDto | DongHocCuDto) => (x.loai === "HOC_CU" ? 0 : (x.giam ?? 0));
  const tongSau = hopLe.reduce((sum, x) => sum + thanhTienDong(x), 0);
  const giamTong = hopLe.reduce((sum, x) => sum + giamDong(x), 0);
  const tamTinh = tongSau + giamTong;
  // Giao hàng CHỈ khi còn dòng học cụ HỢP LỆ; phí do máy chủ tính từ cấu hình + địa chỉ + phương thức đã chọn (cùng hàm với lúc đặt hàng).
  const coHocCu = hopLe.some((x) => x.loai === "HOC_CU");
  let phiVanChuyen = 0;
  let giaoHang: GioDto["giaoHang"] = { yeuCau: false, phuongThuc: null, daCoDiaChi: false, vanDe: null };
  if (coHocCu) {
    const [coDiaChi, phi] = await Promise.all([db.parentShippingAddress.count({ where: { parentUserId } }), tinhPhiGiao(db, { parentUserId, phuongThuc: cart.shippingMethodCode, tamTinhHang: tamTinh })]);
    if (phi.ok) phiVanChuyen = phi.phi;
    giaoHang = { yeuCau: true, phuongThuc: cart.shippingMethodCode, daCoDiaChi: coDiaChi > 0, vanDe: phi.ok ? null : phi.ma };
  }
  return {
    gio: {
      revision: cart.revision,
      dong,
      tamTinh,
      tongTien: tamTinh - giamTong + phiVanChuyen,
      giamTong,
      phiVanChuyen,
      soDongSanSang: hopLe.length,
      soDong: dong.length,
      soDongCanXuLy: dong.length - hopLe.length,
      khuyenMai: dungKhuyenMai(dong),
      dongBiGo: thongBaoGo.map((n) => ({ id: n.id, ten: n.ten, lyDo: n.lyDo, luc: n.createdAt.toISOString() })),
      gioMayChu: now.toISOString(),
      giaoHang,
    },
    canGo: hocCu.canGo,
  };
}

/** Khối mã khuyến mãi cấp giỏ: phạm vi do MÁY CHỦ nói (mã chỉ áp cho khoá Online). null khi chưa dòng khoá nào mang mã. */
function dungKhuyenMai(dong: Array<DongGioDto | DongHocCuDto>): KhuyenMaiGioDto | null {
  const khoaCoMa = dong.filter((x): x is DongGioDto => x.loai === "ONLINE_COURSE" && !!x.maGiamGia);
  if (khoaCoMa.length === 0) return null;
  const ma = khoaCoMa[0]!.maGiamGia!;
  const loi = khoaCoMa.find((x) => x.trangThai === "KHONG_MUA_DUOC" && typeof x.ma === "string" && x.ma.startsWith("MA_"));
  if (loi) return { ma, hopLe: false, apDungCho: ["ONLINE_COURSE"], khongApDungCho: ["HOC_CU"], moTa: loi.thongBao ?? "Mã khuyến mãi không dùng được." };
  const soDongGiam = khoaCoMa.filter((x) => (x.giam ?? 0) > 0).length;
  return { ma, hopLe: true, apDungCho: ["ONLINE_COURSE"], khongApDungCho: ["HOC_CU"], moTa: `Giảm cho ${soDongGiam} khoá online. Mã không áp cho học cụ.` };
}

const CHON_DONG = { id: true, itemType: true, onlineCourseId: true, productId: true, quantity: true, studentId: true, maGiamGia: true, donGiaLucThem: true } as const;

/**
 * GET giỏ: trạng thái SỐNG từng dòng (cùng cổng với đặt hàng). Chỉ GHI khi phải dọn dòng KHÔNG THỂ cứu: dòng học cụ của sản phẩm đã ngừng kinh doanh bị GỠ khỏi giỏ
 * và lưu thông báo `CartRemovedNotice` (trả trong mọi GET cho tới khi phụ huynh xác nhận); có thay đổi ⇒ `revision` +1 đúng một lần.
 * Kẹp số lượng theo kho KHÔNG ghi gì (xem `xetDongHocCu`) — GET thường là thuần đọc.
 */
export async function docGio(db: Db, input: { parentUserId: string; now: Date }): Promise<GioDto> {
  const cart = await layHoacTaoGio(db, input.parentUserId);
  const doc = async (c: { id: string; revision: number; shippingMethodCode: string | null }) => dungGio(db, input.parentUserId, c, await db.cartItem.findMany({ where: { cartId: c.id }, orderBy: { createdAt: "asc" }, select: CHON_DONG }), input.now);
  const r = await doc(cart);
  if (r.canGo.length === 0) return r.gio;
  await db.$transaction(async (tx) => {
    const c = await khoaGio(tx, cart.id);
    let doi = 0;
    for (const x of r.canGo) {
      const xoa = await tx.cartItem.deleteMany({ where: { id: x.itemId, cartId: c.id } });
      if (xoa.count > 0) {
        await tx.cartRemovedNotice.create({ data: { cartId: c.id, ten: x.ten.slice(0, 200), lyDo: x.lyDo } });
        doi += xoa.count;
      }
    }
    if (doi > 0) await tx.cart.update({ where: { id: c.id }, data: { revision: { increment: 1 } } });
  });
  const sau = await layHoacTaoGio(db, input.parentUserId);
  return (await doc(sau)).gio;
}

export type ThemDongInput = { parentUserId: string; loai?: LoaiDongGio; khoaId?: string; studentId?: string; productId?: string; soLuong?: number; maGiamGia?: string | null; revision?: number; now: Date };

export async function themDongGio(db: PrismaClient, input: ThemDongInput): Promise<({ ok: true; daCo: boolean; itemId: string; revision: number }) | LoiGio> {
  if (input.loai === "PHYSICAL_GOOD") return themDongHocCuGio(db, input);
  const khoaId = input.khoaId?.trim();
  const studentId = input.studentId?.trim();
  if (!khoaId || !studentId) return loiGio("THIEU_KHOA", "Thiếu khoá học hoặc học viên");
  const maGiamGia = input.maGiamGia?.trim() ? input.maGiamGia.trim() : null;

  // Loại trừ Offline: chỉ tra OnlCourse. Id không phải khoá Online nhưng LÀ khoá Offline thật ⇒ lỗi rõ ràng (không tạo dòng nào).
  const khoa = await db.onlCourse.findFirst({ where: { id: khoaId, deletedAt: null }, select: { id: true } });
  if (!khoa) {
    const off = await db.course.findUnique({ where: { id: khoaId }, select: { id: true } });
    return off ? loiGio("LOAI_SAN_PHAM_CHUA_HO_TRO", "Khoá học trực tiếp (Offline) không bán qua cửa hàng Online.") : loiGio("KHOA_KHONG_TON_TAI", "Khoá học không tồn tại");
  }

  const cart = await layHoacTaoGio(db, input.parentUserId);
  const daCo = await db.cartItem.findFirst({ where: { cartId: cart.id, itemType: "ONLINE_COURSE", onlineCourseId: khoaId, studentId }, select: { id: true } });
  if (!daCo && (await db.cartItem.count({ where: { cartId: cart.id } })) >= TOI_DA_DONG_GIO_LUU) return loiGio("GIO_TOI_DA_DONG", `Giỏ hàng tối đa ${TOI_DA_DONG_GIO_LUU} dòng`);

  // Cùng cổng với tạo đơn: sai con (404), khoá không bán/đã trọn đời/tiên quyết… bị từ chối NGAY lúc thêm. MÃ GIẢM không chặn lúc thêm (mã chỉ được GIỮ dạng chữ; mã sai/hết hạn hiện ở trạng thái dòng khi xem giỏ).
  const gate = await xetMotDong(db, input.parentUserId, { courseId: khoaId, studentId, maGiamGia: null }, input.now);
  if (!gate.ok) return loiGio(gate.ma, gate.thongBao);
  const donGia = gate.dong[0]!.donGia;

  return db.$transaction(async (tx) => {
    const c = await khoaGio(tx, cart.id);
    if (input.revision !== undefined && input.revision !== c.revision) return loiGio("GIO_DA_THAY_DOI", "Giỏ hàng vừa thay đổi ở nơi khác");
    const co = await tx.cartItem.findFirst({ where: { cartId: c.id, itemType: "ONLINE_COURSE", onlineCourseId: khoaId, studentId }, select: { id: true } });
    if (co) return { ok: true as const, daCo: true, itemId: co.id, revision: c.revision };
    if ((await tx.cartItem.count({ where: { cartId: c.id } })) >= TOI_DA_DONG_GIO_LUU) return loiGio("GIO_TOI_DA_DONG", `Giỏ hàng tối đa ${TOI_DA_DONG_GIO_LUU} dòng`);
    const moi = await tx.cartItem.create({ data: { cartId: c.id, itemType: "ONLINE_COURSE", onlineCourseId: khoaId, studentId, quantity: 1, maGiamGia, donGiaLucThem: donGia }, select: { id: true } });
    const sau = await tx.cart.update({ where: { id: c.id }, data: { revision: { increment: 1 } }, select: { revision: true } });
    return { ok: true as const, daCo: false, itemId: moi.id, revision: sau.revision };
  });
}

/** THÊM học cụ. XOR với khoá (người gọi đã kiểm). Trần số lượng của sản phẩm; hết hàng ⇒ 409; số lượng vượt tồn khả dụng ⇒ kẹp (daGiamSoLuong). Thêm lại cùng sản phẩm ⇒ daCo=true, KHÔNG đổi số lượng (đổi bằng PATCH). */
async function themDongHocCuGio(db: PrismaClient, input: ThemDongInput): Promise<({ ok: true; daCo: boolean; itemId: string; revision: number; daGiamSoLuong?: boolean }) | LoiGio> {
  const productId = input.productId?.trim();
  const soLuong = input.soLuong ?? 1;
  if (!productId) return loiGio("THIEU_KHOA", "Thiếu sản phẩm");
  if (!Number.isInteger(soLuong) || soLuong < 1) return loiGio("SO_LUONG_VUOT_TOI_DA", "Số lượng không hợp lệ");
  const p = await db.product.findUnique({ where: { id: productId }, select: { id: true, status: true, sellOnline: true, salePrice: true, stockOnHand: true, onlineMaxQty: true } });
  if (!p) return loiGio("SAN_PHAM_KHONG_TON_TAI", "Sản phẩm không tồn tại");
  if (!p.sellOnline || p.status !== "ACTIVE") return loiGio("KHONG_BAN_ONLINE", "Sản phẩm hiện không bán Online");
  const toiDa = soLuongToiDaCuaSanPham(p.onlineMaxQty);
  if (soLuong > toiDa) return loiGio("SO_LUONG_VUOT_TOI_DA", `Tối đa ${toiDa} sản phẩm cho mỗi dòng`);
  const khaDung = tinhKhaDung(p.stockOnHand, (await tongDangGiu(db, [p.id], input.now)).get(p.id) ?? 0);
  if (khaDung <= 0) return loiGio("HET_HANG", "Sản phẩm đã hết hàng");
  const soLuongLuu = Math.min(soLuong, khaDung);

  const cart = await layHoacTaoGio(db, input.parentUserId);
  return db.$transaction(async (tx) => {
    const c = await khoaGio(tx, cart.id);
    if (input.revision !== undefined && input.revision !== c.revision) return loiGio("GIO_DA_THAY_DOI", "Giỏ hàng vừa thay đổi ở nơi khác");
    const co = await tx.cartItem.findFirst({ where: { cartId: c.id, itemType: "PHYSICAL_GOOD", productId }, select: { id: true } });
    if (co) return { ok: true as const, daCo: true, itemId: co.id, revision: c.revision };
    if ((await tx.cartItem.count({ where: { cartId: c.id } })) >= TOI_DA_DONG_GIO_LUU) return loiGio("GIO_TOI_DA_DONG", `Giỏ hàng tối đa ${TOI_DA_DONG_GIO_LUU} dòng`);
    const moi = await tx.cartItem.create({ data: { cartId: c.id, itemType: "PHYSICAL_GOOD", productId, quantity: soLuongLuu, donGiaLucThem: p.salePrice }, select: { id: true } });
    const sau = await tx.cart.update({ where: { id: c.id }, data: { revision: { increment: 1 } }, select: { revision: true } });
    return { ok: true as const, daCo: false, itemId: moi.id, revision: sau.revision, ...(soLuongLuu < soLuong ? { daGiamSoLuong: true } : {}) };
  });
}

/** PATCH MỘT dòng: `soLuong` (học cụ) · `studentId` (khoá — kiểm lại bằng cổng tạo đơn, không trùng cặp) · `maGiamGia` (khoá). Sai loại ⇒ SAI_LOAI_DONG. */
export async function suaDongGioChung(db: PrismaClient, input: { parentUserId: string; itemId: string; soLuong?: number; studentId?: string; maGiamGia?: string | null; revision?: number; now: Date }): Promise<{ ok: true; revision: number } | LoiGio> {
  const cart = await layHoacTaoGio(db, input.parentUserId);
  const dong = await db.cartItem.findFirst({ where: { id: input.itemId, cartId: cart.id }, select: { id: true, itemType: true, onlineCourseId: true, productId: true, studentId: true } });
  if (!dong) return loiGio("DONG_KHONG_THUOC_GIO", "Không tìm thấy dòng trong giỏ hàng");
  const laKhoa = dong.itemType === "ONLINE_COURSE";
  if (input.soLuong !== undefined) {
    if (laKhoa) return loiGio("SAI_LOAI_DONG", "Khoá học luôn có số lượng 1");
    if (!Number.isInteger(input.soLuong) || input.soLuong < 1) return loiGio("SO_LUONG_VUOT_TOI_DA", "Số lượng không hợp lệ");
    const p = await db.product.findUnique({ where: { id: dong.productId ?? "" }, select: { onlineMaxQty: true } });
    const toiDa = soLuongToiDaCuaSanPham(p?.onlineMaxQty ?? null);
    if (input.soLuong > toiDa) return loiGio("SO_LUONG_VUOT_TOI_DA", `Tối đa ${toiDa} sản phẩm cho mỗi dòng`);
  }
  if ((input.studentId !== undefined || input.maGiamGia !== undefined) && !laKhoa) return loiGio("SAI_LOAI_DONG", "Học cụ không có học viên hay mã khuyến mãi theo dòng");
  if (input.studentId !== undefined && dong.onlineCourseId) {
    if (input.studentId === dong.studentId) return { ok: true, revision: cart.revision };
    const gate = await xetMotDong(db, input.parentUserId, { courseId: dong.onlineCourseId, studentId: input.studentId, maGiamGia: null }, input.now);
    if (!gate.ok) return loiGio(gate.ma, gate.thongBao);
  }
  const ma = input.maGiamGia === undefined ? undefined : input.maGiamGia?.trim() ? input.maGiamGia.trim() : null;
  return suaTrongGio(db, input.parentUserId, input.revision, async (tx, cartId) => {
    if (input.studentId !== undefined && dong.onlineCourseId) {
      const trung = await tx.cartItem.findFirst({ where: { cartId, itemType: "ONLINE_COURSE", onlineCourseId: dong.onlineCourseId, studentId: input.studentId, NOT: { id: dong.id } }, select: { id: true } });
      if (trung) return loiGio("DONG_DA_CO_TRONG_GIO", "Giỏ đã có khoá này cho học viên đó");
    }
    await tx.cartItem.updateMany({ where: { id: dong.id, cartId }, data: { ...(input.soLuong !== undefined ? { quantity: input.soLuong } : {}), ...(input.studentId !== undefined ? { studentId: input.studentId } : {}), ...(ma !== undefined ? { maGiamGia: ma } : {}) } });
    return null;
  });
}

/** Phụ huynh đã XEM các dòng bị gỡ: đánh dấu đã xác nhận (idempotent; `ids` trống = tất cả). KHÔNG đổi revision (không đổi dòng nào). */
export async function xacNhanDongBiGo(db: PrismaClient, input: { parentUserId: string; ids?: string[]; now: Date }): Promise<{ ok: true; soDaXacNhan: number }> {
  const cart = await layHoacTaoGio(db, input.parentUserId);
  const r = await db.cartRemovedNotice.updateMany({ where: { cartId: cart.id, ackedAt: null, ...(input.ids?.length ? { id: { in: input.ids } } : {}) }, data: { ackedAt: input.now } });
  return { ok: true, soDaXacNhan: r.count };
}

/** Sửa/xoá dòng: giỏ khác ⇒ DONG_KHONG_THUOC_GIO; dòng đã biến mất (xoá lặp) ⇒ ok, không đổi gì. */
async function suaTrongGio(db: PrismaClient, parentUserId: string, revision: number | undefined, viec: (tx: Prisma.TransactionClient, cartId: string) => Promise<LoiGio | null>): Promise<{ ok: true; revision: number } | LoiGio> {
  const cart = await layHoacTaoGio(db, parentUserId);
  return db.$transaction(async (tx) => {
    const c = await khoaGio(tx, cart.id);
    if (revision !== undefined && revision !== c.revision) return loiGio("GIO_DA_THAY_DOI", "Giỏ hàng vừa thay đổi ở nơi khác");
    const loi = await viec(tx, c.id);
    if (loi) return loi;
    const sau = await tx.cart.update({ where: { id: c.id }, data: { revision: { increment: 1 } }, select: { revision: true } });
    return { ok: true as const, revision: sau.revision };
  });
}

export async function xoaDongGio(db: PrismaClient, input: { parentUserId: string; itemId: string; revision?: number }) {
  const cart = await layHoacTaoGio(db, input.parentUserId);
  const dong = await db.cartItem.findUnique({ where: { id: input.itemId }, select: { cartId: true } });
  if (dong && dong.cartId !== cart.id) return loiGio("DONG_KHONG_THUOC_GIO", "Không tìm thấy dòng trong giỏ hàng");
  if (!dong) return { ok: true as const, revision: cart.revision }; // xoá lặp: đã không còn
  return suaTrongGio(db, input.parentUserId, input.revision, async (tx, cartId) => {
    await tx.cartItem.deleteMany({ where: { id: input.itemId, cartId } });
    return null;
  });
}

export async function suaMaDongGio(db: PrismaClient, input: { parentUserId: string; itemId: string; maGiamGia: string | null; revision?: number }) {
  const cart = await layHoacTaoGio(db, input.parentUserId);
  const dong = await db.cartItem.findFirst({ where: { id: input.itemId, cartId: cart.id }, select: { id: true } });
  if (!dong) return loiGio("DONG_KHONG_THUOC_GIO", "Không tìm thấy dòng trong giỏ hàng");
  const ma = input.maGiamGia?.trim() ? input.maGiamGia.trim() : null;
  return suaTrongGio(db, input.parentUserId, input.revision, async (tx, cartId) => {
    await tx.cartItem.updateMany({ where: { id: input.itemId, cartId }, data: { maGiamGia: ma } });
    return null;
  });
}

/**
 * PATCH giỏ: «áp mã cho tất cả» (mọi dòng KHOÁ cùng mã; null = gỡ; mã chỉ được GIỮ dạng chữ — không tiêu lượt) và/hoặc CHỌN PHƯƠNG THỨC GIAO (`phuongThucGiao`; null = bỏ chọn).
 * Phương thức phải TỒN TẠI và đang bật (khả dụng theo địa chỉ được xét lúc xem giỏ/đặt hàng, không ở đây — địa chỉ có thể đổi sau). Cả hai trong một giao dịch, một lần tăng revision.
 */
export async function apMaTatCaGio(db: PrismaClient, input: { parentUserId: string; maGiamGia?: string | null; phuongThucGiao?: string | null; revision?: number }) {
  const ma = input.maGiamGia === undefined ? undefined : input.maGiamGia?.trim() ? input.maGiamGia.trim() : null;
  if (input.phuongThucGiao) {
    const co = await db.shippingMethod.findFirst({ where: { code: input.phuongThucGiao, isActive: true }, select: { id: true } });
    if (!co) return loiGio("PHUONG_THUC_GIAO_KHONG_HOP_LE", "Phương thức giao hàng không tồn tại hoặc đang tắt");
  }
  return suaTrongGio(db, input.parentUserId, input.revision, async (tx, cartId) => {
    if (ma !== undefined) await tx.cartItem.updateMany({ where: { cartId, itemType: "ONLINE_COURSE" }, data: { maGiamGia: ma } }); // mã chỉ áp cho khoá Online
    if (input.phuongThucGiao !== undefined) await tx.cart.update({ where: { id: cartId }, data: { shippingMethodCode: input.phuongThucGiao } });
    return null;
  });
}

export async function xoaGio(db: PrismaClient, input: { parentUserId: string; revision?: number }) {
  return suaTrongGio(db, input.parentUserId, input.revision, async (tx, cartId) => {
    await tx.cartItem.deleteMany({ where: { cartId } });
    return null;
  });
}

export type KetQuaDatHang =
  | { ok: true; daCo: boolean; orderId: string; /** true = đơn cũ trả lại (bấm đúp) mà KHÔNG chạy lại tạo đơn — route dựng phản hồi từ đơn */ phat: boolean; tao: Extract<KetQuaTaoDon, { ok: true }> | null }
  | LoiGio;

/**
 * ĐẶT HÀNG TỪ GIỎ. `revision` BẮT BUỘC (đúng bản giỏ người dùng đã thấy). `itemIds` tuỳ chọn: bỏ trống = MỌI dòng trong giỏ; có = đúng các dòng đó. V8.44 (Owner): ALL-OR-NOTHING THEO SNAPSHOT NGƯỜI MUA — mọi dòng được chọn phải
 * SAN_SANG, nếu có dòng không đặt được (hết hàng, khoá đóng…) thì 409 `KHONG_CO_DONG_DE_DAT` kèm `cartItemIds` và KHÔNG tạo đơn; KHÔNG BAO GIỜ âm thầm bỏ dòng rồi tạo đơn khác tổng đã xác nhận. Mọi lỗi ⇒ KHÔNG xoá dòng, KHÔNG đổi revision. Bấm đúp cùng revision ⇒ trả đơn vừa tạo (`phat:true`).
 */
export async function datHangTuGio(db: PrismaClient, input: { parentUserId: string; revision: number; itemIds?: string[]; /** khách ĐÃ xác nhận giá mới (giá TĂNG so với lúc thêm vào giỏ) */ xacNhanGiaMoi?: boolean; now: Date }): Promise<KetQuaDatHang> {
  const cart = await layHoacTaoGio(db, input.parentUserId);
  if (cart.revision !== input.revision) {
    if (cart.lastCheckoutRevision === input.revision && cart.lastCheckoutOrderId) return { ok: true, daCo: true, orderId: cart.lastCheckoutOrderId, phat: true, tao: null };
    return loiGio("GIO_DA_THAY_DOI", "Giỏ hàng vừa thay đổi ở nơi khác");
  }
  const tatCa = await db.cartItem.findMany({ where: { cartId: cart.id }, orderBy: { createdAt: "asc" }, select: CHON_DONG });
  let chon = tatCa;
  if (input.itemIds) {
    const ids = [...new Set(input.itemIds)];
    chon = ids.map((id) => tatCa.find((d) => d.id === id)).filter((d): d is DongDb => !!d);
    if (chon.length !== ids.length) return loiGio("DONG_KHONG_THUOC_GIO", "Có dòng không thuộc giỏ hàng này");
  }
  if (chon.length === 0) return loiGio("KHONG_CO_DONG_DE_DAT", "Giỏ hàng không có dòng nào để đặt");
  // Phân loại dòng: khoá / học cụ. Học cụ xét bằng TRẠNG THÁI SỐNG của kho (cùng hàm với xem giỏ); số lượng đặt = số lượng HIỆU LỰC (đã kẹp theo kho) — đúng thứ ba mẹ đã thấy.
  const hangRows = chon.filter((d) => d.itemType === "PHYSICAL_GOOD");
  const khoaRows = chon.filter((d) => d.itemType !== "PHYSICAL_GOOD");
  const xetHC = hangRows.length ? await xetDongHocCu(db, { rows: hangRows.map((d) => ({ id: d.id, productId: d.productId, quantity: d.quantity, donGiaLucThem: d.donGiaLucThem })), parentUserId: input.parentUserId, now: input.now }) : { dong: [] as DongHocCuDto[], canGo: [] };
  const hocCuHopLe: Array<{ row: DongDb; x: DongHocCuDto }> = [];
  const giaTang: string[] = [];
  const khongDat: string[] = []; // MỌI dòng không đặt được (báo một lượt để người mua thấy hết, không phải thử từng dòng)
  for (const row of hangRows) {
    const x = xetHC.dong.find((k) => k.itemId === row.id);
    if (x && laDongHopLe(x.trangThai)) {
      hocCuHopLe.push({ row, x });
      if (x.donGiaLucThem !== null && x.donGia > x.donGiaLucThem) giaTang.push(row.id);
    } else khongDat.push(row.id);
  }

  // Xét từng dòng khoá bằng cổng tạo đơn; dòng nào hỏng ⇒ từ chối CẢ lượt (all-or-nothing), không bỏ qua im lặng.
  const dangDat: DongDb[] = [];
  for (const d of khoaRows) {
    if (d.itemType !== "ONLINE_COURSE" || !d.onlineCourseId || !d.studentId) {
      khongDat.push(d.id);
      continue;
    }
    const r = await xetMotDong(db, input.parentUserId, { courseId: d.onlineCourseId, studentId: d.studentId, maGiamGia: d.maGiamGia }, input.now);
    if (r.ok) {
      dangDat.push(d);
      if (d.donGiaLucThem !== null && r.dong[0]!.donGia > d.donGiaLucThem) giaTang.push(d.id);
    } else if (r.ma === "THIEU_HO_SO_PHU_HUYNH" || r.ma === "THIEU_HO_SO_HOC_VIEN") return loiGio(r.ma, r.thongBao); // lỗi hồ sơ: người dùng sửa được — báo đúng mã, không gói thành «không có dòng để đặt»
    else khongDat.push(d.id);
  }
  if (khongDat.length > 0) return { ...loiGio("KHONG_CO_DONG_DE_DAT", "Có dòng chưa thể đặt hàng — xem lại giỏ"), cartItemIds: khongDat };
  if (dangDat.length === 0 && hocCuHopLe.length === 0) return loiGio("KHONG_CO_DONG_DE_DAT", "Không có dòng nào đủ điều kiện đặt hàng");
  // GIÁ TĂNG so với lúc thêm vào giỏ ⇒ phải được khách xác nhận (giá GIẢM thì không cần). Đơn chưa tạo.
  if (giaTang.length > 0 && !input.xacNhanGiaMoi) return { ...loiGio("GIA_DA_TANG", "Giá của một số sản phẩm đã tăng — vui lòng xem lại và xác nhận"), cartItemIds: giaTang };
  const gioHang = dangDat.map((d) => ({ courseId: d.onlineCourseId!, studentId: d.studentId!, voucherId: null, maGiamGia: d.maGiamGia }));
  if (gioHang.length > 0) {
    const kiem = kiemGioHang(gioHang);
    if (!kiem.ok) return loiGio(kiem.ma, kiem.thongBao, kiem.viTri);
  }

  const idDat = [...dangDat.map((d) => d.id), ...hocCuHopLe.map((h) => h.row.id)];
  let r: KetQuaTaoDon;
  try {
    r = await taoDonOnline(db, {
      parentUserId: input.parentUserId,
      gioHang,
      now: input.now,
      ...(hocCuHopLe.length > 0 ? { hocCu: { dong: hocCuHopLe.map((h) => ({ cartItemId: h.row.id, productId: h.x.productId, soLuong: h.x.soLuong })), phuongThuc: cart.shippingMethodCode } } : {}),
      // TRONG CÙNG giao dịch tạo đơn: xoá dòng đã đặt + tăng revision + ghi «checkout cuối». Lệch revision (đua) ⇒ ném ⇒ cả đơn rollback.
      sauKhiTao: async (tx, orderId) => {
        const c = await khoaGio(tx, cart.id);
        if (c.revision !== input.revision) throw new LoiGioDaDoi();
        await tx.cartItem.deleteMany({ where: { id: { in: idDat }, cartId: cart.id } });
        await tx.cart.update({ where: { id: cart.id }, data: { revision: { increment: 1 }, lastCheckoutRevision: input.revision, lastCheckoutOrderId: orderId } });
      },
    });
  } catch (e) {
    if (e instanceof LoiGioDaDoi) return loiGio("GIO_DA_THAY_DOI", "Giỏ hàng vừa thay đổi ở nơi khác");
    throw e;
  }
  if (!r.ok) {
    const idTheoSp = new Map(hocCuHopLe.map((h) => [h.x.productId, h.row.id]));
    return { ...loiGio(r.ma, r.thongBao, r.viTri), ...(r.cartItemIds ? { cartItemIds: r.cartItemIds } : {}), ...(r.thieu ? { thieu: r.thieu.map((t) => ({ itemId: idTheoSp.get(t.productId) ?? null, productId: t.productId, yeuCau: t.yeuCau, conLai: t.conLai })) } : {}) };
  }
  if (r.daCo) {
    // Đơn cũ cho đúng các cặp này đang chờ (bấm đúp/đua/đặt ở máy khác): dòng trong giỏ coi như ĐÃ đặt — dọn, nhưng lệch revision thì bỏ qua (không phá giỏ người khác).
    await db
      .$transaction(async (tx) => {
        const c = await khoaGio(tx, cart.id);
        if (c.revision !== input.revision) return;
        await tx.cartItem.deleteMany({ where: { id: { in: idDat }, cartId: cart.id } });
        await tx.cart.update({ where: { id: cart.id }, data: { revision: { increment: 1 }, lastCheckoutRevision: input.revision, lastCheckoutOrderId: r.orderId } });
      })
      .catch(() => undefined);
  }
  return { ok: true, daCo: r.daCo, orderId: r.orderId, phat: false, tao: r };
}

export type KetQuaHuyKhoiPhuc = { ok: true; daHuyTruocDo: boolean; soDongKhoiPhuc: number } | { ok: false; ma: "KHONG_TIM_THAY" | "DA_CO_TIEN" | "DA_CAP_QUYEN" | "SAI_TRANG_THAI"; thongBao: string };

/**
 * HUỶ ĐƠN CHƯA THANH TOÁN + TRẢ CÁC DÒNG VỀ GIỎ (Owner: «không xoá giỏ»). Cùng cổng huỷ của `huyDonOnlineChuaThanhToan` (có tiền/đã cấp quyền ⇒ từ chối, không khôi phục).
 * Khôi phục = các dòng (khoá × con) của đơn quay lại giỏ với MÃ GIẢM GIÁ đã dùng (chữ) — giá/hạn tính lại khi xem giỏ; dòng đã có trong giỏ thì bỏ qua; vượt trần giỏ thì dừng.
 * Idempotent: lần đầu huỷ ⇒ khôi phục; huỷ lại (mạng rớt) ⇒ chỉ khôi phục nếu đơn này VẪN là «checkout cuối» của giỏ (dấu bị xoá sau khi khôi phục) ⇒ không bao giờ nhân đôi dòng người dùng đã bỏ.
 */
export async function huyDonKhoiPhucGio(db: PrismaClient, input: { parentUserId: string; orderId: string; now: Date }): Promise<KetQuaHuyKhoiPhuc> {
  const r = await huyDonOnlineChuaThanhToan(db, { parentUserId: input.parentUserId, orderId: input.orderId, now: input.now });
  if (!r.ok) return r;
  const cart = await layHoacTaoGio(db, input.parentUserId);
  const soDongKhoiPhuc = await db.$transaction(async (tx) => {
    const c = await tx.cart.findUniqueOrThrow({ where: { id: cart.id }, select: { id: true, lastCheckoutOrderId: true } });
    await khoaGio(tx, c.id);
    if (r.daHuyTruocDo && c.lastCheckoutOrderId !== input.orderId) return 0; // huỷ lặp mà dấu đã xoá ⇒ đã khôi phục (hoặc người dùng đã tự quyết) — không khôi phục lại
    const items = await tx.orderItem.findMany({
      where: { orderId: input.orderId, type: "ONLINE_COURSE", onlineCourseId: { not: null }, studentId: { not: null }, order: { createdById: input.parentUserId } },
      orderBy: { createdAt: "asc" },
      select: { onlineCourseId: true, studentId: true, unitPrice: true, metadata: true },
    });
    let them = 0;
    let dem = await tx.cartItem.count({ where: { cartId: c.id } });
    for (const it of items) {
      if (dem >= TOI_DA_DONG_GIO_LUU) break;
      const co = await tx.cartItem.findFirst({ where: { cartId: c.id, itemType: "ONLINE_COURSE", onlineCourseId: it.onlineCourseId!, studentId: it.studentId! }, select: { id: true } });
      if (co) continue;
      const ma = (it.metadata as { khuyenMai?: { ma?: unknown } } | null)?.khuyenMai?.ma;
      await tx.cartItem.create({ data: { cartId: c.id, itemType: "ONLINE_COURSE", onlineCourseId: it.onlineCourseId!, studentId: it.studentId!, quantity: 1, maGiamGia: typeof ma === "string" && ma.trim() ? ma.trim() : null, donGiaLucThem: it.unitPrice } });
      them++;
      dem++;
    }
    // V8.43 — dòng HỌC CỤ của đơn cũng quay lại giỏ (số lượng đã đặt; dòng sản phẩm đã có trong giỏ thì bỏ qua)
    const hang = await tx.orderItem.findMany({ where: { orderId: input.orderId, type: "PRODUCT", productId: { not: null }, order: { createdById: input.parentUserId } }, orderBy: { createdAt: "asc" }, select: { productId: true, quantity: true, unitPrice: true } });
    for (const it of hang) {
      if (dem >= TOI_DA_DONG_GIO_LUU) break;
      const co = await tx.cartItem.findFirst({ where: { cartId: c.id, itemType: "PHYSICAL_GOOD", productId: it.productId! }, select: { id: true } });
      if (co) continue;
      await tx.cartItem.create({ data: { cartId: c.id, itemType: "PHYSICAL_GOOD", productId: it.productId!, quantity: it.quantity, donGiaLucThem: it.unitPrice } });
      them++;
      dem++;
    }
    await tx.cart.update({
      where: { id: c.id },
      data: { ...(them > 0 ? { revision: { increment: 1 } } : {}), ...(c.lastCheckoutOrderId === input.orderId ? { lastCheckoutOrderId: null, lastCheckoutRevision: null } : {}) },
    });
    return them;
  });
  return { ok: true, daHuyTruocDo: r.daHuyTruocDo, soDongKhoiPhuc };
}
