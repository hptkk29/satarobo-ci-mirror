import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import { writeAudit } from "@/lib/audit/audit-log";
import type { Actor } from "@/lib/auth/actor";
import { coQuyenKeToanTaiCoSo } from "./quyen";
import { nguonGiaoDich } from "./nguon-khoan";
import {
  TOI_DA_GHI_CHU_CHUNG_TU,
  TOI_DA_LY_DO_CHUNG_TU,
  TOI_THIEU_LY_DO_CHUNG_TU,
  chuyenTrangThai,
  lamSachGhiChu,
  lyDoKhongDanhDau,
  nutDuocPhep,
  type HanhDongChungTu,
  type LoaiTepChungTu,
  type NutChungTu,
  type TrangThaiChungTu,
} from "./chung-tu-ngan-hang";

// lib/finance/hoa-don/chung-tu-ngan-hang-db.ts — đọc / ghi HỒ SƠ CHỨNG TỪ NGÂN HÀNG của khoản thu (P7-E, 06/11/2026).
// Luật "được làm gì ở trạng thái nào" nằm ở `chung-tu-ngan-hang.ts` (thuần, có test); tệp này chỉ nối với DB.
//
// ⚠️ TỆP NÀY CHỈ GHI VÀO `ChungTuNganHang` + `AuditLog`. KHÔNG `payment.update*` (không xác nhận / từ chối / đổi tiền / đổi `evidenceUrl`),
//    KHÔNG Receipt, KHÔNG hoá đơn (phát hành / huỷ / thay) — lưới `[CTW-*]` đếm đúng điều đó. Tải chứng từ KHÔNG BAO GIỜ xác nhận khoản thu.
// ⚠️ ĐỌC đi qua `scopedDb` (tiền tố `payments:`); GHI thì `scopedDb` KHÔNG che — mọi hàm ghi đọc lại khoản / hồ sơ BẰNG CHÍNH transaction của
//    nó rồi tự hỏi `coQuyenKeToanTaiCoSo(actor, centerId)`. Action đã hỏi một lần ở cổng; hỏi lại ở đây là để một đường gọi mới không quên.
// ⚠️ Luật rollback: mọi từ chối là `throw` (LoiChungTu), mọi cổng đứng TRƯỚC phép ghi đầu tiên; AuditLog ghi TRONG CÙNG transaction —
//    audit ném thì phép ghi lùi theo (không có thay đổi chứng từ nào mà không có dấu vết).

const ENTITY = "ChungTuNganHang";

export const MA_LOI_CHUNG_TU = {
  KHONG_THAY: "KHONG_THAY",
  KHONG_DANH_DAU_DUOC: "KHONG_DANH_DAU_DUOC",
  DA_DANH_DAU: "DA_DANH_DAU",
  THIEU_LY_DO: "THIEU_LY_DO",
  SAI_TRANG_THAI: "SAI_TRANG_THAI",
  DA_DOI: "DA_DOI",
} as const;
export type MaLoiChungTu = (typeof MA_LOI_CHUNG_TU)[keyof typeof MA_LOI_CHUNG_TU];

export class LoiChungTu extends Error {
  constructor(
    readonly ma: MaLoiChungTu,
    readonly thongDiep: string,
  ) {
    super(thongDiep);
    this.name = "LoiChungTu";
  }
}

/** Mọi nhánh từ chối vì PHẠM VI đều nói "không tìm thấy" — không phân biệt "không có" với "không thuộc cơ sở bạn". */
const khongThay = () => new LoiChungTu("KHONG_THAY", "Không tìm thấy khoản thu / hồ sơ chứng từ");

export type NguoiLam = { id: string; ten: string };
type Tx = Prisma.TransactionClient;

function kiemLyDo(lyDo: string | null | undefined, ten: string): string {
  const v = (lyDo ?? "").trim();
  if (v.length < TOI_THIEU_LY_DO_CHUNG_TU) throw new LoiChungTu("THIEU_LY_DO", `${ten}: ghi rõ lý do (ít nhất ${TOI_THIEU_LY_DO_CHUNG_TU} ký tự)`);
  if (v.length > TOI_DA_LY_DO_CHUNG_TU) throw new LoiChungTu("THIEU_LY_DO", `${ten}: lý do tối đa ${TOI_DA_LY_DO_CHUNG_TU} ký tự`);
  return v;
}

