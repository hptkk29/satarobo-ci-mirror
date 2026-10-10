// lib/hoa-hong/chinh-sach-hanh-dong.ts — ĐIỀU PHỐI các thao tác ghi của tab Chính sách (06 §5.2): lưu nháp · kiểm hàng rào ·
// kích hoạt · huỷ nháp. Server Action (`.../chinh-sach/_actions.ts`) CHỈ làm: auth → quyền → gọi các hàm này → revalidate.
//
// Vì sao tách ra `lib/`: Server Action phải gọi `auth()`/`revalidatePath` nên khó chạy dưới test; điều đáng canh (cách ly cơ sở khi
// GHI, map lỗi về ô, văn bản mồ côi khi lưu hỏng giữa chừng, nháp bị sửa bởi người khác) nằm ở đây và chạy được trên Postgres thật.
//
// ⚠️ KHÔNG kiểm QUYỀN HÀNH ĐỘNG (`commission_policies:*`) — đó là việc của Server Action ngay đầu hàm. Ở đây là CÁCH LY CƠ SỞ:
// `scopedDb` không che write, nên mỗi thao tác tự hỏi `coTheGhiChoChuSoHuu` và đọc bản ghi qua `scopedDb(actor)` (ngoài tầm nhìn
// ⇒ "không tìm thấy", cùng một câu với "không tồn tại" — không lộ id của cơ sở khác).
// ⚠️ Mọi hàm nhận `now` BẮT BUỘC (luật 19).
import { Prisma } from "@prisma/client";

import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import { getR2PublicUrl } from "@/lib/storage/r2-client";

import {
  anhXaLoiMayChu,
  dungPayload,
  formChinhSachSchema,
  loiOTepVanBan,
  loiTepVanBan,
  type LoiMayChu,
  type LoiO,
  type PayloadChinhSach,
} from "./chinh-sach-form";
import { coTheGhiChoChuSoHuu } from "./chinh-sach-quyen";
import { canNhap, kichHoat, huyNhap, kiemTruocKichHoat, suaNhap, taoChinhSach, taoPhienBanMoi, taoVanBan, type NguoiThaoTac } from "./chinh-sach-service";
import { tamNhinChinhSach } from "./chinh-sach-doc";
import type { KetQuaKiemHangRao, VanDeHangRao } from "./hang-rao-ui";
import { HoaHongError } from "./kieu";

export type KetQuaThatBai = {
  ok: false;
  loi: LoiO[];
  /** Lỗi không gắn được vào ô nào — form hiện ở đầu. */
  chung: string | null;
  /** Văn bản đã tạo xong nhưng bước sau hỏng: client giữ id này để lần Lưu kế KHÔNG tạo văn bản trùng. */
  vanBanIdDaTao?: string;
  /** Bước nào của guardrail chặn kích hoạt (chỉ ở `kichHoatPhienBan`). */
  hangRao?: KetQuaKiemHangRao;
};

export type KetQuaLuuNhap =
  | {
      ok: true;
      policyId: string;
      versionId: string;
      versionNo: number;
      vanBanId: string | null;
      /** ISO — client gửi lại ở lần Lưu sau để phát hiện người khác sửa xen giữa. */
      updatedAt: string;
      /** `null` khi chưa kiểm được (lỗi đọc) — client hiện "chưa kiểm", KHÔNG hiện "đạt". */
      hangRao: KetQuaKiemHangRao | null;
    }
  | KetQuaThatBai;

const thatBai = (chung: string, extra: Partial<KetQuaThatBai> = {}): KetQuaThatBai => ({ ok: false, loi: [], chung, ...extra });

const KHONG_THAY = "Không tìm thấy chính sách này (đã bị xoá, hoặc nằm ngoài phạm vi bạn được xem).";
const KHONG_DUOC_GHI = "Bạn không được sửa chính sách của đơn vị này.";

function dichLoi(e: unknown): LoiMayChu | null {
  if (e instanceof HoaHongError) return { kieu: "hoa-hong", ma: e.ma, message: e.message, chiTiet: e.chiTiet };
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    const t = (e.meta as { target?: unknown } | undefined)?.target;
    return { kieu: "trung-khoa", cot: Array.isArray(t) ? t.map(String) : typeof t === "string" ? [t] : [] };
  }
  return null;
}

/** Lỗi không lường trước ⇒ KHÔNG đưa chi tiết ra client (có thể chứa SQL/tên bảng); chỉ log tên lỗi. */
function loiLa(e: unknown): KetQuaThatBai {
  console.error("[hoa-hong/chinh-sach] thao tác lỗi", e instanceof Error ? e.name : "?");
  return thatBai("Có lỗi khi lưu — thử lại, hoặc báo bộ phận kỹ thuật.");
}

