import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { passesScope, scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { writeAudit } from "@/lib/audit/audit-log";
import type { QuyTac } from "./engine/chinh-sach";
import { laNgayHopLe } from "./cau-hinh-co-so";
import {
  kiemBoSauKhiThem,
  kiemChongHoPhienBan,
  kiemChuyen,
  kiemKhoangHieuLuc,
  kiemNgayKetThuc,
  lyDoDuDai,
  phanTichNoiDung,
  sangQuyTac,
  toiThieuLyDo,
  type TrangThaiChinhSach,
} from "./chinh-sach-phien-ban";
import { dungMoPhong, type KetQuaDungMoPhong } from "./chinh-sach-mo-phong";
import { duocDuyetChinhSach, duocGhiChinhSach } from "./quyen";

// lib/finance/hoa-don/chinh-sach-db.ts — DỊCH VỤ CHÍNH SÁCH HOÁ ĐƠN CÓ PHIÊN BẢN (lát S7, Invoice Hub). Luật nằm ở `chinh-sach-phien-ban.ts` +
// `chinh-sach-mo-phong.ts` (thuần, có test); tệp này nối với DB.
//
// ⚠️ ĐỌC cho màn đi qua `scopedDb` (`payments:` + khai `NULL_IS_GLOBAL_MODELS`: dòng `centerId = NULL` = DÙNG CHUNG, mọi kế toán thấy).
// ⚠️ GHI thì `scopedDb` KHÔNG che. Mọi hàm ghi nhận `actor` (BẮT BUỘC, không mặc định — luật 7) và TỰ kiểm trên dòng ĐỌC LẠI TỪ DB:
//    `passesScope` (tầm nhìn) + `duocGhiChinhSach` / `duocDuyetChinhSach` (một vị từ chung với nút và action). Action kiểm trước là LỚP NGOÀI;
//    dịch vụ không tin nó, vì chính sách dùng chung (`centerId` null) là luật của MỌI cơ sở.
// ⚠️ Mọi ghi nằm trong MỘT `$transaction` có khoá tư vấn theo PHÁP NHÂN (`hoa-don-chinh-sach:<phapNhanMa>`) — khuôn
//    `cau-hinh-hoa-don:<centerId>` (`cau-hinh-co-so-db.ts`): kiểm chồng/hở và ghi nằm trong cùng một lượt. Khoá theo pháp nhân (không theo
//    cơ sở) vì chính sách dùng chung và chính sách riêng cơ sở cùng thuộc một pháp nhân.
// ⚠️ TỪ CHỐI TRONG `$transaction` = `throw` (CLAUDE.md "Luật rollback"; `cong-truoc-phep-ghi.test.ts` quét): `tx.$executeRaw` của khoá đã tính là phép
//    ghi, nên KHÔNG có `return { ok: false` nào trong callback. Bắt ngoài.
// ⚠️ Race: `updateMany` CÓ ĐIỀU KIỆN (`id` + `trangThai` + `phienBan`), đổi 0 dòng ⇒ throw. Dưới khoá tư vấn, người duyệt thứ hai ĐỢI rồi gặp
//    trạng thái đã đổi; điều kiện là lưới thứ hai nếu có đường ghi nào đó không qua khoá.
// ⚠️ Lý do ≥ `TOI_THIEU_LY_DO_HOA_DON` ký tự cho MỌI thao tác ghi; `writeAudit` old/new trong CÙNG transaction.

const ENTITY = "HoaDonChinhSach";
const MODULE = "hoa-don";

type Tx = Prisma.TransactionClient;
export type KhachDb = Pick<PrismaClient, "hoaDonChinhSach">;

/** Từ chối nghiệp vụ trong transaction ⇒ NÉM. Bắt ngoài `$transaction`. */
class TuChoiChinhSach extends Error {
  constructor(
    readonly ma: string,
    thongDiep: string,
  ) {
    super(thongDiep);
  }
}

/** Số phiên bản tối đa màn nhận một lần (không phân trang — xem `docDanhSachChinhSach`). */
export const TOI_DA_BAN_HIEN = 200;

const MOT_NGAY = (d: Date) => d.toISOString().slice(0, 10);
const sangDate = (s: string) => new Date(`${s}T00:00:00Z`);

export type BanChinhSach = {
  id: string;
  phapNhanMa: string;
  /** null = dùng chung toàn pháp nhân. */
  centerId: string | null;
  phienBan: number;
  trangThai: TrangThaiChinhSach;
  hieuLucTu: string;
  hieuLucDen: string | null;
  /** Json thô từ DB — `phanTichNoiDung` ở nơi dùng (không tin DB tuyệt đối). */
  noiDung: unknown;
  nguoiTaoId: string;
  nguoiDuyetId: string | null;
  lyDo: string | null;
  taoLuc: string;
  capNhatLuc: string;
};

const CHON = {
  id: true,
  phapNhanMa: true,
  centerId: true,
  phienBan: true,
  trangThai: true,
  hieuLucTu: true,
  hieuLucDen: true,
  noiDung: true,
  nguoiTaoId: true,
  nguoiDuyetId: true,
  lyDo: true,
  createdAt: true,
  updatedAt: true,
} as const;

type Hang = {
  id: string;
  phapNhanMa: string;
  centerId: string | null;
  phienBan: number;
  trangThai: TrangThaiChinhSach;
  hieuLucTu: Date;
  hieuLucDen: Date | null;
  noiDung: unknown;
  nguoiTaoId: string;
  nguoiDuyetId: string | null;
  lyDo: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function sangBan(h: Hang): BanChinhSach {
  return {
    id: h.id,
    phapNhanMa: h.phapNhanMa,
    centerId: h.centerId,
    phienBan: h.phienBan,
    trangThai: h.trangThai,
    hieuLucTu: MOT_NGAY(h.hieuLucTu),
    hieuLucDen: h.hieuLucDen ? MOT_NGAY(h.hieuLucDen) : null,
    noiDung: h.noiDung,
    nguoiTaoId: h.nguoiTaoId,
    nguoiDuyetId: h.nguoiDuyetId,
    lyDo: h.lyDo,
    taoLuc: h.createdAt.toISOString(),
    capNhatLuc: h.updatedAt.toISOString(),
  };
}

// ── ĐỌC CHO MÀN (qua scopedDb) ────────────────────────────────────────────

/**
 * Chính sách của MỘT pháp nhân trong tầm nhìn của người xem, cho cơ sở đang làm việc: các bản riêng của cơ sở đó + các bản DÙNG CHUNG.
 * `scopedDb` loại bản của cơ sở khác ngay cả khi `centerId` truyền vào ngoài phạm vi (không có dòng nào để trả).
 */
export async function docDanhSachChinhSach(actor: Actor, input: { phapNhanMa: string; centerId: string }): Promise<BanChinhSach[]> {
  const ds = await scopedDb(actor).hoaDonChinhSach.findMany({
    where: { phapNhanMa: input.phapNhanMa, OR: [{ centerId: input.centerId }, { centerId: null }] },
    orderBy: [{ centerId: "asc" }, { phienBan: "desc" }],
    // Trần cứng: chính sách đổi vài lần mỗi năm; màn không phân trang (xem MIEN_TRU ở bang-coverage.test.ts) nên truy vấn phải có đáy.
    take: TOI_DA_BAN_HIEN,
    select: CHON,
  });
  return (ds as Hang[]).map(sangBan);
}

/** Tên hiển thị của người soạn/duyệt (chỉ id → tên; không PII khác). */
export async function docTenNguoi(ids: readonly string[]): Promise<Record<string, string>> {
  const duy = [...new Set(ids.filter((x) => x))];
  if (duy.length === 0) return {};
  const us = await db.user.findMany({ where: { id: { in: duy } }, select: { id: true, name: true, email: true } });
  return Object.fromEntries(us.map((u) => [u.id, u.name ?? u.email ?? u.id]));
}

/** Lịch sử thay đổi (AuditLog) của các bản — `ids` PHẢI lấy từ `docDanhSachChinhSach` (đã qua phạm vi). Không cần nới `audit-logs:view`. */
export type LichSuChinhSach = { id: string; chinhSachId: string; hanhDong: string; nguoiSua: string; lyDo: string | null; luc: string; truoc: unknown; sau: unknown };
export async function docLichSuChinhSach(ids: readonly string[], gioiHan = 100): Promise<LichSuChinhSach[]> {
  if (ids.length === 0) return [];
  const ds = await db.auditLog.findMany({
    where: { entityType: ENTITY, entityId: { in: [...ids] } },
    orderBy: { createdAt: "desc" },
    take: gioiHan,
    select: { id: true, entityId: true, action: true, actorName: true, reason: true, createdAt: true, oldValues: true, newValues: true },
  });
  return ds.map((a) => ({ id: a.id, chinhSachId: a.entityId, hanhDong: a.action, nguoiSua: a.actorName, lyDo: a.reason, luc: a.createdAt.toISOString(), truoc: a.oldValues, sau: a.newValues }));
}

// ── ĐỌC CHO ENGINE (không có người dùng — nội bộ) ─────────────────────────

/**
 * Quy tắc HIỆU LỰC của (pháp nhân, cơ sở) vào `ngay`, đúng định dạng cho `resolve` của engine. Đọc `HIEU_LUC` VÀ `HET_HIEU_LUC` (bản đã
 * kết thúc vẫn đúng cho ngày TRONG khoảng của nó — kết thúc chỉ cắt đuôi); `resolve` lọc theo ngày. Trả cả bản của cơ sở LẪN bản dùng chung
 * (đích danh hơn thắng). Cơ sở `null` ⇒ chỉ bản dùng chung.
 *
 * FAIL-CLOSED: không bản nào ⇒ mảng rỗng ⇒ `resolve` trả `KHONG_CO`; hai bản chồng ⇒ cả hai có mặt ⇒ `resolve` trả `CHONG_HIEU_LUC`. Không chọn
 * "bản mới nhất". Nội dung một bản hiệu lực mà KHÔNG phân tích được (sửa tay trong DB) ⇒ NÉM — hơn là lặng lẽ bỏ bản đó và để `resolve` rơi
 * sang bản cũ.
 * KHÔNG qua `scopedDb` có chủ đích: người gọi là cron/scanner (không có người dùng) hoặc dịch vụ này trong transaction; không trả gì ra màn
 * ngoài `chinh-sach-mo-phong` (đã chỉ gồm bản của chính cơ sở + bản dùng chung).
 */
export async function docHieuLuc(input: { phapNhanMa: string; centerId: string | null; ngay: string }, khach: KhachDb = db): Promise<QuyTac[]> {
  if (!laNgayHopLe(input.ngay)) return [];
  const ngay = sangDate(input.ngay);
  const rows = await khach.hoaDonChinhSach.findMany({
    where: {
      phapNhanMa: input.phapNhanMa,
      trangThai: { in: ["HIEU_LUC", "HET_HIEU_LUC"] },
      ...(input.centerId === null ? { centerId: null } : { OR: [{ centerId: input.centerId }, { centerId: null }] }),
      hieuLucTu: { lte: ngay },
      AND: [{ OR: [{ hieuLucDen: null }, { hieuLucDen: { gte: ngay } }] }],
    },
    orderBy: [{ phienBan: "asc" }, { id: "asc" }],
    select: CHON,
  });
  return (rows as Hang[]).flatMap((h) => {
    const b = sangBan(h);
    const p = phanTichNoiDung(b.noiDung);
    if (!p.ok) throw new Error(`Chính sách ${b.id} (phiên bản ${b.phienBan}) đang hiệu lực nhưng nội dung hỏng: ${p.loi.join("; ")}`);
    return sangQuyTac(b, p.noiDung);
  });
}

/**
 * Mô phỏng của MỘT bản (đọc qua `scopedDb` để kiểm phạm vi) — trang dùng để HIỆN, bước duyệt dùng cùng `dungMoPhong` để KIỂM. Bản không thấy
 * được ⇒ `null`. "Trước" = chính sách hiệu lực vào ngày bắt đầu của bản này.
 */
export async function docMoPhongChoBan(actor: Actor, id: string): Promise<(KetQuaDungMoPhong & { ban: BanChinhSach }) | null> {
  const h = (await scopedDb(actor).hoaDonChinhSach.findFirst({ where: { id }, select: CHON })) as Hang | null;
  if (!h) return null;
  const ban = sangBan(h);
  // Một bản đang hiệu lực HỎNG (sửa tay trong DB) làm `docHieuLuc` ném — ở đây bắt lại để chỉ MỘT bản báo lỗi, không kéo sập cả trang Cấu hình.
  // Bước DUYỆT vẫn từ chối trong trường hợp đó (xem `docHienHanhTrongKhoa`).
  let hienHanh: QuyTac[];
  try {
    hienHanh = await docHieuLuc({ phapNhanMa: ban.phapNhanMa, centerId: ban.centerId, ngay: ban.hieuLucTu });
  } catch (e) {
    return { ok: false, loi: [`Không đọc được chính sách đang hiệu lực để so sánh: ${e instanceof Error ? e.message : String(e)}`], ban };
  }
  return { ...dungMoPhong({ ban, noiDungTho: ban.noiDung, hienHanh }), ban };
}

// ── GHI ───────────────────────────────────────────────────────────────────

export type NguoiThaoTac = { actor: Actor; ten: string };
export type KetQuaGhi = { ok: true; id: string; phienBan: number; trangThai: TrangThaiChinhSach } | { ok: false; ma: string; error: string };

const KHONG_THAY = "Không tìm thấy chính sách";

async function trongKhoa<T>(phapNhanMa: string, viec: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"hoa-don-chinh-sach:" + phapNhanMa}))`;
    return viec(tx);
  });
}

async function chayGhi(viec: () => Promise<KetQuaGhi>): Promise<KetQuaGhi> {
  try {
    return await viec();
  } catch (e) {
    if (e instanceof TuChoiChinhSach) return { ok: false, ma: e.ma, error: e.message };
    throw e;
  }
}

/** Tóm tắt dòng để vào AuditLog (không chép cả `noiDung` ở mọi bước — chỉ lúc tạo). */
const tomTat = (b: BanChinhSach) => ({ trangThai: b.trangThai, phienBan: b.phienBan, phapNhanMa: b.phapNhanMa, centerId: b.centerId, hieuLucTu: b.hieuLucTu, hieuLucDen: b.hieuLucDen, nguoiTaoId: b.nguoiTaoId, nguoiDuyetId: b.nguoiDuyetId });

/** Bản ĐỌC LẠI TỪ DB, dưới khoá, đã qua kiểm tầm nhìn. Ngoài phạm vi ⇒ nói chung "Không tìm thấy" (không lộ tồn tại). */
async function docBanTrongKhoa(tx: Tx, actor: Actor, id: string): Promise<BanChinhSach> {
  const h = (await tx.hoaDonChinhSach.findUnique({ where: { id }, select: CHON })) as Hang | null;
  if (!h || !passesScope(ENTITY, { centerId: h.centerId }, actor)) throw new TuChoiChinhSach("KHONG_THAY", KHONG_THAY);
  return sangBan(h);
}

/** Chính sách đang hiệu lực làm mốc "trước" của bước duyệt, đọc TRONG khoá. Bản hiệu lực hỏng ⇒ TỪ CHỐI có thông điệp (không để lỗi thô lọt ra action). */
async function docHienHanhTrongKhoa(tx: Tx, cu: BanChinhSach): Promise<QuyTac[]> {
  try {
    return await docHieuLuc({ phapNhanMa: cu.phapNhanMa, centerId: cu.centerId, ngay: cu.hieuLucTu }, tx);
  } catch (e) {
    throw new TuChoiChinhSach("HIEN_HANH_HONG", `Không duyệt được vì chính sách đang hiệu lực có nội dung hỏng: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Cần biết pháp nhân TRƯỚC khi lấy khoá — đọc nhanh ngoài khoá, rồi ĐỌC LẠI trong khoá (pháp nhân không đổi sau khi tạo). */