function kiemGhiChu(ghiChu: string | null | undefined): string | null {
  const v = lamSachGhiChu(ghiChu);
  if (v !== null && v.length > TOI_DA_GHI_CHU_CHUNG_TU) {
    throw new LoiChungTu("THIEU_LY_DO", `Ghi chú tối đa ${TOI_DA_GHI_CHU_CHUNG_TU} ký tự`);
  }
  return v;
}

/** Hồ sơ của một khoản — đọc BẰNG transaction đang chạy, rồi kiểm phạm vi kế toán của người làm. */
async function docHoSo(tx: Tx, actor: Actor, paymentId: string) {
  const hs = await tx.chungTuNganHang.findUnique({ where: { paymentId } });
  if (!hs || !coQuyenKeToanTaiCoSo(actor, hs.centerId)) throw khongThay();
  return hs;
}

function kiemChuyen(tu: TrangThaiChungTu, hd: HanhDongChungTu) {
  const kq = chuyenTrangThai(tu, hd);
  if (!kq.ok) throw new LoiChungTu("SAI_TRANG_THAI", kq.lyDo);
  return kq.den;
}

/** Đổi trạng thái CÓ ĐIỀU KIỆN trạng thái cũ — hai kế toán bấm cùng lúc thì người sau nhận "đã thay đổi", không ghi đè im lặng. */
async function capNhatCoDieuKien(tx: Tx, id: string, tu: TrangThaiChungTu, data: Prisma.ChungTuNganHangUncheckedUpdateManyInput): Promise<void> {
  const r = await tx.chungTuNganHang.updateMany({ where: { id, trangThai: tu }, data });
  if (r.count !== 1) throw new LoiChungTu("DA_DOI", "Hồ sơ vừa được người khác thay đổi — tải lại trang rồi thao tác lại");
}

// ─── GHI ───────────────────────────────────────────────────────────────────────────────────────────────

/** Kế toán ĐÁNH DẤU một khoản thu cần bổ sung chứng từ ngân hàng. Kể cả khoản nguồn nhập lịch sử, kể cả khoản đang PENDING. */
export async function danhDauCanChungTu(input: { actor: Actor; nguoi: NguoiLam; paymentId: string; lyDo: string }): Promise<{ id: string }> {
  const lyDo = kiemLyDo(input.lyDo, "Đánh dấu cần chứng từ");
  try {
    return await db.$transaction(async (tx) => {
      const p = await tx.payment.findUnique({
        where: { id: input.paymentId },
        select: { id: true, deletedAt: true, paymentType: true, accountantStatus: true, amount: true, centerId: true, orgUnitId: true },
      });
      if (!p || !p.centerId || !coQuyenKeToanTaiCoSo(input.actor, p.centerId)) throw khongThay();
      const khongDuoc = lyDoKhongDanhDau(p);
      if (khongDuoc) throw new LoiChungTu("KHONG_DANH_DAU_DUOC", khongDuoc);
      if (await tx.chungTuNganHang.findUnique({ where: { paymentId: p.id }, select: { id: true } })) {
        throw new LoiChungTu("DA_DANH_DAU", "Khoản thu này đã có hồ sơ chứng từ");
      }
      const hs = await tx.chungTuNganHang.create({
        data: {
          paymentId: p.id,
          centerId: p.centerId, // scopedDb không che write: tự set cơ sở của KHOẢN THU
          ...(p.orgUnitId ? { orgUnitId: p.orgUnitId } : {}),
          trangThai: "CHO_BO_SUNG",
          lyDoDanhDau: lyDo,
          danhDauBoiId: input.nguoi.id,
        },
        select: { id: true, orgUnitId: true },
      });
      await writeAudit({
        actor: { id: input.nguoi.id, name: input.nguoi.ten },
        module: "finance",
        entityType: ENTITY,
        entityId: hs.id,
        action: "DANH_DAU_CAN_CHUNG_TU",
        newValues: { paymentId: p.id, trangThai: "CHO_BO_SUNG" },
        reason: lyDo,
        orgUnitId: hs.orgUnitId ?? p.centerId,
        tx,
      });
      return { id: hs.id };
    });
  } catch (e) {
    // Hai kế toán đánh dấu cùng một khoản cùng lúc: khoá duy nhất `paymentId` chặn người sau.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new LoiChungTu("DA_DANH_DAU", "Khoản thu này đã có hồ sơ chứng từ");
    }
    throw e;
  }
}