/** Lỗi đã biết ⇒ các ô cần tô; lỗi lạ ⇒ câu chung an toàn. */
function ketQuaLoi(e: unknown, extra: Partial<KetQuaThatBai> = {}): KetQuaThatBai {
  const d = dichLoi(e);
  if (!d) return { ...loiLa(e), ...extra };
  const m = anhXaLoiMayChu(d);
  return { ok: false, loi: m.loi, chung: m.chung, ...extra };
}

/** Gốc URL công khai của kho tệp; `null` khi chưa cấu hình R2 (ngoài prod) — `loiTepVanBan` có nhánh riêng cho trường hợp đó. */
function gocKhoCongKhai(): string | null {
  try {
    return getR2PublicUrl();
  } catch {
    return null;
  }
}

async function centerIdCuaDonVi(orgUnitId: string | null): Promise<string | null | "KHONG_HOP_LE"> {
  if (orgUnitId === null) return null;
  const o = await db.orgUnit.findFirst({ where: { id: orgUnitId, deletedAt: null, type: "CENTER", centerId: { not: null } }, select: { centerId: true } });
  return o?.centerId ?? "KHONG_HOP_LE";
}

async function hangRaoCuaNhap(versionId: string, now: Date): Promise<KetQuaKiemHangRao | null> {
  try {
    const kq = await kiemTruocKichHoat({ versionId, now });
    return { loi: kq.loi, canhBao: kq.canhBao, somNhat: kq.somNhat };
  } catch (e) {
    console.error("[hoa-hong/chinh-sach] kiểm hàng rào lỗi", e instanceof Error ? e.name : "?");
    return null;
  }
}

// ── Lưu nháp ────────────────────────────────────────────────────────────────

export type DauVaoLuuNhap = {
  /** Dữ liệu form — chưa tin (client gửi). */
  form: unknown;
  /** `null` = chính sách MỚI (tạo chính sách + version 1). */
  policyId: string | null;
  /** `null` + có `policyId` = tạo VERSION MỚI; có `versionId` = sửa nháp đó. */
  versionId: string | null;
  /** `updatedAt` (ISO) client đã thấy ở lần lưu trước — lệch ⇒ có người sửa xen giữa. Chỉ dùng khi sửa nháp. */
  updatedAtDaThay: string | null;
};