async function phapNhanCuaBan(id: string): Promise<string> {
  const h = await db.hoaDonChinhSach.findUnique({ where: { id }, select: { phapNhanMa: true } });
  if (!h) throw new TuChoiChinhSach("KHONG_THAY", KHONG_THAY);
  return h.phapNhanMa;
}

function kiemLyDo(lyDo: string): string {
  if (!lyDoDuDai(lyDo)) throw new TuChoiChinhSach("THIEU_LY_DO", `Ghi lý do (ít nhất ${toiThieuLyDo} ký tự).`);
  return lyDo.trim();
}

function canGhi(actor: Actor, ban: Pick<BanChinhSach, "centerId">) {
  if (duocGhiChinhSach(actor, ban.centerId)) return;
  // Bản riêng cơ sở khác ⇒ nói chung (không lộ). Bản DÙNG CHUNG thì mọi kế toán đều thấy ⇒ nói rõ vì sao không được.
  if (ban.centerId === null) throw new TuChoiChinhSach("KHONG_CO_QUYEN", "Chính sách dùng chung chỉ kế toán Hội sở được thao tác.");
  throw new TuChoiChinhSach("KHONG_THAY", KHONG_THAY);
}

function canDuyet(actor: Actor) {
  if (!duocDuyetChinhSach(actor)) throw new TuChoiChinhSach("KHONG_CO_QUYEN", "Chỉ kế toán Hội sở được duyệt, từ chối hay kết thúc chính sách.");
}

