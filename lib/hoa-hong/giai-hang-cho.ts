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
import type { CommissionTransaction, PrismaClient } from "@prisma/client";

import { writeAudit } from "@/lib/audit/audit-log";
import { passesScope } from "@/lib/db-scope";

import type { BoiCanhQuet } from "./boi-canh";
import { batGiaiHangCho, chenhDaoSach, chenhKhoiPhucHoan, type QuyetDinhGiai } from "./dieu-chinh";
import { HoaHongError, batLyDoToiThieu } from "./kieu";
import { khoaHold, khoaNguoi, type KhoaNguoi } from "./khoa-so";
import { chayTrongKhoa } from "./ghi-so";
import { tinhChenhTheoNguoi } from "./o-tinh";
import { MA_KHOI_PHUC_HOAN, docTrangThaiO } from "./o-tinh-db";
import { conThucThu, docKhoan } from "./nap-khoan";
import { danhDauOKhop, docDanhTinh, ghiChenhLech, ghiKhoiPhucHoanLegacy, hashCuaKetQua, kiemKhoanVanNhuCu, kyChanCua, kyVongCua, lapThu } from "./quet-khoan";
import { tinhDongChoKhoan } from "./tinh-dong-cho-khoan";
import { kyTuNhienCua } from "./but-toan";
import type { NguoiThaoTacKy } from "./ky-service";

const MODULE_AUDIT = "hoa-hong";

export type KetQuaGiai =
  | { loai: "DA_AP_DUNG"; soDong: number; tong: number; kyGhi: string }
  /** Đầu vào đã trôi về đúng số đã tính ⇒ không còn gì để điều chỉnh; hàng chờ vẫn được đóng. */
  | { loai: "KHONG_CAN_DIEU_CHINH" }
  | { loai: "DA_GIU_NGUYEN" };

export async function giaiHangCho(
  client: PrismaClient,
  bc: BoiCanhQuet,
  i: { holdId: string; quyetDinh: QuyetDinhGiai; lyDo: string; nguoi: NguoiThaoTacKy },
): Promise<KetQuaGiai> {
  const lyDo = batLyDoToiThieu(i.lyDo, i.quyetDinh === "AP_DUNG" ? "Áp dụng điều chỉnh" : "Giữ nguyên");
  const hold = await client.commissionHold.findUnique({ where: { id: i.holdId } });
  if (!hold) throw new HoaHongError("HANG_CHO_KHONG_MO", "Hàng chờ không tồn tại.");
  batGiaiHangCho({ code: hold.code, trangThai: hold.status, quyetDinh: i.quyetDinh });
  // Phạm vi GHI: người ở cơ sở khác không giải được hàng chờ của cơ sở này dù gõ đúng id (IDOR).
  if (!passesScope("CommissionHold", { centerId: hold.centerId }, i.nguoi.quyen)) {
    throw new HoaHongError("NGOAI_PHAM_VI", "Hàng chờ thuộc cơ sở ngoài phạm vi của bạn.");
  }

  if (i.quyetDinh === "GIU_NGUYEN") return giuNguyen(client, bc, hold, lyDo, i.nguoi);
  return hold.code === "INPUT_DRIFT" ? apDungInputDrift(client, bc, hold, lyDo, i.nguoi) : daoKhoanBiRut(client, bc, hold, lyDo, i.nguoi);
}

type Hold = NonNullable<Awaited<ReturnType<PrismaClient["commissionHold"]["findUnique"]>>>;
const actorAudit = (n: NguoiThaoTacKy) => ({ id: n.userId, name: n.ten });

// ── GIỮ NGUYÊN ───────────────────────────────────────────────────────────────────────────────

async function giuNguyen(client: PrismaClient, bc: BoiCanhQuet, hold: Hold, lyDo: string, nguoi: NguoiThaoTacKy): Promise<KetQuaGiai> {
  await client.$transaction(async (tx) => {
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
      newValues: { status: "DISMISSED" },
      reason: lyDo,
      orgUnitId: hold.orgUnitId,
      tx,
    });
  });
  return { loai: "DA_GIU_NGUYEN" };
}

// ── ÁP DỤNG: INPUT_DRIFT → INPUT_CORRECTION ──────────────────────────────────────────────────