export async function luuNhap(a: { actor: Actor; nguoi: NguoiThaoTac; now: Date; vao: DauVaoLuuNhap }): Promise<KetQuaLuuNhap> {
  const parsed = formChinhSachSchema.safeParse(a.vao.form);
  if (!parsed.success) return thatBai("Dữ liệu gửi lên không đúng dạng — tải lại trang rồi thử lại.");
  const p = dungPayload(parsed.data);
  if (!p.ok) return { ok: false, loi: p.loi, chung: null };
  const payload: PayloadChinhSach = p.payload;
  const tamNhin = tamNhinChinhSach(a.actor);
  const sdb = scopedDb(a.actor);

  // ── Xác định chủ sở hữu (bất biến) và quyền ghi cho chủ đó ──
  let ownerOrgUnitId: string | null = payload.ownerOrgUnitId;
  let ownerCenterId: string | null;
  let nhapDangSua: { id: string; updatedAt: Date; status: string; firstUsedAt: Date | null } | null = null;
  if (a.vao.policyId !== null) {
    const pol = await sdb.commissionPolicy.findUnique({ where: { id: a.vao.policyId }, select: { id: true, orgUnitId: true, centerId: true } });
    if (!pol) return thatBai(KHONG_THAY);
    ownerOrgUnitId = pol.orgUnitId;
    ownerCenterId = pol.centerId;
    if (a.vao.versionId !== null) {
      const ver = await sdb.commissionPolicyVersion.findUnique({ where: { id: a.vao.versionId }, select: { id: true, policyId: true, updatedAt: true, status: true, firstUsedAt: true } });
      if (!ver || ver.policyId !== pol.id) return thatBai(KHONG_THAY);
      nhapDangSua = { id: ver.id, updatedAt: ver.updatedAt, status: ver.status, firstUsedAt: ver.firstUsedAt };
    }
  } else {
    const c = await centerIdCuaDonVi(ownerOrgUnitId);
    if (c === "KHONG_HOP_LE") return { ok: false, loi: anhXaLoiMayChu({ kieu: "hoa-hong", ma: "DON_VI_KHONG_HOP_LE", message: "Chủ sở hữu phải là Hội sở hoặc một cơ sở." }).loi, chung: null };
    ownerCenterId = c;
  }
  if (!coTheGhiChoChuSoHuu(tamNhin, ownerCenterId)) return thatBai(KHONG_DUOC_GHI);

  // Cổng trạng thái đứng TRƯỚC phép ghi đầu tiên (`taoVanBan` bên dưới commit riêng): version đã kích hoạt/đã dùng/đã huỷ mà vẫn cho tạo
  // văn bản rồi mới bị `suaNhap` từ chối thì để lại văn bản mồ côi chiếm số hiệu.
  if (nhapDangSua) {
    try {
      canNhap(nhapDangSua); // cùng câu chữ với service: "chỉ sửa được bản nháp" / "đã sinh dòng sổ"
    } catch (e) {
      return ketQuaLoi(e);
    }
  }
  // Sửa nháp ĐÃ CÓ thì BẮT BUỘC mang mốc `updatedAt` đã thấy: không có mốc thì không thể biết có ai sửa xen giữa.
  if (nhapDangSua && a.vao.updatedAtDaThay === null) return thatBai("Thiếu mốc thời gian của bản nháp — tải lại trang rồi sửa tiếp.");
  if (nhapDangSua && a.vao.updatedAtDaThay !== null && new Date(a.vao.updatedAtDaThay).getTime() !== nhapDangSua.updatedAt.getTime()) {
    return thatBai("Có người vừa sửa bản nháp này — tải lại trang để lấy bản mới nhất rồi sửa tiếp (thay đổi của bạn chưa được lưu).");
  }
  // Tệp đính kèm do client khai: chỉ nhận tệp nằm trong kho của mình (xem `loiTepVanBan`).
  if (payload.vanBan.kieu === "moi" && payload.vanBan.fileKey !== null) {
    const loiTep = loiTepVanBan({ key: payload.vanBan.fileKey, url: payload.vanBan.fileUrl ?? "" }, gocKhoCongKhai());
    if (loiTep) return { ok: false, loi: [loiOTepVanBan(loiTep)], chung: null };
  }

  // ── Văn bản (nếu tạo mới) ──
  let documentId: string | null = null;
  let vanBanIdDaTao: string | undefined;
  try {
    if (payload.vanBan.kieu === "co-san") {
      // Văn bản phải nằm trong tầm nhìn của người ghi (chống gắn văn bản của cơ sở khác bằng id đoán).
      const vb = await sdb.regulationDocument.findUnique({ where: { id: payload.vanBan.id }, select: { id: true } });
      if (!vb) return { ok: false, loi: anhXaLoiMayChu({ kieu: "hoa-hong", ma: "VAN_BAN_KHONG_TON_TAI", message: "x" }).loi, chung: null };
      documentId = vb.id;
    } else if (payload.vanBan.kieu === "moi") {
      const v = payload.vanBan;
      const r = await taoVanBan({
        documentCode: v.documentCode,
        title: v.title,
        kind: "COMMISSION_POLICY",
        issuedOn: v.issuedOn,
        publishedOn: v.publishedOn,
        effectiveOn: v.effectiveOn,
        approvedByName: v.approvedByName,
        approvedById: null,
        fileKey: v.fileKey,
        fileName: v.fileName,
        fileUrl: v.fileUrl,
        ownerOrgUnitId,
        actor: a.nguoi,
        now: a.now,
      });
      documentId = r.id;
      vanBanIdDaTao = r.id;
    }
  } catch (e) {
    return ketQuaLoi(e);
  }

  // ── Chính sách / version ──
  try {
    let policyId: string;
    let versionId: string;
    let versionNo: number;
    if (a.vao.policyId === null) {
      const r = await taoChinhSach({
        policyCode: payload.policyCode,
        name: payload.name,
        description: payload.description,
        ownerOrgUnitId,
        phamVi: payload.phamVi,
        effectiveFrom: payload.effectiveFrom,
        effectiveTo: payload.effectiveTo,
        reason: payload.reason,
        documentId,
        rules: payload.rules,
        actor: a.nguoi,
        now: a.now,
      });
      ({ policyId, versionId, versionNo } = r);
    } else if (nhapDangSua) {
      await suaNhap({
        versionId: nhapDangSua.id,
        phamVi: payload.phamVi,
        effectiveFrom: payload.effectiveFrom,
        effectiveTo: payload.effectiveTo,
        reason: payload.reason,
        documentId,
        rules: payload.rules,
        updatedAtDaThay: nhapDangSua.updatedAt,
        actor: a.nguoi,
        now: a.now,
      });
      const ver = await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: nhapDangSua.id }, select: { policyId: true, versionNo: true } });
      policyId = ver.policyId;
      versionId = nhapDangSua.id;
      versionNo = ver.versionNo;
    } else {
      const r = await taoPhienBanMoi({
        policyId: a.vao.policyId,
        phamVi: payload.phamVi,
        effectiveFrom: payload.effectiveFrom,
        effectiveTo: payload.effectiveTo,
        reason: payload.reason,
        documentId,
        rules: payload.rules,
        actor: a.nguoi,
        now: a.now,
      });
      policyId = a.vao.policyId;
      versionId = r.versionId;
      versionNo = r.versionNo;
    }
    const sau = await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: versionId }, select: { updatedAt: true } });
    return { ok: true, policyId, versionId, versionNo, vanBanId: documentId, updatedAt: sau.updatedAt.toISOString(), hangRao: await hangRaoCuaNhap(versionId, a.now) };
  } catch (e) {
    return ketQuaLoi(e, vanBanIdDaTao ? { vanBanIdDaTao } : {});
  }
}