export type DauVaoTaoNhap = {
  actor: Actor;
  ten: string;
  phapNhanMa: string;
  /** Danh sách pháp nhân hợp lệ — người gọi lấy từ cấu hình pháp nhân (không có mặc định: để `tsc` buộc truyền). */
  phapNhanHopLe: readonly string[];
  centerId: string | null;
  hieuLucTu: string;
  hieuLucDen: string | null;
  noiDungTho: unknown;
  lyDo: string;
};

/** Tạo BẢN NHÁP mới (phiên bản kế tiếp của cùng pháp nhân + cơ sở). Không sửa bản có sẵn: sửa = phiên bản mới. */
export function taoNhap(i: DauVaoTaoNhap): Promise<KetQuaGhi> {
  return chayGhi(async () => {
    // Cổng đứng TRƯỚC mọi truy vấn: quyền, dữ liệu, lý do.
    if (!i.phapNhanHopLe.includes(i.phapNhanMa)) throw new TuChoiChinhSach("PHAP_NHAN_LA", "Pháp nhân không có trong danh sách phát hành hoá đơn.");
    canGhi(i.actor, { centerId: i.centerId });
    const loiKhoang = kiemKhoangHieuLuc(i.hieuLucTu, i.hieuLucDen);
    if (loiKhoang) throw new TuChoiChinhSach("KHOANG_SAI", loiKhoang);
    const nd = phanTichNoiDung(i.noiDungTho);
    if (!nd.ok) throw new TuChoiChinhSach("NOI_DUNG_SAI", nd.loi.join("; "));
    const lyDo = kiemLyDo(i.lyDo);

    return trongKhoa(i.phapNhanMa, async (tx) => {
      if (i.centerId !== null) {
        const c = await tx.center.findUnique({ where: { id: i.centerId }, select: { id: true } });
        if (!c) throw new TuChoiChinhSach("KHONG_THAY_CO_SO", "Không tìm thấy cơ sở.");
      }
      const cao = await tx.hoaDonChinhSach.aggregate({ where: { phapNhanMa: i.phapNhanMa, centerId: i.centerId }, _max: { phienBan: true } });
      const phienBan = (cao._max.phienBan ?? 0) + 1;
      const tao = (await tx.hoaDonChinhSach.create({
        data: {
          phapNhanMa: i.phapNhanMa,
          // `centerId` tự set (scopedDb KHÔNG che write); `orgUnitId` do ghi kép ở lib/db.ts.
          centerId: i.centerId,
          phienBan,
          trangThai: "NHAP",
          hieuLucTu: sangDate(i.hieuLucTu),
          hieuLucDen: i.hieuLucDen ? sangDate(i.hieuLucDen) : null,
          noiDung: nd.noiDung as unknown as Prisma.InputJsonValue,
          nguoiTaoId: i.actor.userId,
          lyDo,
        },
        select: CHON,
      })) as Hang;
      const ban = sangBan(tao);
      await writeAudit({
        tx,
        actor: { id: i.actor.userId, name: i.ten },
        module: MODULE,
        entityType: ENTITY,
        entityId: ban.id,
        action: "TAO_CHINH_SACH_HOA_DON",
        oldValues: null,
        newValues: { ...tomTat(ban), noiDung: nd.noiDung as unknown as Record<string, unknown> },
        reason: lyDo,
        orgUnitId: ban.centerId,
      });
      return { ok: true as const, id: ban.id, phienBan, trangThai: "NHAP" as const };
    });
  });
}