export type TepDaXacMinh = { khoa: string; ten: string; loai: LoaiTepChungTu; co: number; sha256: string };

/**
 * Ghi tệp ĐÃ XÁC MINH BYTE vào hồ sơ → DA_TAI_LEN. KHÔNG đổi `Payment` (chỉ ghi `ChungTuNganHang` + audit).
 * Tệp cũ (khi thay) không bị xoá ở đây: cron dọn tệp mồ côi lo sau 7 ngày — xoá ngay trong lúc commit có thể mất cả hai nếu commit hỏng.
 */
export async function ghiTepChungTu(input: { actor: Actor; nguoi: NguoiLam; paymentId: string; tep: TepDaXacMinh; ghiChu?: string | null; now: Date }): Promise<{ id: string; trangThai: TrangThaiChungTu }> {
  const ghiChu = kiemGhiChu(input.ghiChu);
  return db.$transaction(async (tx) => {
    const hs = await docHoSo(tx, input.actor, input.paymentId);
    const den = kiemChuyen(hs.trangThai, "TAI_LEN");
    if (den === "HUY") throw new LoiChungTu("SAI_TRANG_THAI", "Không tải lên được ở trạng thái này");
    const thay = hs.tepKhoa !== null;
    await capNhatCoDieuKien(tx, hs.id, hs.trangThai, {
      trangThai: den,
      tepKhoa: input.tep.khoa,
      tepTen: input.tep.ten,
      tepLoai: input.tep.loai,
      tepCo: input.tep.co,
      tepSha256: input.tep.sha256,
      taiLenBoiId: input.nguoi.id,
      taiLenLuc: input.now,
      // Không cần xoá dấu «đã kiểm tra»: tải lên chỉ qua được từ CHO_BO_SUNG / DA_TAI_LEN / CAN_BO_SUNG_LAI, mà cả ba đều đã để trống
      // kiemTraBoiId/kiemTraLuc (`yeuCauBoSungLai` xoá chúng; DA_KIEM_TRA không thay tệp trực tiếp được).
      ghiChu,
    });
    await writeAudit({
      actor: { id: input.nguoi.id, name: input.nguoi.ten },
      module: "finance",
      entityType: ENTITY,
      entityId: hs.id,
      action: thay ? "THAY_TEP_CHUNG_TU" : "TAI_LEN_CHUNG_TU",
      // KHÔNG chép khoá tệp / URL: nhật ký là nơi nhiều người đọc được hơn kho tệp.
      oldValues: { trangThai: hs.trangThai, tepTen: hs.tepTen, tepSha256: hs.tepSha256 },
      newValues: { paymentId: hs.paymentId, trangThai: den, tepTen: input.tep.ten, tepLoai: input.tep.loai, tepCo: input.tep.co, tepSha256: input.tep.sha256 },
      reason: ghiChu ?? undefined,
      orgUnitId: hs.orgUnitId ?? hs.centerId,
      tx,
    });
    return { id: hs.id, trangThai: den };
  });
}

