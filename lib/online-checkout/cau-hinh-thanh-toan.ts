import type { Prisma, PrismaClient } from "@prisma/client";

import { writeAudit } from "@/lib/audit/audit-log";
import { VIETQR_ADDINFO_MAX } from "@/lib/payments/vietqr";

/**
 * V8.18 — CẤU HÌNH THU TIỀN ONLINE (Owner chốt): SataRobo bán · nhận tiền · xuất hoá đơn; KHÔNG theo cơ sở Offline.
 *
 *  • Nguồn DUY NHẤT: bảng `OnlinePaymentConfig` (một dòng bật). CHỈ Quản trị tối cao ghi (kèm lý do + audit). Không hardcode, không env chứa số tài khoản.
 *  • Tái sử dụng bản ghi sẵn có: `paymentMethodId` là một `PaymentMethod` chuyển khoản DÙNG CHUNG (centerId trống — KHÔNG phải tài khoản CS1/CS2) đã có đủ ngân hàng/STK/chủ TK;
 *    `legalEntityId` là pháp nhân GỐC SataRobo (`LegalEntity.isPrimary`, đang hoạt động, chưa xoá). Không có ⇒ BLOCKED_CONFIG + danh sách trường thiếu; KHÔNG tự chọn/tạo.
 *  • Mỗi đơn Online CHỤP cấu hình lúc tạo đơn (`Order.onlinePaymentSnapshot` + `Order.legalEntityId`): đổi cấu hình sau đó chỉ áp cho đơn MỚI.
 *  • Nội dung chuyển khoản = `SR` + mã tham chiếu duy nhất của đơn (mã phiếu thu), không dấu, ≤ ${VIETQR_ADDINFO_MAX} ký tự.
 *  • PROD chưa bật: lưu/đọc cấu hình mode PROD đều đòi khoá `ONLINE_PAYMENT_PROD_UNLOCK=OWNER_VERIFIED` (Owner đặt SAU khi xác minh tài khoản chính thức). TEST không bao giờ dựng QR chuyển tiền thật.
 */

type Db = PrismaClient;
type Cli = Db | Prisma.TransactionClient;

export type ModeThuTien = "TEST" | "PROD";
export const MA_MAC_DINH_TIEN_TO = "SR";
export const KHOA_MO_PROD = "OWNER_VERIFIED";

export type CauHinhThuTien = {
  configId: string;
  mode: ModeThuTien;
  memoPrefix: string;
  nganHang: { ma: string; ten: string | null };
  soTaiKhoan: string;
  tenTaiKhoan: string;
  phuongThucId: string;
  phapNhan: { id: string; maSoThue: string; tenPhapLy: string };
};

export type KetQuaCauHinh = { trangThai: "SAN_SANG"; cauHinh: CauHinhThuTien } | { trangThai: "BLOCKED_CONFIG"; lyDo: string; truongThieu: string[] };

export const TRUONG_CAN_QUAN_TRI_TOI_CAO = [
  "Cấu hình thu tiền Online (Quản trị tối cao): chọn phương thức chuyển khoản DÙNG CHUNG của SataRobo (không phải tài khoản CS1/CS2) đã có đủ mã ngân hàng, số tài khoản, tên chủ tài khoản",
  "Pháp nhân gốc SataRobo (`isPrimary`, đang hoạt động) làm đơn vị bán + xuất hoá đơn",
  "Chế độ TEST hoặc PROD (PROD chỉ bật khi Owner đặt khoá mở sau khi xác minh tài khoản chính thức)",
] as const;

