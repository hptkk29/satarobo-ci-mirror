import "server-only";
// lib/entitlements/hang-doi/hanh-dong.ts — CÁC HÀNH ĐỘNG XỬ LÝ DÒNG HÀNG ĐỢI QUYỀN HỌC. DB, GHI.
//
// Mỗi hành động theo MỘT khuôn (lưới `[HD-W*]` canh từng bước):
//   1. NGOÀI transaction: tìm dòng qua `scopedDb(actor)` (người cấp cơ sở KHÔNG thấy dòng cơ sở khác ⇒ "không tìm thấy"); kiểm `entitlements:manage` tại ĐÚNG cơ sở của
//      dòng bằng `can()` v2 (action ở `_actions.ts` còn gọi `checkPermission` trước — chạy qua grant + cờ RBAC_V2 như mọi action khác); đọc cờ phạm vi của cơ sở.
//   2. TRONG transaction: `khoaDonTrongTx` TRƯỚC mọi thứ → ĐỌC LẠI dòng + quyền học dưới khoá → mọi cổng (`xetHanhDong`, tiêu thụ, trạng thái) → CHỈ KHI qua hết mới ghi.
//      Từ chối = `throw` (luật rollback: `return` không rollback); không có `db.` trong tx.
//   3. Ghi `AuditLog` (ai · lúc nào · trước/sau · lý do) trong CÙNG transaction. Dòng đã đóng ⇒ trả "không có gì đổi" và KHÔNG ghi audit ⇒ bấm lại không đổi gì, không trùng.
//
// 🔴 HÀNG ĐỢI KHÔNG BAO GIỜ TẠO / XOÁ `StudyEntitlementUsage` (sổ cái buổi đã học) và không gọi `ghiNhanBai` — [ENT-USAGE-PIN] + `[HD-DB-*]` đếm hàng.
// 🔴 Chỉ MỘT hành động đụng quyền học: `duyetThuHoi` (đóng quyền CHƯA tiêu thụ buổi nào qua `dungQuyenHocTrongTx` có sẵn). Đã tiêu thụ ⇒ không có đường thu hồi ở đây.
// 🔴 `duyetHocVuot` (quyết định 5, 13/10/2026) là hành động DUY NHẤT gác bằng `entitlements:approve-exception` thay vì `manage` (phần học vượt VƯỢT TRẦN); nó ghi `skippedSessions` /
//    `configSnapshot.xepLop` của quyền học và sinh `MakeupNeed` ORDER_CONVERSION qua `taoDongHocBu` — vẫn KHÔNG ghi Usage, KHÔNG ghi OrderItem, KHÔNG đụng điểm danh / cổng phụ huynh.
// 🔴 KHÔNG ghi `OrderItem.studentId` / `OrderItem.enrollmentId` (các cột đó nuôi hoa hồng, hoàn tiền, bảo lưu) — "gắn học viên / ghi danh" đi qua màn Chuyển đổi có sẵn.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { passesScope, scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { khoaDonTrongTx } from "@/lib/finance/ghi-tien-don";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { hanhDongChoChuyenDoi } from "../cho-chuyen-doi";
import { docBuoiDaDayTheoBai } from "../bai-ke-tiep-db";
import { taoDongHocBu } from "@/lib/hoc-bu/dong-service";
import { apDungDuyetHocVuot, docDeXuat, dinhDangDaiBai, LoiDuyetHocVuot, quyenCanDuyetHocVuot } from "../hoc-vuot-duyet";
import { ghiDaQuyet, type HanhDongDaQuyet } from "../da-quyet";
import { daTieuThuBuoi } from "../da-tieu-thu";
import { dungQuyenHocTrongTx, LoiQuyenHoc } from "../dich-vu";
import { laThuHocPhiTheoPhamViBat } from "../feature";
import { xetCapQuyenHocCoKetQua, xetXepLopCoKetQua } from "../hich";
import { doiSoatLechMotDon } from "./doi-soat";
import { thiHanhHanhDongCho } from "./ghi-dong";
import { LoiHangDoi, type MaLoiHangDoi } from "./loi";
import { kiemLyDoNhap, xetHanhDong, type DongHangDoiXet, type HanhDongHangDoi } from "./hanh-dong-duoc-phep";

export { LoiHangDoi, type MaLoiHangDoi } from "./loi";

export type KetQuaHanhDong = { readonly ok: true; readonly daLam: boolean; readonly thongBao: string } | { readonly ok: false; readonly ma: MaLoiHangDoi; readonly error: string };