/** Kế toán xác nhận đã KIỂM TRA tệp → DA_KIEM_TRA. Không xác nhận khoản thu. */
export async function danhDauDaKiemTra(input: { actor: Actor; nguoi: NguoiLam; paymentId: string; ghiChu?: string | null; now: Date }): Promise<{ id: string }> {
  const ghiChu = kiemGhiChu(input.ghiChu);
  return db.$transaction(async (tx) => {
    const hs = await docHoSo(tx, input.actor, input.paymentId);
    const den = kiemChuyen(hs.trangThai, "KIEM_TRA");
    if (den === "HUY" || !hs.tepKhoa) throw new LoiChungTu("SAI_TRANG_THAI", "Chưa có tệp chứng từ để kiểm tra");
    await capNhatCoDieuKien(tx, hs.id, hs.trangThai, { trangThai: den, kiemTraBoiId: input.nguoi.id, kiemTraLuc: input.now, ghiChu });
    await writeAudit({
      actor: { id: input.nguoi.id, name: input.nguoi.ten },
      module: "finance",
      entityType: ENTITY,
      entityId: hs.id,
      action: "KIEM_TRA_CHUNG_TU",
      oldValues: { trangThai: hs.trangThai },
      newValues: { paymentId: hs.paymentId, trangThai: den },
      reason: ghiChu ?? undefined,
      orgUnitId: hs.orgUnitId ?? hs.centerId,
      tx,
    });
    return { id: hs.id };
  });
}

/** Bác tệp hiện có, đòi bổ sung lại → CAN_BO_SUNG_LAI (kèm lý do bắt buộc). */
export async function yeuCauBoSungLai(input: { actor: Actor; nguoi: NguoiLam; paymentId: string; lyDo: string; now: Date }): Promise<{ id: string }> {
  const lyDo = kiemLyDo(input.lyDo, "Yêu cầu bổ sung lại");
  return db.$transaction(async (tx) => {
    const hs = await docHoSo(tx, input.actor, input.paymentId);
    const den = kiemChuyen(hs.trangThai, "YEU_CAU_BO_SUNG_LAI");
    if (den === "HUY") throw new LoiChungTu("SAI_TRANG_THAI", "Không yêu cầu bổ sung lại được ở trạng thái này");
    await capNhatCoDieuKien(tx, hs.id, hs.trangThai, {
      trangThai: den,
      canBoSungLyDo: lyDo,
      canBoSungBoiId: input.nguoi.id,
      canBoSungLuc: input.now,
      kiemTraBoiId: null,
      kiemTraLuc: null,
    });
    await writeAudit({
      actor: { id: input.nguoi.id, name: input.nguoi.ten },
      module: "finance",
      entityType: ENTITY,
      entityId: hs.id,
      action: "YEU_CAU_BO_SUNG_LAI_CHUNG_TU",
      oldValues: { trangThai: hs.trangThai },
      newValues: { paymentId: hs.paymentId, trangThai: den },
      reason: lyDo,
      orgUnitId: hs.orgUnitId ?? hs.centerId,
      tx,
    });
    return { id: hs.id };
  });
}

/** Gỡ đánh dấu nhầm — CHỈ khi chưa từng có tệp (CHO_BO_SUNG). Hồ sơ bị xoá; dấu vết còn trong AuditLog. */
export async function huyDanhDau(input: { actor: Actor; nguoi: NguoiLam; paymentId: string; lyDo: string }): Promise<{ id: string }> {
  const lyDo = kiemLyDo(input.lyDo, "Huỷ đánh dấu");
  return db.$transaction(async (tx) => {
    const hs = await docHoSo(tx, input.actor, input.paymentId);
    kiemChuyen(hs.trangThai, "HUY_DANH_DAU");
    // Xoá CÓ ĐIỀU KIỆN trạng thái: hồ sơ vừa nhận tệp ở giữa chừng thì count = 0 ⇒ throw ⇒ không mất tệp.
    const r = await tx.chungTuNganHang.deleteMany({ where: { id: hs.id, trangThai: "CHO_BO_SUNG", tepKhoa: null } });
    if (r.count !== 1) throw new LoiChungTu("DA_DOI", "Hồ sơ vừa được người khác thay đổi — tải lại trang rồi thao tác lại");
    await writeAudit({
      actor: { id: input.nguoi.id, name: input.nguoi.ten },
      module: "finance",
      entityType: ENTITY,
      entityId: hs.id,
      action: "HUY_DANH_DAU_CHUNG_TU",
      oldValues: { paymentId: hs.paymentId, trangThai: hs.trangThai, lyDoDanhDau: hs.lyDoDanhDau },
      reason: lyDo,
      orgUnitId: hs.orgUnitId ?? hs.centerId,
      tx,
    });
    return { id: hs.id };
  });
}

