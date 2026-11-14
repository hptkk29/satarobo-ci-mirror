import "server-only";
import type { Prisma } from "@prisma/client";
import type { Actor } from "@/lib/auth/actor";
import { writeAudit } from "@/lib/audit/audit-log";
import { db } from "@/lib/db";
import { passesScope, scopedDb } from "@/lib/db-scope";
import {
  CO_TRANG_NGOAI_LE,
  chuyenNgoaiLe,
  hanhDongNgoaiLeChoPhep,
  kiemLyDoXuLy,
  trangThaiCuaNhom,
  type HanhDongChoPhep,
  type HanhDongNgoaiLe,
  type LocNgoaiLe,
  type TrangThaiNgoaiLe,
} from "./ngoai-le-xu-ly";
import { coQuyenKeToanTaiCoSo, phamViKeToan } from "./quyen";
import type { TomTatNghiaVu } from "./nghia-vu-tom-tat";

// lib/finance/hoa-don/ngoai-le-db.ts — ĐỌC và XỬ LÝ hộp thư ngoại lệ hoá đơn (Invoice Hub S12). Ngoại lệ do scanner S8 sinh (`quet-nghia-vu-db.ts`).
//
// Quyền: DÙNG LẠI `payments:confirm` (TD-07), phạm vi theo nơi neo vai — `coQuyenKeToanTaiCoSo` / `phamViKeToan` (quyen.ts), CÙNG vị từ với nút trên màn.
// ⚠️ `scopedDb` cho TẦM NHÌN theo tiền tố `payments:` — người có `payments:record` ở CS1 (sale) THẤY ngoại lệ CS1 mà không phải kế toán. Nên ĐỌC lọc thêm theo
//    phạm vi kế toán (giao của hai tập), và GHI kiểm lại trên dòng đọc lại trong giao dịch. Không tin action ngoài.
// ⚠️ Ghi: `updateMany` CÓ ĐIỀU KIỆN theo trạng thái đã đọc; đổi 0 dòng ⇒ NÉM (người khác vừa xử lý). `writeAudit` old/new CÙNG giao dịch, chỉ sau khi ghi thành công.
// ⚠️ Hub không ghi sổ tiền: file này chỉ chạm `HoaDonNgoaiLe` (+ AuditLog qua writeAudit); không `Payment` / `Order` / hoá đơn.

const ENTITY = "HoaDonNgoaiLe";
const MODULE = "hoa-don";

export type DongNgoaiLe = {
  id: string;
  loai: string;
  muc: string;
  trangThai: string;
  centerId: string;
  tenCoSo: string;
  orderId: string | null;
  maDon: string | null;
  hoaDonId: string | null;
  nguoiXuLyId: string | null;
  lyDoXuLy: string | null;
  hanXuLy: Date | null;
  createdAt: Date;
  hanhDong: HanhDongChoPhep;
};

export type DanhSachNgoaiLe = {
  dong: DongNgoaiLe[];
  tong: number;
  trang: number;
  soTrang: number;
  /** Đếm trong PHẠM VI người xem (và bộ lọc cơ sở), không phụ thuộc bộ lọc nhóm/mức/loại — để nhãn tab đúng. */
  dem: { dangMo: number; daDong: number; khan: number };
};

/** Điều kiện cơ sở: giao của phạm vi KẾ TOÁN và `?coSo=`. Ngoài phạm vi ⇒ tập rỗng (không bao giờ rơi về "tất cả"). */
type DieuKienCoSo = { centerId?: string | { in: string[] } };
function dieuKienCoSo(actor: Actor, coSoId: string | null): DieuKienCoSo {
  const pham = phamViKeToan(actor);
  if (coSoId) return pham === "ALL" || pham.includes(coSoId) ? { centerId: coSoId } : { centerId: { in: [] } };
  return pham === "ALL" ? {} : { centerId: { in: pham } };
}