const KHONG_DAU = /[̀-ͯ]/g;
/** Chuỗi chỉ gồm A–Z0–9 (không dấu) — mọi nội dung chuyển khoản đều đi qua đây. */
export function chuanHoaMemo(s: string): string {
  return s.normalize("NFD").replace(KHONG_DAU, "").replace(/đ/g, "d").replace(/Đ/g, "D").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** `SR{ma}` — ≤ 25 ký tự; vượt ⇒ null (không cắt ngầm: cắt làm mất mã đối khớp). */
export function noiDungChuyenKhoan(tienTo: string, maThamChieu: string): string | null {
  const s = chuanHoaMemo(tienTo) + chuanHoaMemo(maThamChieu);
  return s.length > 0 && s.length <= VIETQR_ADDINFO_MAX && chuanHoaMemo(maThamChieu).length > 0 ? s : null;
}

export const laQuanTriToiCao = (actor: { role?: string | null; roles?: readonly string[] | null }) => actor.role === "SUPER_ADMIN" || (actor.roles ?? []).includes("SUPER_ADMIN");
export const khoaProdDaMo = () => (process.env.ONLINE_PAYMENT_PROD_UNLOCK ?? "").trim() === KHOA_MO_PROD;

type Dong = Prisma.OnlinePaymentConfigGetPayload<{ include: { paymentMethod: true; legalEntity: true } }>;

/** Kiểm MỘT dòng cấu hình có DÙNG ĐƯỢC không (đọc live khi tạo đơn mới). Trả danh sách trường thiếu/sai. */
function kiemDong(d: Dong): string[] {
  const thieu: string[] = [];
  const pm = d.paymentMethod;
  if (pm.type !== "BANK_TRANSFER" || !pm.isActive) thieu.push("phương thức thanh toán phải là chuyển khoản và đang bật");
  if (pm.centerId !== null) thieu.push("phương thức thanh toán là tài khoản CỦA MỘT CƠ SỞ — Online chỉ dùng tài khoản chính thức dùng chung của SataRobo (centerId trống)");
  if (!pm.bankBin) thieu.push("thiếu mã ngân hàng (bankBin)");
  if (!pm.bankAccountNumber) thieu.push("thiếu số tài khoản");
  if (!pm.bankAccountName) thieu.push("thiếu tên chủ tài khoản");
  const le = d.legalEntity;
  if (!le.isPrimary || !le.isActive || le.deletedAt !== null) thieu.push("pháp nhân phải là pháp nhân GỐC SataRobo, đang hoạt động, chưa xoá");
  if (d.mode === "PROD" && !khoaProdDaMo()) thieu.push("chế độ PROD chưa được mở (chờ Owner xác minh tài khoản ngân hàng chính thức)");
  return thieu;
}

export async function docCauHinhDangBat(db: Cli): Promise<KetQuaCauHinh> {
  const d = await db.onlinePaymentConfig.findFirst({ where: { isActive: true }, include: { paymentMethod: true, legalEntity: true } });
  if (!d) return { trangThai: "BLOCKED_CONFIG", lyDo: "Chưa có cấu hình thu tiền Online do Quản trị tối cao thiết lập.", truongThieu: [...TRUONG_CAN_QUAN_TRI_TOI_CAO] };
  const thieu = kiemDong(d);
  if (thieu.length > 0) return { trangThai: "BLOCKED_CONFIG", lyDo: "Cấu hình thu tiền Online chưa hợp lệ.", truongThieu: thieu };
  const pm = d.paymentMethod;
  return {
    trangThai: "SAN_SANG",
    cauHinh: {
      configId: d.id,
      mode: d.mode as ModeThuTien,
      memoPrefix: d.memoPrefix,
      nganHang: { ma: pm.bankBin!, ten: pm.bankName },
      soTaiKhoan: pm.bankAccountNumber!,
      tenTaiKhoan: pm.bankAccountName!,
      phuongThucId: pm.id,
      phapNhan: { id: d.legalEntity.id, maSoThue: d.legalEntity.taxCode, tenPhapLy: d.legalEntity.legalName },
    },
  };
}

/** Bản CHỤP ghi vào đơn lúc tạo đơn (JSON thuần, đọc lại bằng `docSnapshot`). */
export type SnapshotThuTien = CauHinhThuTien & { phienBan: 1; chupLuc: string };
export const chupChoDon = (c: CauHinhThuTien, now: Date): SnapshotThuTien => ({ ...c, phienBan: 1, chupLuc: now.toISOString() });

export function docSnapshot(raw: unknown): SnapshotThuTien | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<SnapshotThuTien>;
  if (s.phienBan !== 1 || !s.configId || !s.soTaiKhoan || !s.tenTaiKhoan || !s.nganHang?.ma || !s.phapNhan?.id || !s.memoPrefix || (s.mode !== "TEST" && s.mode !== "PROD")) return null;
  return s as SnapshotThuTien;
}

// ───────────────────────── QUẢN TRỊ (chỉ Quản trị tối cao) ─────────────────────────

