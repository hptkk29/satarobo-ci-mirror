// lib/hoa-hong/quet-khoan.ts — CommissionCalculationService: quét MỘT khoản `Payment` thuộc `WHERE_THUC_THU` vào sổ hoa hồng mới.
//
// Nguồn: docs/source-commission/04 §2 (đường ống), §4 (cơ sở tính), §10 (sổ, ô tính), §11 (đảo). Quyết định chủ dự án 07–09/10/2026.
//
// Đường ống của MỘT bút toán (04 §2):
//   chủ sở hữu → loại bút toán → VAT → thành phần → học viên → phân loại NEW/RENEWAL → nguồn → người hưởng → chính sách →
//   trần → tư cách → tiền → ghi sổ (ô tính + dòng + hàng chờ) trong MỘT transaction.
//
// KHÔNG cắm sự kiện vào `lib/payments` / `lib/finance`: engine QUÉT theo kỳ trên `WHERE_THUC_THU` (cron + nút Tính). Nhờ đó nó không làm
// đường tiền chậm đi một câu nào và không có đường nào "quên" gọi nó.
//
// BA kết cục của một khoản THU:
//   · GHI MỚI   — chưa có ô: dựng ô + dòng ORIGINAL (hoặc LATE_ARRIVAL nếu kỳ tự nhiên đã đóng) + hàng chờ treo.
//   · SO Ô      — đã có ô (L13): KHÔNG BAO GIỜ ghi ORIGINAL nữa; so Σ ròng với kỳ vọng hôm nay, lệch ⇒ INPUT_DRIFT (người duyệt).
//   · GIỮ       — thiếu dữ liệu để quyết (L7): hàng chờ, 0 dòng. Không đoán.
// Và một khoản HOÀN / điều chỉnh giảm: ĐẢO theo dòng gốc (A3, L8), không theo bút toán hoàn.
//
// ⚠️ Cấu trúc retry: `quetKhoan` đọc ngoài transaction (nháp) rồi ghi trong transaction sau khoá. Trạng thái đổi giữa hai bước ⇒
// `HoaHongError` mã `TRANG_THAI_DA_DOI`/`KY_DA_DONG` ⇒ nạp lại từ đầu, tối đa 3 lần — không bao giờ ghi trên số đã cũ.
import { Prisma, type CommissionEntryKind, type CommissionTransaction, type PrismaClient } from "@prisma/client";

import { writeAudit } from "@/lib/audit/audit-log";
import type { NguonChoHoaHong } from "@/lib/nguon/doc-nguon-hoa-hong";

import { danhDauDaDung } from "./chinh-sach-service";
import { chuSoHuuButToan } from "./chu-so-huu";
import { docKyCu } from "./cutover";
import { tinhDaoNguoc } from "./dao-nguoc";
import { ghiHangCho, dongHangChoDaHetCan, type HoldNhap, type MaHold } from "./hang-cho";
import { HoaHongError, MA_KHOI_PHUC_HOAN_LEGACY } from "./kieu";
import { khoaDao, khoaDieuChinh, khoaHold, khoaLegacy, khoaNguoi, khoaOriginal, bamDauVao, refEventTheoTheHe, tachKhoaNguoi, type KhoaNguoi } from "./khoa-so";
import { bamKy, docKyTomTat, type KyDb } from "./ky-db";
import { kyGhiSo } from "./ky-hoa-hong";
import {
  conThucThu,
  dongPhanBoCua,
  conNoTuKhoanTruoc,
  docDonViCuaCoSo,
  docHocVienTheoLeadChild,
  docKhoan,
  docKhoanTruoc,
  docNgayThuDau,
  dongNoCua,
  hangButToanCua,
  khoanTruocCuaNap,
  type Khach,
  type KhoanNap,
} from "./nap-khoan";
import { loaiButToan, mocCuaButToan, kyTuNhienCua } from "./but-toan";
import { ngayVN } from "./ngay-lam-viec";
import { tinhLegacyReversal } from "./legacy-reversal";
import { MASTER_VAI_HUONG } from "./vai-huong";
import type { AffiliateChoHoaHong } from "@/lib/affiliate/campaign-cho-hoa-hong";
import type { KetQuaBaoVe, KetQuaLienKet } from "./bao-ve-campaign";
import { dungDauVaoChinhSach } from "./dau-vao-chinh-sach";
import { laKhoanDauCuaLanMua, laKhoanDauSauSoCai } from "./khoan-dau-lan-mua";
import { docChuFixedTrongSo } from "./khoan-dau-lan-mua-db";
import { ghiGiaiThich } from "./giai-thich-db";
import type { CuaSoGhiCong } from "./giai-thich-khong-tien";
import type { KetQuaNguoiHuong } from "./nguoi-huong";
import { MA_KHOI_PHUC_HOAN, docTrangThaiO, type OCoDong } from "./o-tinh-db";
import { kyVongSauLichSu, soVoiO, tachChenhDoiNguon, type ChenhNguoi } from "./o-tinh";
import { phanBoKhoan, type KetQuaPhanBo } from "./phan-bo-khoan";
import { BO_LUAT_PHAN_LOAI, type KetQuaPhanLoai } from "./phan-loai-giao-dich";
import { phanLoaiDongDon } from "./phan-loai-giao-dich-db";
import type { BoiCanhQuet } from "./boi-canh";
import { chayTrongKhoa, type CotAffiliateSo, type DongGhi, type CongGhi } from "./ghi-so";
import { tachVat, vatHieuLuc } from "./tien";
import { tinhDongChoKhoan, type DauVaoKhoan, type DongNhap, type KetQuaTinhKhoan } from "./tinh-dong-cho-khoan";
import { tinhCanhBaoGoiDoiNguon } from "./canh-bao-de-xuat";
import { luuDeXuat, quyetDinhQuanTriTrongTx, type GoiDong } from "./de-xuat-dieu-chinh";
import type { MucQuanTri } from "./quan-tri-dieu-chinh";
import type { NguonCuaKhoan } from "./tinh-chinh-sach";

const NGUOI_HE_THONG = { id: null as string | null, name: "Engine hoa hồng" };
const MODULE_AUDIT = "hoa-hong";
const SO_LAN_THU_LAI = 3;
const MA_THU_LAI: ReadonlySet<string> = new Set(["TRANG_THAI_DA_DOI", "KY_DA_DONG"]);

export type LyDoBoQua =
  | "KHONG_THUC_THU"
  | "KHONG_PHAI_CHU"
  | "NGOAI_PHAM_VI"
  | "SO_TIEN_0"
  | "GOC_CHUA_CO_O"
  | "KHONG_CO_GI_DE_DAO"
  | "DA_XU_LY";

export type KetQuaQuetKhoan =
  | { loai: "KHONG_THAY" }
  | { loai: "BO_QUA"; lyDo: LyDoBoQua }
  | { loai: "GIU"; hangCho: MaHold[] }
  | { loai: "DA_GHI"; slotId: string; soDong: number; tong: number; kyGhi: string; lateArrival: boolean; treo: number }
  /** `lichSu` có mặt khi bất biến carry-forward đã GIỮ nguyên tiền của những `(vai, người)` vắng vì trạng thái sống (nghỉ việc · affiliate ngưng · cờ nguồn tắt). */
  | { loai: "KHONG_DOI"; slotId: string; lichSu?: KhoaNguoi[] }
  | { loai: "TROI"; slotId: string; chenh: ChenhNguoi[]; lyDo: "LECH_TIEN" | "LOI_CAU_HINH" }
  /** Đổi nguồn sau thu ⇒ ĐỀ XUẤT điều chỉnh chờ duyệt đã được lập; SỔ CHƯA ĐỔI (hướng B+C). */
  | { loai: "DE_XUAT"; slotId: string; requestId: string; quanTri: MucQuanTri }
  /** Ô đã có đề xuất đổi nguồn đang mở — lượt này không lập thêm, không mở INPUT_DRIFT thứ hai. */
  | { loai: "DE_XUAT_DA_CO"; slotId: string; requestId: string }
  /** Duyệt đề xuất mà số liệu đã đổi ⇒ đề xuất thành STALE, KHÔNG ghi sổ. */
  | { loai: "STALE_DE_XUAT"; slotId: string; lyDo: string }
  | { loai: "DA_DAO"; soDong: number; tong: number; kyGhi: string; lateArrival: boolean }
  /** Đổi nguồn sau thu (đã cấp quyền) ⇒ `SOURCE_CORRECTION` = chênh lệch theo từng người (04 §10.4 bước 4, §11.4). */
  | { loai: "DA_DIEU_CHINH"; slotId: string; soDong: number; tong: number; kyGhi: string; lateArrival: boolean }
  /** Hoàn khoản mà dòng gốc thuộc engine CŨ ⇒ `LEGACY_REVERSAL` = đúng số engine cũ sẽ ra (04 §11.3). */
  | { loai: "DA_DAO_LEGACY"; soDong: number; tong: number; kyGhi: string; lateArrival: boolean }
  | { loai: "RUT_TIEN"; slotId: string | null };

/**
 * Chế độ của một lượt quét MỘT khoản (hướng B+C, 16/10/2026 — KHÔNG chế độ nào tự ghi tiền khi chưa có người duyệt):
 *   · `QUET` (mặc định) KHÔNG BAO GIỜ ghi chênh lệch lên ô đã có — chỉ phát hiện (INPUT_DRIFT).
 *   · `DE_XUAT_DOI_NGUON` do consumer của sự kiện `nguon.da-doi-sau-thanh-toan` (và script backfill) truyền: TÍNH chênh lệch do nguồn và LẬP ĐỀ XUẤT điều chỉnh chờ duyệt. KHÔNG ghi sổ.
 *   · `DOI_NGUON_CO_QUYEN` chỉ do SERVICE DUYỆT truyền (đề xuất đã qua đủ cấp): tính lại dưới khoá, đúng gói đã duyệt thì ghi `SOURCE_CORRECTION`, khác thì STALE. Đúng MỘT nơi gọi (lưới [DXD-W5]).
 * `refEventId` BẮT BUỘC: sự kiện đổi nguồn (lập đề xuất — khoá idempotency của đề xuất) hoặc id đề xuất (duyệt — khoá idempotency của dòng điều chỉnh).
 */
export type CheDoQuet =
  | { cheDo: "QUET" }
  | {
      cheDo: "DE_XUAT_DOI_NGUON";
      refEventId: string;
      requestedById: string;
      /** Dự báo tổng |tiền| của CẢ sự kiện (mọi ô sẽ có đề xuất) — để cái lập đầu tiên cũng thấy tổng (BẮT BUỘC — luật 7). `apDungDoiNguonSauThu` tính; chỉ NÂNG mức duyệt, không hạ. */
      duBaoTongYeuCau: number;
    }
  | { cheDo: "DOI_NGUON_CO_QUYEN"; refEventId: string; duyet: DuyetDeXuat };

/** Phần của service duyệt chạy TRONG transaction của engine: ghi trạng thái đề xuất cùng giao dịch với dòng sổ (hoặc cùng giao dịch với việc đánh dấu STALE). */
export type DuyetDeXuat = {
  requestId: string;
  /** Gói người duyệt đã THẤY (đóng băng lúc lập). Engine tính lại dưới khoá và đối chiếu từng dòng. */
  goi: readonly GoiDong[];
  /** Cổng ĐẦU transaction, TRƯỚC mọi phép ghi: khoá hàng đề xuất `FOR UPDATE` và kiểm nó VẪN đang ở đúng trạng thái người duyệt thấy; lệch ⇒ `throw` (rollback sạch). */
  kiemTruoc: (h: CongGhi) => Promise<void>;
  khiGhi: (h: CongGhi, kq: { khoaDong: readonly string[]; soDong: number; tong: number; kyId: string; kyGhi: string }) => Promise<void>;
  khiLoiThoi: (h: CongGhi, lyDo: string) => Promise<void>;
};
const CHE_DO_QUET: CheDoQuet = { cheDo: "QUET" };

// ── Điểm vào ─────────────────────────────────────────────────────────────────────────────────

export async function quetKhoan(client: PrismaClient, bc: BoiCanhQuet, paymentId: string, che: CheDoQuet = CHE_DO_QUET): Promise<KetQuaQuetKhoan> {
  for (let lan = 1; ; lan++) {
    try {
      return await quetMotLan(client, bc, paymentId, che);
    } catch (e) {
      if (e instanceof HoaHongError && MA_THU_LAI.has(e.ma) && lan < SO_LAN_THU_LAI) continue;
      throw e;
    }
  }
}

async function quetMotLan(client: PrismaClient, bc: BoiCanhQuet, paymentId: string, che: CheDoQuet): Promise<KetQuaQuetKhoan> {
  const p = await docKhoan(client, paymentId);
  if (!p) return { loai: "KHONG_THAY" };
  if (!conThucThu(p)) return quetKhongConThucThu(client, bc, p);
  if (p.amount === 0) return { loai: "BO_QUA", lyDo: "SO_TIEN_0" };

  const loai = loaiButToan(hangButToanCua(p));
  switch (loai) {
    case "THU":
      return quetThu(client, bc, p, che);
    case "DAO_CO_GOC":
      return quetDao(client, bc, p);
    case "CHUYEN_NOI_BO":
      return chiHangCho(client, bc, p, [{ ...cotHold(p), holdKey: khoaHold.theoKhoan("INTERNAL_TRANSFER", p.id), code: "INTERNAL_TRANSFER", detail: { lyDo: "Cặp chuyển tiền giữa hai bé — phục vụ nhiều việc khác nhau (sửa gắn nhầm, dư sau dừng học, đổi khoá); không tự đảo, không tự tính (04 §4.1)." } }]);
    case "AM_KHONG_GOC":
      return chiHangCho(client, bc, p, [{ ...cotHold(p), holdKey: khoaHold.theoKhoan("NEGATIVE_WITHOUT_ORIGIN", p.id), code: "NEGATIVE_WITHOUT_ORIGIN", detail: { lyDo: "Bút toán âm không có khoản gốc — không biết đảo dòng hoa hồng nào." } }]);
  }
}

// ── Tiện ích chung ───────────────────────────────────────────────────────────────────────────

export type CoSo = { centerId: string; orgUnitId: string; path: string };

export function cotHold(p: KhoanNap, extra: Partial<HoldNhap> = {}): Omit<HoldNhap, "holdKey" | "code" | "detail"> {
  return {
    paymentId: p.id,
    orderId: p.orderId,
    orderItemId: null,
    studentId: null,
    entryId: null,
    calcSlotId: null,
    blockingPeriodId: null,
    centerId: null,
    orgUnitId: null,
    ...extra,
  };
}

/** Kỳ mà hàng chờ của khoản này chặn: kỳ GHI SỔ nó sẽ vào (≥ mốc, bỏ qua kỳ đã đóng). */
export async function kyChanCua(client: Khach, bc: BoiCanhQuet, kyTuNhien: string, cs: Pick<CoSo, "centerId" | "orgUnitId">): Promise<KyDb> {
  const tu = kyTuNhien < bc.kyCutover ? bc.kyCutover : kyTuNhien;
  const thang = kyGhiSo({ kyTuNhien, orgUnitId: cs.orgUnitId, kyCutover: bc.kyCutover, ky: await docKyTomTat(client, cs.orgUnitId, tu) });
  return bamKy(client, { thang, centerId: cs.centerId, orgUnitId: cs.orgUnitId, kyCutover: bc.kyCutover });
}

export async function docCoSoCuaKhoan(client: Khach, p: KhoanNap): Promise<{ co: CoSo } | { thieu: string }> {
  const centerId = mocCuaButToan(hangButToanCua(p)).centerId;
  if (!centerId) return { thieu: "Khoản không quy được cơ sở (Payment → đơn → lead đều trống centerId)." };
  const dv = await docDonViCuaCoSo(client, centerId);
  if (!dv) return { thieu: `Cơ sở ${centerId} chưa có đơn vị (OrgUnit) tương ứng.` };
  return { co: { centerId, orgUnitId: dv.orgUnitId, path: dv.path } };
}