/** Ghi audit mỗi lần cấp liên kết TẢI VỀ — gọi TRƯỚC khi ký URL; ném ⇒ route trả 503 và KHÔNG ký (khuôn route tải hoá đơn). */
export async function ghiAuditTaiVeChungTu(input: { nguoi: NguoiLam; hoSo: { id: string; paymentId: string; trangThai: string; orgUnitId: string | null; centerId: string } }): Promise<void> {
  await writeAudit({
    actor: { id: input.nguoi.id, name: input.nguoi.ten },
    module: "finance",
    entityType: ENTITY,
    entityId: input.hoSo.id,
    action: "TAI_VE_CHUNG_TU",
    newValues: { paymentId: input.hoSo.paymentId, trangThai: input.hoSo.trangThai },
    orgUnitId: input.hoSo.orgUnitId ?? input.hoSo.centerId,
  });
}

// ─── ĐỌC ───────────────────────────────────────────────────────────────────────────────────────────────

export type DongChungTu = {
  id: string;
  paymentId: string;
  maDon: string;
  hocVien: string | null;
  /** `null` khi người xem không có `orders:view-pii` (tên phụ huynh là thông tin liên hệ). */
  phuHuynh: string | null;
  soTien: number;
  ngayThu: string;
  trangThaiKhoan: "PENDING" | "CONFIRMED" | "REJECTED" | string;
  /** Khoản nhập lịch sử (backfill / sheet) — màn hàng chờ hoá đơn LOẠI loại khoản này, nên đây là chỗ DUY NHẤT kế toán thấy nó. */
  nhapLichSu: boolean;
  /** Hoá đơn còn hiệu lực đã gắn khoản ("1C26MAI-1"); `null` = chưa có. */
  hoaDon: string | null;
  trangThai: TrangThaiChungTu;
  lyDoDanhDau: string;
  nguoiDanhDau: string;
  danhDauLuc: string;
  tepTen: string | null;
  nguoiTaiLen: string | null;
  taiLenLuc: string | null;
  kiemTraLuc: string | null;
  nguoiKiemTra: string | null;
  canBoSungLyDo: string | null;
  ghiChu: string | null;
  nut: NutChungTu;
};

const TRANG_THAI_HOA_DON_CO_SO_HIEU = ["NHAP", "DA_XAC_NHAN", "DANG_PHAT_HANH", "LOI_PHAT_HANH"];

async function tenNguoiDung(ids: readonly string[]): Promise<Map<string, string>> {
  const duy = [...new Set(ids.filter((x) => x))];
  if (duy.length === 0) return new Map();
  const ds = await db.user.findMany({ where: { id: { in: duy } }, select: { id: true, name: true, email: true } });
  return new Map(ds.map((u) => [u.id, u.name ?? u.email ?? u.id]));
}