// ── Kiểm hàng rào ───────────────────────────────────────────────────────────

export async function kiemHangRao(a: { actor: Actor; now: Date; versionId: string }): Promise<{ ok: true; hangRao: KetQuaKiemHangRao; updatedAt: string } | KetQuaThatBai> {
  const ver = await scopedDb(a.actor).commissionPolicyVersion.findUnique({ where: { id: a.versionId }, select: { id: true, updatedAt: true } });
  if (!ver) return thatBai(KHONG_THAY);
  try {
    const kq = await kiemTruocKichHoat({ versionId: ver.id, now: a.now });
    return { ok: true, hangRao: { loi: kq.loi, canhBao: kq.canhBao, somNhat: kq.somNhat }, updatedAt: ver.updatedAt.toISOString() };
  } catch (e) {
    return ketQuaLoi(e);
  }
}

// ── Kích hoạt ───────────────────────────────────────────────────────────────

export type KetQuaKichHoat = { ok: true; canhBao: VanDeHangRao[] } | KetQuaThatBai;

export async function kichHoatPhienBan(a: {
  actor: Actor;
  nguoi: NguoiThaoTac;
  now: Date;
  versionId: string;
  /** `null` = chưa xác nhận cảnh báo nào. */
  xacNhanLyDo: string | null;
  /** `updatedAt` (ISO) của nháp mà người duyệt ĐÃ THẤY — kích hoạt chỉ áp cho đúng nội dung đó, lệch ⇒ `VERSION_DA_DOI`. BẮT BUỘC (luật 7). */
  updatedAtDaThay: string;
}): Promise<KetQuaKichHoat> {
  const sdb = scopedDb(a.actor);
  const ver = await sdb.commissionPolicyVersion.findUnique({ where: { id: a.versionId }, select: { id: true, centerId: true } });
  if (!ver) return thatBai(KHONG_THAY);
  if (!coTheGhiChoChuSoHuu(tamNhinChinhSach(a.actor), ver.centerId)) return thatBai(KHONG_DUOC_GHI);
  try {
    const r = await kichHoat({ versionId: ver.id, actor: a.nguoi, now: a.now, xacNhanCanhBao: a.xacNhanLyDo === null ? null : { lyDo: a.xacNhanLyDo }, updatedAtDaThay: new Date(a.updatedAtDaThay) });
    return { ok: true, canhBao: r.canhBao };
  } catch (e) {
    if (e instanceof HoaHongError && e.ma === "KICH_HOAT_BI_CHAN") {
      const chiTiet = Array.isArray(e.chiTiet) ? (e.chiTiet as VanDeHangRao[]) : [];
      // Cần xác nhận cảnh báo ≠ lỗi: client mở ô lý do thay vì tô đỏ hàng rào.
      if (chiTiet.length === 1 && chiTiet[0]!.ma === "CAN_XAC_NHAN_CANH_BAO") {
        return { ok: false, loi: [], chung: "Có cảnh báo cần xác nhận — nêu lý do (từ 10 ký tự) rồi kích hoạt lại.", hangRao: { loi: [], canhBao: chiTiet, somNhat: null } };
      }
      return { ok: false, loi: [], chung: "Không kích hoạt được — còn điều kiện chưa đạt.", hangRao: { loi: chiTiet, canhBao: [], somNhat: null } };
    }
    return ketQuaLoi(e);
  }
}

// ── Huỷ nháp ────────────────────────────────────────────────────────────────

export async function huyBanNhap(a: { actor: Actor; nguoi: NguoiThaoTac; now: Date; versionId: string; lyDo: string }): Promise<{ ok: true } | KetQuaThatBai> {
  const ver = await scopedDb(a.actor).commissionPolicyVersion.findUnique({ where: { id: a.versionId }, select: { id: true, centerId: true } });
  if (!ver) return thatBai(KHONG_THAY);
  if (!coTheGhiChoChuSoHuu(tamNhinChinhSach(a.actor), ver.centerId)) return thatBai(KHONG_DUOC_GHI);
  try {
    await huyNhap({ versionId: ver.id, lyDo: a.lyDo, actor: a.nguoi, now: a.now });
    return { ok: true };
  } catch (e) {
    return ketQuaLoi(e);
  }
}
