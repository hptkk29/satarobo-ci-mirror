import type { PrismaClient } from "@prisma/client";

/**
 * V8.43 — GIAO HÀNG cho đơn có học cụ (Commerce v2 · P0). TẤT CẢ mức phí/khu vực/phương thức là DỮ LIỆU CẤU HÌNH (`ShippingZone/Method/Rate`, Admin quản trị) —
 * KHÔNG có số tiền nào được viết trong mã. Giỏ chỉ khoá Online KHÔNG đòi địa chỉ/phương thức giao (phí 0).
 *   · khu vực = danh sách tỉnh/thành so khớp sau chuẩn hoá (bỏ dấu, bỏ «Tỉnh/Thành phố/TP», bỏ khoảng trắng thừa);
 *   · một phương thức CHỈ khả dụng ở khu vực có `ShippingRate` hoạt động ⇒ «giao nhanh chỉ vài khu vực» = chỉ tạo rate ở các khu vực đó;
 *   · phí miễn khi tạm tính hàng ≥ `freeAboveAmount` (nếu cấu hình);
 *   · địa chỉ bắt buộc đủ 5 trường, SĐT Việt Nam hợp lệ; client KHÔNG gửi phí — máy chủ tính từ cấu hình lúc xem giỏ và lúc đặt hàng.
 * Thuần: `chuanHoaTinh`, `kiemDiaChi`, `tinhPhiTheoRate`. Đọc/ghi DB: các hàm còn lại. `now` không cần (không có hạn).
 */
type Db = PrismaClient;

export type DiaChiGiaoHang = { hoTen: string; soDienThoai: string; tinhThanh: string; phuongXa: string; soNhaDuong: string };

/** THUẦN. Chuẩn hoá tên tỉnh/thành để so khớp khu vực. */
export function chuanHoaTinh(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\b(thanh pho|tinh|tp\.?|t\.p\.?)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const SDT_VN = /^(?:0|\+?84)(?:3|5|7|8|9)\d{8}$/;
const TRUONG: Array<[keyof DiaChiGiaoHang, string, number]> = [["hoTen", "Họ tên người nhận", 80], ["soDienThoai", "Số điện thoại", 20], ["tinhThanh", "Tỉnh/thành phố", 60], ["phuongXa", "Phường/xã", 80], ["soNhaDuong", "Số nhà, đường", 160]];

/** THUẦN. Địa chỉ phải đủ 5 trường (sau khi cắt khoảng trắng), độ dài hợp lý, SĐT Việt Nam hợp lệ. */
export function kiemDiaChi(raw: Partial<Record<keyof DiaChiGiaoHang, unknown>>): { ok: true; data: DiaChiGiaoHang } | { ok: false; truong: keyof DiaChiGiaoHang; thongBao: string } {
  const out = {} as DiaChiGiaoHang;
  for (const [k, nhan, max] of TRUONG) {
    const v = typeof raw[k] === "string" ? (raw[k] as string).replace(/\s+/g, " ").trim() : "";
    if (!v) return { ok: false, truong: k, thongBao: `Thiếu ${nhan.toLowerCase()}` };
    if (v.length > max) return { ok: false, truong: k, thongBao: `${nhan} tối đa ${max} ký tự` };
    out[k] = v;
  }
  const sdt = out.soDienThoai.replace(/[\s.\-()]/g, "");
  if (!SDT_VN.test(sdt)) return { ok: false, truong: "soDienThoai", thongBao: "Số điện thoại không hợp lệ" };
  out.soDienThoai = sdt;
  return { ok: true, data: out };
}

/** THUẦN. Phí của một rate với tạm tính hàng (miễn khi đạt ngưỡng). Không bao giờ âm. */
export function tinhPhiTheoRate(rate: { fee: number; freeAboveAmount: number | null }, tamTinhHang: number): number {
  if (rate.freeAboveAmount !== null && tamTinhHang >= rate.freeAboveAmount) return 0;
  return Math.max(0, rate.fee);
}

export type DiaChiDto = { daCo: true; hoTen: string; soDienThoai: string; tinhThanh: string; phuongXa: string; soNhaDuong: string; diaChiMotDong: string } | { daCo: false; goiY: { hoTen: string | null; soDienThoai: string | null; diaChi: string | null } };
export const diaChiMotDong = (d: Pick<DiaChiGiaoHang, "soNhaDuong" | "phuongXa" | "tinhThanh">) => `${d.soNhaDuong}, ${d.phuongXa}, ${d.tinhThanh}`;

/** Luôn trả (không lỗi) — chưa có thì kèm `goiY` lấy từ hồ sơ phụ huynh (CHỈ gợi ý, không tự lưu). */
export async function docDiaChiGiaoHang(db: Db, parentUserId: string): Promise<DiaChiDto> {
  const a = await db.parentShippingAddress.findUnique({ where: { parentUserId } });
  if (a) return { daCo: true, hoTen: a.hoTen, soDienThoai: a.soDienThoai, tinhThanh: a.tinhThanh, phuongXa: a.phuongXa, soNhaDuong: a.soNhaDuong, diaChiMotDong: diaChiMotDong(a) };
  const u = await db.user.findUnique({ where: { id: parentUserId }, select: { name: true, phone: true, address: true } });
  return { daCo: false, goiY: { hoTen: u?.name ?? null, soDienThoai: u?.phone ?? null, diaChi: u?.address ?? null } };
}

export async function ghiDiaChiGiaoHang(db: Db, input: { parentUserId: string; diaChi: Partial<Record<keyof DiaChiGiaoHang, unknown>> }): Promise<{ ok: true; diaChi: DiaChiDto } | { ok: false; ma: "DIA_CHI_KHONG_HOP_LE"; truong: keyof DiaChiGiaoHang; thongBao: string }> {
  const k = kiemDiaChi(input.diaChi);
  if (!k.ok) return { ok: false, ma: "DIA_CHI_KHONG_HOP_LE", truong: k.truong, thongBao: k.thongBao };
  await db.parentShippingAddress.upsert({ where: { parentUserId: input.parentUserId }, create: { parentUserId: input.parentUserId, ...k.data }, update: { ...k.data } });
  return { ok: true, diaChi: await docDiaChiGiaoHang(db, input.parentUserId) };
}

export type PhuongThucGiaoDto = { ma: string; ten: string; moTa: string | null; phi: number; khaDung: boolean; lyDo: "CHUA_CO_DIA_CHI" | "NGOAI_VUNG" | null };

/** Khu vực ĐANG HOẠT ĐỘNG chứa tỉnh/thành đó. Trùng nhiều khu vực (cấu hình sai) ⇒ chọn theo `code` tăng dần — xác định, không ngẫu nhiên. */
export async function khuVucCuaTinh(db: Db, tinhThanh: string): Promise<{ id: string; code: string } | null> {
  const can = chuanHoaTinh(tinhThanh);
  if (!can) return null;
  const zs = await db.shippingZone.findMany({ where: { isActive: true }, orderBy: { code: "asc" }, select: { id: true, code: true, provinces: true } });
  return zs.find((z) => z.provinces.some((p) => chuanHoaTinh(p) === can)) ?? null;
}

/** Các phương thức giao cho địa chỉ hiện có của phụ huynh. Chưa có địa chỉ ⇒ mọi phương thức khaDung:false lý do CHUA_CO_DIA_CHI (không đoán vùng). */
export async function layPhuongThucGiao(db: Db, input: { parentUserId: string; tamTinhHang: number }): Promise<PhuongThucGiaoDto[]> {
  const [ms, a] = await Promise.all([
    db.shippingMethod.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }], select: { id: true, code: true, name: true, etaText: true, description: true } }),
    db.parentShippingAddress.findUnique({ where: { parentUserId: input.parentUserId }, select: { tinhThanh: true } }),
  ]);
  const zone = a ? await khuVucCuaTinh(db, a.tinhThanh) : null;
  const rates = zone ? await db.shippingRate.findMany({ where: { zoneId: zone.id, isActive: true, methodId: { in: ms.map((m) => m.id) } }, select: { methodId: true, fee: true, freeAboveAmount: true } }) : [];
  const theoMethod = new Map(rates.map((r) => [r.methodId, r]));
  return ms.map((m) => {
    const r = theoMethod.get(m.id);
    const moTa = [m.etaText, m.description].filter(Boolean).join(" · ") || null;
    if (!a) return { ma: m.code, ten: m.name, moTa, phi: 0, khaDung: false, lyDo: "CHUA_CO_DIA_CHI" as const };
    if (!r) return { ma: m.code, ten: m.name, moTa, phi: 0, khaDung: false, lyDo: "NGOAI_VUNG" as const };
    return { ma: m.code, ten: m.name, moTa, phi: tinhPhiTheoRate(r, input.tamTinhHang), khaDung: true, lyDo: null };
  });
}