export interface VaoHanhDong {
  readonly actor: Actor;
  /** Người bấm — vào `AuditLog.actorId/actorName` và `payload.daQuyet.boi`. */
  readonly nguoi: AuditActor;
  readonly dongId: string;
  /** Lý do người nhập (bắt buộc ≥ 10 ký tự với mọi hành động trừ `thuLai`). */
  readonly lyDo: string;
  /** Đồng hồ của lượt gọi — BẮT BUỘC (luật 7 + 19). */
  readonly now: Date;
}

const TX_OPTS = { maxWait: 15_000, timeout: 30_000 } as const;

const khongDoi = (thongBao: string): KetQuaHanhDong => ({ ok: true, daLam: false, thongBao });
const loi = (ma: MaLoiHangDoi, error: string): KetQuaHanhDong => ({ ok: false, ma, error });

function dichLoi(e: unknown): KetQuaHanhDong {
  if (e instanceof LoiHangDoi) return loi(e.ma, e.message);
  if (e instanceof LoiQuyenHoc) return loi("KHONG_CHO_PHEP", e.message);
  console.error("[hang-doi-quyen-hoc]", e);
  return loi("LOI", "Có lỗi khi xử lý — thử lại sau ít phút.");
}

interface DongTim {
  readonly id: string;
  readonly orderId: string;
  readonly centerId: string;
  readonly orgUnitId: string | null;
}

interface ChuanBi {
  readonly dong: DongTim;
  readonly orgUnitId: string | null;
  readonly coBat: boolean;
}

/** Bước 1 (NGOÀI transaction): cách ly cơ sở + quyền + cờ. Ném `LoiHangDoi`. */
async function chuanBi(actor: Actor, dongId: string): Promise<ChuanBi> {
  const dong = await scopedDb(actor).studyEntitlementXuLy.findUnique({ where: { id: dongId }, select: { id: true, orderId: true, centerId: true, orgUnitId: true } });
  // `findUnique` của scopedDb đã lọc theo cơ sở; `passesScope` là lớp thứ hai (scopedDb KHÔNG che write — mọi đường ghi phải tự kiểm).
  if (!dong || !passesScope("StudyEntitlementXuLy", dong, actor)) throw new LoiHangDoi("KHONG_TIM_THAY", "Không tìm thấy dòng hàng đợi.");
  const orgUnitId = dong.orgUnitId ?? (await orgUnitIdForCenter(dong.centerId));
  if (!can(actor, "entitlements:manage", { centerId: dong.centerId, orgUnitId: orgUnitId ?? undefined })) {
    throw new LoiHangDoi("KHONG_QUYEN", "Bạn không có quyền xử lý hàng đợi quyền học (entitlements:manage).");
  }
  const coBat = orgUnitId ? await laThuHocPhiTheoPhamViBat(orgUnitId) : false;
  return { dong, orgUnitId, coBat };
}

type Client = Prisma.TransactionClient | typeof db;

/** Trạng thái quyền học của dòng đơn → đầu vào của `xetHanhDong`. Đọc bằng `client` (trong tx thì dưới khoá đơn). */
async function docDongXet(client: Client, h: { loai: DongHangDoiXet["loai"]; trangThai: DongHangDoiXet["trangThai"]; orderItemId: string; payload: unknown }): Promise<DongHangDoiXet> {
  const q = await client.studyEntitlement.findFirst({
    where: { orderItemId: h.orderItemId, status: { not: "VOIDED" } },
    select: { id: true, status: true, consumedSessions: true },
  });
  let daTieuThu = false;
  if (q) {
    daTieuThu = q.consumedSessions > 0 || (await client.studyEntitlementUsage.count({ where: { entitlementId: q.id, voidedAt: null } })) > 0;
  }
  const dx = h.loai === "CHO_DUYET_HOC_VUOT" ? docDeXuat(h.payload) : null;
  return { loai: h.loai, trangThai: h.trangThai, coQuyenHoc: q !== null, trangThaiQuyenHoc: q?.status ?? null, daTieuThu, quyenCanDuyet: dx ? quyenCanDuyetHocVuot(dx) : null };
}

function cho(hd: HanhDongHangDoi, dong: DongHangDoiXet, coBat: boolean, quyen: { coQuyenManage: boolean; coQuyenDuyetNgoaiLe: boolean } = { coQuyenManage: true, coQuyenDuyetNgoaiLe: false }): void {
  const kq = xetHanhDong(hd, dong, { ...quyen, coBat });
  if (!kq.duoc) throw new LoiHangDoi("KHONG_CHO_PHEP", kq.lyDo);
}

