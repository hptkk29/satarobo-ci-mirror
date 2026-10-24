// lib/hoa-hong/giai-hang-cho.ts — NGƯỜI DUYỆT GIẢI hàng chờ: `INPUT_DRIFT` (đầu vào trôi) và `PAYMENT_WITHDRAWN` (khoản đã tính bị rút).
//
// Nguồn: docs/source-commission/04 §10.4 (bước 3), §10.5; 01 §6.2; 05 COM-16/COM-17.
//
// Hai quyết định, cả hai BẮT BUỘC lý do ≥ 10 ký tự + audit CÙNG transaction:
//   AP_DUNG     INPUT_DRIFT        → `INPUT_CORRECTION` = đúng CHÊNH LỆCH (kỳ vọng hôm nay − Σ ròng) từng người, tính lại SAU khoá ô
//               PAYMENT_WITHDRAWN  → khoản THU: `INPUT_CORRECTION` = −Σ ròng từng người (đảo sạch ô) · khoản HOÀN: trả lại đúng số đã thu hồi
//   GIU_NGUYEN  hai mã             → hàng chờ `DISMISSED` kèm lý do; INPUT_DRIFT: hash vào `hashDaChapNhan` (lượt quét sau không báo lại)
//
// Vì sao KHÔNG tự đảo khi khoản bị rút (04 Q6, 01 §6.2): "từ chối" có thể là bấm nhầm rồi xác nhận lại. Engine chỉ dựng hàng chờ CỨNG chặn khoá; người quyết.
//
// ⚠️ Service này KHÔNG kiểm quyền chức năng (khuôn `ky-service.ts`): action (PR9) gác `commission_periods:manage` ở đầu hàm. Nó tự gác PHẠM VI
// (`passesScope("CommissionHold")`) — `scopedDb` không che ghi (CLAUDE.md luật 5). Từ chối = `throw` TRƯỚC phép ghi đầu tiên (luật 12).
import type { CommissionTransaction, Prisma, PrismaClient } from "@prisma/client";

import { writeAudit } from "@/lib/audit/audit-log";
import { passesScope } from "@/lib/db-scope";

import type { BoiCanhQuet } from "./boi-canh";
import { batGiaiHangCho, chenhDaoSach, chenhKhoiPhucHoan, proposalIdCuaHangCho, type QuyetDinhGiai } from "./dieu-chinh";
import { HoaHongError, batLyDoToiThieu } from "./kieu";
import { dinhDangDong } from "./vi-sao";
import { docDauVetXuLy, docMocMoLaiCuoi } from "./hang-cho-dau-vet";
import { chuVoHieu, tienChoCapTu, tienKhopDeNghi, tienTiepXuc } from "./hang-cho-xu-ly";
import { khoaHold, khoaNguoi, type KhoaNguoi } from "./khoa-so";
import { chayTrongKhoa } from "./ghi-so";
import { kyVongSauLichSu, tachChenhDoiNguon, tinhChenhTheoNguoi } from "./o-tinh";
import { MA_KHOI_PHUC_HOAN, docTrangThaiO } from "./o-tinh-db";
import { conThucThu, docKhoan } from "./nap-khoan";
import { suKienDoiNguonChuaXong } from "./doi-nguon-chua-xong";
import { danhDauOKhop, docDanhTinh, ghiChenhLech, ghiKhoiPhucHoanLegacy, hashCuaKetQua, khoaLichSuCua, kiemKhoanVanNhuCu, kyChanCua, kyVongCua, lapThu } from "./quet-khoan";
import { tinhDongChoKhoan } from "./tinh-dong-cho-khoan";
import { kyTuNhienCua } from "./but-toan";
import type { NguoiThaoTacKy } from "./ky-service";

const MODULE_AUDIT = "hoa-hong";

/** Một dòng chênh lệch của bản XEM TRƯỚC: `khoa` = khoá người hưởng (`vai|loại|id`), `chenh` có dấu (dương = trả thêm, âm = thu hồi). */
export type DongXemTruoc = { khoa: string; chenh: number };

export type KetQuaGiai =
  | { loai: "DA_AP_DUNG"; soDong: number; tong: number; kyGhi: string }
  /** Đầu vào đã trôi về đúng số đã tính ⇒ không còn gì để điều chỉnh; hàng chờ vẫn được đóng. */
  | { loai: "KHONG_CAN_DIEU_CHINH" }
  | { loai: "DA_GIU_NGUYEN" }
  /**
   * XEM TRƯỚC (R9, T1): chạy đúng các cổng của "Áp dụng" rồi DỪNG trước phép ghi đầu tiên — không ghi gì, không mở kỳ, không đóng hàng chờ.
   * `tongTuyetDoi` = Σ|chênh| — con số "tiền bị ảnh hưởng" mà cổng tiền lớn (hai cấp) và `tranTien` đo; `tongRong` = Σ chênh (có dấu).
   */
  | { loai: "XEM_TRUOC"; tongTuyetDoi: number; tongRong: number; chenh: DongXemTruoc[]; kyDuKien: string };