async function apDungInputDrift(client: PrismaClient, bc: BoiCanhQuet, hold: Hold, lyDo: string, nguoi: NguoiThaoTacKy): Promise<KetQuaGiai> {
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
  const kyDc = await kyChanCua(client, bc, kyTuNhienCua(bc.now), co);

  return chayTrongKhoa(client, { khoaKhoan: [p.id], kyCutoverDaDoc: bc.kyCutover }, async (h): Promise<KetQuaGiai> => {
    const tx = h.tx;
    await kiemKhoanVanNhuCu(h, p, p.updatedAt.getTime());
    await h.khoaO([slot.id]);
    // Hàng chờ còn mở? (đọc SAU khoá khoản: hai người cùng bấm "áp dụng" ⇒ người sau thấy đã RESOLVED ⇒ throw, không ghi lần hai)
    const cu = await tx.commissionHold.findUnique({ where: { id: hold.id }, select: { status: true } });
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
    const chenh = tinhChenhTheoNguoi(kyVongCua(kq), o.rong);

    let ketQua: KetQuaGiai = { loai: "KHONG_CAN_DIEU_CHINH" };
    if (chenh.length > 0) {
      await h.khoaKyDeGhi([kyDc.id]);
      const danhTinh = await docDanhTinh(tx, kq);
      const gd = await ghiChenhLech(h, {
        loai: "INPUT_CORRECTION",
        refEventType: "HOLD",
        refEventId: hold.id,
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
    await tx.commissionHold.update({ where: { id: hold.id }, data: { status: "RESOLVED", resolvedAt: bc.now, resolvedById: nguoi.userId, resolutionNote: lyDo } });
    await writeAudit({
      actor: actorAudit(nguoi),
      module: MODULE_AUDIT,
      entityType: "CommissionHold",
      entityId: hold.id,
      action: "APPLY",
      oldValues: { status: "OPEN", code: hold.code },
      newValues: { status: "RESOLVED", ketQua: ketQua.loai, chenh: chenh.map((c) => ({ khoa: c.key, chenh: c.chenh })) },
      reason: lyDo,
      orgUnitId: hold.orgUnitId,
      tx,
    });
    return ketQua;
  });
}

// ── ÁP DỤNG: PAYMENT_WITHDRAWN → đảo / khôi phục ────────────────────────────────────────────

async function daoKhoanBiRut(client: PrismaClient, bc: BoiCanhQuet, hold: Hold, lyDo: string, nguoi: NguoiThaoTacKy): Promise<KetQuaGiai> {
  if (!hold.paymentId) throw new HoaHongError("HANG_CHO_THIEU_KHOAN", "Hàng chờ PAYMENT_WITHDRAWN không gắn khoản.");
  const chiTiet = (hold.detail ?? {}) as Record<string, unknown>;
  const laKhoanHoan = chiTiet.loaiKhoan === "HOAN";
  const khoan = await client.payment.findUnique({ where: { id: hold.paymentId }, select: { id: true, amount: true, adjustmentOfId: true, updatedAt: true, deletedAt: true } });
  if (!khoan) throw new HoaHongError("KHOAN_KHONG_TON_TAI", `Khoản ${hold.paymentId} không tồn tại.`);

  // Dòng/ô bị ảnh hưởng. Khoản THU: các ô của chính khoản. Khoản HOÀN: các dòng REVERSAL (và LEGACY_REVERSAL, không ô) mang `paymentId` = khoản hoàn.
  const khoaKhoan = [khoan.id, ...(khoan.adjustmentOfId ? [khoan.adjustmentOfId] : [])];
  const coSo = hold.centerId && hold.orgUnitId ? { centerId: hold.centerId, orgUnitId: hold.orgUnitId } : null;
  if (!coSo) throw new HoaHongError("HANG_CHO_THIEU_CO_SO", "Hàng chờ không quy được cơ sở — không có kỳ để ghi điều chỉnh.");
  const kyDc = await kyChanCua(client, bc, kyTuNhienCua(bc.now), coSo);

  return chayTrongKhoa(client, { khoaKhoan, kyCutoverDaDoc: bc.kyCutover }, async (h): Promise<KetQuaGiai> => {
    const tx = h.tx;
    // Cổng: hàng chờ còn mở + khoản VẪN rời thực thu (nếu đã khôi phục thì hàng chờ đã tự đóng ở lượt quét — không đảo thêm).
    const cu = await tx.commissionHold.findUnique({ where: { id: hold.id }, select: { status: true } });
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
      for (const g of nhom) {
        const gd = await ghiChenhLech(h, {
          loai: "INPUT_CORRECTION",
          refEventType: "HOLD",
          refEventId: hold.id,
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
    await tx.commissionHold.update({ where: { id: hold.id }, data: { status: "RESOLVED", resolvedAt: bc.now, resolvedById: nguoi.userId, resolutionNote: lyDo } });
    await writeAudit({
      actor: actorAudit(nguoi),
      module: MODULE_AUDIT,
      entityType: "CommissionHold",
      entityId: hold.id,
      action: "APPLY",
      oldValues: { status: "OPEN", code: hold.code },
      newValues: { status: "RESOLVED", cach: laKhoanHoan ? "KHOI_PHUC_HOAN" : "DAO_SACH", soDong, tong, kyGhi: kyDc.period },
      reason: lyDo,
      orgUnitId: hold.orgUnitId,
      tx,
    });
    return soDong === 0 ? { loai: "KHONG_CAN_DIEU_CHINH" } : { loai: "DA_AP_DUNG", soDong, tong, kyGhi: kyDc.period };
  });
}