function quyetDinh(hanhDong: HanhDongDaQuyet, dauVan: string, vao: VaoHanhDong) {
  return { dauVan, hanhDong, boi: { id: vao.nguoi.id, ten: vao.nguoi.name }, luc: vao.now.toISOString(), lyDo: vao.lyDo.trim() };
}

const ghiChuDong = (vao: VaoHanhDong): string => `${vao.nguoi.name}: ${vao.lyDo.trim()}`;

// ═══ ĐÓNG CÓ LÝ DO / GIỮ QUYỀN ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

async function dongCoLyDo(vao: VaoHanhDong, hd: "DONG" | "GIU_QUYEN"): Promise<KetQuaHanhDong> {
  const loiNhap = kiemLyDoNhap(vao.lyDo);
  if (loiNhap) return loi("DAU_VAO", loiNhap);
  try {
    const cb = await chuanBi(vao.actor, vao.dongId);
    return await db.$transaction(async (tx): Promise<KetQuaHanhDong> => {
      await khoaDonTrongTx(tx, cb.dong.orderId);
      const hien = await tx.studyEntitlementXuLy.findUnique({ where: { id: vao.dongId } });
      if (!hien) throw new LoiHangDoi("KHONG_TIM_THAY", "Không tìm thấy dòng hàng đợi.");
      if (hien.trangThai !== "OPEN") return khongDoi("Dòng đã đóng — không có gì thay đổi.");
      cho(hd, await docDongXet(tx, hien), cb.coBat);

      const hanhDongQuyet: HanhDongDaQuyet = hd === "GIU_QUYEN" ? "GIU_QUYEN" : "DONG";
      const q = quyetDinh(hanhDongQuyet, hien.lyDo, vao);
      await tx.studyEntitlementXuLy.update({
        where: { id: hien.id },
        data: { trangThai: "DA_XU_LY", resolvedAt: vao.now, resolvedNote: ghiChuDong(vao), payload: ghiDaQuyet(hien.payload, q) as Prisma.InputJsonValue },
      });
      await writeAudit({
        actor: vao.nguoi,
        module: "entitlements",
        entityType: "StudyEntitlementXuLy",
        entityId: hien.id,
        action: hd === "GIU_QUYEN" ? "KEEP_ENTITLEMENT" : "CLOSE",
        oldValues: { loai: hien.loai, trangThai: hien.trangThai, lyDo: hien.lyDo },
        newValues: { trangThai: "DA_XU_LY", hanhDong: hanhDongQuyet },
        reason: vao.lyDo.trim(),
        orgUnitId: hien.centerId,
        tx,
      });
      return { ok: true, daLam: true, thongBao: hd === "GIU_QUYEN" ? "Đã ghi nhận: giữ quyền học." : "Đã đóng dòng." };
    }, TX_OPTS);
  } catch (e) {
    return dichLoi(e);
  }
}

export const dongDongHangDoi = (vao: VaoHanhDong): Promise<KetQuaHanhDong> => dongCoLyDo(vao, "DONG");
export const giuQuyenHoc = (vao: VaoHanhDong): Promise<KetQuaHanhDong> => dongCoLyDo(vao, "GIU_QUYEN");

// ═══ CẦN DUYỆT TAY ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