export type LoiQuanTri = { ok: false; ma: "KHONG_CO_QUYEN" | "THIEU_LY_DO" | "PHUONG_THUC_KHONG_HOP_LE" | "PHAP_NHAN_KHONG_HOP_LE" | "TIEN_TO_KHONG_HOP_LE" | "MODE_KHONG_HOP_LE" | "PROD_CHUA_MO" | "PHAP_NHAN_CHUA_XAC_NHAN" | "KHONG_CO_CAU_HINH_DANG_BAT"; thongBao: string };
type Actor = { id: string; name: string; role?: string | null; roles?: readonly string[] | null };

export async function datCauHinhThuTien(
  db: Db,
  input: { actor: Actor; paymentMethodId: string; legalEntityId?: string | null; /** MST do Quản trị tối cao GÕ LẠI để xác nhận đúng pháp nhân — BẮT BUỘC khi mode = PROD. */ xacNhanMaSoThue?: string | null; memoPrefix?: string; mode: string; reason: string; now: Date },
): Promise<{ ok: true; configId: string } | LoiQuanTri> {
  if (!laQuanTriToiCao(input.actor)) return { ok: false, ma: "KHONG_CO_QUYEN", thongBao: "Chỉ Quản trị tối cao được cấu hình thu tiền Online." };
  const reason = input.reason.trim();
  if (reason.length < 10) return { ok: false, ma: "THIEU_LY_DO", thongBao: "Cần ghi lý do (≥ 10 ký tự)." };
  if (input.mode !== "TEST" && input.mode !== "PROD") return { ok: false, ma: "MODE_KHONG_HOP_LE", thongBao: "Chế độ phải là TEST hoặc PROD." };
  if (input.mode === "PROD" && !khoaProdDaMo()) return { ok: false, ma: "PROD_CHUA_MO", thongBao: "PROD chưa được bật — chờ Owner xác minh tài khoản ngân hàng chính thức." };
  const tienTo = chuanHoaMemo(input.memoPrefix ?? MA_MAC_DINH_TIEN_TO);
  if (!/^[A-Z0-9]{1,8}$/.test(tienTo)) return { ok: false, ma: "TIEN_TO_KHONG_HOP_LE", thongBao: "Tiền tố nội dung chuyển khoản: 1–8 ký tự A–Z/0–9." };

  const pm = await db.paymentMethod.findUnique({ where: { id: input.paymentMethodId } });
  if (!pm || pm.type !== "BANK_TRANSFER" || !pm.isActive || pm.centerId !== null || !pm.bankBin || !pm.bankAccountNumber || !pm.bankAccountName) {
    return { ok: false, ma: "PHUONG_THUC_KHONG_HOP_LE", thongBao: "Phương thức phải là chuyển khoản DÙNG CHUNG (không thuộc cơ sở nào), đang bật, đủ ngân hàng/STK/chủ tài khoản." };
  }
  const goc = await db.legalEntity.findFirst({ where: { isPrimary: true, isActive: true, deletedAt: null }, select: { id: true, taxCode: true, legalName: true } });
  if (!goc || (input.legalEntityId && input.legalEntityId !== goc.id)) {
    return { ok: false, ma: "PHAP_NHAN_KHONG_HOP_LE", thongBao: "Pháp nhân bán phải là pháp nhân GỐC SataRobo (isPrimary, đang hoạt động). Không tự chọn pháp nhân khác." };
  }

  // V8.19 — `isPrimary` chỉ nói «pháp nhân gốc của hệ thống», KHÔNG chứng minh đó là SataRobo thật. PROD (tiền thật + hoá đơn thật) đòi người có thẩm quyền chỉ đích danh
  // pháp nhân (id) VÀ gõ lại MST khớp bản ghi; không khớp ⇒ từ chối, không tự suy từ `isPrimary`. TEST không đòi (dữ liệu giả, không QR thật).
  if (input.mode === "PROD") {
    const chuSo = (v: string | null | undefined) => (v ?? "").replace(/[^0-9]/g, "");
    if (!input.legalEntityId || input.legalEntityId !== goc.id || chuSo(input.xacNhanMaSoThue).length === 0 || chuSo(input.xacNhanMaSoThue) !== chuSo(goc.taxCode)) {
      return { ok: false, ma: "PHAP_NHAN_CHUA_XAC_NHAN", thongBao: "PROD cần chỉ đích danh pháp nhân (legalEntityId) và nhập lại mã số thuế khớp với bản ghi pháp nhân SataRobo đã được Owner xác minh." };
    }
  }

  return db.$transaction(async (tx) => {
    const cu = await tx.onlinePaymentConfig.findFirst({ where: { isActive: true }, select: { id: true } });
    if (cu) await tx.onlinePaymentConfig.update({ where: { id: cu.id }, data: { isActive: false, deactivatedAt: input.now } });
    const moi = await tx.onlinePaymentConfig.create({
      data: { paymentMethodId: pm.id, legalEntityId: goc.id, memoPrefix: tienTo, mode: input.mode, isActive: true, reason, createdById: input.actor.id, activatedAt: input.now },
      select: { id: true },
    });
    await writeAudit({
      tx,
      actor: { id: input.actor.id, name: input.actor.name },
      module: "online-checkout",
      entityType: "OnlinePaymentConfig",
      entityId: moi.id,
      action: "ONLINE_PAYMENT_CONFIG_SET",
      // KHÔNG ghi số tài khoản vào audit — chỉ id + mode + lý do (STK đọc từ PaymentMethod khi cần).
      newValues: { mode: input.mode, memoPrefix: tienTo, paymentMethodId: pm.id, legalEntityId: goc.id, maSoThueDaXacNhan: input.mode === "PROD" ? goc.taxCode : null, thayCho: cu?.id ?? null, reason },
      orgUnitId: null,
    });
    return { ok: true as const, configId: moi.id };
  });
}