/** Hàng chờ NO_ORG_UNIT — hàng chờ cứng KHÔNG gắn kỳ (chưa có đơn vị thì chưa có kỳ). */
function holdKhongCoDonVi(p: KhoanNap, lyDo: string): HoldNhap {
  return { ...cotHold(p), holdKey: khoaHold.theoKhoan("NO_ORG_UNIT", p.id), code: "NO_ORG_UNIT", detail: { lyDo } };
}

// ── Chỉ hàng chờ (thiếu dữ liệu — không đoán) ─────────────────────────────────────────────────

type StGhi = {
  orderItemId: string;
  orderId: string;
  studentId: string | null;
  status: "CLASSIFIED" | "MANUAL_REVIEW_REQUIRED" | "PENDING_REGULATION";
  transactionTypeCode: "NEW" | "RENEWAL" | null;
  reasonCode: string;
  evidence: Prisma.InputJsonValue;
  centerId: string | null;
  orgUnitId: string | null;
  /** `null` = chưa có dòng; có id = đã có dòng nhưng chưa CLASSIFIED/chưa ai quyết ⇒ cập nhật. */
  suaId: string | null;
};

async function luuStudentTransaction(tx: Prisma.TransactionClient, st: StGhi, now: Date): Promise<string> {
  const data = {
    studentId: st.studentId,
    revenueComponent: "TUITION" as const,
    status: st.status,
    transactionTypeCode: st.transactionTypeCode,
    reasonCode: st.reasonCode,
    evidence: st.evidence,
    rulesetVersion: BO_LUAT_PHAN_LOAI,
    classifiedAt: now,
    centerId: st.centerId,
    orgUnitId: st.orgUnitId,
  };
  if (st.suaId) {
    // Chỉ sửa dòng CHƯA CLASSIFIED và CHƯA ai quyết tay: dòng đã chốt không bị phân loại lại im lặng (02 §8.3).
    const r = await tx.studentTransaction.updateMany({ where: { id: st.suaId, decidedById: null, status: { not: "CLASSIFIED" } }, data });
    if (r.count === 0) throw new HoaHongError("TRANG_THAI_DA_DOI", `StudentTransaction ${st.suaId} đã được chốt giữa hai lượt đọc/ghi.`);
    return st.suaId;
  }
  const c = await tx.studentTransaction.create({ data: { orderItemId: st.orderItemId, orderId: st.orderId, ...data }, select: { id: true } });
  return c.id;
}

async function chiHangCho(
  client: PrismaClient,
  bc: BoiCanhQuet,
  p: KhoanNap,
  holds: HoldNhap[],
  st: StGhi | null = null,
  coSo: CoSo | null | undefined = undefined,
): Promise<KetQuaQuetKhoan> {
  // Gắn kỳ chặn (ngoài transaction — tạo kỳ idempotent). Không có đơn vị ⇒ không có kỳ ⇒ không chặn khoá kỳ nào (chỉ Hội sở thấy).
  const cs = coSo === undefined ? await docCoSoCuaKhoan(client, p) : coSo ? { co: coSo } : { thieu: "" };
  let holdXong = holds;
  if ("co" in cs) {
    const ky = await kyChanCua(client, bc, kyTuNhienCua(p.paidDate), cs.co);
    holdXong = holds.map((h) => ({ ...h, centerId: h.centerId ?? cs.co.centerId, orgUnitId: h.orgUnitId ?? cs.co.orgUnitId, blockingPeriodId: h.blockingPeriodId ?? ky.id }));
  }
  const gioi = p.updatedAt.getTime();
  await chayTrongKhoa(client, { khoaKhoan: [p.id], kyCutoverDaDoc: bc.kyCutover }, async (h) => {
    await kiemKhoanVanNhuCu(h, p, gioi);
    if (st) await luuStudentTransaction(h.tx, st, bc.now);
    for (const hold of holdXong) await ghiHangCho(h.tx, hold, bc.now);
    await dongHangChoDaHetCan(h.tx, p.id, new Set(holdXong.map((x) => x.holdKey)), bc.now);
  });
  return { loai: "GIU", hangCho: holdXong.map((x) => x.code) };
}

/** Cổng đầu mọi lượt ghi: khoản VẪN thuộc thực thu và CHƯA đổi từ lúc nạp — không thì nạp lại. */
export async function kiemKhoanVanNhuCu(h: CongGhi, p: KhoanNap, updatedAtDaDoc: number): Promise<void> {
  const lai = await h.tx.payment.findUnique({ where: { id: p.id }, select: { deletedAt: true, accountantStatus: true, updatedAt: true } });
  if (!lai || !conThucThu(lai) || lai.updatedAt.getTime() !== updatedAtDaDoc) {
    throw new HoaHongError("TRANG_THAI_DA_DOI", `Khoản ${p.id} đã đổi giữa lúc nạp và lúc ghi.`);
  }
}

// ── Khoản KHÔNG CÒN thuộc thực thu (Q6 — quét ngược, 04 §12.1) ─────────────────────────────────

async function quetKhongConThucThu(client: PrismaClient, bc: BoiCanhQuet, p: KhoanNap): Promise<KetQuaQuetKhoan> {
  const slot = await client.commissionCalcSlot.findFirst({ where: { paymentId: p.id }, orderBy: { createdAt: "asc" } });
  if (!slot) return quetHoanBiRut(client, bc, p);
  const o = (await docTrangThaiO(client, [slot.id])).get(slot.id)!;
  const conTien = [...o.rong.values()].some((v) => v !== 0);
  if (!conTien) return { loai: "BO_QUA", lyDo: "KHONG_THUC_THU" };

  // Khoản đã có tiền hoa hồng mà nay rời thực thu (kế toán từ chối khoản đã xác nhận, hoặc xoá mềm): KHÔNG tự đảo — từ chối có thể là
  // bấm nhầm rồi xác nhận lại (01 §6.2). Hàng chờ cứng chặn khoá kỳ; người duyệt chọn "đảo" hoặc "giữ nguyên" kèm lý do.
  const ky = await kyChanCua(client, bc, kyTuNhienCua(new Date(bc.now)), { centerId: slot.centerId, orgUnitId: slot.orgUnitId });
  const hold: HoldNhap = {
    ...cotHold(p, { calcSlotId: slot.id, centerId: slot.centerId, orgUnitId: slot.orgUnitId, blockingPeriodId: ky.id }),
    holdKey: khoaHold.rutTien(slot.id),
    code: "PAYMENT_WITHDRAWN",
    detail: {
      lyDo: "Khoản thu đã có hoa hồng nhưng không còn thuộc thực thu (bị từ chối / xoá).",
      trangThaiKhoan: p.accountantStatus,
      daXoa: p.deletedAt !== null,
      rongTheoNguoi: Object.fromEntries(o.rong),
    },
  };
  await chayTrongKhoa(client, { khoaKhoan: [p.id], kyCutoverDaDoc: bc.kyCutover }, async (h) => {
    await ghiHangCho(h.tx, hold, bc.now);
  });
  return { loai: "RUT_TIEN", slotId: slot.id };
}

/**
 * Khoản HOÀN / điều chỉnh giảm mà engine ĐÃ đảo theo (có dòng REVERSAL — hoặc LEGACY_REVERSAL khi gốc thuộc sổ cũ — mang `paymentId` = khoản này) nay rời thực thu — kế toán bác khoản hoàn.
 * Khoản âm KHÔNG có ô tính (ô thuộc khoản THU gốc) nên nhánh "tìm ô" ở trên mù với nó, và dòng đảo còn nguyên ⇒ người hưởng bị thu hồi theo một khoản hoàn
 * không còn hiệu lực, im lặng. Cùng luật với khoản thu: KHÔNG tự đảo ngược lại (bác có thể là bấm nhầm — 01 §6.2), hàng chờ cứng chặn khoá kỳ.
 */