export async function danhDauCanDuyet(vao: VaoHanhDong): Promise<KetQuaHanhDong> {
  const loiNhap = kiemLyDoNhap(vao.lyDo);
  if (loiNhap) return loi("DAU_VAO", loiNhap);
  try {
    const cb = await chuanBi(vao.actor, vao.dongId);
    return await db.$transaction(async (tx): Promise<KetQuaHanhDong> => {
      await khoaDonTrongTx(tx, cb.dong.orderId);
      const hien = await tx.studyEntitlementXuLy.findUnique({ where: { id: vao.dongId } });
      if (!hien) throw new LoiHangDoi("KHONG_TIM_THAY", "Không tìm thấy dòng hàng đợi.");
      if (hien.trangThai !== "OPEN") return khongDoi("Dòng đã đóng — không có gì thay đổi.");
      cho("DANH_DAU_CAN_DUYET", await docDongXet(tx, hien), cb.coBat);

      // Dòng TREO_DUYET_TAY của cùng dòng đơn (khoá duy nhất (orderItemId, loai)): mở / mở lại / đổi lý do — KHÔNG chèn dòng thứ hai.
      const treo = await tx.studyEntitlementXuLy.findUnique({ where: { orderItemId_loai: { orderItemId: hien.orderItemId, loai: "TREO_DUYET_TAY" } } });
      const lyDoTreo = `Cần duyệt tay: ${vao.lyDo.trim()}`;
      const viec = hanhDongChoChuyenDoi(treo ? { trangThai: treo.trangThai, lyDo: treo.lyDo, daQuyetDauVan: null } : null, { kieu: "PHAI_CHO", lyDo: lyDoTreo });
      await thiHanhHanhDongCho(
        tx,
        "TREO_DUYET_TAY",
        viec,
        treo,
        {
          orderId: hien.orderId,
          orderItemId: hien.orderItemId,
          courseId: hien.courseId,
          leadChildId: hien.leadChildId,
          studentId: hien.studentId,
          entitlementId: null,
          centerId: hien.centerId,
          orgUnitId: hien.orgUnitId ?? cb.orgUnitId,
        },
        { nguon: "NGUOI_DANH_DAU", tuLoai: hien.loai, tuDongId: hien.id },
        vao.now,
      );
      const q = quyetDinh("DANH_DAU_CAN_DUYET", hien.lyDo, vao);
      await tx.studyEntitlementXuLy.update({
        where: { id: hien.id },
        data: { trangThai: "DA_XU_LY", resolvedAt: vao.now, resolvedNote: `Chuyển sang TREO_DUYET_TAY — ${ghiChuDong(vao)}`, payload: ghiDaQuyet(hien.payload, q) as Prisma.InputJsonValue },
      });
      await writeAudit({
        actor: vao.nguoi,
        module: "entitlements",
        entityType: "StudyEntitlementXuLy",
        entityId: hien.id,
        action: "MARK_MANUAL_REVIEW",
        oldValues: { loai: hien.loai, trangThai: hien.trangThai, lyDo: hien.lyDo },
        newValues: { trangThai: "DA_XU_LY", chuyenSang: "TREO_DUYET_TAY" },
        reason: vao.lyDo.trim(),
        orgUnitId: hien.centerId,
        tx,
      });
      return { ok: true, daLam: true, thongBao: "Đã chuyển sang 'treo duyệt tay'." };
    }, TX_OPTS);
  } catch (e) {
    return dichLoi(e);
  }
}

// ═══ DUYỆT THU HỒI (chỉ quyền học CHƯA tiêu thụ) ════════════════════════════════════════════════════════════════════════════════════════════════════