/** Phần mở rộng của lượt giải do tầng xử lý hàng chờ (R9) truyền vào — mặc định mọi thứ TẮT, hành vi cũ giữ nguyên. */
export type TuyChonGiai = {
  /** Chỉ chạy cổng + dựng chênh lệch, trả `XEM_TRUOC`. Không đòi lý do (người dùng chưa gõ). */
  xemTruoc?: boolean;
  /**
   * Trần Σ|chênh| mà người quyết ĐÃ THẤY. Chênh lệch tính lại SAU khoá lớn hơn trần ⇒ `TIEN_DA_DOI` (throw TRƯỚC phép ghi đầu): bấm trên con số cũ không được ghi con số mới.
   * Thiếu ⇒ không giới hạn (đường cũ/test cũ).
   */
  tranTien?: number;
  /** Dấu vết bổ sung (đề nghị · bằng chứng · người duyệt cấp hai) — vào `newValues.batKy` của audit CÙNG transaction với phép ghi. */
  batKy?: Record<string, unknown>;
  /**
   * ẢNH CHỤP đề nghị cấp 1 mà lượt duyệt này dựa vào (đóng hàng chờ HAI cấp). Kiểm lại TRONG khoá, trước phép ghi đầu tiên: đề nghị vẫn là đề nghị MỚI NHẤT, chưa bị dùng, hàng chờ chưa mở lại
   * sau nó, cùng khoá hàng chờ, và tiền ảnh hưởng tính lại KHỚP tiền đã chụp ⇒ sai một thứ là `DE_NGHI_HET_HIEU_LUC` / `TIEN_DA_DOI`. Thiếu ⇒ đường một người (dưới ngưỡng) — không có gì để kiểm.
   */
  deNghiXacNhan?: { auditId: string; tien: number; holdKey: string; mocMoLai: string | null; nguoiId: string | null };
};

/**
 * Cổng ẢNH CHỤP đề nghị, gọi TRONG khoá ô/khoản (hoặc trong giao dịch "Giữ nguyên"), SAU khi đã đọc lại hàng chờ và TRƯỚC phép ghi đầu tiên (throw ⇒ rollback sạch).
 * Đọc dấu vết bằng chính `tx` đang giữ khoá: lượt quét mở lại hàng chờ (`ghiHangCho`) chạy dưới CÙNG khoá khoản nên không chen được giữa kiểm và ghi.
 */
async function batDeNghiTrongKhoa(tx: Pick<Prisma.TransactionClient, "auditLog">, hold: { id: string; code: Hold["code"]; holdKey: string; detail: Prisma.JsonValue }, tuyChon: TuyChonGiai, tongTuyetDoi: number): Promise<void> {
  const x = tuyChon.deNghiXacNhan;
  if (!x) return;
  const dn = (await docDauVetXuLy(tx, [hold.id])).get(hold.id)?.deNghi ?? null;
  if (!dn || dn.id !== x.auditId || dn.vo !== null || dn.holdKey !== hold.holdKey || hold.holdKey !== x.holdKey) {
    throw new HoaHongError("DE_NGHI_HET_HIEU_LUC", `Đề nghị cấp 1 không còn hiệu lực (${chuVoHieu(dn?.id === x.auditId ? dn.vo : null)}) — người thứ nhất lập đề nghị mới, rồi người KHÁC duyệt.`);
  }
  const tienNay = tienChoCapTu(tienTiepXuc({ code: hold.code, detail: hold.detail }), tongTuyetDoi);
  if (!tienKhopDeNghi(dn, tienNay)) {
    throw new HoaHongError("TIEN_DA_DOI", `Số tiền ảnh hưởng nay (${dinhDangDong(tienNay ?? 0)}) khác số trong đề nghị cấp 1 (${dinhDangDong(dn.tien)}) — người thứ nhất lập lại đề nghị trên số mới.`);
  }
}

const gomXemTruoc = (chenh: readonly { key: string; chenh: number }[], kyDuKien: string): Extract<KetQuaGiai, { loai: "XEM_TRUOC" }> => ({
  loai: "XEM_TRUOC",
  tongTuyetDoi: chenh.reduce((t, c) => t + Math.abs(c.chenh), 0),
  tongRong: chenh.reduce((t, c) => t + c.chenh, 0),
  chenh: chenh.map((c) => ({ khoa: c.key, chenh: c.chenh })),
  kyDuKien,
});

/** Cổng `tranTien`: gọi SAU khi dựng chênh lệch và TRƯỚC phép ghi đầu tiên (throw ⇒ rollback sạch, hàng chờ nguyên trạng). */
function batTranTien(tuyChon: TuyChonGiai, tongTuyetDoi: number): void {
  if (tuyChon.tranTien !== undefined && tongTuyetDoi > tuyChon.tranTien) {
    throw new HoaHongError("TIEN_DA_DOI", `Số tiền điều chỉnh tính lại (${dinhDangDong(tongTuyetDoi)}) lớn hơn số bạn đã xem (${dinhDangDong(tuyChon.tranTien)}) — đóng hộp thoại, đọc lại số mới rồi quyết.`);
  }
}

/**
 * TÁCH NHIỆM: người QUYẾT ghi sổ không được là NGƯỜI HƯỞNG của một dòng điều chỉnh sắp ghi — cùng luật với đường đề xuất (`duyet-de-xuat.ts` · `lyDoKhongDuocDuyet`). Không có cổng này, người giữ
 * `commission_periods:manage` (Quản trị tối cao, Kế toán HO) đồng thời là Sale/chủ nguồn của ô tự «Giải phóng» hàng chờ dưới ngưỡng hai cấp và ghi tiền cho CHÍNH MÌNH, không ai thứ hai. Khoá người
 * của dòng: `vai|USER|id` (dòng thường) hoặc `LEGACY|vai|id` (trả lại số đã thu hồi). Đối tác Affiliate không phải `User` nên không so. Gọi SAU xem trước và TRƯỚC phép ghi đầu tiên (throw ⇒ rollback sạch).
 * "Giữ nguyên" không đi qua đây (không có dòng nào được ghi) — giới hạn đã biết, ghi ở doc 08 §17.f3.
 */