async function quetHoanBiRut(client: PrismaClient, bc: BoiCanhQuet, p: KhoanNap): Promise<KetQuaQuetKhoan> {
  const tatCa = await client.commissionTransaction.findMany({
    where: { paymentId: p.id, OR: [{ entryKind: { in: ["REVERSAL", "LEGACY_REVERSAL"] } }, { reasonCode: { in: [MA_KHOI_PHUC_HOAN, MA_KHOI_PHUC_HOAN_LEGACY] } }] },
    select: { calcSlotId: true, centerId: true, orgUnitId: true, amount: true, roleCode: true, beneficiaryKind: true, beneficiaryUserId: true, beneficiaryAffiliateId: true, entryKind: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const dongDao = tatCa.filter((d) => d.entryKind === "REVERSAL" || d.entryKind === "LEGACY_REVERSAL");
  const dau = dongDao[0];
  // Ròng THEO NGƯỜI sau cả dòng TRẢ LẠI: người duyệt đã "áp dụng" (trả lại đúng số thu hồi) ⇒ ròng 0 ⇒ không còn gì treo. Nếu bỏ qua dòng trả lại thì lượt quét/cron
  // sau đó dựng lại hàng chờ — `ghiHangCho` MỞ LẠI hàng RESOLVED — và nó treo vĩnh viễn chặn khoá kỳ (giải lần hai bị khoá idempotency từ chối).
  const rongTheoNguoi = new Map<string, number>();
  for (const d of tatCa) {
    const key = `${d.roleCode}|${d.beneficiaryKind}|${(d.beneficiaryKind === "USER" ? d.beneficiaryUserId : d.beneficiaryAffiliateId) ?? "-"}`;
    rongTheoNguoi.set(key, (rongTheoNguoi.get(key) ?? 0) + d.amount);
  }
  if (!dau || [...rongTheoNguoi.values()].every((v) => v === 0)) return { loai: "BO_QUA", lyDo: "KHONG_THUC_THU" };

  const ky = await kyChanCua(client, bc, kyTuNhienCua(new Date(bc.now)), { centerId: dau.centerId, orgUnitId: dau.orgUnitId });
  const hold: HoldNhap = {
    ...cotHold(p, { calcSlotId: dau.calcSlotId, centerId: dau.centerId, orgUnitId: dau.orgUnitId, blockingPeriodId: ky.id }),
    holdKey: khoaHold.theoKhoan("PAYMENT_WITHDRAWN", p.id),
    code: "PAYMENT_WITHDRAWN",
    detail: {
      lyDo: "Khoản HOÀN đã được đảo hoa hồng nhưng không còn thuộc thực thu (bị từ chối / xoá) — dòng đảo vẫn còn trong sổ.",
      trangThaiKhoan: p.accountantStatus,
      daXoa: p.deletedAt !== null,
      loaiKhoan: "HOAN",
      dongDao: dongDao.map((d) => ({ vai: d.roleCode, nguoi: d.beneficiaryKind === "USER" ? d.beneficiaryUserId : d.beneficiaryAffiliateId, tien: d.amount, ...(d.entryKind === "LEGACY_REVERSAL" ? { gocSoCu: true } : {}) })),
    },
  };
  await chayTrongKhoa(client, { khoaKhoan: [p.id], kyCutoverDaDoc: bc.kyCutover }, async (h) => {
    await ghiHangCho(h.tx, hold, bc.now);
  });
  return { loai: "RUT_TIEN", slotId: dau.calcSlotId };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// KHOẢN THU (THU)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export type DanhTinh = {
  users: ReadonlyMap<string, { name: string; employeeId: string | null }>;
  /** Đối tác (AffiliateParty) → tên hiển thị + cá nhân / tổ chức LÚC TÍNH (AFF-L2, D-B). */
  affiliates: ReadonlyMap<string, { name: string; partyKind: "PERSON" | "ORGANIZATION" }>;
};

/**
 * ĐIỀU CHỈNH TĂNG (`adjustPayment` delta DƯƠNG, 04 §11.2): ô MỚI của delta CHÉP rule/tỉ lệ/người hưởng từ ô GỐC thay vì tra lại chính sách hôm nay — đây là
 * SỬA SỐ của chính lần thu ấy, không phải lần thu mới. Sale/QC/chính sách đã đổi từ lúc thu gốc thì delta VẪN theo người đã nhận phần gốc.
 */
export type ChepTuO = {
  slotGocId: string;
  /** Trạng thái ô gốc (Σ ròng theo người, cơ sở còn lại…) — tỉ lệ TIỀN của chính từng người = `rong / coSoConLai`. */
  o: OCoDong;
  /** Dòng ĐẦU TIÊN của từng người trong ô gốc (mẫu snapshot). */
  dongGoc: ReadonlyMap<KhoaNguoi, CommissionTransaction>;
};

export type KeHoachThu = {
  p: KhoanNap;
  kyTuNhien: string;
  co: CoSo;
  moc: ReturnType<typeof mocCuaButToan>;
  orderItemId: string | null;
  cachTach: string;
  studentId: string;
  loaiGiaoDich: "NEW" | "RENEWAL";
  stId: string | null;
  st: StGhi | null;
  nguon: NguonChoHoaHong | null;
  nguonChinhSach: NguonCuaKhoan;
  /** Campaign · thành viên · referral Affiliate của khoản (AFF-P2) — `null` = không đến từ link Affiliate. BẮT BUỘC (luật 7). */
  affiliate: AffiliateChoHoaHong | null;
  /** Campaign còn BẢO VỆ referral vào ngày sự kiện không (AFF-L2, D-A) — chỉ để GIẢI THÍCH trên dòng sổ; quyết định thoát cửa sổ nằm ở `tinhDongChoKhoan`. BẮT BUỘC (luật 7). */
  baoVe: KetQuaBaoVe;
  /** Chuỗi liên kết campaign hợp lệ vào ngày sự kiện (chưa xét hạn bảo vệ) — so bóng đọc. BẮT BUỘC (luật 7). */
  lienKet: KetQuaLienKet;
  vat: { grossAmount: number; vatRate: number; netBase: number };
  nguoiHuong: ReadonlyMap<string, KetQuaNguoiHuong>;
  roleDefIds: ReadonlyMap<string, readonly string[]>;
  ngoaiCuaSo: boolean;
  /** Cửa sổ ghi công HIỆU LỰC (nguồn riêng ?? setting) — để ảnh chụp ứng viên ghi đúng số đã dùng. */
  cuaSoNgay: number;
  /** Ba số đã quyết `ngoaiCuaSo` (ngày quy nguồn · ngày thu đầu · cửa sổ) — cho giải thích «vì sao 0đ» (`giai-thich-db.ts`). `null` = không có phép đo cửa sổ nào chạy. BẮT BUỘC. */
  cuaSo: CuaSoGhiCong | null;
  daTraBangEngineCu: ReadonlySet<string>;
  dauVao: (coSo: number) => DauVaoKhoan;
  /** `null` = khoản thu thường. Có giá trị ⇒ delta dương của `adjustPayment` mà gốc ĐÃ có ô: chép từ ô gốc (04 §11.2). */
  chepTu: ChepTuO | null;
};

export type LapThu =
  | { loai: "BO_QUA"; lyDo: LyDoBoQua }
  | { loai: "GIU"; holds: HoldNhap[]; st: StGhi | null; co: CoSo | null }
  | { loai: "TINH"; kh: KeHoachThu };

async function quetThu(client: PrismaClient, bc: BoiCanhQuet, p: KhoanNap, che: CheDoQuet): Promise<KetQuaQuetKhoan> {
  const lap = await lapThu(client, bc, p);
  if (lap.loai === "BO_QUA") {
    // Khoản ngoài phạm vi / không phải chủ: vẫn đóng hàng chờ cũ của nó (vd ghi danh đổi loại dòng).
    await chayTrongKhoa(client, { khoaKhoan: [p.id], kyCutoverDaDoc: bc.kyCutover }, async (h) => {
      await dongHangChoDaHetCan(h.tx, p.id, new Set(), bc.now);
    });
    return lap;
  }
  if (lap.loai === "GIU") return chiHangCho(client, bc, p, lap.holds, lap.st, lap.co);

  const kh = lap.kh;
  const slots = await client.commissionCalcSlot.findMany({ where: { paymentId: p.id }, orderBy: { createdAt: "asc" } });
  return slots.length === 0 ? ghiMoiThu(client, bc, kh) : soVoiOThu(client, bc, kh, slots[0]!.id, che);
}

export async function lapThu(client: PrismaClient, bc: BoiCanhQuet, p: KhoanNap): Promise<LapThu> {
  const order = p.order;
  const moc = mocCuaButToan(hangButToanCua(p));
  const kyTuNhien = kyTuNhienCua(moc.paidDate);

  // 1 — chủ sở hữu: engine CŨ hay MỚI (L10). Cũ ⇒ không đụng; không quyết được ⇒ hàng chờ.
  const chu = chuSoHuuButToan({ id: p.id, paidDate: p.paidDate }, { kyCutover: bc.kyCutover, kyCu: await docKyCu(client, [kyTuNhien]) });
  if (chu === "CU") return { loai: "BO_QUA", lyDo: "KHONG_PHAI_CHU" };

  // 2 — đơn vị của GIAO DỊCH (cơ sở bút toán), không phải của nguồn / người hưởng (A5).
  const dv = await docCoSoCuaKhoan(client, p);
  if ("thieu" in dv) return { loai: "GIU", holds: [holdKhongCoDonVi(p, dv.thieu)], st: null, co: null };
  const co = dv.co;
  const cs = { centerId: co.centerId, orgUnitId: co.orgUnitId };

  if (typeof chu === "object") {
    return {
      loai: "GIU",
      st: null,
      co,
      holds: [{ ...cotHold(p, cs), holdKey: khoaHold.theoKhoan("MANUAL_REVIEW_REQUIRED", p.id, "CHU_SO_HUU"), code: "MANUAL_REVIEW_REQUIRED", detail: { lyDo: `Kỳ ${kyTuNhien} của sổ cũ đã duyệt mà không có manifest — không quyết được khoản này thuộc engine cũ hay mới (04 §3.1).` } }],
    };
  }

  // 3 — thành phần + học viên (04 §4.3–4.4). MỘT khoản ⇒ tối đa MỘT phần.
  const hocVienLC = await docHocVienTheoLeadChild(client, order.leadChildId);
  const khoanTruoc = await docKhoanTruoc(client, p);
  let dongGoi = p.orderItemId;
  if (!dongGoi && p.adjustmentOfId) {
    // ADJUSTMENT delta DƯƠNG không chép `orderItemId` (adjustPayment): lấy dòng theo Ô CỦA GỐC (04 §11.2) rồi mới tới cột của gốc.
    const slotGoc = await client.commissionCalcSlot.findFirst({ where: { paymentId: p.adjustmentOfId }, select: { orderItemKey: true } });
    dongGoi = slotGoc && slotGoc.orderItemKey !== "-" ? slotGoc.orderItemKey : (p.adjustmentOf?.orderItemId ?? null);
  }
  const pb: KetQuaPhanBo = phanBoKhoan({
    soTien: p.amount,
    orderItemId: dongGoi,
    enrollmentId: p.enrollmentId,
    enrollmentStudentId: p.enrollment?.studentId ?? null,
    orderType: order.type,
    dongDon: dongPhanBoCua(order),
    hocVienTheoLeadChild: hocVienLC,
    conNoTheoDong: conNoTuKhoanTruoc(p, hocVienLC, khoanTruoc),
  });
  if (pb.loai === "NGOAI_PHAM_VI") return { loai: "BO_QUA", lyDo: "NGOAI_PHAM_VI" };
  if (pb.loai === "GIU") {
    return {
      loai: "GIU",
      st: null,
      co,
      holds: [{ ...cotHold(p, cs), holdKey: khoaHold.theoKhoan(pb.ma, p.id), code: pb.ma, detail: { lyDo: pb.lyDo } }],
    };
  }

  // 4 — phân loại NEW / RENEWAL theo HỌC VIÊN, trên MỘT lần mua (một OrderItem học phí). Mọi đợt thu của cùng dòng dùng chung kết quả.
  if (pb.orderItemId === null) {
    return {
      loai: "GIU",
      st: null,
      co,
      holds: [{ ...cotHold(p, { ...cs, studentId: pb.studentId }), holdKey: khoaHold.theoKhoan("MANUAL_REVIEW_REQUIRED", p.id, "KHONG_CO_DONG_DON"), code: "MANUAL_REVIEW_REQUIRED", detail: { lyDo: "Khoản học phí không gắn dòng đơn nào — không có 'lần mua' để phân loại NEW/RENEWAL." } }],
    };
  }
  const chot = await chotPhanLoai(client, p, pb.orderItemId, pb.studentId);
  if (chot.loai === "BO_QUA") return { loai: "BO_QUA", lyDo: "NGOAI_PHAM_VI" };
  if (chot.loai === "GIU") {
    return {
      loai: "GIU",
      st: chot.st,
      co,
      holds: [{ ...cotHold(p, { ...cs, orderItemId: pb.orderItemId, studentId: pb.studentId }), holdKey: khoaHold.theoKhoan(chot.ma, p.id, chot.maLuat), code: chot.ma, detail: { lyDo: chot.lyDo, maLuat: chot.maLuat } }],
    };
  }

  // 5–8 — nguồn · người hưởng · cửa sổ ghi công · GV Trial đã trả bằng engine cũ: MỘT hàm dùng chung với "dự kiến của bạn".
  const sv = await client.student.findUnique({ where: { id: pb.studentId }, select: { leadChildId: true } });
  const dongDon = order.items.find((d) => d.id === pb.orderItemId);
  const dau = await dungDauVaoChinhSach(client, bc, {
    leadId: order.leadId,
    leadChildId: order.leadChildId ?? sv?.leadChildId ?? null,
    studentId: pb.studentId,
    enrollmentId: dongDon?.enrollmentId ?? p.enrollmentId,
    centerId: co.centerId,
    orgUnitPath: co.path,
    rateDate: moc.rateDate,
    assigneeDate: moc.assigneeDate,
    loaiGiaoDich: chot.loai,
    ngayThuDau: () => docNgayThuDau(client, p, pb.orderItemId),
    laKhoanDauLanMua: await laKhoanDauCuaLanMuaNay(client, bc, p, pb.orderItemId, hocVienLC, khoanTruoc),
  });

  // 5b — [21/10/2026, chủ dự án chốt] lead legacy «Import Excel»: nhãn đó là PHƯƠNG THỨC NHẬP, không phải nguồn khách ⇒ di trú ghi UNKNOWN + xem tay (`LEGACY_IMPORT_SOURCE_UNKNOWN`).
  // Nguồn UNKNOWN mà để engine tự tính sẽ đi đường «mức thấp nhất giữa các nhóm» và vẫn có thể ra tiền ở thành phần dùng rule chung — chủ dự án nói rõ: KHÔNG tạo hoa hồng từ các lead này cho tới khi
  // người xử lý tay. ⇒ giữ nguyên CẢ KHOẢN ở hàng chờ cứng `MANUAL_REVIEW_REQUIRED` (nhìn thấy, chặn khoá kỳ chứa khoản), không sinh dòng sổ. Người xử lý tay = đổi nguồn lead (gỡ lý do khỏi signals)
  // ⇒ lượt quét sau tự đóng hàng chờ và tính bình thường. Dùng lại mã hold có sẵn (không thêm giá trị enum/CHECK); `maLuat` phân biệt ca này khi lọc.
  if (dau.nguon?.legacyImportChuaXuLy) {
    return {
      loai: "GIU",
      st: chot.st,
      co,
      holds: [
        {
          ...cotHold(p, { ...cs, orderItemId: pb.orderItemId, studentId: pb.studentId }),
          holdKey: khoaHold.theoKhoan("MANUAL_REVIEW_REQUIRED", p.id, "NGUON_LEGACY_IMPORT_CHUA_XU_LY"),
          code: "MANUAL_REVIEW_REQUIRED",
          detail: {
            lyDo: "Lead nhập từ file Excel cũ (nhãn «Import Excel» là phương thức nhập, không phải nguồn khách): chưa rõ khách đến từ đâu nên CHƯA tính hoa hồng. Chọn nguồn cho lead (Đổi nguồn) để mở khoản này.",
            maLuat: "NGUON_LEGACY_IMPORT_CHUA_XU_LY",
          },
        },
      ],
    };
  }

  // 9 — VAT theo NGÀY GỐC (D15). Dòng sổ CHỤP `vatRate`; khoản hoàn dùng VAT của dòng gốc, không tra lại.
  const vat = tachVat(p.amount, vatHieuLuc(bc.hoaHong.vatTheoNgay, ngayVN(moc.rateDate)));

  // 10 — điều chỉnh TĂNG mà gốc đã có ô ⇒ chép từ ô gốc (04 §11.2). Gốc chưa có ô (không sinh dòng / ngoài phạm vi) ⇒ chạy pipeline như khoản thu thường.
  const chepTu = p.adjustmentOfId && p.amount > 0 ? await docChepTuO(client, p.adjustmentOfId, pb.orderItemId) : null;

  return {
    loai: "TINH",
    kh: {
      p,
      kyTuNhien,
      co,
      moc,
      orderItemId: pb.orderItemId,
      cachTach: pb.cachTach,
      studentId: pb.studentId,
      loaiGiaoDich: chot.loai,
      stId: chot.stId,
      st: chot.st,
      nguon: dau.nguon,
      nguonChinhSach: dau.nguonChinhSach,
      affiliate: dau.affiliate,
      baoVe: dau.baoVe,
      lienKet: dau.lienKet,
      vat,
      nguoiHuong: dau.nguoiHuong,
      roleDefIds: dau.roleDefIds,
      ngoaiCuaSo: dau.ngoaiCuaSo,
      cuaSoNgay: dau.cuaSoNgay,
      cuaSo: dau.cuaSo,
      daTraBangEngineCu: dau.daTraBangEngineCu,
      // `coSoGoc` = cơ sở GỐC của khoản (`netBase`); các đường tính lại trên cơ sở CÒN LẠI của ô (`kh.dauVao(o.coSoConLai)`) vẫn đo FIXED so với cơ sở gốc này (AFF-L2b).
      dauVao: (coSo: number) => dau.dauVao(coSo, vat.netBase),
      chepTu,
    },
  };
}

/**
 * Khoản `p` có phải khoản thu ĐẦU của lần mua không (AFF-L2b) — chỉ để quyết rule `FIXED_PER_PURCHASE`; PERCENT không đọc. Thứ tự `(paidDate, id)` trên TẬP KHOẢN CHUNG của lần mua (`laKhoanDauCuaLanMua`),
 * cộng một lớp SỔ CÁI (`laKhoanDauSauSoCai`) để khoản đến TRỄ không làm tiền cố định bị trả hai lần. Lớp sổ cái chỉ tra khi bộ quy tắc đang nạp có rule FIXED: ai không dùng FIXED không phát sinh thêm câu tra nào.
 */
async function laKhoanDauCuaLanMuaNay(client: PrismaClient, bc: BoiCanhQuet, p: KhoanNap, orderItemId: string, hocVienLC: string | null, khoanTruoc: Awaited<ReturnType<typeof docKhoanTruoc>>): Promise<boolean> {
  const order = p.order;
  const thuan = laKhoanDauCuaLanMua({
    adjustmentOfId: p.adjustmentOfId,
    orderItemId,
    dong: dongNoCua(order),
    khoanTruoc: khoanTruoc.filter((t) => t.adjustmentOfId === null).map(khoanTruocCuaNap),
    orderType: order.type,
    hocVienTheoLeadChild: hocVienLC,
  });
  if (!bc.hoaHong.quyTac.some((q) => q.kieuTinh === "FIXED_PER_PURCHASE")) return thuan;
  return laKhoanDauSauSoCai(thuan, p.id, await docChuFixedTrongSo(client, orderItemId));
}

/** Ô GỐC của một điều chỉnh tăng + dòng mẫu của từng người. `null` khi gốc chưa có ô nào mang dòng. */
async function docChepTuO(client: PrismaClient, gocPaymentId: string, orderItemId: string | null): Promise<ChepTuO | null> {
  const slot = await client.commissionCalcSlot.findFirst({
    where: { paymentId: gocPaymentId, orderItemKey: orderItemId ?? "-" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (!slot) return null;
  const o = (await docTrangThaiO(client, [slot.id])).get(slot.id);
  if (!o || o.dongGoc.size === 0) return null;
  const rows = await client.commissionTransaction.findMany({ where: { id: { in: [...o.dongGoc.values()] } } });
  const theoId = new Map(rows.map((x) => [x.id, x]));
  const dongGoc = new Map<KhoaNguoi, CommissionTransaction>();
  for (const [key, id] of o.dongGoc) {
    const row = theoId.get(id);
    if (row) dongGoc.set(key, row);
  }
  return { slotGocId: slot.id, o, dongGoc };
}

/** `round(a × b / c)` bằng số nguyên (nửa lên), `a ≥ 0, b ≥ 0, c > 0`. */
function nhanChia(a: number, b: number, c: number): number {
  return Number((BigInt(a) * BigInt(b) * BigInt(2) + BigInt(c)) / (BigInt(2) * BigInt(c)));
}

/**
 * Dòng của ô MỚI trong ĐIỀU CHỈNH TĂNG: mỗi người còn số ròng > 0 ở ô gốc nhận `round(ròng × netBaseDelta / cơ sở còn lại của ô gốc)` — tỉ lệ TIỀN của chính họ
 * (khuôn L8), không nhân lại `rate` của cả vai. Dòng `FIXED_PER_PURCHASE` bị bỏ: tiền cố định theo LẦN MUA, không theo số tiền thu.
 */
function dongChepTuO(kh: KeHoachThu, chep: ChepTuO, n: { slotId: string; periodId: string; lateArrival: boolean; entryKind: CommissionEntryKind; hash: string; studentTransactionId: string | null }): DongGhi[] {
  const { p } = kh;
  const rows: DongGhi[] = [];
  for (const [key, rong] of [...chep.o.rong.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (rong <= 0) continue;
    const g = chep.dongGoc.get(key);
    if (!g || g.calcKind === "FIXED_PER_PURCHASE") continue;
    const co = chep.o.coSoConLai > 0 ? chep.o.coSoConLai : g.netBase;
    if (co <= 0) continue;
    const amount = nhanChia(rong, kh.vat.netBase, co);
    if (amount <= 0) continue;
    const t = tachKhoaNguoi(key);
    rows.push(
      saoTuDongGoc(g, {
        idempotencyKey: khoaOriginal({ paymentId: p.id, orderItemKey: kh.orderItemId ?? "-", thanhPhan: "TUITION", roleCode: t.roleCode, kind: t.kind, beneficiaryId: t.beneficiaryId }),
        entryKind: n.entryKind,
        calcSlotId: n.slotId,
        periodId: n.periodId,
        naturalPeriod: kh.kyTuNhien,
        lateArrival: n.lateArrival,
        paymentId: p.id,
        amount,
        reason: `Điều chỉnh TĂNG ${p.amount}đ của khoản ${p.adjustmentOfId}: sao rule, tỉ lệ và người hưởng từ ô của khoản gốc (04 §11.2) — sửa số của chính lần thu ấy, không tra lại chính sách hôm nay.`,
        reasonCode: "DIEU_CHINH_TANG",
        grossAmount: kh.vat.grossAmount,
        netBase: kh.vat.netBase,
        inputHash: n.hash,
        refEntryId: null, // CHECK `loai_dong_chk`: ORIGINAL / LATE_ARRIVAL không mang `refEntryId` — tham chiếu gốc đi theo `refEvent*`
        refEventType: "PAYMENT",
        refEventId: p.adjustmentOfId,
      }),
    );
  }
  return rows;
}

// ── Phân loại (lưu ở StudentTransaction) ─────────────────────────────────────────────────────

type ChotPL =
  | { loai: "BO_QUA" }
  | { loai: "GIU"; ma: "MANUAL_REVIEW_REQUIRED" | "PENDING_REGULATION"; maLuat: string; lyDo: string; st: StGhi | null }
  | { loai: "NEW" | "RENEWAL"; stId: string | null; st: StGhi | null };

async function chotPhanLoai(client: PrismaClient, p: KhoanNap, orderItemId: string, studentId: string): Promise<ChotPL> {
  const cu = await client.studentTransaction.findUnique({ where: { orderItemId } });
  // "Mọi đợt thu của cùng dòng dùng chung kết quả" (HĐ 3 đợt = NEW ×3): dòng đã CLASSIFIED, hoặc đã có người quyết tay, thì GIỮ.
  if (cu && (cu.status === "CLASSIFIED" || cu.decidedById !== null)) {
    if (cu.status === "CLASSIFIED" && (cu.transactionTypeCode === "NEW" || cu.transactionTypeCode === "RENEWAL")) {
      return { loai: cu.transactionTypeCode, stId: cu.id, st: null };
    }
    const ma = cu.status === "PENDING_REGULATION" ? "PENDING_REGULATION" : "MANUAL_REVIEW_REQUIRED";
    return { loai: "GIU", ma, maLuat: cu.reasonCode, lyDo: `Đã có quyết định phân loại: ${cu.status} (${cu.reasonCode}).`, st: null };
  }
  // Luật v2: KHÔNG truyền ngày thu của khoản đang quét — phân loại là hàm của thứ tự mua + τ của ĐƠN (tự tính trong bộ nạp).
  const kq: KetQuaPhanLoai | null = await phanLoaiDongDon(client, { orderItemId });
  if (!kq) return { loai: "BO_QUA" };
  if (kq.trangThai === "NGOAI_PHAM_VI") return { loai: "BO_QUA" };
  const order = p.order;
  const st: StGhi = {
    orderItemId,
    orderId: p.orderId,
    studentId,
    status: kq.trangThai,
    transactionTypeCode: kq.trangThai === "CLASSIFIED" ? (kq.loai as "NEW" | "RENEWAL") : null,
    reasonCode: kq.maLuat,
    evidence: kq.bangChung as unknown as Prisma.InputJsonValue,
    centerId: order.centerId,
    orgUnitId: order.orgUnitId,
    suaId: cu?.id ?? null,
  };
  if (kq.trangThai === "CLASSIFIED") return { loai: kq.loai as "NEW" | "RENEWAL", stId: cu?.id ?? null, st };
  return { loai: "GIU", ma: kq.trangThai, maLuat: kq.maLuat, lyDo: kq.lyDo, st };
}

// ── Dựng dòng sổ từ kết quả tính ─────────────────────────────────────────────────────────────

export async function docDanhTinh(client: Khach, kq: Extract<KetQuaTinhKhoan, { loai: "OK" }>): Promise<DanhTinh> {
  const uIds = new Set<string>();
  const aIds = new Set<string>();
  for (const d of kq.dong) (d.beneficiaryKind === "USER" ? uIds : aIds).add(d.beneficiaryId);
  const [us, as] = await Promise.all([
    uIds.size ? client.user.findMany({ where: { id: { in: [...uIds] } }, select: { id: true, name: true, email: true, employeeId: true } }) : [],
    aIds.size ? client.affiliate.findMany({ where: { id: { in: [...aIds] } }, select: { id: true, name: true, partyKind: true } }) : [],
  ]);
  return {
    users: new Map(us.map((u) => [u.id, { name: u.name ?? u.email ?? u.id, employeeId: u.employeeId }])),
    affiliates: new Map(as.map((a) => [a.id, { name: a.name, partyKind: a.partyKind }])),
  };
}

/** Dấu vân tay đầu vào đã DÙNG (04 §10.4): số tiền, học viên, loại, nguồn, người hưởng, rule/version thắng, trần, cờ tư cách. */
export function hashCuaKetQua(kh: KeHoachThu, bc: BoiCanhQuet, coSo: number, kq: KetQuaTinhKhoan): string {
  const chung = {
    gross: kh.vat.grossAmount,
    vatRate: kh.vat.vatRate,
    coSo,
    loai: kh.loaiGiaoDich,
    studentId: kh.studentId,
    dong: kh.orderItemId ?? "-",
    // `camp` CHỈ có mặt khi khác null (`undefined` bị `chuanHoa` bỏ): khoản không đến từ campaign Affiliate băm Y HỆT trước AFF-P2 — ô đã khớp không thành "drift" vì một chiều nó chưa từng có.
    nguon: { nhom: kh.nguonChinhSach.sourceGroupId, aff: kh.nguonChinhSach.affiliateId, attribution: kh.nguon?.attributionId ?? null, camp: kh.nguonChinhSach.campaignId ?? undefined },
    tran: bc.hoaHong.tranTongTiLe,
    thuTu: bc.hoaHong.phienBanThuTu,
    ngoaiCuaSo: kh.ngoaiCuaSo,
    daTra: [...kh.daTraBangEngineCu].sort(),
  };
  if (kq.loai !== "OK") return bamDauVao({ ...chung, loi: kq.loai, tiLe: kq.loai === "VUOT_TRAN" ? kq.tiLeTuongDuong : null });
  return bamDauVao({
    ...chung,
    // AFF-L2 (D-A): KHÔNG cần khoá riêng cho «vai thoát cửa sổ nguồn». Thoát ⇒ vai đổi từ TREO sang SINH_DONG nên `vai[].tt` + `phan` ở dưới ĐÃ đổi băm; thêm một khoá là bản thứ hai của cùng một sự thật
    // (phép cấy bỏ nó không làm ca nào đỏ — xem docs/source-commission/closeout/l2-engine.md §8). Khoản không dính campaign băm Y HỆT trước AFF-L2.
    vai: kq.cacVai.map((v) => ({
      role: v.roleCode,
      tt: v.trangThai,
      rule: v.quyTac ? [v.quyTac.ruleId, v.quyTac.versionId, v.quyTac.giaTri] : null,
      nguoi: v.nguoi.map((n) => `${n.kind}:${n.id}`).sort(),
      treo: v.lyDoTreo,
      phan: v.cacPhan.map((x) => [x.recipientId, x.amount]),
    })),
  });
}

const keyDong = (d: { roleCode: string; beneficiaryKind: "USER" | "AFFILIATE"; beneficiaryId: string }): KhoaNguoi => khoaNguoi(d.roleCode, d.beneficiaryKind, d.beneficiaryId);

export function kyVongCua(kq: Extract<KetQuaTinhKhoan, { loai: "OK" }>): Map<KhoaNguoi, number> {
  const m = new Map<KhoaNguoi, number>();
  for (const d of kq.dong) m.set(keyDong(d), (m.get(keyDong(d)) ?? 0) + d.amount);
  return m;
}

const jsonHoacNull = (v: Prisma.JsonValue | null | undefined): Prisma.InputJsonValue | typeof Prisma.JsonNull => (v === null || v === undefined ? Prisma.JsonNull : (v as Prisma.InputJsonValue));

function holdCuaKetQuaLoi(kh: KeHoachThu, kq: Exclude<KetQuaTinhKhoan, { loai: "OK" }>, cs: Pick<CoSo, "centerId" | "orgUnitId">, kyId: string | null): HoldNhap {
  const base = cotHold(kh.p, { ...cs, orderItemId: kh.orderItemId, studentId: kh.studentId, blockingPeriodId: kyId });
  if (kq.loai === "VUOT_TRAN") {
    return {
      ...base,
      holdKey: khoaHold.theoKhoan("CAP_EXCEEDED", kh.p.id),
      code: "CAP_EXCEEDED",
      detail: { lyDo: "Tổng tỉ lệ các rule thắng vượt trần — lỗi cấu hình, KHÔNG ghi dòng nào cho khoản này và KHÔNG tự cắt vai nào (D1).", tiLeTuongDuong: kq.tiLeTuongDuong, tran: kq.tran, quyTacThang: kq.quyTacThang },
    };
  }
  return { ...base, holdKey: khoaHold.theoKhoan("POLICY_OVERLAP", kh.p.id, kq.roleCode), code: "POLICY_OVERLAP", detail: { lyDo: kq.lyDo, vai: kq.roleCode } };
}

// ── Dựng dòng sổ (MỘT chỗ cho ORIGINAL / LATE_ARRIVAL / *_CORRECTION) ─────────────────────────────

type KqOk = Extract<KetQuaTinhKhoan, { loai: "OK" }>;

/** Phần CHUNG của mọi dòng dựng từ kết quả tính hôm nay (`tinhDongChoKhoan`). */
export type NenDongNhap = {
  kh: KeHoachThu;
  bc: BoiCanhQuet;
  kq: KqOk;
  danhTinh: DanhTinh;
  slotId: string;
  periodId: string;
  naturalPeriod: string;
  lateArrival: boolean;
  entryKind: CommissionEntryKind;
  reasonCode: string | null;
  /** Chữ in trước "vì sao rule thắng" ở cột `reason` (dòng điều chỉnh nói vì sao nó tồn tại); `null` = chỉ lý do của rule. */
  lyDoThem: string | null;
  hash: string;
  studentTransactionId: string | null;
  /** Cơ sở tính chụp trên dòng: `netBase` của phần với ORIGINAL; `coSoConLai` với dòng điều chỉnh. */
  netBase: number;
  refEntryId: string | null;
  refEventType: string | null;
  refEventId: string | null;
};

/** Ba cột snapshot campaign Affiliate của MỘT khoản (cùng giá trị cho mọi dòng của khoản — campaign ảnh hưởng việc chọn rule của MỌI vai, không riêng vai AFFILIATE). */
function cotAffiliateCuaKeHoach(kh: Pick<KeHoachThu, "affiliate">): CotAffiliateSo {
  return {
    affiliateCampaignId: kh.affiliate?.campaignId ?? null,
    affiliateMembershipId: kh.affiliate?.membershipId ?? null,
    affiliateReferralId: kh.affiliate?.referralId ?? null,
  };
}

/**
 * Chi tiết "campaign / đối tác / tuyến / bậc quyết định nguồn" ghi vào `resolverBasis.affiliate` — KHÔNG PII (mã công khai + loại + id nội bộ). AFF-L2 (D-C) thêm:
 *   · `partyId` — đối tác đang giữ công LÚC TÍNH;
 *   · `campaign` — ẢNH CHỤP cấu hình campaign lúc tính (mô hình ghi nhận · cửa sổ cookie/bảo vệ · hiệu lực · `updatedAt`): sửa campaign về sau KHÔNG viết lại lịch sử, và KHÔNG vào `inputHash`;
 *   · `cuaSo` — cửa sổ nào đã quyết "còn đủ điều kiện" cho vai AFFILIATE và VÌ SAO (D-A), để ngăn «Vì sao con số này» nói đúng.
 */
function basisAffiliateCua(a: AffiliateChoHoaHong, cuaSo: Prisma.InputJsonValue | null): Prisma.InputJsonValue {
  return {
    campaignCode: a.campaignCode,
    tu: a.tu,
    tuNhan: a.tuNhan,
    typeCode: a.typeCode,
    partyKind: a.partyKind,
    parentPartyId: a.parentPartyId,
    partyId: a.partyId,
    campaign: {
      status: a.chup.status,
      attributionModel: a.chup.attributionModel,
      cookieWindowDays: a.chup.cookieWindowDays,
      protectWindowDays: a.chup.protectWindowDays,
      defaultSourceGroupId: a.chup.defaultSourceGroupId,
      effectiveFrom: a.chup.effectiveFrom?.toISOString() ?? null,
      effectiveTo: a.chup.effectiveTo?.toISOString() ?? null,
      updatedAt: a.chup.updatedAt.toISOString(),
    },
    cuaSo,
  } as Prisma.InputJsonValue;
}

/**
 * Cửa sổ nào ĐÃ áp cho MỘT dòng (D-A). Chỉ vai AFFILIATE được campaign bảo vệ mới có `ap: "BAO_VE_CAMPAIGN"`; mọi dòng khác của khoản mang `ap: "NGUON"` (cửa sổ nguồn vẫn là luật của chúng — hoặc không có phép đo nào).
 * `lyDo` là mã máy đọc được — màn hình dựng chữ từ đây, không in JSON thô.
 */
function cuaSoCuaDong(kh: KeHoachThu, kq: KqOk, roleCode: string, laVaiThuHut: boolean): Prisma.InputJsonValue | null {
  // Vai KHÔNG thu hút (Sale · QLCS · Marketing…) không chịu cửa sổ ghi công nào — nói gì về cửa sổ ở dòng của chúng là nói về thứ không áp dụng (luật 12).
  if (!laVaiThuHut) return null;
  const nguon = kh.cuaSo
    ? { cuaSoNguonNgay: kh.cuaSo.cuaSoNgay, ngayQuyNguon: kh.cuaSo.attributedAt.toISOString(), ngayThuDau: kh.cuaSo.ngayThuDau.toISOString(), ngoaiCuaSoNguon: kh.ngoaiCuaSo }
    : { cuaSoNguonNgay: kh.cuaSoNgay, ngoaiCuaSoNguon: kh.ngoaiCuaSo };
  const baoVeDen = kh.baoVe.baoVe ? kh.baoVe.baoVeDen.toISOString() : null;
  if (kq.mienCuaSoNguon.includes(roleCode)) {
    return { ap: "BAO_VE_CAMPAIGN", lyDo: "MIEN_CUA_SO_NGUON", baoVeDen, ...nguon } as Prisma.InputJsonValue;
  }
  return {
    ap: "NGUON",
    lyDo: kh.baoVe.baoVe ? (kh.ngoaiCuaSo ? "CHINH_SACH_DUNG_CUA_SO_NGUON_HOAC_KHONG_PHAI_CAMPAIGN" : "TRONG_CUA_SO_NGUON") : kh.baoVe.lyDo,
    baoVeDen,
    ...nguon,
  } as Prisma.InputJsonValue;
}

/** Một `DongNhap` → dòng sổ. `amount` truyền riêng: dòng điều chỉnh mang CHÊNH LỆCH chứ không phải `d.amount`. */
function dongTuNhap(n: NenDongNhap, d: DongNhap, idempotencyKey: string, amount: number): DongGhi {
  const { kh, bc, kq, danhTinh } = n;
  const p = kh.p;
  const nguoi = d.beneficiaryKind === "USER" ? danhTinh.users.get(d.beneficiaryId) : null;
  const doiTac = d.beneficiaryKind === "AFFILIATE" ? danhTinh.affiliates.get(d.beneficiaryId) : undefined;
  const q = d.quyTac;
  return {
    idempotencyKey,
    entryKind: n.entryKind,
    calcSlotId: n.slotId,
    periodId: n.periodId,
    naturalPeriod: n.naturalPeriod,
    lateArrival: n.lateArrival,
    rateDate: kh.moc.rateDate,
    assigneeDate: kh.moc.assigneeDate,
    paymentId: p.id,
    orderId: p.orderId,
    orderItemId: kh.orderItemId,
    studentId: kh.studentId,
    leadId: p.order.leadId,
    studentTransactionId: n.studentTransactionId,
    transactionTypeCode: kh.loaiGiaoDich,
    revenueComponent: "TUITION",
    splitMethod: kh.cachTach,
    attributionId: kh.nguon?.attributionId ?? null,
    sourceGroupId: kh.nguonChinhSach.sourceGroupId ?? bc.nhomUnknown.id,
    sourceGroupCode: kh.nguonChinhSach.sourceGroupId === null ? bc.nhomUnknown.code : (kh.nguon?.groupCode ?? bc.nhomUnknown.code),
    sourceId: null,
    ...cotAffiliateCuaKeHoach(kh),
    beneficiaryRoleId: bc.idVai.get(d.roleCode)!,
    roleCode: d.roleCode,
    beneficiaryKind: d.beneficiaryKind,
    beneficiaryUserId: d.beneficiaryKind === "USER" ? d.beneficiaryId : null,
    beneficiaryAffiliateId: d.beneficiaryKind === "AFFILIATE" ? d.beneficiaryId : null,
    beneficiaryEmployeeId: nguoi?.employeeId ?? null,
    beneficiaryName: (d.beneficiaryKind === "USER" ? nguoi?.name : doiTac?.name) ?? d.beneficiaryId,
    // AFF-L2 (D-B): cá nhân / TỔ CHỨC lúc ghi. Tổ chức là người hưởng hợp lệ — KHÔNG chuyển sang người đại diện; `ghiDong` đặt dòng của tổ chức ở `ON_HOLD`.
    beneficiaryType: d.beneficiaryKind === "USER" ? "PERSON" : (doiTac?.partyKind ?? null),
    resolverType: bc.hoaHong.vaiHuong.find((v) => v.code === d.roleCode)!.resolverType,
    // ẢNH CHỤP LÚC RESOLVE (hướng B+C): sổ cũ chỉ ghi `canCu`. Nay ghi thêm "lúc đó chủ nguồn là ai, theo căn cứ nào, ở ngày sự kiện nào, bản chính sách nào, resolve lúc nào"
    // — để lịch sử tiền đọc lại được mà KHÔNG phải tra nguồn sống / lịch sử hiện tại. `saoTuDongGoc` chép nguyên khối này sang dòng đảo / điều chỉnh.
    resolverBasis: {
      canCu: d.canCu,
      sourceOwnerEmployeeId: kh.nguon?.nguonChuEmployeeId ?? null,
      nguonChuGoc: kh.nguon?.nguonGocChup ?? null,
      nguonChuKhoangId: kh.nguon?.nguonChuKhoangId ?? null,
      ngaySuKien: kh.nguon?.ngaySuKien.toISOString() ?? null,
      attributionId: kh.nguon?.attributionId ?? null,
      policyVersionNo: q.version,
      resolvedAt: bc.now.toISOString(),
      ...(kh.affiliate ? { affiliate: basisAffiliateCua(kh.affiliate, cuaSoCuaDong(kh, kq, d.roleCode, bc.hoaHong.vaiHuong.some((v) => v.code === d.roleCode && v.isAcquisition))) } : {}),
    } as Prisma.InputJsonValue,
    policyId: q.policyId,
    policyVersionId: q.versionId,
    versionNo: q.version,
    ruleId: q.ruleId,
    documentNumber: q.documentNumber,
    calcKind: q.kieuTinh,
    scopeOrderVersion: bc.hoaHong.phienBanThuTu,
    reason: n.lyDoThem ? `${n.lyDoThem} · ${d.lyDo}` : d.lyDo,
    reasonCode: n.reasonCode,
    candidates: { cuaSoNgay: kh.cuaSoNgay, ngoaiCuaSo: kh.ngoaiCuaSo, nguonKhongRo: d.nguonKhongRo, tienVai: d.tienVai, cachTach: kh.cachTach } as Prisma.InputJsonValue,
    grossAmount: kh.vat.grossAmount,
    vatRate: new Prisma.Decimal(String(kh.vat.vatRate)),
    netBase: n.netBase,
    rate: q.kieuTinh === "PERCENT" ? new Prisma.Decimal(String(q.giaTri)) : null,
    fixedAmount: q.kieuTinh === "FIXED_PER_PURCHASE" ? Number(q.giaTri) : null,
    amount,
    capRate: new Prisma.Decimal(String(bc.hoaHong.tranTongTiLe)),
    equivalentRate: new Prisma.Decimal(kq.tiLeTuongDuong.toFixed(6)),
    inputHash: n.hash,
    refEntryId: n.refEntryId,
    refEventType: n.refEventType,
    refEventId: n.refEventId,
    centerId: kh.co.centerId,
    orgUnitId: kh.co.orgUnitId,
  };
}

/** Phần của dòng mới KHÁC dòng gốc khi SAO CHÉP snapshot (người · vai · chính sách · rule · tỉ lệ) từ một dòng đã có. */
export type NenSaoDong = {
  idempotencyKey: string;
  entryKind: CommissionEntryKind;
  calcSlotId: string | null;
  periodId: string;
  naturalPeriod: string;
  lateArrival: boolean;
  paymentId: string | null;
  amount: number;
  reason: string;
  reasonCode: string;
  grossAmount: number;
  netBase: number;
  inputHash: string;
  refEntryId: string | null;
  refEventType: string | null;
  refEventId: string | null;
};

/**
 * Dòng mới SAO snapshot từ dòng `g` đã có — người hưởng, rate, version, vai CHÉP từ `g` (kể cả khi người đó đã nghỉ: đòi lại tiền của người ĐÃ nhận,
 * không tra chính sách hôm nay — L8). Dùng cho dòng ĐẢO (hoàn) và dòng điều chỉnh của người không còn nằm trong kỳ vọng.
 */
export function saoTuDongGoc(g: CommissionTransaction, n: NenSaoDong): DongGhi {
  return {
    idempotencyKey: n.idempotencyKey,
    entryKind: n.entryKind,
    calcSlotId: n.calcSlotId,
    periodId: n.periodId,
    naturalPeriod: n.naturalPeriod,
    lateArrival: n.lateArrival,
    rateDate: g.rateDate,
    assigneeDate: g.assigneeDate,
    paymentId: n.paymentId,
    orderId: g.orderId,
    orderItemId: g.orderItemId,
    studentId: g.studentId,
    leadId: g.leadId,
    studentTransactionId: g.studentTransactionId,
    transactionTypeCode: g.transactionTypeCode,
    revenueComponent: g.revenueComponent,
    splitMethod: g.splitMethod,
    attributionId: g.attributionId,
    sourceGroupId: g.sourceGroupId,
    sourceGroupCode: g.sourceGroupCode,
    sourceId: g.sourceId,
    // Bản chụp campaign Affiliate CHÉP từ dòng gốc (đảo / điều chỉnh / chép-từ-ô / khiếu nại): cùng khoản thu, cùng ngữ cảnh — không tra lại campaign hôm nay.
    affiliateCampaignId: g.affiliateCampaignId,
    affiliateMembershipId: g.affiliateMembershipId,
    affiliateReferralId: g.affiliateReferralId,
    beneficiaryRoleId: g.beneficiaryRoleId,
    roleCode: g.roleCode,
    beneficiaryKind: g.beneficiaryKind,
    beneficiaryUserId: g.beneficiaryUserId,
    beneficiaryAffiliateId: g.beneficiaryAffiliateId,
    beneficiaryEmployeeId: g.beneficiaryEmployeeId,
    beneficiaryName: g.beneficiaryName,
    // Loại người hưởng CHÉP từ dòng gốc (đảo / điều chỉnh): thu hồi của TỔ CHỨC cũng ON_HOLD (`ghiDong`) — không thì xuất chi đòi lại tiền chưa từng trả.
    beneficiaryType: g.beneficiaryType,
    resolverType: g.resolverType,
    resolverBasis: jsonHoacNull(g.resolverBasis),
    policyId: g.policyId,
    policyVersionId: g.policyVersionId,
    versionNo: g.versionNo,
    ruleId: g.ruleId,
    documentNumber: g.documentNumber,
    calcKind: g.calcKind,
    scopeOrderVersion: g.scopeOrderVersion,
    reason: n.reason,
    reasonCode: n.reasonCode,
    candidates: jsonHoacNull(null),
    grossAmount: n.grossAmount,
    vatRate: g.vatRate,
    netBase: n.netBase,
    rate: g.rate,
    fixedAmount: g.fixedAmount,
    amount: n.amount,
    capRate: g.capRate,
    equivalentRate: g.equivalentRate,
    inputHash: n.inputHash,
    refEntryId: n.refEntryId,
    refEventType: n.refEventType,
    refEventId: n.refEventId,
    centerId: g.centerId,
    orgUnitId: g.orgUnitId,
  };
}

// ── GHI CHÊNH LỆCH lên ô đã có (SOURCE_CORRECTION · INPUT_CORRECTION) ────────────────────────────

export type YeuCauChenhLech = {
  loai: "SOURCE_CORRECTION" | "INPUT_CORRECTION";
  refEventType: "ATTRIBUTION" | "HOLD";
  /** Khoá idempotency = (sự kiện × ô × người): MỘT dòng chênh lệch cho mỗi (sự kiện × ô × người) — 04 §10.3. */
  refEventId: string;
  /**
   * THẾ HỆ MỞ LẠI của hàng chờ nguồn (`docMocMoLaiCuoi`) — chỉ vào KHOÁ idempotency (`refEventTheoTheHe`), không vào cột `refEventId` của dòng. BẮT BUỘC (luật 7): `null` = "không có thế hệ" (SOURCE_CORRECTION
   * của đề xuất; đường trả lại số đã thu hồi cần chốt khoá cũ) — chọn `null` phải là một quyết định viết ra, không phải quên.
   */
  moLaiCuoiId: string | null;
  reasonCode: string;
  /** Vì sao dòng này tồn tại — người rà đọc ở cột `reason`. */
  lyDo: string;
  ky: KyDb;
  naturalPeriod: string;
  slotId: string;
  /** Cơ sở tính chụp trên dòng (`coSoConLai` của ô lúc tính). */
  netBase: number;
  chenh: readonly ChenhNguoi[];
  /** Id dòng ĐẦU TIÊN của từng người trong ô (`TrangThaiO.dongGoc`) — để tham chiếu `refEntryId` và làm mẫu khi người không còn trong kỳ vọng. */
  dongGoc: ReadonlyMap<KhoaNguoi, string>;
  /** Kết quả tính hôm nay: người còn trong kỳ vọng được dựng từ ĐÂY (rule/tỉ lệ MỚI). `null` = chỉ sao từ dòng cũ (đảo sạch / khôi phục). */
  mau: { kh: KeHoachThu; bc: BoiCanhQuet; kq: KqOk; danhTinh: DanhTinh; hash: string } | null;
  /** Mẫu riêng cho từng người (ưu tiên hơn `dongGoc`) — vd dòng REVERSAL cần khôi phục. */
  mauDong?: ReadonlyMap<KhoaNguoi, CommissionTransaction>;
  paymentId: string;
  grossAmount: number;
};

export type KetQuaChenhLech = { loai: "DA_GHI"; soDong: number; tong: number; khoa: string[] } | { loai: "TRUNG" };

/**
 * Ghi MỘT dòng chênh lệch cho mỗi người có `chenh ≠ 0` của ô, TRONG transaction đã khoá ô + kỳ (`h`). Chỗ gọi PHẢI đã `khoaO` và `khoaKyDeGhi([ky.id])`.
 *
 * ⚠️ Trả `TRUNG` (KHÔNG ghi gì) khi MỘT dòng nào đã có khoá idempotency: cùng sự kiện, cùng ô, cùng người đã được ghi mà ô vẫn lệch ⇒ đầu vào đổi LẦN NỮA
 * sau khi áp dụng. Ghi nửa chừng rồi cập nhật dấu "đã khớp" là nuốt chênh lệch còn lại — để người rà quyết (INPUT_DRIFT).
 */
export async function ghiChenhLech(h: CongGhi, y: YeuCauChenhLech): Promise<KetQuaChenhLech> {
  const cacKhoa = y.chenh.filter((c) => c.chenh !== 0).map((c) => ({ c, t: tachKhoaNguoi(c.key) }));
  if (cacKhoa.length === 0) return { loai: "DA_GHI", soDong: 0, tong: 0, khoa: [] };

  const idGoc = [...new Set([...y.dongGoc.values()])];
  const gocRows = new Map((idGoc.length ? await h.tx.commissionTransaction.findMany({ where: { id: { in: idGoc } } }) : []).map((x) => [x.id, x]));
  const lateArrival = y.ky.period !== y.naturalPeriod;

  const rows: DongGhi[] = cacKhoa.map(({ c, t }) => {
    const idempotencyKey = khoaDieuChinh({ loai: y.loai, refEventId: refEventTheoTheHe(y.refEventId, y.moLaiCuoiId), calcSlotId: y.slotId, roleCode: t.roleCode, kind: t.kind, beneficiaryId: t.beneficiaryId });
    const idGocNguoi = y.dongGoc.get(c.key) ?? null;
    const dMoi = y.mau?.kq.dong.find((d) => khoaNguoi(d.roleCode, d.beneficiaryKind, d.beneficiaryId) === c.key);
    if (y.mau && dMoi) {
      return dongTuNhap(
        {
          kh: y.mau.kh,
          bc: y.mau.bc,
          kq: y.mau.kq,
          danhTinh: y.mau.danhTinh,
          slotId: y.slotId,
          periodId: y.ky.id,
          naturalPeriod: y.naturalPeriod,
          lateArrival,
          entryKind: y.loai,
          reasonCode: y.reasonCode,
          lyDoThem: y.lyDo,
          hash: y.mau.hash,
          studentTransactionId: y.mau.kh.stId,
          netBase: y.netBase,
          refEntryId: idGocNguoi,
          refEventType: y.refEventType,
          refEventId: y.refEventId,
        },
        dMoi,
        idempotencyKey,
        c.chenh,
      );
    }
    const mau = y.mauDong?.get(c.key) ?? (idGocNguoi ? gocRows.get(idGocNguoi) : undefined);
    if (!mau) {
      throw new HoaHongError("KHONG_CO_MAU_DONG", `Ô ${y.slotId}: người ${c.key} có chênh ${c.chenh} nhưng không có dòng nào để sao snapshot — không đoán.`);
    }
    return saoTuDongGoc(mau, {
      idempotencyKey,
      entryKind: y.loai,
      calcSlotId: y.slotId,
      periodId: y.ky.id,
      naturalPeriod: y.naturalPeriod,
      lateArrival,
      paymentId: y.paymentId,
      amount: c.chenh,
      reason: y.lyDo,
      reasonCode: y.reasonCode,
      grossAmount: y.grossAmount,
      netBase: y.netBase,
      inputHash: y.mau?.hash ?? mau.inputHash,
      refEntryId: y.mauDong?.get(c.key)?.id ?? idGocNguoi,
      refEventType: y.refEventType,
      refEventId: y.refEventId,
    });
  });

  const daCo = await h.tx.commissionTransaction.findMany({ where: { idempotencyKey: { in: rows.map((r) => r.idempotencyKey) } }, select: { id: true }, take: 1 });
  if (daCo.length > 0) return { loai: "TRUNG" };
  await h.ghiDong(rows);
  return { loai: "DA_GHI", soDong: rows.length, tong: rows.reduce((s, r) => s + r.amount, 0), khoa: rows.map((r) => r.idempotencyKey) };
}

// ── TRẢ LẠI hoa hồng đã thu hồi bằng LEGACY_REVERSAL (khoản hoàn của sổ cũ bị bác) ──────────────

export type YeuCauKhoiPhucLegacy = {
  /** Hàng chờ `PAYMENT_WITHDRAWN` đang được giải — khoá idempotency = (hàng chờ × người). */
  refEventId: string;
  lyDo: string;
  ky: KyDb;
  naturalPeriod: string;
  khoan: { id: string; amount: number };
  /** Mọi dòng `LEGACY_REVERSAL` mang `paymentId` = khoản hoàn. */
  dongLegacy: readonly CommissionTransaction[];
};

/**
 * Trả lại ĐÚNG số `LEGACY_REVERSAL` đã thu hồi (từng người, snapshot CHÉP từ dòng đã thu hồi). CHECK `loai_dong_chk` cấm `LEGACY_REVERSAL` dương và `o_tinh_chk` đòi ô cho
 * mọi kind `*_CORRECTION` — LEGACY_REVERSAL không có ô — nên dòng trả lại mang kind `DISPUTE_ADJUSTMENT` (ô tuỳ chọn, số tiền không ràng buộc dấu) với `reasonCode`
 * `MA_KHOI_PHUC_HOAN_LEGACY`, tham chiếu dòng bị vô hiệu hoá (`refEntryId`) và hàng chờ (`refEvent*`). Không migration. Chỗ gọi PHẢI đã `khoaKyDeGhi([ky.id])`.
 */
export async function ghiKhoiPhucHoanLegacy(h: CongGhi, y: YeuCauKhoiPhucLegacy): Promise<KetQuaChenhLech> {
  const theoNguoi = new Map<KhoaNguoi, { mau: CommissionTransaction; tong: number }>();
  for (const d of y.dongLegacy) {
    const key = khoaNguoi(d.roleCode, d.beneficiaryKind, (d.beneficiaryKind === "USER" ? d.beneficiaryUserId : d.beneficiaryAffiliateId) ?? "-");
    const cu = theoNguoi.get(key);
    theoNguoi.set(key, { mau: cu?.mau ?? d, tong: (cu?.tong ?? 0) + d.amount });
  }
  const cac = [...theoNguoi.entries()].filter(([, v]) => v.tong !== 0).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (cac.length === 0) return { loai: "DA_GHI", soDong: 0, tong: 0, khoa: [] };

  const lateArrival = y.ky.period !== y.naturalPeriod;
  const rows: DongGhi[] = cac.map(([key, v]) => {
    const t = tachKhoaNguoi(key);
    return {
      ...saoTuDongGoc(v.mau, {
        idempotencyKey: khoaDieuChinh({ loai: "DISPUTE_ADJUSTMENT", refEventId: y.refEventId, calcSlotId: null, roleCode: t.roleCode, kind: t.kind, beneficiaryId: t.beneficiaryId }),
        entryKind: "DISPUTE_ADJUSTMENT",
        calcSlotId: null,
        periodId: y.ky.id,
        naturalPeriod: y.naturalPeriod,
        lateArrival,
        paymentId: y.khoan.id,
        amount: -v.tong,
        reason: y.lyDo,
        reasonCode: MA_KHOI_PHUC_HOAN_LEGACY,
        grossAmount: -y.khoan.amount,
        netBase: -v.mau.netBase,
        inputHash: v.mau.inputHash,
        refEntryId: v.mau.id,
        refEventType: "HOLD",
        refEventId: y.refEventId,
      }),
      legacyTier: v.mau.legacyTier,
    };
  });
  const daCo = await h.tx.commissionTransaction.findMany({ where: { idempotencyKey: { in: rows.map((r) => r.idempotencyKey) } }, select: { id: true }, take: 1 });
  if (daCo.length > 0) return { loai: "TRUNG" };
  await h.ghiDong(rows);
  return { loai: "DA_GHI", soDong: rows.length, tong: rows.reduce((s, r) => s + r.amount, 0), khoa: rows.map((r) => r.idempotencyKey) };
}

// ── GHI MỚI ──────────────────────────────────────────────────────────────────────────────────

async function ghiMoiThu(client: PrismaClient, bc: BoiCanhQuet, kh: KeHoachThu): Promise<KetQuaQuetKhoan> {
  const { p, co } = kh;
  const cs = { centerId: co.centerId, orgUnitId: co.orgUnitId };
  const kq = tinhDongChoKhoan(kh.dauVao(kh.vat.netBase));

  const ky = await kyChanCua(client, bc, kh.kyTuNhien, co);

  if (kq.loai !== "OK") {
    // Lỗi cấu hình (vượt trần / chồng lấn): 0 dòng, 0 ô — giải bằng sửa chính sách rồi Tính lại.
    return chiHangCho(client, bc, p, [holdCuaKetQuaLoi(kh, kq, cs, ky.id)], kh.st, co);
  }

  const danhTinh = await docDanhTinh(client, kq);
  const hash = hashCuaKetQua(kh, bc, kh.vat.netBase, kq);
  const lateArrival = ky.period !== kh.kyTuNhien;
  const updatedAtDaDoc = p.updatedAt.getTime();

  return chayTrongKhoa(client, { khoaKhoan: [p.id], kyCutoverDaDoc: bc.kyCutover }, async (h): Promise<KetQuaQuetKhoan> => {
    const tx = h.tx;
    await kiemKhoanVanNhuCu(h, p, updatedAtDaDoc);
    // Sau khoá, ô vẫn chưa có? (lượt khác có thể vừa ghi) — có rồi thì nạp lại và đi nhánh "so ô".
    if (await tx.commissionCalcSlot.findFirst({ where: { paymentId: p.id }, select: { id: true } })) {
      throw new HoaHongError("TRANG_THAI_DA_DOI", `Khoản ${p.id} vừa có ô tính ở lượt khác.`);
    }
    await h.khoaKyDeGhi([ky.id]);

    const stId = kh.st ? await luuStudentTransaction(tx, kh.st, bc.now) : kh.stId;
    // Số dòng ghi lần đầu của ô (`originalLineCount`): điều chỉnh tăng ⇒ số người còn ròng > 0 ở ô gốc; còn lại ⇒ số dòng của kết quả tính.
    const soDongDuKien = kh.chepTu
      ? dongChepTuO(kh, kh.chepTu, { slotId: "-", periodId: ky.id, lateArrival, entryKind: "ORIGINAL", hash, studentTransactionId: stId }).length
      : kq.dong.length;
    const ids = await h.taoO([
      { paymentId: p.id, orderItemKey: kh.orderItemId ?? "-", revenueComponent: "TUITION", netBase: kh.vat.netBase, firstInputHash: hash, originalLineCount: soDongDuKien, centerId: co.centerId, orgUnitId: co.orgUnitId },
    ]);
    if (!ids) throw new HoaHongError("TRANG_THAI_DA_DOI", `Ô của khoản ${p.id} vừa được lượt khác tạo.`);
    const slotId = [...ids.values()][0]!;

    const kind: CommissionEntryKind = lateArrival ? "LATE_ARRIVAL" : "ORIGINAL";
    const reasonCode = lateArrival ? (kh.kyTuNhien < bc.kyCutover ? "KY_TRUOC_MOC" : "KY_GOC_DA_DONG") : null;
    const nen: NenDongNhap = {
      kh,
      bc,
      kq,
      danhTinh,
      slotId,
      periodId: ky.id,
      naturalPeriod: kh.kyTuNhien,
      lateArrival,
      entryKind: kind,
      reasonCode,
      lyDoThem: null,
      hash,
      studentTransactionId: stId,
      netBase: kh.vat.netBase,
      refEntryId: null,
      // LATE_ARRIVAL (H22): tham chiếu GIAO DỊCH GỐC (chính khoản thu đến muộn) để người rà biết vì sao nó nằm ở kỳ khác kỳ hiệu lực.
      refEventType: lateArrival ? "PAYMENT" : null,
      refEventId: lateArrival ? p.id : null,
    };
    const rows: DongGhi[] = kh.chepTu
      ? dongChepTuO(kh, kh.chepTu, { slotId, periodId: ky.id, lateArrival, entryKind: kind, hash, studentTransactionId: stId })
      : kq.dong.map((d) =>
          dongTuNhap(nen, d, khoaOriginal({ paymentId: p.id, orderItemKey: kh.orderItemId ?? "-", thanhPhan: "TUITION", roleCode: d.roleCode, kind: d.beneficiaryKind, beneficiaryId: d.beneficiaryId }), d.amount),
        );
    const r = await h.ghiDong(rows);
    if (r.trung.length > 0) throw new HoaHongError("TRANG_THAI_DA_DOI", `Khoá idempotency đã có trước khi ô tồn tại (${r.trung[0]!.idempotencyKey}).`);

    // Hàng chờ treo (mềm, không chặn khoá kỳ) — người xuất hiện về sau ⇒ INPUT_DRIFT.
    const holds: HoldNhap[] = (kh.chepTu ? [] : kq.treo)
      .filter((t) => t.coHangCho)
      .map((t) => ({
        ...cotHold(p, { ...cs, orderItemId: kh.orderItemId, studentId: kh.studentId, calcSlotId: slotId }),
        holdKey: khoaHold.theoKhoan("UNRESOLVED", p.id, t.roleCode, t.recipientId ?? "-"),
        code: "UNRESOLVED_BENEFICIARY" as const,
        detail: { vai: t.roleCode, lyDo: t.lyDo, tienVai: t.tienVai, canCu: t.canCu, nguoiBiLoai: t.recipientId },
      }));
    for (const hold of holds) await ghiHangCho(tx, hold, bc.now);
    await dongHangChoDaHetCan(tx, p.id, new Set(holds.map((x) => x.holdKey)), bc.now);

    // «Vì sao 0đ» (Hướng G): vai thu hút ngoài cửa sổ ghi công không có dòng sổ và không có hàng chờ — giải thích ghi CÙNG giao dịch với ô (bảng chỉ-thêm, không phải sổ).
    await ghiGiaiThich(tx, { kh, bc, slotId, netBase: kh.vat.netBase, hash, hashDuocChapNhan: true, coDrift: false, rong: new Map() });
    if (!kh.chepTu) for (const vid of new Set(kq.dong.map((d) => d.quyTac.versionId))) await danhDauDaDung(tx, vid, bc.now);
    const tong = rows.reduce((s, d) => s + d.amount, 0);
    await writeAudit({
      actor: NGUOI_HE_THONG,
      module: MODULE_AUDIT,
      entityType: "CommissionCalcSlot",
      entityId: slotId,
      action: lateArrival ? "LATE_ARRIVAL" : "CALCULATE",
      newValues: { paymentId: p.id, soDong: rows.length, tong, kyGhi: ky.period, kyTuNhien: kh.kyTuNhien, inputHash: hash },
      reason: lateArrival ? `Khoản thu của kỳ ${kh.kyTuNhien} đến khi kỳ đó đã đóng/trước mốc cutover — ghi vào kỳ ${ky.period}, giữ kỳ hiệu lực (H22).` : undefined,
      orgUnitId: co.orgUnitId,
      tx,
    });
    return { loai: "DA_GHI", slotId, soDong: rows.length, tong, kyGhi: ky.period, lateArrival, treo: holds.length };
  });
}

// ── SO Ô (đã có ô — L13/L14) ─────────────────────────────────────────────────────────────────

/**
 * Ghi dấu "đã so ô lúc này" (+ băm đầu vào đã khớp). ĐƯỜNG DUY NHẤT cập nhật ô tính (lưới `[NHH-W5b]`): ô chỉ được đổi hai cột theo dõi; `netBase`/`firstInputHash`
 * là bất biến. `hash = null` ⇒ chỉ đặt `lastCheckedAt` (lượt so không đổi gì); có `hash` ⇒ đầu vào hôm nay được chấp nhận (đã ghi correction, hoặc chênh = 0).
 */
export async function danhDauOKhop(tx: Prisma.TransactionClient, slotId: string, now: Date, hash: string | null): Promise<void> {
  await tx.commissionCalcSlot.update({ where: { id: slotId }, data: { lastCheckedAt: now, ...(hash ? { lastMatchedHash: hash } : {}) } });
}

/**
 * Dấu vết "khoá lịch sử" của MỘT khoản: những `(vai, người)` mà bộ tính hôm nay CÓ THỂ không còn trả chỉ vì TRẠNG THÁI SỐNG của họ đã đổi sau lúc tính
 * (nghỉ việc · affiliate ngưng) hoặc vì cờ `commissionEnabled` của nguồn bị tắt. Dùng cho bất biến carry-forward (`kyVongSauLichSu`).
 *
 * Hai phần:
 *   · người bị loại vì NGHỈ / ngừng: lấy thẳng từ kết quả phân giải người hưởng (`biLoai`) — cả khi chỉ MỘT người của vai nghỉ lẫn khi cả vai nghỉ;
 *   · cờ nguồn tắt: ĐỐI CHỨNG — tính lại với cờ BẬT; ai được trả trong bản đối chứng mà vắng ở bản hôm nay thì vắng vì cờ. Không suy từ "lý do treo" vì khi cờ tắt
 *     vai chỉ đơn giản mất rule (không có trạng thái treo nào để đọc).
 * Người đổi vì NGHIỆP VỤ (đổi Sale, đổi nguồn, đổi phân công cơ sở) không bao giờ rơi vào đây ⇒ vẫn drift (đối chứng dương `[DRF-02]`).
 */
export function khoaLichSuCua(kh: KeHoachThu, coSo: number): Set<KhoaNguoi> {
  const ra = new Set<KhoaNguoi>();
  for (const [vai, nh] of kh.nguoiHuong) {
    const biLoai = nh.loai === "CO_NGUOI" ? nh.biLoai.map((b) => b.nguoi) : (nh.biLoai ?? []);
    for (const n of biLoai) ra.add(khoaNguoi(vai, n.kind, n.id));
  }
  if (kh.nguonChinhSach.sourceGroupId !== null && !kh.nguonChinhSach.coHoaHong) {
    const bat = tinhDongChoKhoan({ ...kh.dauVao(coSo), nguon: { ...kh.nguonChinhSach, coHoaHong: true } });
    if (bat.loai === "OK") for (const d of bat.dong) ra.add(keyDong(d));
  }
  return ra;
}

/** Hai gói giống nhau từng dòng (khoá · chênh · kỳ vọng · ròng) — "cái người duyệt đã thấy" so với "cái engine tính ra bây giờ". */
function goiGiongNhau(a: readonly GoiDong[], b: readonly ChenhNguoi[]): boolean {
  if (a.length !== b.length) return false;
  const theoKhoa = new Map(b.map((c) => [c.key, c]));
  return a.every((d) => {
    const c = theoKhoa.get(d.key);
    return !!c && c.chenh === d.chenh && c.kyVong === d.kyVong && c.rong === d.rong;
  });
}

async function soVoiOThu(client: PrismaClient, bc: BoiCanhQuet, kh: KeHoachThu, slotId: string, che: CheDoQuet): Promise<KetQuaQuetKhoan> {
  const { p, co } = kh;
  const cs = { centerId: co.centerId, orgUnitId: co.orgUnitId };
  const kyCh = await kyChanCua(client, bc, kh.kyTuNhien, co);
  // Kỳ GHI chênh lệch của đổi nguồn ĐÃ DUYỆT: kỳ tự nhiên của HÔM NAY (ngày duyệt), KHÔNG phải kỳ của khoản thu — kỳ của khoản thu có thể đã LOCKED/EXPORTED.
  // Bản thân việc dời sang kỳ OPEN là `kyGhiSo` (H22): kỳ hiệu lực giữ nguyên là tháng sự kiện, kỳ ghi sổ là kỳ mở.
  const kyDc = che.cheDo === "DOI_NGUON_CO_QUYEN" ? await kyChanCua(client, bc, kyTuNhienCua(bc.now), co) : null;
  const updatedAtDaDoc = p.updatedAt.getTime();

  return chayTrongKhoa(client, { khoaKhoan: [p.id], kyCutoverDaDoc: bc.kyCutover }, async (h): Promise<KetQuaQuetKhoan> => {
    const tx = h.tx;
    await kiemKhoanVanNhuCu(h, p, updatedAtDaDoc);
    await h.khoaO([slotId]);
    // L11: trạng thái ô nạp LẠI sau khoá rồi mới tính — cơ sở còn lại có thể đã đổi vì một khoản hoàn vừa ghi.
    const o = (await docTrangThaiO(tx, [slotId])).get(slotId);
    if (!o) throw new HoaHongError("TRANG_THAI_DA_DOI", `Ô ${slotId} biến mất.`);

    if (che.cheDo === "DOI_NGUON_CO_QUYEN") await che.duyet.kiemTruoc(h);

    // Ô đang có ĐỀ XUẤT ĐỔI NGUỒN MỞ ⇒ lượt quét thường và lượt lập đề xuất KHÔNG mở INPUT_DRIFT thứ hai (hai hàng chờ cho một việc = hai người cùng "áp dụng"
    // một khoản). Hàng chờ của đề xuất đứng nguyên (`dongHangChoDaHetCan` miễn nó); không đụng gì khác.
    if (che.cheDo !== "DOI_NGUON_CO_QUYEN") {
      const mo = await tx.commissionAdjustmentRequest.findFirst({ where: { calcSlotId: slotId, origin: "SOURCE_CHANGE", status: { in: ["PENDING", "APPROVED_L1"] } }, select: { id: true } });
      if (mo) {
        await danhDauOKhop(tx, slotId, bc.now, null);
        return { loai: "DE_XUAT_DA_CO", slotId, requestId: mo.id };
      }
    }

    const kq = tinhDongChoKhoan(kh.dauVao(o.coSoConLai));
    const hashMoi = hashCuaKetQua(kh, bc, o.coSoConLai, kq);
    let holds: HoldNhap[] = [];
    let ketQua: KetQuaQuetKhoan;
    let capNhatHash: string | null = null;
    /** Đề xuất vừa lập ở lượt này — hàng chờ của nó được ghi ở đuôi hàm rồi nối `holdId` ngược lại. */
    let deXuatMoi: { requestId: string } | null = null;

    /** Duyệt đề xuất mà điều kiện đã đổi ⇒ ghi trạng thái STALE (KHÔNG ghi sổ) và trả `STALE_DE_XUAT`. Commit: đây là phép ghi duy nhất của lượt. */
    const loiThoi = async (lyDo: string): Promise<KetQuaQuetKhoan> => {
      if (che.cheDo !== "DOI_NGUON_CO_QUYEN") throw new Error("loiThoi chỉ dành cho chế độ duyệt đề xuất.");
      await che.duyet.khiLoiThoi(h, lyDo);
      await danhDauOKhop(tx, slotId, bc.now, null);
      return { loai: "STALE_DE_XUAT", slotId, lyDo };
    };

    if (kq.loai !== "OK") {
      if (che.cheDo === "DOI_NGUON_CO_QUYEN") return loiThoi(`Đầu vào hôm nay gặp lỗi cấu hình (${kq.loai}) — không dựng lại được gói đã duyệt.`);
      // "Dựng tập mong muốn mà gặp lỗi cấu hình ⇒ vẫn là INPUT_DRIFT, detail mang mã gốc" (02 §9.6 luật 4).
      const conTien = [...o.rong.values()].some((v) => v !== 0);
      if (conTien && !o.hashDaChapNhan.has(hashMoi)) {
        holds = [
          {
            ...cotHold(p, { ...cs, calcSlotId: slotId, orderItemId: kh.orderItemId, studentId: kh.studentId, blockingPeriodId: kyCh.id }),
            holdKey: khoaHold.inputDrift(slotId, hashMoi),
            code: "INPUT_DRIFT",
            detail: { lyDo: "Đầu vào hôm nay gặp lỗi cấu hình trong khi ô đã có tiền.", loi: kq.loai, chiTiet: holdCuaKetQuaLoi(kh, kq, cs, null).detail, rongTheoNguoi: Object.fromEntries(o.rong) },
          },
        ];
        ketQua = { loai: "TROI", slotId, chenh: [], lyDo: "LOI_CAU_HINH" };
      } else {
        ketQua = { loai: "KHONG_DOI", slotId };
      }
    } else {
      // BẤT BIẾN CARRY-FORWARD: khoá `(vai, người)` vắng chỉ vì trạng thái SỐNG của người ấy đổi sau lúc tính thì kỳ vọng := ròng — không hold, không điều chỉnh âm.
      const ls = kyVongSauLichSu(kyVongCua(kq), o.rong, khoaLichSuCua(kh, o.coSoConLai));
      const r = soVoiO({ o, kyVong: ls.kyVong, hashMoi, cheDo: che.cheDo === "QUET" ? "QUET" : "DOI_NGUON_CO_QUYEN" });
      const holdDrift = (chenh: ChenhNguoi[]): { holds: HoldNhap[]; ketQua: KetQuaQuetKhoan } => ({
        holds: [
          {
            ...cotHold(p, { ...cs, calcSlotId: slotId, orderItemId: kh.orderItemId, studentId: kh.studentId, blockingPeriodId: kyCh.id }),
            holdKey: khoaHold.inputDrift(slotId, hashMoi),
            code: "INPUT_DRIFT",
            detail: { lyDo: "Đầu vào đã đổi sau khi ô được tính — chênh lệch theo từng người, chờ người duyệt (áp thay đổi hoặc giữ nguyên).", hashMoi, coSoConLai: o.coSoConLai, chenh },
          },
        ],
        ketQua: { loai: "TROI", slotId, chenh, lyDo: "LECH_TIEN" },
      });
      if (r.loai === "INPUT_DRIFT") {
        if (che.cheDo === "DOI_NGUON_CO_QUYEN") return loiThoi("Ô đã có điều chỉnh do khiếu nại — chênh lệch không còn thuộc đề xuất đổi nguồn.");
        ({ holds, ketQua } = holdDrift(r.chenh));
      } else if (r.loai === "KHONG_LAM_GI") {
        if (che.cheDo === "DOI_NGUON_CO_QUYEN") return loiThoi("Không còn chênh lệch do đổi nguồn — số đã được điều chỉnh bằng đường khác hoặc đầu vào đã trôi về.");
        if (r.lyDo === "CHENH_BANG_0" || r.lyDo === "LAM_TRON_SAU_HOAN") capNhatHash = hashMoi;
        ketQua = { loai: "KHONG_DOI", slotId, ...(ls.lichSu.length > 0 ? { lichSu: ls.lichSu } : {}) };
      } else {
        // GHI: chỉ chế độ đổi nguồn mới tới đây (`soVoiO(QUET)` không bao giờ trả GHI).
        if (che.cheDo === "QUET") throw new Error("soVoiO(QUET) trả GHI — chỉ chế độ đổi nguồn mới được lập/ghi điều chỉnh.");
        // Quyền đổi nguồn KHÔNG phải quyền chuyển tiền giữa hai người cùng vai: phần lệch vì lý do khác (vd người chốt đổi từ A sang B) vẫn là INPUT_DRIFT cho người duyệt.
        const vaiAcq = new Set(bc.hoaHong.vaiHuong.filter((v) => v.isAcquisition).map((v) => v.code));
        const { deXuat, choDuyet } = tachChenhDoiNguon(r.chenh, vaiAcq);

        if (che.cheDo === "DOI_NGUON_CO_QUYEN") {
          // ── GHI SỔ SAU KHI ĐÃ DUYỆT — chỗ DUY NHẤT gọi `ghiChenhLech(SOURCE_CORRECTION)` (lưới [DXD-W1]). Gói phải GIỐNG HỆT cái người duyệt đã thấy. ──
          if (!goiGiongNhau(che.duyet.goi, deXuat)) return loiThoi("Số liệu đã đổi giữa lúc lập đề xuất và lúc duyệt (số ròng hoặc kỳ vọng của người hưởng khác gói đã duyệt).");
          if (!kyDc) throw new Error("Thiếu kỳ ghi chênh lệch ở chế độ duyệt đề xuất.");
          await h.khoaKyDeGhi([kyDc.id]);
          const danhTinh = await docDanhTinh(tx, kq);
          const gd = await ghiChenhLech(h, {
            loai: "SOURCE_CORRECTION",
            refEventType: "ATTRIBUTION",
            refEventId: che.refEventId,
            moLaiCuoiId: null, // khoá theo ĐỀ XUẤT (không phải hàng chờ): đề xuất không bao giờ được mở lại — một đề xuất, một lượt ghi
            reasonCode: "DOI_NGUON_SAU_THU",
            lyDo: `Đổi nguồn sau khi đã thu tiền, ĐÃ QUA người duyệt (đề xuất ${che.duyet.requestId}): chênh lệch tính trên cơ sở còn lại ${o.coSoConLai}đ.`,
            ky: kyDc,
            naturalPeriod: kyTuNhienCua(bc.now),
            slotId,
            netBase: o.coSoConLai,
            chenh: deXuat,
            dongGoc: o.dongGoc,
            mau: { kh, bc, kq, danhTinh, hash: hashMoi },
            paymentId: p.id,
            grossAmount: kh.vat.grossAmount,
          });
          if (gd.loai === "TRUNG") throw new HoaHongError("DA_AP_DUNG_TRUOC", "Điều chỉnh của đề xuất này đã được ghi — không ghi lần hai.");
          await writeAudit({
            actor: NGUOI_HE_THONG,
            module: MODULE_AUDIT,
            entityType: "CommissionCalcSlot",
            entityId: slotId,
            action: "SOURCE_CORRECTION",
            newValues: {
              khoan: p.id,
              deXuat: che.duyet.requestId,
              soDong: gd.soDong,
              tong: gd.tong,
              kyGhi: kyDc.period,
              chenh: deXuat.map((c) => ({ khoa: c.key, chenh: c.chenh })),
              choDuyet: choDuyet.map((c) => ({ khoa: c.key, chenh: c.chenh })),
            },
            reason: "đổi nguồn sau thanh toán — đề xuất đã duyệt",
            orgUnitId: co.orgUnitId,
            tx,
          });
          await che.duyet.khiGhi(h, { khoaDong: gd.khoa, soDong: gd.soDong, tong: gd.tong, kyId: kyDc.id, kyGhi: kyDc.period });
          if (choDuyet.length > 0) {
            // Phần còn lại KHÔNG phải do nguồn: giữ cho người duyệt (hàng chờ chỉ liệt kê phần đó), KHÔNG đánh dấu "đã khớp" — lượt quét sau vẫn thấy lệch.
            ({ holds } = holdDrift(choDuyet));
          } else {
            capNhatHash = hashMoi;
          }
          ketQua = { loai: "DA_DIEU_CHINH", slotId, soDong: gd.soDong, tong: gd.tong, kyGhi: kyDc.period, lateArrival: kyDc.period !== kyTuNhienCua(bc.now) };
        } else if (deXuat.length === 0 || !p.order.leadId) {
          ({ holds, ketQua } = holdDrift(r.chenh));
        } else if (await tx.commissionAdjustmentRequest.findFirst({ where: { calcSlotId: slotId, refEventId: che.refEventId, origin: "SOURCE_CHANGE" }, select: { id: true } })) {
          // CÙNG sự kiện đã có đề xuất cho ô này (đang chờ đã bị chặn ở trên; ở đây là đã DUYỆT / TỪ CHỐI / LỖI THỜI) mà ô vẫn lệch ⇒ đầu vào đổi LẦN NỮA sau khi nó được xử lý.
          // Không đẻ đề xuất thứ hai cho một sự kiện (chỉ mục `…_su_kien_key`; retry của dispatcher không được đẻ lại đề xuất đã bị người duyệt bác): để người rà quyết bằng INPUT_DRIFT.
          ({ holds, ketQua } = holdDrift(r.chenh));
        } else {
          // ── LẬP ĐỀ XUẤT (KHÔNG ghi sổ): gói = phần do nguồn gây ra, đóng băng; quản trị một/hai cấp theo ngưỡng CẤU HÌNH. ──
          const goi: GoiDong[] = deXuat.map((c) => ({ key: c.key, chenh: c.chenh, kyVong: c.kyVong, rong: c.rong }));
          const canhBao = await tinhCanhBaoGoiDoiNguon(tx, { leadId: p.order.leadId, goi, requestedById: che.requestedById });
          // Tích luỹ + cận gốc: `docNenQuanTri` đọc sau `khoaO(slotId)` ở đầu hàm (MỘT chỗ đọc, cùng khuôn với khiếu nại tiền).
          // Yêu cầu logic = CẢ SỰ KIỆN đổi nguồn (`refEventId`): nó chạm nhiều ô, mỗi ô một đề xuất trong một giao dịch riêng. `duBaoTongYeuCau` (do `apDungDoiNguonSauThu` dự báo trước cho
          // MỌI ô) làm cái lập đầu tiên cũng thấy tổng; các gói anh em đã có thì `docNenQuanTri` cộng thêm.
          const qd = await quyetDinhQuanTriTrongTx(tx, { goi, calcSlotId: slotId, yeuCau: { khoa: { origin: "SOURCE_CHANGE", refEventId: che.refEventId }, duBaoTong: che.duBaoTongYeuCau }, canhBao });
          const { id: requestId } = await luuDeXuat(tx, {
            origin: "SOURCE_CHANGE",
            disputeId: null,
            leadId: p.order.leadId,
            paymentId: p.id,
            calcSlotId: slotId,
            refEventType: "ATTRIBUTION",
            refEventId: che.refEventId,
            goi,
            qd,
            canhBao,
            requestedById: che.requestedById,
            centerId: co.centerId,
            orgUnitId: co.orgUnitId,
            holdId: null,
            trangThai: { loai: "CHO_DUYET" },
          });
          deXuatMoi = { requestId };
          holds = [
            {
              ...cotHold(p, { ...cs, calcSlotId: slotId, orderItemId: kh.orderItemId, studentId: kh.studentId, blockingPeriodId: kyCh.id }),
              // Khoá CHUẨN `INPUT_DRIFT:<ô>:<hash>` (không khoá riêng): đề xuất bị TỪ CHỐI ⇒ hàng chờ thành DISMISSED = "giữ nguyên" ⇒ hash vào `hashDaChapNhan` ⇒ lượt quét sau KHÔNG dựng lại
              // cùng chênh lệch thành một INPUT_DRIFT thường mà MỘT người "Áp dụng" được (vòng qua cấp hai). Phân biệt với INPUT_DRIFT thường bằng `detail.proposalId`.
              holdKey: khoaHold.inputDrift(slotId, hashMoi),
              code: "INPUT_DRIFT",
              detail: {
                lyDo: "Đổi nguồn sau khi đã thu tiền — ĐỀ XUẤT điều chỉnh đang chờ người duyệt. Sổ chưa đổi; kỳ không khoá được cho tới khi đề xuất được duyệt hoặc từ chối.",
                proposalId: requestId,
                quanTri: qd.quanTri,
                absTotal: qd.tong.absTotal,
                coSoConLai: o.coSoConLai,
                chenh: deXuat,
                // Phần lệch vì lý do KHÁC nguồn đi CÙNG hàng chờ này (không mở INPUT_DRIFT thứ hai); sau khi đề xuất xong, lượt quét kế tiếp sẽ nêu nó như thường.
                choDuyet,
              },
            },
          ];
          await writeAudit({
            actor: { id: che.requestedById, name: "Người đổi nguồn" },
            module: MODULE_AUDIT,
            entityType: "CommissionAdjustmentRequest",
            entityId: requestId,
            action: "CREATE",
            newValues: { origin: "SOURCE_CHANGE", khoan: p.id, slotId, quanTri: qd.quanTri, absTotal: qd.tong.absTotal, net: qd.tong.net, lyDoQuanTri: qd.lyDo.map((l) => l.ma), canhBao },
            reason: "đổi nguồn sau thanh toán — lập đề xuất điều chỉnh chờ duyệt",
            orgUnitId: co.orgUnitId,
            tx,
          });
          ketQua = { loai: "DE_XUAT", slotId, requestId, quanTri: qd.quanTri };
        }
      }
    }

    if (deXuatMoi) {
      // `ghiHangCho` không mở lại hàng chờ đã "giữ nguyên" (DISMISSED); đề xuất MỚI trên đúng trạng thái đầu vào đó là quyết định mới ⇒ đóng bản cũ để nó được mở lại.
      await tx.commissionHold.updateMany({
        where: { holdKey: khoaHold.inputDrift(slotId, hashMoi), status: "DISMISSED" },
        data: { status: "RESOLVED", resolutionNote: "Thay bằng hàng chờ của đề xuất điều chỉnh mới." },
      });
    }
    for (const hold of holds) await ghiHangCho(tx, hold, bc.now);
    if (deXuatMoi) {
      const hang = await tx.commissionHold.findUniqueOrThrow({ where: { holdKey: khoaHold.inputDrift(slotId, hashMoi) }, select: { id: true } });
      await tx.commissionAdjustmentRequest.update({ where: { id: deXuatMoi.requestId }, data: { holdId: hang.id } });
    }
    await dongHangChoDaHetCan(tx, p.id, new Set(holds.map((x) => x.holdKey)), bc.now);
    await danhDauOKhop(tx, slotId, bc.now, capNhatHash);
    await ghiGiaiThich(tx, { kh, bc, slotId, netBase: o.netBase, hash: hashMoi, hashDuocChapNhan: o.hashDaChapNhan.has(hashMoi) || capNhatHash === hashMoi, coDrift: holds.some((x) => x.code === "INPUT_DRIFT"), rong: o.rong });
    if (kh.st) await luuStudentTransaction(tx, kh.st, bc.now);
    return ketQua;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// KHOẢN ĐẢO (hoàn / điều chỉnh giảm) — 04 §11.1
// ═══════════════════════════════════════════════════════════════════════════════════════════════

async function quetDao(client: PrismaClient, bc: BoiCanhQuet, r: KhoanNap): Promise<KetQuaQuetKhoan> {
  const goc = r.adjustmentOf;
  if (!goc) return chiHangCho(client, bc, r, [{ ...cotHold(r), holdKey: khoaHold.theoKhoan("NEGATIVE_WITHOUT_ORIGIN", r.id), code: "NEGATIVE_WITHOUT_ORIGIN", detail: { lyDo: "Bút toán âm mất dấu khoản gốc." } }]);

  const kyR = kyTuNhienCua(r.paidDate);
  const kyCu = await docKyCu(client, [kyR, kyTuNhienCua(goc.paidDate)]);
  // Engine MỚI chỉ đảo khoản hoàn mà CHÍNH NÓ sở hữu (R) và gốc cũng của nó (G).
  const chuR = chuSoHuuButToan({ id: r.id, paidDate: r.paidDate }, { kyCutover: bc.kyCutover, kyCu });
  if (chuR === "CU") return { loai: "BO_QUA", lyDo: "KHONG_PHAI_CHU" };
  const slots = await client.commissionCalcSlot.findMany({ where: { paymentId: goc.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const chuG = chuSoHuuButToan({ id: goc.id, paidDate: goc.paidDate }, { kyCutover: bc.kyCutover, kyCu });

  if (typeof chuR === "object" || typeof chuG === "object") {
    // Không quyết được chủ (kỳ cũ đã duyệt mà KHÔNG có manifest — 04 §3.1): không đoán gốc thuộc engine nào. Hàng chờ CỨNG để khoản thu hồi không MẤT IM LẶNG.
    const dv = await docCoSoCuaKhoan(client, r);
    return chiHangCho(
      client,
      bc,
      r,
      [
        {
          ...cotHold(r),
          holdKey: khoaHold.theoKhoan("MANUAL_REVIEW_REQUIRED", r.id, "LEGACY_REVERSAL"),
          code: "MANUAL_REVIEW_REQUIRED",
          detail: { lyDo: "Khoản hoàn của khoản thu thuộc kỳ cũ ĐÃ DUYỆT mà không có manifest — không quyết được gốc thuộc engine cũ hay mới (04 §3.1, §11.3).", khoanGoc: goc.id },
        },
      ],
      null,
      "co" in dv ? dv.co : null,
    );
  }
  // R thuộc engine mới, gốc thuộc engine CŨ ⇒ LEGACY_REVERSAL: chạy NGUYÊN pipeline cũ trên R (04 §11.3), tự động, 0 hàng chờ (H5 đóng).
  if (chuG === "CU") return ghiLegacyReversal(client, bc, r, goc);
  if (slots.length === 0) return { loai: "BO_QUA", lyDo: "GOC_CHUA_CO_O" };

  if (await client.commissionTransaction.findFirst({ where: { paymentId: r.id, entryKind: "REVERSAL" }, select: { id: true } })) {
    // Đã đảo rồi, và khoản hoàn VẪN thuộc thực thu (nếu không, đã đi nhánh "rút tiền" ở `quetKhoan`): hàng chờ PAYMENT_WITHDRAWN cũ của nó (kế toán bác rồi khôi phục) hết căn cứ.
    if (await client.commissionHold.findFirst({ where: { paymentId: r.id, status: "OPEN" }, select: { id: true } })) {
      await chayTrongKhoa(client, { khoaKhoan: [r.id], kyCutoverDaDoc: bc.kyCutover }, async (h) => {
        await dongHangChoDaHetCan(h.tx, r.id, new Set(), bc.now);
      });
    }
    return { loai: "BO_QUA", lyDo: "DA_XU_LY" };
  }

  const co0 = slots[0]!;
  const ky = await kyChanCua(client, bc, kyR, { centerId: co0.centerId, orgUnitId: co0.orgUnitId });
  const lateArrival = ky.period !== kyR;
  const updatedAtDaDoc = r.updatedAt.getTime();

  return chayTrongKhoa(client, { khoaKhoan: [r.id, goc.id], kyCutoverDaDoc: bc.kyCutover }, async (h): Promise<KetQuaQuetKhoan> => {
    const tx = h.tx;
    await kiemKhoanVanNhuCu(h, r, updatedAtDaDoc);
    await h.khoaO(slots.map((s) => s.id));
    // Sau khoá: đã có dòng đảo của R chưa? (hai lượt hoàn chồng nhau cùng R — hoặc retry)
    if (await tx.commissionTransaction.findFirst({ where: { paymentId: r.id, entryKind: "REVERSAL" }, select: { id: true } })) {
      return { loai: "BO_QUA", lyDo: "DA_XU_LY" };
    }
    const trangThai = await docTrangThaiO(tx, slots.map((s) => s.id));
    const nhomO = slots.map((s) => trangThai.get(s.id)!).filter(Boolean);
    const gocIds = nhomO.flatMap((x) => [...x.dongGoc.values()]);
    if (gocIds.length === 0) return { loai: "BO_QUA", lyDo: "KHONG_CO_GI_DE_DAO" };
    const gocRows = new Map((await tx.commissionTransaction.findMany({ where: { id: { in: gocIds } } })).map((x) => [x.id, x]));
    const vatGoc = Number(gocRows.get(gocIds[0]!)!.vatRate);

    const dao = tinhDaoNguoc({
      absAmountAm: Math.abs(r.amount),
      vatRateGoc: vatGoc,
      nhomO: nhomO.map((o) => ({ o, dongGoc: o.dongGoc })),
    });
    const rows: DongGhi[] = [];
    for (const theoO of dao.theoO) {
      for (const d of theoO.dong) {
        const g = gocRows.get(d.refEntryId)!;
        rows.push(
          saoTuDongGoc(g, {
            idempotencyKey: khoaDao(r.id, g.id),
            entryKind: "REVERSAL",
            calcSlotId: g.calcSlotId,
            periodId: ky.id,
            naturalPeriod: kyR,
            lateArrival,
            paymentId: r.id,
            amount: d.amount,
            reason: `Hoàn tiền ${Math.abs(r.amount)}đ trên khoản ${goc.id}: đảo ${-d.amount}đ của dòng ${g.id} theo TỈ LỆ TIỀN của chính dòng trên cơ sở còn lại, người hưởng + chính sách của dòng gốc (04 §11.1).`,
            reasonCode: "HOAN_TIEN",
            grossAmount: r.amount,
            netBase: -theoO.coSoDao,
            inputHash: g.inputHash,
            refEntryId: g.id,
            refEventType: "PAYMENT",
            refEventId: r.id,
          }),
        );
      }
    }
    if (rows.length === 0) return { loai: "BO_QUA", lyDo: "KHONG_CO_GI_DE_DAO" };
    await h.khoaKyDeGhi([ky.id]);
    await h.ghiDong(rows);
    const tong = rows.reduce((s, x) => s + x.amount, 0);
    await writeAudit({
      actor: NGUOI_HE_THONG,
      module: MODULE_AUDIT,
      entityType: "CommissionCalcSlot",
      entityId: co0.id,
      action: "ADJUST",
      newValues: { khoanHoan: r.id, khoanGoc: goc.id, soDong: rows.length, tong, kyGhi: ky.period },
      reason: `hoàn tiền ${r.id}`,
      orgUnitId: co0.orgUnitId,
      tx,
    });
    await dongHangChoDaHetCan(tx, r.id, new Set(), bc.now);
    return { loai: "DA_DAO", soDong: rows.length, tong, kyGhi: ky.period, lateArrival };
  });
}

// ── LEGACY_REVERSAL (gốc thuộc engine CŨ — 04 §11.3, H22) ────────────────────────────────────────

/**
 * Hoàn tiền SAU mốc của khoản thu TRƯỚC mốc (gốc nằm trong bảng kê cũ). Tự động, KHÔNG hàng chờ: luật tất định (chạy lại đúng pipeline cũ). Dòng âm vào kỳ
 * MỚI đang MỞ (`kyGhiSo`), giữ `naturalPeriod` = kỳ của khoản hoàn, tham chiếu GIAO DỊCH GỐC (`refEventId`), KHÔNG sửa/ghi gì vào `CommissionStatement`/`CommissionLine`
 * và KHÔNG mở lại kỳ nào (H22). Một dòng cho mỗi (khoản hoàn × tầng × người) — khoá `khoaLegacy`.
 */
async function ghiLegacyReversal(client: PrismaClient, bc: BoiCanhQuet, r: KhoanNap, goc: NonNullable<KhoanNap["adjustmentOf"]>): Promise<KetQuaQuetKhoan> {
  const dv = await docCoSoCuaKhoan(client, r);
  if ("thieu" in dv) return chiHangCho(client, bc, r, [holdKhongCoDonVi(r, dv.thieu)], null, null);
  const co = dv.co;

  if (await client.commissionTransaction.findFirst({ where: { paymentId: r.id, entryKind: "LEGACY_REVERSAL" }, select: { id: true } })) {
    return { loai: "BO_QUA", lyDo: "DA_XU_LY" };
  }
  const dong = await tinhLegacyReversal(client, r.id);
  if (dong.length === 0) return { loai: "BO_QUA", lyDo: "KHONG_CO_GI_DE_DAO" };

  const kyR = kyTuNhienCua(r.paidDate);
  const ky = await kyChanCua(client, bc, kyR, co);
  const lateArrival = ky.period !== kyR;
  const updatedAtDaDoc = r.updatedAt.getTime();
  const users = await client.user.findMany({ where: { id: { in: [...new Set(dong.map((d) => d.recipientId))] } }, select: { id: true, name: true, email: true, employeeId: true } });
  const nguoi = new Map(users.map((u) => [u.id, { name: u.name ?? u.email ?? u.id, employeeId: u.employeeId }]));

  return chayTrongKhoa(client, { khoaKhoan: [r.id, goc.id], kyCutoverDaDoc: bc.kyCutover }, async (h): Promise<KetQuaQuetKhoan> => {
    const tx = h.tx;
    await kiemKhoanVanNhuCu(h, r, updatedAtDaDoc);
    if (await tx.commissionTransaction.findFirst({ where: { paymentId: r.id, entryKind: "LEGACY_REVERSAL" }, select: { id: true } })) {
      return { loai: "BO_QUA", lyDo: "DA_XU_LY" };
    }
    await h.khoaKyDeGhi([ky.id]);
    const rows: DongGhi[] = dong.map((d) => {
      const idVai = bc.idVai.get(d.roleCode);
      if (!idVai) throw new HoaHongError("THIEU_VAI_MASTER", `Vai "${d.roleCode}" (tầng cũ ${d.tier}) chưa có trong master BeneficiaryRole — dừng, không đoán.`);
      const nv = nguoi.get(d.recipientId);
      return {
        idempotencyKey: khoaLegacy(r.id, d.tier, d.recipientId),
        entryKind: "LEGACY_REVERSAL",
        calcSlotId: null, // không có ô: gốc ở sổ cũ (CHECK `o_tinh_chk`)
        periodId: ky.id,
        naturalPeriod: kyR,
        lateArrival,
        rateDate: goc.paidDate,
        assigneeDate: goc.confirmedAt ?? goc.paidDate,
        paymentId: r.id,
        orderId: r.orderId,
        orderItemId: null,
        studentId: null,
        leadId: r.order.leadId,
        studentTransactionId: null,
        transactionTypeCode: "LEGACY",
        revenueComponent: "TUITION",
        splitMethod: null,
        attributionId: null,
        sourceGroupId: bc.nhomUnknown.id,
        sourceGroupCode: bc.nhomUnknown.code,
        sourceId: null,
        // Gốc ở sổ CŨ (bảng kê): không có campaign Affiliate nào để chụp.
        affiliateCampaignId: null,
        affiliateMembershipId: null,
        affiliateReferralId: null,
        beneficiaryRoleId: idVai,
        roleCode: d.roleCode,
        beneficiaryKind: "USER",
        beneficiaryUserId: d.recipientId,
        beneficiaryAffiliateId: null,
        beneficiaryEmployeeId: nv?.employeeId ?? null,
        beneficiaryName: nv?.name ?? d.recipientId,
        beneficiaryType: "PERSON",
        resolverType: MASTER_VAI_HUONG.find((v) => v.code === d.roleCode)!.resolverType,
        resolverBasis: { engineCu: true, tier: d.tier } as Prisma.InputJsonValue,
        policyId: null,
        policyVersionId: null,
        versionNo: null,
        ruleId: null,
        documentNumber: null,
        calcKind: null,
        scopeOrderVersion: null,
        reason: `Hoàn tiền ${Math.abs(r.amount)}đ của khoản ${goc.id} (thuộc bảng kê CŨ): thu hồi tầng ${d.tier} bằng pipeline cũ, tỉ lệ theo ngày thu gốc (04 §11.3). ${d.note}`,
        reasonCode: "GOC_THUOC_ENGINE_CU",
        candidates: Prisma.JsonNull,
        grossAmount: r.amount,
        vatRate: new Prisma.Decimal(0),
        netBase: r.amount,
        rate: null,
        fixedAmount: null,
        amount: d.amount,
        capRate: new Prisma.Decimal(String(bc.hoaHong.tranTongTiLe)),
        equivalentRate: new Prisma.Decimal(0),
        inputHash: bamDauVao({ legacy: true, khoanHoan: r.id, khoanGoc: goc.id, tier: d.tier, nguoi: d.recipientId, tien: d.amount }),
        refEntryId: null,
        refEventType: "PAYMENT",
        refEventId: goc.id, // tham chiếu GIAO DỊCH GỐC (H22)
        legacyTier: d.tier,
        centerId: co.centerId,
        orgUnitId: co.orgUnitId,
      };
    });
    await h.ghiDong(rows);
    const tong = rows.reduce((s, x) => s + x.amount, 0);
    await writeAudit({
      actor: NGUOI_HE_THONG,
      module: MODULE_AUDIT,
      entityType: "CommissionPeriod",
      entityId: ky.id,
      action: "LEGACY_REVERSAL",
      newValues: { khoanHoan: r.id, khoanGoc: goc.id, soDong: rows.length, tong, kyHieuLuc: kyR, kyGhi: ky.period },
      reason: `hoàn tiền ${r.id} của khoản thuộc bảng kê cũ ${goc.id}`,
      orgUnitId: co.orgUnitId,
      tx,
    });
    await dongHangChoDaHetCan(tx, r.id, new Set(), bc.now);
    return { loai: "DA_DAO_LEGACY", soDong: rows.length, tong, kyGhi: ky.period, lateArrival };
  });
}

/** Cho test / báo cáo: tóm tắt trạng thái các ô của một khoản (không dùng trong đường tiền). */
export async function docOCuaKhoan(client: Khach, paymentId: string): Promise<OCoDong[]> {
  const slots = await client.commissionCalcSlot.findMany({ where: { paymentId }, select: { id: true } });
  return [...(await docTrangThaiO(client, slots.map((s) => s.id))).values()];
}