export async function duyetThuHoi(vao: VaoHanhDong): Promise<KetQuaHanhDong> {
  const loiNhap = kiemLyDoNhap(vao.lyDo);
  if (loiNhap) return loi("DAU_VAO", loiNhap);
  try {
    const cb = await chuanBi(vao.actor, vao.dongId);
    // Làm tươi dòng NGOÀI transaction bằng đúng hàm xét (chế độ CHI_GHI_NHAN — không cấp): tiền đã đủ lại thì hàm đó tự ĐÓNG dòng CAN_THU_HOI, và lượt này thấy dòng đã đóng.
    if (cb.coBat) await xetCapQuyenHocCoKetQua(cb.dong.orderId, "HANG_DOI_THU_LAI", vao.now, "CHI_GHI_NHAN");
    return await db.$transaction(async (tx): Promise<KetQuaHanhDong> => {
      await khoaDonTrongTx(tx, cb.dong.orderId);
      const hien = await tx.studyEntitlementXuLy.findUnique({ where: { id: vao.dongId } });
      if (!hien) throw new LoiHangDoi("KHONG_TIM_THAY", "Không tìm thấy dòng hàng đợi.");
      if (hien.trangThai !== "OPEN") return khongDoi("Dòng đã đóng hoặc đã chuyển loại (tiền đã đủ lại, quyền học vừa có buổi tiêu thụ, hoặc người khác đã xử lý) — không thu hồi. Tải lại trang để xem dòng mới.");

      const q0 = await tx.studyEntitlement.findFirst({ where: { orderItemId: hien.orderItemId, status: { not: "VOIDED" } }, select: { id: true } });
      if (!q0) throw new LoiHangDoi("KHONG_CHO_PHEP", "Dòng đơn không còn quyền học nào để thu hồi.");
      // Khoá dòng quyền học TRƯỚC khi đọc số buổi tiêu thụ: ghi nhận bài (điểm danh) cũng khoá dòng này, nên giữa lúc ta kiểm "chưa tiêu thụ" và lúc ta đóng quyền
      // không thể có buổi nào lọt vào sổ cái. `dungQuyenHocTrongTx` lấy lại cùng khoá trong cùng tx (không chờ chính mình).
      await tx.$queryRaw`SELECT "id" FROM "StudyEntitlement" WHERE "id" = ${q0.id} FOR UPDATE`;
      const q = await tx.studyEntitlement.findUnique({ where: { id: q0.id }, select: { id: true, status: true, consumedSessions: true } });
      if (!q || q.status === "VOIDED") throw new LoiHangDoi("KHONG_CHO_PHEP", "Quyền học đã bị huỷ — không còn gì để thu hồi.");
      const daTieuThu = await daTieuThuBuoi(tx, q.id, q.consumedSessions);
      cho("DUYET_THU_HOI", { loai: hien.loai, trangThai: hien.trangThai, coQuyenHoc: true, trangThaiQuyenHoc: q.status, daTieuThu, quyenCanDuyet: null }, cb.coBat);

      const { quyenHoc, suKien } = await dungQuyenHocTrongTx(tx, { entitlementId: q.id, lyDo: vao.lyDo.trim(), actor: vao.nguoi, now: vao.now });
      const qd = quyetDinh("THU_HOI", hien.lyDo, vao);
      await tx.studyEntitlementXuLy.update({
        where: { id: hien.id },
        data: {
          trangThai: "DA_XU_LY",
          resolvedAt: vao.now,
          resolvedNote: `Thu hồi (${suKien === "HUY_HOAN" ? "huỷ quyền chưa xếp lớp" : "dừng quyền học"}) — ${ghiChuDong(vao)}`,
          entitlementId: q.id,
          payload: ghiDaQuyet(hien.payload, qd) as Prisma.InputJsonValue,
        },
      });
      await writeAudit({
        actor: vao.nguoi,
        module: "entitlements",
        entityType: "StudyEntitlementXuLy",
        entityId: hien.id,
        action: "REVOKE_ENTITLEMENT",
        oldValues: { loai: hien.loai, trangThai: hien.trangThai, lyDo: hien.lyDo, quyenHoc: { id: q.id, trangThai: q.status } },
        newValues: { trangThai: "DA_XU_LY", quyenHoc: { id: q.id, trangThai: quyenHoc.status }, suKien },
        reason: vao.lyDo.trim(),
        orgUnitId: hien.centerId,
        tx,
      });
      return { ok: true, daLam: true, thongBao: "Đã thu hồi quyền học. Ghi danh và lịch học KHÔNG bị đổi — xử lý riêng nếu cần." };
    }, TX_OPTS);
  } catch (e) {
    return dichLoi(e);
  }
}

// ═══ THỬ CẤP LẠI ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

export interface VaoThuLai {
  readonly actor: Actor;
  readonly nguoi: AuditActor;
  readonly dongId: string;
  readonly now: Date;
}

/**
 * Chạy lại ĐÚNG đường có sẵn — `xetCapQuyenHocChoDon` (chế độ CAP) rồi `xetXepLopChoDon` — cho đơn của dòng này, rồi đối soát lệch. KHÔNG có logic cấp nào ở đây:
 * đủ tiền + biết học viên ⇒ hàm có sẵn cấp và đóng dòng; thiếu ⇒ dòng VẪN MỞ, hàm có sẵn ghi lý do mới (không ném, không đoán học viên).
 */