/** Ngừng phát hành hướng dẫn thanh toán MỚI (đơn đang chờ GIỮ nguyên thông tin đã phát hành). */
export async function voHieuCauHinhThuTien(db: Db, input: { actor: Actor; reason: string; now: Date }): Promise<{ ok: true; configId: string } | LoiQuanTri> {
  if (!laQuanTriToiCao(input.actor)) return { ok: false, ma: "KHONG_CO_QUYEN", thongBao: "Chỉ Quản trị tối cao được cấu hình thu tiền Online." };
  const reason = input.reason.trim();
  if (reason.length < 10) return { ok: false, ma: "THIEU_LY_DO", thongBao: "Cần ghi lý do (≥ 10 ký tự)." };
  return db.$transaction(async (tx) => {
    const cu = await tx.onlinePaymentConfig.findFirst({ where: { isActive: true }, select: { id: true } });
    if (!cu) return { ok: false as const, ma: "KHONG_CO_CAU_HINH_DANG_BAT" as const, thongBao: "Không có cấu hình đang bật." };
    await tx.onlinePaymentConfig.update({ where: { id: cu.id }, data: { isActive: false, deactivatedAt: input.now } });
    await writeAudit({ tx, actor: { id: input.actor.id, name: input.actor.name }, module: "online-checkout", entityType: "OnlinePaymentConfig", entityId: cu.id, action: "ONLINE_PAYMENT_CONFIG_DISABLE", newValues: { reason }, orgUnitId: null });
    return { ok: true as const, configId: cu.id };
  });
}

/** Lịch sử cấu hình (mới nhất trước) — KHÔNG trả số tài khoản đầy đủ: che còn 4 số cuối. */
export async function docLichSuCauHinh(db: Db, input: { actor: Actor }): Promise<{ ok: true; muc: Array<{ id: string; mode: string; memoPrefix: string; isActive: boolean; reason: string; createdAt: string; nganHang: string | null; soTaiKhoanCuoi: string | null; phapNhan: string }> } | LoiQuanTri> {
  if (!laQuanTriToiCao(input.actor)) return { ok: false, ma: "KHONG_CO_QUYEN", thongBao: "Chỉ Quản trị tối cao được xem cấu hình thu tiền Online." };
  const ds = await db.onlinePaymentConfig.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { paymentMethod: { select: { bankName: true, bankAccountNumber: true } }, legalEntity: { select: { legalName: true, taxCode: true } } } });
  return {
    ok: true,
    muc: ds.map((d) => ({ id: d.id, mode: d.mode, memoPrefix: d.memoPrefix, isActive: d.isActive, reason: d.reason, createdAt: d.createdAt.toISOString(), nganHang: d.paymentMethod.bankName, soTaiKhoanCuoi: d.paymentMethod.bankAccountNumber ? d.paymentMethod.bankAccountNumber.slice(-4) : null, phapNhan: `${d.legalEntity.legalName} (${d.legalEntity.taxCode})` })),
  };
}