/** Chuyển một bản `from → to` bằng `updateMany` CÓ ĐIỀU KIỆN (+ `phienBan`), audit old/new. Gọi TRONG khoá, SAU mọi cổng. */
async function ghiChuyen(
  tx: Tx,
  actor: Actor,
  ten: string,
  cu: BanChinhSach,
  to: TrangThaiChinhSach,
  data: { nguoiDuyetId?: string; hieuLucDen?: Date },
  lyDo: string,
  hanhDong: string,
): Promise<KetQuaGhi> {
  const upd = await tx.hoaDonChinhSach.updateMany({
    where: { id: cu.id, trangThai: cu.trangThai, phienBan: cu.phienBan },
    data: { trangThai: to, lyDo, ...data },
  });
  if (upd.count === 0) throw new TuChoiChinhSach("DA_DOI", "Chính sách vừa được người khác xử lý — tải lại trang để xem trạng thái mới.");
  const moi = sangBan((await tx.hoaDonChinhSach.findUniqueOrThrow({ where: { id: cu.id }, select: CHON })) as Hang);
  await writeAudit({
    tx,
    actor: { id: actor.userId, name: ten },
    module: MODULE,
    entityType: ENTITY,
    entityId: cu.id,
    action: hanhDong,
    oldValues: { ...tomTat(cu) },
    newValues: { ...tomTat(moi) },
    reason: lyDo,
    orgUnitId: moi.centerId,
  });
  return { ok: true, id: moi.id, phienBan: moi.phienBan, trangThai: moi.trangThai };
}