/**
 * TÓM TẮT nghĩa vụ hoá đơn mà scanner đã ghi trong phạm vi kế toán của người xem (cùng luật phạm vi với danh sách ngoại lệ: giao của phạm vi kế toán và `?coSo=`; ngoài phạm vi ⇒ rỗng).
 * Chỉ ĐẾM theo trạng thái + lần quét gần nhất — không trả dòng nào, không số tiền, không thông tin khách. Để «0 ngoại lệ» đọc được là «đã quét N và không lệch», không phải «chưa chạy».
 */
export async function docTomTatNghiaVu(actor: Actor, opts: { coSoId: string | null }): Promise<TomTatNghiaVu> {
  const sdb = scopedDb(actor);
  const nhom = await sdb.hoaDonNghiaVu.groupBy({
    by: ["trangThai"],
    where: dieuKienCoSo(actor, opts.coSoId),
    _count: { _all: true },
    _max: { quetLanCuoiLuc: true },
  });
  const theoTrangThai: Record<string, number> = {};
  let tong = 0;
  let cuoi: Date | null = null;
  for (const n of nhom) {
    theoTrangThai[n.trangThai] = n._count._all;
    tong += n._count._all;
    const q = n._max.quetLanCuoiLuc;
    if (q && (cuoi === null || q.getTime() > cuoi.getTime())) cuoi = q;
  }
  return { tong, theoTrangThai, quetLanCuoiLuc: cuoi ? cuoi.toISOString() : null };
}