function batNguoiQuyetKhongPhaiNguoiHuong(nguoi: NguoiThaoTacKy, chenh: readonly { key: string; chenh: number }[]): void {
  for (const c of chenh) {
    if (c.chenh === 0) continue;
    const [a, b, ...rest] = c.key.split("|");
    const nguoiHuong = a === "LEGACY" ? rest[0] : b === "USER" ? rest.join("|") : null;
    if (nguoiHuong === nguoi.userId) {
      throw new HoaHongError("NGUOI_QUYET_LA_NGUOI_HUONG", "Bạn là người hưởng của một dòng trong lần điều chỉnh này nên không được tự quyết — nhờ một người khác có quyền xử lý hàng chờ.");
    }
  }
}

export async function giaiHangCho(
  client: PrismaClient,
  bc: BoiCanhQuet,
  i: { holdId: string; quyetDinh: QuyetDinhGiai; lyDo: string; nguoi: NguoiThaoTacKy } & TuyChonGiai,
): Promise<KetQuaGiai> {
  const tuyChon: TuyChonGiai = { xemTruoc: i.xemTruoc, tranTien: i.tranTien, batKy: i.batKy, deNghiXacNhan: i.deNghiXacNhan };
  const lyDo = i.xemTruoc ? i.lyDo.trim() : batLyDoToiThieu(i.lyDo, i.quyetDinh === "AP_DUNG" ? "Áp dụng điều chỉnh" : "Giữ nguyên");
  const hold = await client.commissionHold.findUnique({ where: { id: i.holdId } });
  if (!hold) throw new HoaHongError("HANG_CHO_KHONG_MO", "Hàng chờ không tồn tại.");
  batGiaiHangCho({ code: hold.code, trangThai: hold.status, quyetDinh: i.quyetDinh });
  // Phạm vi GHI: người ở cơ sở khác không giải được hàng chờ của cơ sở này dù gõ đúng id (IDOR).
  if (!passesScope("CommissionHold", { centerId: hold.centerId }, i.nguoi.quyen)) {
    throw new HoaHongError("NGOAI_PHAM_VI", "Hàng chờ thuộc cơ sở ngoài phạm vi của bạn.");
  }

  // Hàng chờ của một ĐỀ XUẤT điều chỉnh đang mở: chỉ service duyệt / từ chối đề xuất đóng nó. CẢ HAI quyết định ở đây đều đóng hàng chờ — "Áp dụng" là ghi tiền một người
  // (vòng qua cấp hai), "Giữ nguyên" là gỡ khoá kỳ trong khi đề xuất còn PENDING (kỳ khoá được, rồi đề xuất ghi vào kỳ đã chốt).
  const dxMo = proposalIdCuaHangCho(hold.detail);
  if (dxMo) {
    throw new HoaHongError(
      "HANG_CHO_CUA_DE_XUAT",
      `Hàng chờ này thuộc đề xuất điều chỉnh ${dxMo} — duyệt hoặc từ chối ở đề xuất (quy trình một hoặc hai cấp), không ${i.quyetDinh === "AP_DUNG" ? '"Áp dụng"' : '"Giữ nguyên"'} trực tiếp ở hàng chờ.`,
    );
  }
  if (i.quyetDinh === "GIU_NGUYEN") return giuNguyen(client, bc, hold, lyDo, i.nguoi, tuyChon);
  return hold.code === "INPUT_DRIFT" ? apDungInputDrift(client, bc, hold, lyDo, i.nguoi, tuyChon) : daoKhoanBiRut(client, bc, hold, lyDo, i.nguoi, tuyChon);
}

type Hold = NonNullable<Awaited<ReturnType<PrismaClient["commissionHold"]["findUnique"]>>>;
const actorAudit = (n: NguoiThaoTacKy) => ({ id: n.userId, name: n.ten });
const batKyAudit = (t: TuyChonGiai) => (t.batKy ? { batKy: t.batKy as Prisma.InputJsonValue } : {});

/**
 * Đóng hàng chờ có ĐIỀU KIỆN `status = OPEN` (khuôn FIX-H9): "Giữ nguyên" không giữ khoá advisory của khoản, nên một lượt "Áp dụng" đã đọc OPEN trong khoá có thể bị "Giữ nguyên" của người khác chen vào
 * và đóng hàng chờ trước. Cập nhật vô điều kiện sẽ ghi đè DISMISSED bằng RESOLVED SAU KHI đã ghi dòng sổ — sổ có tiền mà người kia được báo "sổ không đổi". Đổi 0 dòng ⇒ throw ⇒ rollback cả dòng sổ vừa ghi.
 */
export async function dongCoDieuKien(tx: Prisma.TransactionClient, holdId: string, data: { status: "RESOLVED"; resolvedAt: Date; resolvedById: string | null; resolutionNote: string }): Promise<void> {
  const r = await tx.commissionHold.updateMany({ where: { id: holdId, status: "OPEN" }, data });
  if (r.count === 0) throw new HoaHongError("TRANG_THAI_DA_DOI", "Hàng chờ vừa được xử lý ở nơi khác.");
}

// ── GIỮ NGUYÊN ───────────────────────────────────────────────────────────────────────────────