/** NHAP → CHO_DUYET. Kế toán đúng phạm vi của chính sách (dùng chung ⇒ Hội sở). */
export function guiDuyet(i: { actor: Actor; ten: string; id: string; lyDo: string }): Promise<KetQuaGhi> {
  return chayGhi(async () => {
    const lyDo = kiemLyDo(i.lyDo);
    const phapNhanMa = await phapNhanCuaBan(i.id);
    return trongKhoa(phapNhanMa, async (tx) => {
      const cu = await docBanTrongKhoa(tx, i.actor, i.id);
      canGhi(i.actor, cu);
      const kc = kiemChuyen(cu.trangThai, "CHO_DUYET", { lyDo, moPhong: null });
      if (!kc.ok) throw new TuChoiChinhSach(kc.ma, kc.thongDiep);
      const nd = phanTichNoiDung(cu.noiDung);
      if (!nd.ok) throw new TuChoiChinhSach("NOI_DUNG_SAI", `Nội dung chưa hợp lệ: ${nd.loi.join("; ")}`);
      return ghiChuyen(tx, i.actor, i.ten, cu, "CHO_DUYET", {}, lyDo, "GUI_DUYET_CHINH_SACH_HOA_DON");
    });
  });
}

/**
 * CHO_DUYET → HIEU_LUC. Điều kiện (mọi cổng TRƯỚC phép ghi): kế toán Hội sở (người soạn cũng duyệt được — chủ dự án chốt 02/11/2026) · lý do ≥ 10 · băm mô phỏng UI
 * gửi lên KHỚP băm server tự tính lại (tập mẫu + bối cảnh dựng ở server) · không chồng/hở hiệu lực với bản khác cùng phạm vi · bộ quy tắc sạch
 * khi gộp với các bản đã hiệu lực.
 */