export async function docDanhSachNgoaiLe(actor: Actor, loc: LocNgoaiLe, opts: { coSoId: string | null }): Promise<DanhSachNgoaiLe> {
  const sdb = scopedDb(actor);
  const coSo = dieuKienCoSo(actor, opts.coSoId);
  const where: Prisma.HoaDonNgoaiLeWhereInput = {
    ...coSo,
    trangThai: { in: [...trangThaiCuaNhom(loc.nhom)] },
    ...(loc.muc ? { muc: loc.muc } : {}),
    ...(loc.loai ? { loai: loc.loai } : {}),
  };
  const [dong, tong, dangMo, daDong, khan] = await Promise.all([
    sdb.hoaDonNgoaiLe.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (loc.trang - 1) * CO_TRANG_NGOAI_LE,
      take: CO_TRANG_NGOAI_LE,
    }),
    sdb.hoaDonNgoaiLe.count({ where }),
    sdb.hoaDonNgoaiLe.count({ where: { ...coSo, trangThai: { in: [...trangThaiCuaNhom("DANG_MO")] } } }),
    sdb.hoaDonNgoaiLe.count({ where: { ...coSo, trangThai: { in: [...trangThaiCuaNhom("DA_DONG")] } } }),
    sdb.hoaDonNgoaiLe.count({ where: { ...coSo, trangThai: { in: [...trangThaiCuaNhom("DANG_MO")] }, muc: "KHAN" } }),
  ]);
  const orderIds = [...new Set(dong.map((d) => d.orderId).filter((x): x is string => x != null))];
  const centerIds = [...new Set(dong.map((d) => d.centerId))];
  const [don, trungTam] = await Promise.all([
    orderIds.length > 0 ? sdb.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, code: true } }) : Promise.resolve([]),
    centerIds.length > 0 ? sdb.center.findMany({ where: { id: { in: centerIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const maDon = new Map(don.map((o) => [o.id, o.code] as const));
  const tenCoSo = new Map(trungTam.map((c) => [c.id, c.name] as const));
  return {
    dong: dong.map((d) => ({
      id: d.id,
      loai: d.loai,
      muc: d.muc,
      trangThai: d.trangThai,
      centerId: d.centerId,
      tenCoSo: tenCoSo.get(d.centerId) ?? "Cơ sở khác",
      orderId: d.orderId,
      maDon: d.orderId ? (maDon.get(d.orderId) ?? null) : null,
      hoaDonId: d.hoaDonId,
      nguoiXuLyId: d.nguoiXuLyId,
      lyDoXuLy: d.lyDoXuLy,
      hanXuLy: d.hanXuLy,
      createdAt: d.createdAt,
      hanhDong: hanhDongNgoaiLeChoPhep(actor, { trangThai: d.trangThai, centerId: d.centerId }),
    })),
    tong,
    trang: loc.trang,
    soTrang: Math.max(1, Math.ceil(tong / CO_TRANG_NGOAI_LE)),
    dem: { dangMo, daDong, khan },
  };
}

// ── GHI ───────────────────────────────────────────────────────────────────

export type KetQuaXuLy =
  | { ok: true; id: string; trangThai: TrangThaiNgoaiLe }
  | { ok: false; error: string; ma: "LY_DO" | "KHONG_THAY" | "CHUYEN" | "DA_DOI" };

/** Từ chối nghiệp vụ trong giao dịch ⇒ NÉM (rollback). Bắt ngoài `$transaction`. */
class TuChoiNgoaiLe extends Error {
  constructor(
    readonly ma: "KHONG_THAY" | "CHUYEN" | "DA_DOI",
    thongDiep: string,
  ) {
    super(thongDiep);
  }
}

const TEN_HANH_DONG: Record<HanhDongNgoaiLe, string> = {
  NHAN_XU_LY: "NHAN_XU_LY_NGOAI_LE_HOA_DON",
  DA_XU_LY: "DA_XU_LY_NGOAI_LE_HOA_DON",
  BO_QUA: "BO_QUA_NGOAI_LE_HOA_DON",
};

export async function xuLyNgoaiLe(i: { actor: Actor; ten: string; id: string; hanhDong: HanhDongNgoaiLe; lyDo: string }): Promise<KetQuaXuLy> {
  const loiLyDo = kiemLyDoXuLy(i.hanhDong, i.lyDo);
  if (loiLyDo) return { ok: false, error: loiLyDo, ma: "LY_DO" };
  const lyDo = i.lyDo.trim();
  try {
    return await db.$transaction(async (tx) => {
      const cu = await tx.hoaDonNgoaiLe.findUnique({ where: { id: i.id } });
      // Vừa "không có", vừa "không phải kế toán của cơ sở này", vừa "ngoài tầm nhìn" ⇒ MỘT câu — không để dò xem id có thật không.
      if (!cu || !coQuyenKeToanTaiCoSo(i.actor, cu.centerId) || !passesScope(ENTITY, cu, i.actor)) {
        throw new TuChoiNgoaiLe("KHONG_THAY", "Không tìm thấy ngoại lệ này trong phạm vi của bạn.");
      }
      const chuyen = chuyenNgoaiLe(cu.trangThai, i.hanhDong);
      if (!chuyen.ok) throw new TuChoiNgoaiLe("CHUYEN", chuyen.lyDo);
      const upd = await tx.hoaDonNgoaiLe.updateMany({
        where: { id: cu.id, trangThai: cu.trangThai },
        data: {
          trangThai: chuyen.den,
          nguoiXuLyId: i.actor.userId,
          ...(i.hanhDong === "NHAN_XU_LY" ? {} : { lyDoXuLy: lyDo }),
        },
      });
      if (upd.count === 0) throw new TuChoiNgoaiLe("DA_DOI", "Ngoại lệ vừa được người khác xử lý — tải lại trang để xem trạng thái mới.");
      await writeAudit({
        tx,
        actor: { id: i.actor.userId, name: i.ten },
        module: MODULE,
        entityType: ENTITY,
        entityId: cu.id,
        action: TEN_HANH_DONG[i.hanhDong],
        oldValues: { trangThai: cu.trangThai, nguoiXuLyId: cu.nguoiXuLyId, lyDoXuLy: cu.lyDoXuLy, loai: cu.loai },
        newValues: { trangThai: chuyen.den, nguoiXuLyId: i.actor.userId, lyDoXuLy: i.hanhDong === "NHAN_XU_LY" ? cu.lyDoXuLy : lyDo, loai: cu.loai },
        reason: i.hanhDong === "NHAN_XU_LY" ? "Nhận xử lý ngoại lệ hoá đơn" : lyDo,
        orgUnitId: cu.orgUnitId,
      });
      return { ok: true as const, id: cu.id, trangThai: chuyen.den };
    });
  } catch (e) {
    if (e instanceof TuChoiNgoaiLe) return { ok: false, error: e.message, ma: e.ma };
    throw e;
  }
}