async function giuNguyen(client: PrismaClient, bc: BoiCanhQuet, hold: Hold, lyDo: string, nguoi: NguoiThaoTacKy, tuyChon: TuyChonGiai): Promise<KetQuaGiai> {
  // "Giữ nguyên" không di chuyển tiền ⇒ bản xem trước rỗng (cổng hàng chờ/phạm vi đã chạy ở `giaiHangCho`).
  if (tuyChon.xemTruoc) return gomXemTruoc([], kyTuNhienCua(bc.now));
  await client.$transaction(async (tx) => {
    // Cổng ảnh chụp đề nghị TRƯỚC phép ghi đầu tiên (đọc lại hàng chờ trong giao dịch: chi tiết / khoá có thể đã đổi từ lúc đọc ngoài).
    if (tuyChon.deNghiXacNhan) {
      const moi = await tx.commissionHold.findUnique({ where: { id: hold.id }, select: { id: true, code: true, holdKey: true, detail: true } });
      if (!moi) throw new HoaHongError("HANG_CHO_KHONG_MO", "Hàng chờ không tồn tại.");
      await batDeNghiTrongKhoa(tx, moi, tuyChon, 0);
    }
    // Ghi CÓ ĐIỀU KIỆN (khuôn FIX-H9): hai người cùng bấm ⇒ người sau đổi 0 dòng ⇒ throw TRƯỚC audit ⇒ rollback sạch.
    const r = await tx.commissionHold.updateMany({
      where: { id: hold.id, status: "OPEN" },
      data: { status: "DISMISSED", resolvedAt: bc.now, resolvedById: nguoi.userId, resolutionNote: lyDo },
    });
    if (r.count === 0) throw new HoaHongError("TRANG_THAI_DA_DOI", "Hàng chờ vừa được xử lý ở nơi khác.");
    await writeAudit({
      actor: actorAudit(nguoi),
      module: MODULE_AUDIT,
      entityType: "CommissionHold",
      entityId: hold.id,
      action: "DISMISS",
      oldValues: { status: "OPEN", code: hold.code },
      newValues: { status: "DISMISSED", ...batKyAudit(tuyChon) },
      reason: lyDo,
      orgUnitId: hold.orgUnitId,
      tx,
    });
  });
  return { loai: "DA_GIU_NGUYEN" };
}

// ── ÁP DỤNG: INPUT_DRIFT → INPUT_CORRECTION ──────────────────────────────────────────────────

// `proposalIdCuaHangCho` dời sang `dieu-chinh.ts` (THUẦN) để tầng xử lý hàng chờ dùng chung mà không kéo DB; re-export giữ import cũ.
export { proposalIdCuaHangCho };

/**
 * Mã lỗi + trạng thái của đề xuất đổi nguồn ĐÃ KẾT THÚC MÀ KHÔNG GHI SỔ (STALE / REJECTED) trên ô — đọc TRONG giao dịch ghi, sau khoá. Người duyệt đã BÁC hoặc đề xuất đã LỖI THỜI
 * thì phần chênh lệch do nguồn không được một người "Áp dụng" lại bằng INPUT_DRIFT thường (hàng chờ sinh ra khi đầu vào đổi tiếp, hash mới, không còn `proposalId`).
 * Cổng đứng ở NƠI GHI và dựa trên SỰ THẬT trong DB (không dựa vào việc hàng chờ có nhãn hay không): hàng chờ thường không mang dấu vết nào của đề xuất.
 */
export async function deXuatDoiNguonKetThucKhongGhi(tx: Pick<PrismaClient, "commissionAdjustmentRequest">, calcSlotId: string): Promise<{ id: string; status: string } | null> {
  return tx.commissionAdjustmentRequest.findFirst({
    where: { calcSlotId, origin: "SOURCE_CHANGE", status: { in: ["STALE", "REJECTED"] } },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: { id: true, status: true },
  });
}

/** Tên sự kiện do `lib/nguon/doi-nguon-lead.ts` phát CÙNG transaction với MỌI lượt đổi nguồn sau khi đã có thực thu (lưới `[DNS-W*]` canh hai đầu khớp). */
const SU_KIEN_DOI_NGUON_SAU_THU = "nguon.da-doi-sau-thanh-toan";

/**
 * Các lượt đổi nguồn sau thu của lead mà ô này CHƯA đi hết quy trình duyệt (xem `doi-nguon-chua-xong.ts`). Đọc TRONG giao dịch ghi, sau khoá ô.
 * Hai câu tra rẻ: sự kiện của lead (vài dòng) + đề xuất `SOURCE_CHANGE` của chính ô.
 */