export function duyet(i: { actor: Actor; ten: string; id: string; lyDo: string; hashMoPhongUi: string | null }): Promise<KetQuaGhi> {
  return chayGhi(async () => {
    const lyDo = kiemLyDo(i.lyDo);
    canDuyet(i.actor);
    const phapNhanMa = await phapNhanCuaBan(i.id);
    return trongKhoa(phapNhanMa, async (tx) => {
      const cu = await docBanTrongKhoa(tx, i.actor, i.id);
      const hienHanh = await docHienHanhTrongKhoa(tx, cu);
      const mp = dungMoPhong({ ban: cu, noiDungTho: cu.noiDung, hienHanh });
      if (!mp.ok) throw new TuChoiChinhSach("NOI_DUNG_SAI", `Nội dung chưa hợp lệ: ${mp.loi.join("; ")}`);
      const kc = kiemChuyen(cu.trangThai, "HIEU_LUC", { lyDo, moPhong: { hashUi: i.hashMoPhongUi, hashServer: mp.hash } });
      if (!kc.ok) throw new TuChoiChinhSach(kc.ma, kc.thongDiep);

      // Chồng / hở với các bản ĐÃ có hiệu lực CÙNG phạm vi (cùng pháp nhân + cùng cơ sở).
      const cungPhamVi = (await tx.hoaDonChinhSach.findMany({
        where: { phapNhanMa: cu.phapNhanMa, centerId: cu.centerId, trangThai: { in: ["HIEU_LUC", "HET_HIEU_LUC"] }, id: { not: cu.id } },
        select: CHON,
      })) as Hang[];
      const daCo = cungPhamVi.map(sangBan);
      const loiKhoang = kiemChongHoPhienBan(daCo, { id: cu.id, phienBan: cu.phienBan, hieuLucTu: cu.hieuLucTu, hieuLucDen: cu.hieuLucDen });
      if (loiKhoang.length > 0) throw new TuChoiChinhSach("CHONG_HO", loiKhoang.join(" "));
      const quyTacDaCo = daCo.flatMap((b) => {
        const p = phanTichNoiDung(b.noiDung);
        return p.ok ? sangQuyTac(b, p.noiDung) : [];
      });
      const loiBo = kiemBoSauKhiThem(quyTacDaCo, sangQuyTac(cu, mp.noiDung));
      if (loiBo.length > 0) throw new TuChoiChinhSach("BO_QUY_TAC_LOI", loiBo.join(" "));

      return ghiChuyen(tx, i.actor, i.ten, cu, "HIEU_LUC", { nguoiDuyetId: i.actor.userId }, lyDo, "DUYET_CHINH_SACH_HOA_DON");
    });
  });
}