export async function thuCapLai(vao: VaoThuLai): Promise<KetQuaHanhDong> {
  try {
    const cb = await chuanBi(vao.actor, vao.dongId);
    const truoc = await db.studyEntitlementXuLy.findUnique({ where: { id: vao.dongId } });
    if (!truoc) throw new LoiHangDoi("KHONG_TIM_THAY", "Không tìm thấy dòng hàng đợi.");
    if (truoc.trangThai !== "OPEN") return khongDoi("Dòng đã đóng — không có gì thay đổi.");
    cho("THU_LAI", await docDongXet(db, truoc), cb.coBat);

    const cap = await xetCapQuyenHocCoKetQua(cb.dong.orderId, "HANG_DOI_THU_LAI", vao.now, "CAP");
    const xep = await xetXepLopCoKetQua(cb.dong.orderId, "HANG_DOI_THU_LAI", vao.now);
    await doiSoatLechMotDon(cb.dong.orderId, vao.now, new Set(cap.chuaXacDinhDuocDong));

    const sau = await db.studyEntitlementXuLy.findUnique({ where: { id: vao.dongId } });
    if (!sau) throw new LoiHangDoi("LOI", "Dòng hàng đợi biến mất sau khi thử lại.");
    const doi = sau.trangThai !== truoc.trangThai || sau.lyDo !== truoc.lyDo || cap.daCap.length > 0 || xep.daXep.length > 0;
    if (doi) {
      await db.$transaction(async (tx) => {
        await khoaDonTrongTx(tx, cb.dong.orderId);
        await writeAudit({
          actor: vao.nguoi,
          module: "entitlements",
          entityType: "StudyEntitlementXuLy",
          entityId: truoc.id,
          action: "RETRY",
          oldValues: { trangThai: truoc.trangThai, lyDo: truoc.lyDo },
          newValues: { trangThai: sau.trangThai, lyDo: sau.lyDo, daCap: cap.daCap.length, daXep: xep.daXep.length },
          orgUnitId: truoc.centerId,
          tx,
        });
      }, TX_OPTS);
    }
    if (cap.daCap.length > 0) return { ok: true, daLam: true, thongBao: `Đã cấp ${cap.daCap.length} quyền học.` };
    if (sau.trangThai !== "OPEN") return { ok: true, daLam: true, thongBao: `Dòng đã tự đóng: ${sau.resolvedNote ?? "điều kiện không còn."}` };
    return {
      ok: true,
      daLam: doi,
      thongBao: doi ? `Chưa đủ điều kiện — lý do mới: ${sau.lyDo}` : "Vẫn chưa đủ điều kiện — không có gì thay đổi.",
    };
  } catch (e) {
    return dichLoi(e);
  }
}

// ═══ DUYỆT HỌC VƯỢT THÊM (quyết định 5 — chỉ khi vượt trần) ═══════════════════════════════════════════════════════════════════════════════════════════════

interface ChuanBiDuyet extends ChuanBi {
  readonly coManage: boolean;
  readonly coDuyetNgoaiLe: boolean;
}

/** Như `chuanBi` nhưng quyền là `manage` HOẶC `approve-exception` tại cơ sở của dòng — tầng nào đủ quyền duyệt do `xetHanhDong` quyết (đọc payload dưới khoá). */
async function chuanBiDuyet(actor: Actor, dongId: string): Promise<ChuanBiDuyet> {
  const dong = await scopedDb(actor).studyEntitlementXuLy.findUnique({ where: { id: dongId }, select: { id: true, orderId: true, centerId: true, orgUnitId: true } });
  if (!dong || !passesScope("StudyEntitlementXuLy", dong, actor)) throw new LoiHangDoi("KHONG_TIM_THAY", "Không tìm thấy dòng hàng đợi.");
  const orgUnitId = dong.orgUnitId ?? (await orgUnitIdForCenter(dong.centerId));
  const target = { centerId: dong.centerId, orgUnitId: orgUnitId ?? undefined };
  const coManage = can(actor, "entitlements:manage", target);
  const coDuyetNgoaiLe = can(actor, "entitlements:approve-exception", target);
  if (!coManage && !coDuyetNgoaiLe) throw new LoiHangDoi("KHONG_QUYEN", "Bạn không có quyền duyệt học vượt (entitlements:approve-exception / entitlements:manage).");
  const coBat = orgUnitId ? await laThuHocPhiTheoPhamViBat(orgUnitId) : false;
  return { dong, orgUnitId, coBat, coManage, coDuyetNgoaiLe };
}

/**
 * Duyệt học vượt THÊM cho dòng CHO_DUYET_HOC_VUOT. Phần vượt trần cần `entitlements:approve-exception`; người chỉ có `manage` chỉ duyệt được khi `quyenCanDuyetHocVuot`
 * cho phép (cấu hình trần không rõ + tổng bài ≤ trần mặc định). Khuôn như mọi hành động hàng đợi: khoá đơn → đọc lại → mọi cổng → mới ghi; từ chối = `throw`.
 */