/** Danh sách hồ sơ của MỘT cơ sở (đã qua phạm vi kế toán ở trang). `scopedDb` vẫn lọc thêm — hai lớp. */
export async function docDanhSachChungTu(actor: Actor, input: { coSoId: string; xemPii: boolean }): Promise<DongChungTu[]> {
  const ds = await scopedDb(actor).chungTuNganHang.findMany({
    where: { centerId: input.coSoId },
    orderBy: [{ danhDauLuc: "desc" }, { id: "asc" }],
    take: 1000,
    include: {
      payment: {
        select: {
          id: true,
          amount: true,
          paidDate: true,
          accountantStatus: true,
          note: true,
          hoaDonKhoan: {
            where: { hieuLuc: true },
            select: { hoaDon: { select: { kyHieu: true, soHoaDon: true, trangThai: true } } },
          },
          order: { select: { code: true, customerName: true, student: { select: { name: true, parentName: true } } } },
        },
      },
    },
  });
  const ten = await tenNguoiDung(ds.flatMap((h) => [h.danhDauBoiId, h.taiLenBoiId ?? "", h.kiemTraBoiId ?? ""]));
  return ds.map((h): DongChungTu => {
    const hd = h.payment.hoaDonKhoan.map((k) => k.hoaDon).find((x) => TRANG_THAI_HOA_DON_CO_SO_HIEU.includes(x.trangThai));
    return {
      id: h.id,
      paymentId: h.paymentId,
      maDon: h.payment.order.code,
      // Không có học viên trên đơn thì `customerName` là tên NGƯỜI ĐẶT (phụ huynh) — chỉ hiện cho người có quyền xem PII.
      hocVien: h.payment.order.student?.name ?? (input.xemPii ? h.payment.order.customerName : null),
      phuHuynh: input.xemPii ? (h.payment.order.student?.parentName ?? null) : null,
      soTien: h.payment.amount,
      ngayThu: h.payment.paidDate.toISOString(),
      trangThaiKhoan: h.payment.accountantStatus,
      nhapLichSu: nguonGiaoDich(h.payment.note).loai === "LICH_SU",
      hoaDon: hd?.soHoaDon ? `${hd.kyHieu ?? ""}${hd.kyHieu ? "-" : ""}${hd.soHoaDon}` : null,
      trangThai: h.trangThai,
      lyDoDanhDau: h.lyDoDanhDau,
      nguoiDanhDau: ten.get(h.danhDauBoiId) ?? h.danhDauBoiId,
      danhDauLuc: h.danhDauLuc.toISOString(),
      tepTen: h.tepTen,
      nguoiTaiLen: h.taiLenBoiId ? (ten.get(h.taiLenBoiId) ?? h.taiLenBoiId) : null,
      taiLenLuc: h.taiLenLuc?.toISOString() ?? null,
      kiemTraLuc: h.kiemTraLuc?.toISOString() ?? null,
      nguoiKiemTra: h.kiemTraBoiId ? (ten.get(h.kiemTraBoiId) ?? h.kiemTraBoiId) : null,
      canBoSungLyDo: h.canBoSungLyDo,
      ghiChu: h.ghiChu,
      nut: nutDuocPhep(h.trangThai, h.tepKhoa !== null),
    };
  });
}

export type KhoanTimThay = {
  paymentId: string;
  soTien: number;
  ngayThu: string;
  trangThaiKhoan: string;
  nhapLichSu: boolean;
  daDanhDau: boolean;
  /** Lý do KHÔNG đánh dấu được; `null` = bấm được. */
  lyDoKhong: string | null;
};

/**
 * Tìm khoản thu theo MÃ ĐƠN trong cơ sở làm việc (để đánh dấu). Đơn ngoài phạm vi ⇒ rỗng (không phân biệt "không có" với "không thuộc bạn").
 * Trả cả khoản nguồn lịch sử và khoản PENDING — đó là mục đích của màn này.
 */
export async function timKhoanTheoMaDon(actor: Actor, input: { coSoId: string; maDon: string }): Promise<{ maDon: string; khoan: KhoanTimThay[] } | null> {
  const ma = input.maDon.trim().toUpperCase();
  if (!/^[A-Z0-9-]{3,40}$/.test(ma)) return null;
  if (!coQuyenKeToanTaiCoSo(actor, input.coSoId)) return null;
  const don = await scopedDb(actor).order.findFirst({
    where: { code: ma, centerId: input.coSoId, deletedAt: null },
    select: {
      code: true,
      payments: {
        where: { deletedAt: null },
        orderBy: [{ paidDate: "asc" }, { id: "asc" }],
        select: { id: true, amount: true, paidDate: true, accountantStatus: true, paymentType: true, deletedAt: true, centerId: true, note: true, chungTuNganHang: { select: { id: true } } },
      },
    },
  });
  if (!don) return null;
  return {
    maDon: don.code,
    khoan: don.payments.map((p) => ({
      paymentId: p.id,
      soTien: p.amount,
      ngayThu: p.paidDate.toISOString(),
      trangThaiKhoan: p.accountantStatus,
      nhapLichSu: nguonGiaoDich(p.note).loai === "LICH_SU",
      daDanhDau: p.chungTuNganHang !== null,
      lyDoKhong: p.chungTuNganHang ? "Khoản này đã có hồ sơ chứng từ" : lyDoKhongDanhDau(p),
    })),
  };
}