/** CHO_DUYET → TU_CHOI. Cùng cổng người với duyệt (kế toán Hội sở), không cần băm. `nguoiDuyetId` = người QUYẾT định. */
export function tuChoi(i: { actor: Actor; ten: string; id: string; lyDo: string }): Promise<KetQuaGhi> {
  return chayGhi(async () => {
    const lyDo = kiemLyDo(i.lyDo);
    canDuyet(i.actor);
    const phapNhanMa = await phapNhanCuaBan(i.id);
    return trongKhoa(phapNhanMa, async (tx) => {
      const cu = await docBanTrongKhoa(tx, i.actor, i.id);
      const kc = kiemChuyen(cu.trangThai, "TU_CHOI", { lyDo, moPhong: null });
      if (!kc.ok) throw new TuChoiChinhSach(kc.ma, kc.thongDiep);
      return ghiChuyen(tx, i.actor, i.ten, cu, "TU_CHOI", { nguoiDuyetId: i.actor.userId }, lyDo, "TU_CHOI_CHINH_SACH_HOA_DON");
    });
  });
}

/**
 * HIEU_LUC → HET_HIEU_LUC: ĐẶT NGÀY KẾT THÚC, không đụng nội dung. Một người (kế toán Hội sở) làm được — kết thúc chỉ tạo khoảng hở mà `resolve`
 * trả `KHONG_CO` (đóng, không phải mở). Muốn thay bằng phiên bản mới: kết thúc bản cũ vào ngày liền trước, rồi duyệt bản mới (không chồng, không hở).
 */
export function hetHieuLuc(i: { actor: Actor; ten: string; id: string; ngayKetThuc: string; lyDo: string }): Promise<KetQuaGhi> {
  return chayGhi(async () => {
    const lyDo = kiemLyDo(i.lyDo);
    canDuyet(i.actor);
    const phapNhanMa = await phapNhanCuaBan(i.id);
    return trongKhoa(phapNhanMa, async (tx) => {
      const cu = await docBanTrongKhoa(tx, i.actor, i.id);
      const kc = kiemChuyen(cu.trangThai, "HET_HIEU_LUC", { lyDo, moPhong: null });
      if (!kc.ok) throw new TuChoiChinhSach(kc.ma, kc.thongDiep);
      const loiNgay = kiemNgayKetThuc(cu, i.ngayKetThuc);
      if (loiNgay) throw new TuChoiChinhSach("NGAY_SAI", loiNgay);
      return ghiChuyen(tx, i.actor, i.ten, cu, "HET_HIEU_LUC", { hieuLucDen: sangDate(i.ngayKetThuc) }, lyDo, "KET_THUC_CHINH_SACH_HOA_DON");
    });
  });
}