export async function duyetHocVuot(vao: VaoHanhDong): Promise<KetQuaHanhDong> {
  const loiNhap = kiemLyDoNhap(vao.lyDo);
  if (loiNhap) return loi("DAU_VAO", loiNhap);
  try {
    const cb = await chuanBiDuyet(vao.actor, vao.dongId);
    // ── NGOÀI transaction: chỉ ĐỌC ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    const truoc = await db.studyEntitlementXuLy.findUnique({ where: { id: vao.dongId } });
    if (!truoc) throw new LoiHangDoi("KHONG_TIM_THAY", "Không tìm thấy dòng hàng đợi.");
    if (truoc.trangThai !== "OPEN") return khongDoi("Dòng đã đóng — không có gì thay đổi.");
    if (truoc.loai !== "CHO_DUYET_HOC_VUOT") throw new LoiHangDoi("KHONG_CHO_PHEP", "Chỉ dòng xin duyệt học vượt mới duyệt được.");
    const dx = docDeXuat(truoc.payload);
    if (!dx) throw new LoiHangDoi("KHONG_CHO_PHEP", "Không đọc được đề xuất học vượt của dòng này — không duyệt theo thứ đoán.");
    // Cổng QUYỀN sớm (trước mọi đọc nặng): phần vượt trần mà người bấm không giữ approve-exception ⇒ từ chối bằng mã KHONG_QUYEN.
    if (quyenCanDuyetHocVuot(dx) === "APPROVE_EXCEPTION" && !cb.coDuyetNgoaiLe) {
      throw new LoiHangDoi("KHONG_QUYEN", "Phần học vượt này vượt trần — chỉ người có quyền duyệt ngoại lệ (entitlements:approve-exception: Giám đốc / Admin) duyệt được. Bạn đóng / từ chối được.");
    }
    const buoiDaDay = await docBuoiDaDayTheoBai(db, dx.classId, vao.now, dx.baiDeXuatThem);
    const lop = await db.class.findUnique({ where: { id: dx.classId }, select: { centerId: true } });
    const orgUnitIdLop = lop?.centerId ? await orgUnitIdForCenter(lop.centerId) : null;

    return await db.$transaction(async (tx): Promise<KetQuaHanhDong> => {
      await khoaDonTrongTx(tx, cb.dong.orderId);
      const hien = await tx.studyEntitlementXuLy.findUnique({ where: { id: vao.dongId } });
      if (!hien) throw new LoiHangDoi("KHONG_TIM_THAY", "Không tìm thấy dòng hàng đợi.");
      if (hien.trangThai !== "OPEN") return khongDoi("Dòng đã đóng — không có gì thay đổi.");
      const dx2 = docDeXuat(hien.payload);
      if (hien.loai !== "CHO_DUYET_HOC_VUOT" || !dx2 || JSON.stringify(dx2) !== JSON.stringify(dx)) {
        throw new LoiHangDoi("KHONG_CHO_PHEP", "Đề xuất vừa đổi giữa lúc đọc và lúc duyệt — tải lại trang rồi duyệt lại.");
      }
      // Khoá quyền học TRƯỚC khi đọc (cùng khoá với ghi nhận bài / xếp lớp), rồi đọc lại.
      await tx.$queryRaw`SELECT "id" FROM "StudyEntitlement" WHERE "id" = ${dx2.entitlementId} FOR UPDATE`;
      const e = await tx.studyEntitlement.findUnique({ where: { id: dx2.entitlementId } });
      if (!e || e.status === "VOIDED" || e.orderItemId !== hien.orderItemId) throw new LoiHangDoi("KHONG_CHO_PHEP", "Dòng đơn không còn quyền học nào để nhận thêm bài học vượt.");
      if (e.startLessonOrder === null || e.classId !== dx2.classId || e.enrollmentId !== dx2.enrollmentId) {
        throw new LoiHangDoi("KHONG_CHO_PHEP", "Quyền học đã đổi lớp / ghi danh sau khi dòng được mở — không duyệt theo dữ liệu cũ.");
      }
      cho(
        "DUYET_HOC_VUOT",
        { loai: hien.loai, trangThai: hien.trangThai, coQuyenHoc: true, trangThaiQuyenHoc: e.status, daTieuThu: e.consumedSessions > 0, quyenCanDuyet: quyenCanDuyetHocVuot(dx2) },
        cb.coBat,
        { coQuyenManage: cb.coManage, coQuyenDuyetNgoaiLe: cb.coDuyetNgoaiLe },
      );

      const cu = e.configSnapshot && typeof e.configSnapshot === "object" && !Array.isArray(e.configSnapshot) ? (e.configSnapshot as Record<string, unknown>) : {};
      const xepLopCu = cu.xepLop && typeof cu.xepLop === "object" && !Array.isArray(cu.xepLop) ? (cu.xepLop as Record<string, unknown>) : null;
      if (!xepLopCu) throw new LoiHangDoi("KHONG_CHO_PHEP", "Quyền học chưa có ảnh chụp xếp lớp — không duyệt được.");
      const requiredHienTai = Array.isArray(xepLopCu.requiredCatchupLessons) ? (xepLopCu.requiredCatchupLessons as unknown[]).filter((x): x is number => typeof x === "number") : [];
      let ap;
      try {
        ap = apDungDuyetHocVuot({ startLesson: e.startLessonOrder, skippedSessions: e.skippedSessions, requiredHienTai, deXuat: dx2 });
      } catch (err) {
        if (err instanceof LoiDuyetHocVuot) throw new LoiHangDoi("KHONG_CHO_PHEP", err.message);
        throw err;
      }

      // ── GHI ── (mọi cổng đã qua)
      const daDuyet = Array.isArray(xepLopCu.duyetHocVuot) ? (xepLopCu.duyetHocVuot as unknown[]) : [];
      const conBoQua = dx2.baiBoQua.filter((b) => !dx2.baiDeXuatThem.includes(b));
      await tx.studyEntitlement.update({
        where: { id: e.id },
        data: {
          skippedSessions: ap.skippedMoi,
          configSnapshot: {
            ...cu,
            xepLop: {
              ...xepLopCu,
              skippedLessons: conBoQua,
              requiredCatchupLessons: [...ap.requiredMoi],
              catchupSessions: ap.catchupSessionsMoi.map((b) => [...b]),
              duyetHocVuot: [...daDuyet, { luc: vao.now.toISOString(), boi: { id: vao.nguoi.id, ten: vao.nguoi.name }, baiThem: [...dx2.baiDeXuatThem], lyDo: vao.lyDo.trim() }],
            },
          } as Prisma.InputJsonValue,
        },
      });
      let soNhuCau = 0;
      const baiChuaGan: number[] = [];
      for (const bai of dx2.baiDeXuatThem) {
        const buoiId = buoiDaDay.get(bai);
        if (!buoiId) {
          baiChuaGan.push(bai);
          continue;
        }
        const r = await taoDongHocBu(tx, { studentId: e.studentId, missedSessionId: buoiId, nguon: "ORDER_CONVERSION", createdById: vao.nguoi.id, orgUnitId: orgUnitIdLop });
        if (r.ket === "TAO") soNhuCau++;
      }
      const qd = quyetDinh("DUYET_HOC_VUOT", hien.lyDo, vao);
      const ghiChu = `Đã duyệt học vượt thêm bài ${dinhDangDaiBai(dx2.baiDeXuatThem)} — ${soNhuCau} phiếu học vượt${baiChuaGan.length > 0 ? `; bài ${dinhDangDaiBai(baiChuaGan)} chưa gắn được buổi đã dạy (Đào tạo xếp tay ở Học bù)` : ""} — ${ghiChuDong(vao)}`;
      await tx.studyEntitlementXuLy.update({
        where: { id: hien.id },
        data: { trangThai: "DA_XU_LY", resolvedAt: vao.now, resolvedNote: ghiChu, entitlementId: e.id, payload: ghiDaQuyet(hien.payload, qd) as Prisma.InputJsonValue },
      });
      await writeAudit({
        actor: vao.nguoi,
        module: "entitlements",
        entityType: "StudyEntitlementXuLy",
        entityId: hien.id,
        action: "APPROVE_EXTRA_CATCHUP",
        oldValues: { loai: hien.loai, trangThai: hien.trangThai, lyDo: hien.lyDo, skippedSessions: e.skippedSessions },
        newValues: { trangThai: "DA_XU_LY", skippedSessions: ap.skippedMoi, baiThem: [...dx2.baiDeXuatThem], soNhuCau, baiChuaGan },
        reason: vao.lyDo.trim(),
        orgUnitId: hien.centerId,
        tx,
      });
      await writeAudit({
        actor: vao.nguoi,
        module: "entitlements",
        entityType: "StudyEntitlement",
        entityId: e.id,
        action: "EXTRA_CATCHUP_APPROVED",
        oldValues: { skippedSessions: e.skippedSessions },
        newValues: { skippedSessions: ap.skippedMoi, baiThem: [...dx2.baiDeXuatThem] },
        reason: vao.lyDo.trim(),
        orgUnitId: e.centerId,
        tx,
      });
      return { ok: true, daLam: true, thongBao: `Đã duyệt học vượt thêm ${dx2.baiDeXuatThem.length} bài (${soNhuCau} phiếu học vượt${baiChuaGan.length > 0 ? `, ${baiChuaGan.length} bài chưa gắn được buổi` : ""}).` };
    }, TX_OPTS);
  } catch (e) {
    return dichLoi(e);
  }
}