export async function suKienDoiNguonChuaXongCuaO(tx: Pick<PrismaClient, "domainEvent" | "commissionAdjustmentRequest">, i: { leadId: string; calcSlotId: string }) {
  const suKien = await tx.domainEvent.findMany({
    where: { type: SU_KIEN_DOI_NGUON_SAU_THU, payloadJson: { path: ["leadId"], equals: i.leadId } },
    select: { id: true, status: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (suKien.length === 0) return [];
  // TẤT CẢ đề xuất đổi nguồn của ô (vài dòng), không chỉ của các sự kiện này: sự kiện FAILED được giải bằng đề xuất của đường backfill (`refEventId = audit:<id>`), xem `doi-nguon-chua-xong.ts`.
  const deXuat = await tx.commissionAdjustmentRequest.findMany({
    where: { calcSlotId: i.calcSlotId, origin: "SOURCE_CHANGE" },
    select: { refEventId: true, status: true, createdAt: true },
  });
  return suKienDoiNguonChuaXong(suKien, deXuat);
}

async function apDungInputDrift(client: PrismaClient, bc: BoiCanhQuet, hold: Hold, lyDo: string, nguoi: NguoiThaoTacKy, tuyChon: TuyChonGiai): Promise<KetQuaGiai> {
  // (Hàng chờ của đề xuất ĐANG MỞ đã bị chặn ở `giaiHangCho` — cổng chung cho cả hai quyết định.)
  if (!hold.calcSlotId) throw new HoaHongError("HANG_CHO_THIEU_O", "Hàng chờ INPUT_DRIFT không gắn ô tính.");
  const slot = await client.commissionCalcSlot.findUnique({ where: { id: hold.calcSlotId } });
  if (!slot) throw new HoaHongError("O_KHONG_TON_TAI", `Ô ${hold.calcSlotId} không tồn tại.`);
  const p = await docKhoan(client, slot.paymentId);
  if (!p) throw new HoaHongError("KHOAN_KHONG_TON_TAI", `Khoản ${slot.paymentId} không tồn tại.`);
  const lap = await lapThu(client, bc, p);
  if (lap.loai !== "TINH") {
    throw new HoaHongError("KHONG_TINH_DUOC", `Không dựng được kỳ vọng hôm nay cho khoản ${p.id} (${lap.loai}) — sửa dữ liệu rồi Tính lại, hoặc chọn "Giữ nguyên".`);
  }
  const kh = lap.kh;
  const co = { centerId: slot.centerId, orgUnitId: slot.orgUnitId };
  // Kỳ ghi: `kyChanCua` → `bamKy` MỞ kỳ nếu chưa có (phép ghi). XEM TRƯỚC không được ghi gì ⇒ không gọi nó, chỉ báo tháng tự nhiên.
  const kyDc = tuyChon.xemTruoc ? null : await kyChanCua(client, bc, kyTuNhienCua(bc.now), co);

  return chayTrongKhoa(client, { khoaKhoan: [p.id], kyCutoverDaDoc: bc.kyCutover }, async (h): Promise<KetQuaGiai> => {
    const tx = h.tx;
    await kiemKhoanVanNhuCu(h, p, p.updatedAt.getTime());
    await h.khoaO([slot.id]);
    // Hàng chờ còn mở? (đọc SAU khoá khoản: hai người cùng bấm "áp dụng" ⇒ người sau thấy đã RESOLVED ⇒ throw, không ghi lần hai)
    const cu = await tx.commissionHold.findUnique({ where: { id: hold.id }, select: { status: true, code: true, holdKey: true, detail: true } });
    if (!cu || cu.status !== "OPEN") throw new HoaHongError("TRANG_THAI_DA_DOI", "Hàng chờ vừa được xử lý ở nơi khác.");

    const o = (await docTrangThaiO(tx, [slot.id])).get(slot.id);
    if (!o) throw new HoaHongError("TRANG_THAI_DA_DOI", `Ô ${slot.id} biến mất.`);
    const kq = tinhDongChoKhoan(kh.dauVao(o.coSoConLai));
    if (kq.loai !== "OK") {
      throw new HoaHongError("DAU_VAO_LOI_CAU_HINH", `Đầu vào hôm nay gặp lỗi cấu hình (${kq.loai}) — sửa chính sách rồi Tính lại; không áp điều chỉnh trên số lỗi.`);
    }
    const hashMoi = hashCuaKetQua(kh, bc, o.coSoConLai, kq);
    // Người duyệt bấm trên chênh lệch ĐÃ HIỂN THỊ (khoá hàng chờ chứa hash lúc lập). Đầu vào đổi THÊM một lần rồi mới bấm ⇒ chênh lệch tính lại là
    // chênh lệch người duyệt CHƯA TỪNG THẤY: từ chối TRƯỚC phép ghi đầu tiên, hàng chờ giữ OPEN; Tính lại để thấy chênh lệch mới.
    if (hold.holdKey !== khoaHold.inputDrift(slot.id, hashMoi)) {
      throw new HoaHongError("DAU_VAO_DA_DOI", "Đầu vào đã đổi sau khi hàng chờ được lập — Tính lại để thấy chênh lệch mới rồi duyệt hàng chờ mới.");
    }
    // Cùng bất biến carry-forward với lượt quét: "Áp dụng" KHÔNG thu hồi tiền của người nghỉ việc / affiliate ngưng / nguồn đã tắt cờ (08 §14c-1).
    const chenh = tinhChenhTheoNguoi(kyVongSauLichSu(kyVongCua(kq), o.rong, khoaLichSuCua(kh, o.coSoConLai)).kyVong, o.rong);

    // CỔNG "PHẦN CHÊNH DO ĐỔI NGUỒN KHÔNG ĐI QUA MỘT NGƯỜI": nếu chênh lệch còn phần thuộc `deXuat` của `tachChenhDoiNguon` (vai acquisition / một phía) VÀ nguyên nhân là một lượt đổi nguồn
    // sau thu chưa đi hết quy trình duyệt ⇒ không một người nào "Áp dụng" được — tiền đổi nguồn chỉ đổi qua ĐỀ XUẤT một/hai cấp. Nguyên nhân hỏi bằng SỰ THẬT trong DB, KHÔNG bằng việc hàng chờ
    // có nhãn hay không (hàng chờ thường không mang dấu vết nào của đề xuất): (1) ô từng có đề xuất đổi nguồn STALE/REJECTED; (2) lead có sự kiện đổi nguồn mà ô chưa có đề xuất POSTED giải nó
    // (kể cả khi consumer CHƯA lập đề xuất — lượt quét thường chạy trước sẽ sinh INPUT_DRIFT mang đúng phần này).
    // `tachChenhDoiNguon` một mình KHÔNG đủ làm cổng: nó chỉ biết vai nào di chuyển, không biết vì sao — chủ nguồn chụp lại (`SOURCE_OWNER`, acquisition, cố ý không phát sự kiện) cũng rơi vào `deXuat`.
    // Đứng TRƯỚC phép ghi đầu tiên (throw ⇒ rollback sạch). "Giữ nguyên" không bị chặn (an toàn tiền).
    const vaiAcq = new Set(bc.hoaHong.vaiHuong.filter((v) => v.isAcquisition).map((v) => v.code));
    if (chenh.length > 0 && tachChenhDoiNguon(chenh, vaiAcq).deXuat.length > 0) {
      const ketThuc = await deXuatDoiNguonKetThucKhongGhi(tx, slot.id);
      if (ketThuc) {
        throw new HoaHongError(
          "HANG_CHO_SAU_DE_XUAT_KHONG_GHI",
          `Ô này từng có đề xuất điều chỉnh do đổi nguồn đã ${ketThuc.status === "REJECTED" ? "bị TỪ CHỐI" : "LỖI THỜI"} (đề xuất ${ketThuc.id}) nên chênh lệch có phần do nguồn không "Áp dụng" bằng một người được: ` +
            `một người chỉ còn "Giữ nguyên" (tiền KHÔNG được điều chỉnh). Nếu chênh lệch này là do nguồn, đổi nguồn lại để hệ thống lập đề xuất mới cho người duyệt; nếu là chỉnh sửa khác (vd. đổi tỉ lệ), hiện chưa có đường áp dụng — báo người phụ trách module (08 §17.x mục 2).`,
        );
      }
      const chuaXong = p.order.leadId ? await suKienDoiNguonChuaXongCuaO(tx, { leadId: p.order.leadId, calcSlotId: slot.id }) : [];
      if (chuaXong.length > 0) {
        throw new HoaHongError(
          "HANG_CHO_DOI_NGUON_CHUA_QUA_DUYET",
          `Lead của khoản này vừa đổi nguồn sau khi đã thu tiền (sự kiện ${chuaXong[0]!.id}) mà đề xuất điều chỉnh của nó chưa được duyệt ghi sổ trên ô này, nên chênh lệch có phần do nguồn không "Áp dụng" bằng một người được ` +
            `(sẽ bỏ qua ngưỡng, duyệt hai cấp và tách nhiệm). Chờ hệ thống lập đề xuất đổi nguồn (xử lý sự kiện) rồi duyệt ở đó; "Giữ nguyên" vẫn dùng được và không làm mất đề xuất (08 §17.R3b mục 1).`,
          { suKien: chuaXong.map((e) => e.id) },
        );
      }
    }

    // Mọi cổng "Áp dụng" đã qua: XEM TRƯỚC dừng ở đây (không ghi, không mở kỳ) — người quyết thấy ĐÚNG chênh lệch mà bấm "Áp dụng" sẽ ghi.
    if (tuyChon.xemTruoc) return gomXemTruoc(chenh, kyTuNhienCua(bc.now));
    if (!kyDc) throw new Error("apDungInputDrift: thiếu kỳ ghi (lỗi lập trình).");
    const tongTuyetDoiDrift = chenh.reduce((t, c) => t + Math.abs(c.chenh), 0);
    batNguoiQuyetKhongPhaiNguoiHuong(nguoi, chenh);
    batTranTien(tuyChon, tongTuyetDoiDrift);
    await batDeNghiTrongKhoa(tx, { id: hold.id, code: cu.code, holdKey: cu.holdKey, detail: cu.detail }, tuyChon, tongTuyetDoiDrift);

    let ketQua: KetQuaGiai = { loai: "KHONG_CAN_DIEU_CHINH" };
    if (chenh.length > 0) {
      await h.khoaKyDeGhi([kyDc.id]);
      const danhTinh = await docDanhTinh(tx, kq);
      const gd = await ghiChenhLech(h, {
        loai: "INPUT_CORRECTION",
        refEventType: "HOLD",
        refEventId: hold.id,
        // Hàng chờ (ô, hash) có thể được MỞ LẠI sau khi đã áp dụng (đầu vào quay về đúng hash cũ): chênh lệch ở đây tính từ ròng HIỆN TẠI nên lượt áp dụng mới là dòng MỚI, không phải lần hai của dòng cũ.
        moLaiCuoiId: await docMocMoLaiCuoi(tx, hold.id),
        reasonCode: "INPUT_DRIFT_AP_DUNG",
        lyDo: `Người duyệt áp thay đổi đầu vào (hàng chờ ${hold.id}): ${lyDo}`,
        ky: kyDc,
        naturalPeriod: kyTuNhienCua(bc.now),
        slotId: slot.id,
        netBase: o.coSoConLai,
        chenh,
        dongGoc: o.dongGoc,
        mau: { kh, bc, kq, danhTinh, hash: hashMoi },
        paymentId: p.id,
        grossAmount: kh.vat.grossAmount,
      });
      if (gd.loai === "TRUNG") throw new HoaHongError("DA_AP_DUNG_TRUOC", "Điều chỉnh cho hàng chờ này đã được ghi — không ghi lần hai.");
      ketQua = { loai: "DA_AP_DUNG", soDong: gd.soDong, tong: gd.tong, kyGhi: kyDc.period };
    }
    // Dấu "đã khớp": lượt quét sau không còn thấy lệch với đầu vào hôm nay.
    await danhDauOKhop(tx, slot.id, bc.now, hashMoi);
    await dongCoDieuKien(tx, hold.id, { status: "RESOLVED", resolvedAt: bc.now, resolvedById: nguoi.userId, resolutionNote: lyDo });
    await writeAudit({
      actor: actorAudit(nguoi),
      module: MODULE_AUDIT,
      entityType: "CommissionHold",
      entityId: hold.id,
      action: "APPLY",
      oldValues: { status: "OPEN", code: hold.code },
      newValues: { status: "RESOLVED", ketQua: ketQua.loai, chenh: chenh.map((c) => ({ khoa: c.key, chenh: c.chenh })), ...batKyAudit(tuyChon) },
      reason: lyDo,
      orgUnitId: hold.orgUnitId,
      tx,
    });
    return ketQua;
  });
}

// ── ÁP DỤNG: PAYMENT_WITHDRAWN → đảo / khôi phục ────────────────────────────────────────────

async function daoKhoanBiRut(client: PrismaClient, bc: BoiCanhQuet, hold: Hold, lyDo: string, nguoi: NguoiThaoTacKy, tuyChon: TuyChonGiai): Promise<KetQuaGiai> {
  if (!hold.paymentId) throw new HoaHongError("HANG_CHO_THIEU_KHOAN", "Hàng chờ PAYMENT_WITHDRAWN không gắn khoản.");
  const chiTiet = (hold.detail ?? {}) as Record<string, unknown>;
  const laKhoanHoan = chiTiet.loaiKhoan === "HOAN";
  const khoan = await client.payment.findUnique({ where: { id: hold.paymentId }, select: { id: true, amount: true, adjustmentOfId: true, updatedAt: true, deletedAt: true } });
  if (!khoan) throw new HoaHongError("KHOAN_KHONG_TON_TAI", `Khoản ${hold.paymentId} không tồn tại.`);

  // Dòng/ô bị ảnh hưởng. Khoản THU: các ô của chính khoản. Khoản HOÀN: các dòng REVERSAL (và LEGACY_REVERSAL, không ô) mang `paymentId` = khoản hoàn.
  const khoaKhoan = [khoan.id, ...(khoan.adjustmentOfId ? [khoan.adjustmentOfId] : [])];
  const coSo = hold.centerId && hold.orgUnitId ? { centerId: hold.centerId, orgUnitId: hold.orgUnitId } : null;
  if (!coSo) throw new HoaHongError("HANG_CHO_THIEU_CO_SO", "Hàng chờ không quy được cơ sở — không có kỳ để ghi điều chỉnh.");
  // XEM TRƯỚC không được mở kỳ (`bamKy` là phép ghi) — xem chú thích ở `apDungInputDrift`.
  const kyDc = tuyChon.xemTruoc ? null : await kyChanCua(client, bc, kyTuNhienCua(bc.now), coSo);

  return chayTrongKhoa(client, { khoaKhoan, kyCutoverDaDoc: bc.kyCutover }, async (h): Promise<KetQuaGiai> => {
    const tx = h.tx;
    // Cổng: hàng chờ còn mở + khoản VẪN rời thực thu (nếu đã khôi phục thì hàng chờ đã tự đóng ở lượt quét — không đảo thêm).
    const cu = await tx.commissionHold.findUnique({ where: { id: hold.id }, select: { status: true, code: true, holdKey: true, detail: true } });
    if (!cu || cu.status !== "OPEN") throw new HoaHongError("TRANG_THAI_DA_DOI", "Hàng chờ vừa được xử lý ở nơi khác.");
    const nay = await tx.payment.findUnique({ where: { id: khoan.id }, select: { deletedAt: true, accountantStatus: true } });
    if (!nay || conThucThu(nay)) {
      throw new HoaHongError("KHOAN_DA_QUAY_LAI_THUC_THU", "Khoản đã được xác nhận lại và thuộc thực thu — không đảo; lượt quét kế tiếp sẽ tự đóng hàng chờ này.");
    }

    type Nhom = { slotId: string; chenh: ReturnType<typeof chenhDaoSach>; dongGoc: ReadonlyMap<KhoaNguoi, string>; mauDong?: ReadonlyMap<KhoaNguoi, CommissionTransaction>; netBase: number; paymentId: string; gross: number };
    const nhom: Nhom[] = [];
    if (!laKhoanHoan) {
      const slots = await tx.commissionCalcSlot.findMany({ where: { paymentId: khoan.id }, select: { id: true } });
      await h.khoaO(slots.map((s) => s.id));
      const tt = await docTrangThaiO(tx, slots.map((s) => s.id));
      for (const s of slots) {
        const o = tt.get(s.id);
        if (!o) continue;
        const chenh = chenhDaoSach(o.rong);
        if (chenh.length > 0) nhom.push({ slotId: s.id, chenh, dongGoc: o.dongGoc, netBase: o.coSoConLai, paymentId: khoan.id, gross: khoan.amount });
      }
    } else {
      const dongDao = await tx.commissionTransaction.findMany({ where: { paymentId: khoan.id, entryKind: "REVERSAL" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
      const slotIds = [...new Set(dongDao.map((d) => d.calcSlotId).filter((x): x is string => !!x))];
      await h.khoaO(slotIds);
      for (const slotId of slotIds) {
        const cua = dongDao.filter((d) => d.calcSlotId === slotId);
        const key = (d: CommissionTransaction) => khoaNguoi(d.roleCode, d.beneficiaryKind, (d.beneficiaryKind === "USER" ? d.beneficiaryUserId : d.beneficiaryAffiliateId) ?? "-");
        const chenh = chenhKhoiPhucHoan(cua.map((d) => ({ key: key(d), amount: d.amount })));
        if (chenh.length === 0) continue;
        const mauDong = new Map<KhoaNguoi, CommissionTransaction>();
        for (const d of cua) if (!mauDong.has(key(d))) mauDong.set(key(d), d);
        // Mọi dòng REVERSAL cùng sự kiện hoàn chụp CÙNG `netBase` (âm) ⇒ lấy dòng đầu, đổi dấu: cơ sở được trả lại.
        nhom.push({ slotId, chenh, dongGoc: new Map(), mauDong, netBase: -cua[0]!.netBase, paymentId: khoan.id, gross: -khoan.amount });
      }
    }

    // Khoản hoàn của gốc thuộc SỔ CŨ: dòng thu hồi là LEGACY_REVERSAL (không có ô) — trả lại bằng dòng riêng (xem `ghiKhoiPhucHoanLegacy`).
    const dongLegacy = laKhoanHoan ? await tx.commissionTransaction.findMany({ where: { paymentId: khoan.id, entryKind: "LEGACY_REVERSAL" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }) : [];

    // Chênh lệch ĐÃ dựng xong, chưa ghi gì: XEM TRƯỚC dừng ở đây; `tranTien` đo Σ|chênh| (kể cả dòng LEGACY: trả lại đúng số đã thu hồi).
    const chenhTatCa: { key: string; chenh: number }[] = [
      ...nhom.flatMap((g) => g.chenh.map((c) => ({ key: c.key, chenh: c.chenh }))),
      ...dongLegacy.map((d) => ({ key: `LEGACY|${d.roleCode}|${d.beneficiaryUserId ?? d.beneficiaryAffiliateId ?? "-"}`, chenh: -d.amount })),
    ];
    if (tuyChon.xemTruoc) return gomXemTruoc(chenhTatCa, kyTuNhienCua(bc.now));
    if (!kyDc) throw new Error("daoKhoanBiRut: thiếu kỳ ghi (lỗi lập trình).");
    const tongTuyetDoiRut = chenhTatCa.reduce((t, c) => t + Math.abs(c.chenh), 0);
    batNguoiQuyetKhongPhaiNguoiHuong(nguoi, chenhTatCa);
    batTranTien(tuyChon, tongTuyetDoiRut);
    await batDeNghiTrongKhoa(tx, { id: hold.id, code: cu.code, holdKey: cu.holdKey, detail: cu.detail }, tuyChon, tongTuyetDoiRut);

    let soDong = 0;
    let tong = 0;
    if (nhom.length > 0 || dongLegacy.length > 0) await h.khoaKyDeGhi([kyDc.id]);
    if (dongLegacy.length > 0) {
      const gl = await ghiKhoiPhucHoanLegacy(h, {
        refEventId: hold.id,
        lyDo: `Khoản hoàn ${khoan.id} (gốc thuộc bảng kê CŨ) không còn hiệu lực — trả lại số đã thu hồi bằng LEGACY_REVERSAL (hàng chờ ${hold.id}): ${lyDo}`,
        ky: kyDc,
        naturalPeriod: kyTuNhienCua(bc.now),
        khoan: { id: khoan.id, amount: khoan.amount },
        dongLegacy,
      });
      if (gl.loai === "TRUNG") throw new HoaHongError("DA_AP_DUNG_TRUOC", "Điều chỉnh cho hàng chờ này đã được ghi — không ghi lần hai.");
      soDong += gl.soDong;
      tong += gl.tong;
    }
    if (nhom.length > 0) {
      // Khoản THU: chênh lệch = −ròng HIỆN TẠI nên mỗi lần hàng chờ được MỞ LẠI là một lượt đảo MỚI (khoá mang thế hệ). Khoản HOÀN: "trả lại đúng số đã thu hồi" tính từ dòng REVERSAL chứ không từ ròng ⇒
      // khoá không thế hệ là chốt DUY NHẤT chống trả lại hai lần (`[RAL-05]`) — để `null`.
      const moLaiCuoiId = laKhoanHoan ? null : await docMocMoLaiCuoi(tx, hold.id);
      for (const g of nhom) {
        const gd = await ghiChenhLech(h, {
          loai: "INPUT_CORRECTION",
          refEventType: "HOLD",
          refEventId: hold.id,
          moLaiCuoiId,
          reasonCode: laKhoanHoan ? MA_KHOI_PHUC_HOAN : "KHOAN_BI_RUT_DAO",
          lyDo: laKhoanHoan
            ? `Khoản hoàn ${khoan.id} không còn hiệu lực — trả lại số đã thu hồi (hàng chờ ${hold.id}): ${lyDo}`
            : `Khoản thu ${khoan.id} không còn thuộc thực thu — thu hồi toàn bộ số đã tính (hàng chờ ${hold.id}): ${lyDo}`,
          ky: kyDc,
          naturalPeriod: kyTuNhienCua(bc.now),
          slotId: g.slotId,
          netBase: g.netBase,
          chenh: g.chenh,
          dongGoc: g.dongGoc,
          mau: null,
          mauDong: g.mauDong,
          paymentId: g.paymentId,
          grossAmount: g.gross,
        });
        if (gd.loai === "TRUNG") throw new HoaHongError("DA_AP_DUNG_TRUOC", "Điều chỉnh cho hàng chờ này đã được ghi — không ghi lần hai.");
        soDong += gd.soDong;
        tong += gd.tong;
      }
    }
    await dongCoDieuKien(tx, hold.id, { status: "RESOLVED", resolvedAt: bc.now, resolvedById: nguoi.userId, resolutionNote: lyDo });
    await writeAudit({
      actor: actorAudit(nguoi),
      module: MODULE_AUDIT,
      entityType: "CommissionHold",
      entityId: hold.id,
      action: "APPLY",
      oldValues: { status: "OPEN", code: hold.code },
      newValues: { status: "RESOLVED", cach: laKhoanHoan ? "KHOI_PHUC_HOAN" : "DAO_SACH", soDong, tong, kyGhi: kyDc.period, ...batKyAudit(tuyChon) },
      reason: lyDo,
      orgUnitId: hold.orgUnitId,
      tx,
    });
    return soDong === 0 ? { loai: "KHONG_CAN_DIEU_CHINH" } : { loai: "DA_AP_DUNG", soDong, tong, kyGhi: kyDc.period };
  });
}