export type KetQuaPhiGiao = { ok: true; phi: number; phuongThuc: string; tinhThanh: string } | { ok: false; ma: "THIEU_DIA_CHI" | "CHUA_CHON_PHUONG_THUC_GIAO" | "PHUONG_THUC_GIAO_KHONG_HOP_LE"; thongBao: string };

/** PHÍ GIAO do máy chủ tính từ cấu hình + địa chỉ + phương thức đã chọn. Mọi thiếu sót ⇒ lỗi có mã (dùng ở cả xem giỏ và đặt hàng — cùng một hàm). */
export async function tinhPhiGiao(db: Db, input: { parentUserId: string; phuongThuc: string | null; tamTinhHang: number }): Promise<KetQuaPhiGiao> {
  const a = await db.parentShippingAddress.findUnique({ where: { parentUserId: input.parentUserId }, select: { tinhThanh: true } });
  if (!a) return { ok: false, ma: "THIEU_DIA_CHI", thongBao: "Chưa có địa chỉ nhận hàng" };
  if (!input.phuongThuc) return { ok: false, ma: "CHUA_CHON_PHUONG_THUC_GIAO", thongBao: "Chưa chọn phương thức giao hàng" };
  const zone = await khuVucCuaTinh(db, a.tinhThanh);
  const m = zone ? await db.shippingMethod.findFirst({ where: { code: input.phuongThuc, isActive: true }, select: { id: true } }) : null;
  const r = zone && m ? await db.shippingRate.findFirst({ where: { zoneId: zone.id, methodId: m.id, isActive: true }, select: { fee: true, freeAboveAmount: true } }) : null;
  if (!r) return { ok: false, ma: "PHUONG_THUC_GIAO_KHONG_HOP_LE", thongBao: "Phương thức giao hàng không áp dụng cho địa chỉ này" };
  return { ok: true, phi: tinhPhiTheoRate(r, input.tamTinhHang), phuongThuc: input.phuongThuc, tinhThanh: a.tinhThanh };
}
