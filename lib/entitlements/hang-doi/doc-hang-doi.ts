import "server-only";
// lib/entitlements/hang-doi/doc-hang-doi.ts — ĐỌC HÀNG ĐỢI QUYỀN HỌC (danh sách có lọc + phân trang). DB, CHỈ ĐỌC.
//
// CÁCH LY CƠ SỞ: dòng hàng đợi đọc qua `scopedDb(actor)` — `StudyEntitlementXuLy` đã khai ở `SCOPED_MODELS` + `getModelPrefixes` + `BACKFILL_SPECS` (PR #655,
// kiểm lại ở `[HD-SC-*]`), nên người cấp cơ sở KHÔNG thấy dòng của cơ sở khác. Mọi bảng liên quan (đơn, học viên, lớp…) cũng đọc qua `scopedDb`.
//
// TIỀN: `entitlements:view-money` quyết định có hiện số tiền không — tiền nằm ở CỘT (`netAmount`) lẫn ở CÂU CHỮ do máy sinh ("còn thiếu …đ"), nên mọi chuỗi
// hiển thị đều đi qua `an-tien.ts` khi thiếu quyền. Che cột mà quên câu chữ là rò rỉ.
//
// NÚT: `hanhDong` của mỗi dòng tính bằng CHÍNH `xetHanhDong` mà action dùng (hanh-dong-duoc-phep.ts) — luật 12.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { can, getEffectivePermissions } from "@/lib/auth/can";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { docDaQuyet, type DaQuyet } from "../da-quyet";
import { laThuHocPhiTheoPhamViBat } from "../feature";
import { dinhDangDaiBai, docDeXuat, quyenCanDuyetHocVuot, type QuyenCanDuyet } from "../hoc-vuot-duyet";
import { anSoTienNeuThieuQuyen } from "./an-tien";
import { hanhDongDuocPhep, type HanhDongHangDoi } from "./hanh-dong-duoc-phep";
import { LoiHangDoi } from "./loi";
import { laQuaHan, NGUONG_QUA_HAN_MS, type LoaiHangDoi, type TrangThaiHangDoi } from "./loai";

export const CO_TRANG = 25;

export interface BoLocHangDoi {
  /** BẮT BUỘC (luật 7): chỗ gọi nói rõ muốn xem trạng thái nào (trang mặc định: ["OPEN"]). */
  readonly trangThai: readonly TrangThaiHangDoi[];
  readonly loai?: readonly LoaiHangDoi[];
  readonly centerId?: string;
  readonly courseId?: string;
  readonly classId?: string;
  readonly studentId?: string;
  /** Tìm theo tên học viên / tên bé (con của phiếu lead). */
  readonly q?: string;
  readonly tu?: Date;
  readonly den?: Date;
  /** Chỉ dòng ĐANG MỞ quá `NGUONG_QUA_HAN_MS`. */
  readonly quaHan?: boolean;
}

export interface DongHangDoiDto {
  readonly id: string;
  readonly loai: LoaiHangDoi;
  readonly trangThai: TrangThaiHangDoi;
  readonly lyDo: string;
  readonly chiTiet: readonly { readonly ma: string; readonly moTa: string }[];
  readonly daQuyet: DaQuyet | null;
  readonly ghiChuDong: string | null;
  readonly taoLuc: string;
  readonly capNhatLuc: string;
  readonly dongLuc: string | null;
  readonly quaHan: boolean;
  readonly coSo: { readonly id: string; readonly ten: string } | null;
  readonly don: { readonly id: string; readonly ma: string } | null;
  readonly dongDon: { readonly id: string; readonly ten: string } | null;
  readonly khoa: { readonly id: string; readonly ten: string } | null;
  readonly hocVien: { readonly id: string; readonly ten: string } | null;
  readonly be: { readonly id: string; readonly ten: string } | null;
  readonly lop: { readonly id: string; readonly ten: string } | null;
  readonly quyenHoc: {
    readonly id: string;
    readonly trangThai: string;
    readonly soBuoiMua: number;
    readonly daTieuThu: number;
    /** `null` khi thiếu `entitlements:view-money`. */
    readonly soTien: number | null;
  } | null;
  readonly coXemTien: boolean;
  /** Nút được vẽ — đúng bằng tập mà action sẽ cho làm. */
  readonly hanhDong: readonly HanhDongHangDoi[];
  readonly coQuyenManage: boolean;
  /** `entitlements:approve-exception` tại cơ sở của dòng. */
  readonly coQuyenDuyetNgoaiLe: boolean;
  readonly coBat: boolean;
  /** Chỉ CHO_DUYET_HOC_VUOT: tóm tắt đề xuất (đọc từ payload) + ai được duyệt. `null` ở loại khác hoặc khi payload không đọc được. */
  readonly deXuatHocVuot: {
    readonly soBaiCan: number;
    readonly tran: number;
    readonly baiDaGiu: string;
    readonly baiBoQua: string;
    readonly baiDeXuatThem: string;
    readonly quyenCan: QuyenCanDuyet;
  } | null;
}

export interface KetQuaHangDoi {
  readonly dong: readonly DongHangDoiDto[];
  readonly tong: number;
  readonly trang: number;
  readonly soTrang: number;
}

const TRAN_ID_PHU = 2000;
const TRAN_ID_TEN = 200;

/**
 * Cổng ĐỌC ở tầng dữ liệu (phòng thủ chiều sâu — trang đã gác bằng PAGE_GATES): actor không giữ `entitlements:view` thì KHÔNG đọc được gì, dù ai gọi hàm này.
 * Chỉ hỏi "có quyền này ở đâu đó không" (`getEffectivePermissions`, bỏ qua scope); phạm vi cơ sở do `scopedDb` lo.
 */
function canXem(actor: Actor): void {
  if (actor.isSuperAdmin || getEffectivePermissions(actor).has("entitlements:view")) return;
  throw new LoiHangDoi("KHONG_QUYEN", "Bạn không có quyền xem hàng đợi quyền học (entitlements:view).");
}

export async function docHangDoi(actor: Actor, loc: BoLocHangDoi, trang: number, now: Date): Promise<KetQuaHangDoi> {
  canXem(actor);
  const sdb = scopedDb(actor);
  const AND: Prisma.StudyEntitlementXuLyWhereInput[] = [{ trangThai: { in: [...loc.trangThai] } }];
  if (loc.loai && loc.loai.length > 0) AND.push({ loai: { in: [...loc.loai] } });
  if (loc.centerId) AND.push({ centerId: loc.centerId });
  if (loc.courseId) AND.push({ courseId: loc.courseId });
  if (loc.studentId) AND.push({ studentId: loc.studentId });
  if (loc.tu) AND.push({ createdAt: { gte: loc.tu } });
  if (loc.den) AND.push({ createdAt: { lt: loc.den } });
  if (loc.quaHan) AND.push({ trangThai: "OPEN", updatedAt: { lte: new Date(now.getTime() - NGUONG_QUA_HAN_MS) } });
  if (loc.classId) {
    const q = await sdb.studyEntitlement.findMany({ where: { classId: loc.classId }, select: { id: true }, take: TRAN_ID_PHU });
    AND.push({ entitlementId: { in: q.map((x) => x.id) } });
  }
  const tuKhoa = loc.q?.trim();
  if (tuKhoa) {
    const [hv, be] = await Promise.all([
      sdb.student.findMany({ where: { name: { contains: tuKhoa, mode: "insensitive" } }, select: { id: true }, take: TRAN_ID_TEN }),
      sdb.leadChild.findMany({ where: { fullName: { contains: tuKhoa, mode: "insensitive" } }, select: { id: true }, take: TRAN_ID_TEN }),
    ]);
    AND.push({ OR: [{ studentId: { in: hv.map((x) => x.id) } }, { leadChildId: { in: be.map((x) => x.id) } }] });
  }
  const where: Prisma.StudyEntitlementXuLyWhereInput = { AND };

  const soTrang0 = Math.max(1, trang);
  const [tong, hang] = await Promise.all([
    sdb.studyEntitlementXuLy.count({ where }),
    sdb.studyEntitlementXuLy.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: (soTrang0 - 1) * CO_TRANG,
      take: CO_TRANG,
    }),
  ]);
  const soTrang = Math.max(1, Math.ceil(tong / CO_TRANG));

  const uniq = (xs: readonly (string | null | undefined)[]): string[] => [...new Set(xs.filter((x): x is string => Boolean(x)))];
  const orderIds = uniq(hang.map((h) => h.orderId));
  const itemIds = uniq(hang.map((h) => h.orderItemId));
  const courseIds = uniq(hang.map((h) => h.courseId));
  const studentIds = uniq(hang.map((h) => h.studentId));
  const beIds = uniq(hang.map((h) => h.leadChildId));
  const centerIds = uniq(hang.map((h) => h.centerId));

  const [don, dongDon, quyen, khoa, hocVien, be, coSo] = await Promise.all([
    orderIds.length ? sdb.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, code: true } }) : Promise.resolve([]),
    itemIds.length ? sdb.orderItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, itemName: true } }) : Promise.resolve([]),
    itemIds.length
      ? sdb.studyEntitlement.findMany({
          where: { orderItemId: { in: itemIds }, status: { not: "VOIDED" } },
          select: { id: true, orderItemId: true, status: true, purchaseSessions: true, consumedSessions: true, netAmount: true, classId: true, studentId: true },
        })
      : Promise.resolve([]),
    courseIds.length ? sdb.course.findMany({ where: { id: { in: courseIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    studentIds.length ? sdb.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    beIds.length ? sdb.leadChild.findMany({ where: { id: { in: beIds } }, select: { id: true, fullName: true } }) : Promise.resolve([]),
    centerIds.length ? sdb.center.findMany({ where: { id: { in: centerIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const lopIds = uniq(quyen.map((q) => q.classId));
  const [lop, tieuThu] = await Promise.all([
    lopIds.length ? sdb.class.findMany({ where: { id: { in: lopIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    quyen.length
      ? db.studyEntitlementUsage.groupBy({ by: ["entitlementId"], where: { entitlementId: { in: quyen.map((q) => q.id) }, voidedAt: null }, _count: { _all: true } })
      : Promise.resolve([]),
  ]);

  // Quyền + cờ theo CƠ SỞ (một lần mỗi cơ sở, không phải mỗi dòng).
  const coBatTheoCoSo = new Map<string, boolean>();
  const orgUnitTheoCoSo = new Map<string, string | null>();
  for (const cid of centerIds) {
    const ou = await orgUnitIdForCenter(cid);
    orgUnitTheoCoSo.set(cid, ou);
    coBatTheoCoSo.set(cid, ou ? await laThuHocPhiTheoPhamViBat(ou) : false);
  }

  const dong: DongHangDoiDto[] = hang.map((h) => {
    const target = { centerId: h.centerId, orgUnitId: h.orgUnitId ?? orgUnitTheoCoSo.get(h.centerId) ?? undefined };
    const coQuyenManage = can(actor, "entitlements:manage", target);
    const coXemTien = can(actor, "entitlements:view-money", target);
    const coQuyenDuyetNgoaiLe = can(actor, "entitlements:approve-exception", target);
    const dx = h.loai === "CHO_DUYET_HOC_VUOT" ? docDeXuat(h.payload) : null;
    const quyenCanDuyet = dx ? quyenCanDuyetHocVuot(dx) : null;
    const coBat = coBatTheoCoSo.get(h.centerId) ?? false;
    const q = quyen.find((x) => x.orderItemId === h.orderItemId) ?? null;
    const soBuoiDaTieuThu = q ? Math.max(q.consumedSessions, tieuThu.find((t) => t.entitlementId === q.id)?._count._all ?? 0) : 0;
    const daQuyet = docDaQuyet(h.payload);
    const chiTietTho = h.payload && typeof h.payload === "object" && !Array.isArray(h.payload) ? (h.payload as Record<string, unknown>).chiTiet : undefined;
    const chiTiet = Array.isArray(chiTietTho)
      ? chiTietTho.flatMap((x) =>
          x && typeof x === "object" && typeof (x as { ma?: unknown }).ma === "string" && typeof (x as { moTa?: unknown }).moTa === "string"
            ? [{ ma: (x as { ma: string }).ma, moTa: anSoTienNeuThieuQuyen((x as { moTa: string }).moTa, coXemTien) }]
            : [],
        )
      : [];
    const ten = (id: string | null, ds: readonly { id: string; name: string }[]) => {
      const x = id ? ds.find((d) => d.id === id) : undefined;
      return id && x ? { id, ten: x.name } : null;
    };
    const beX = h.leadChildId ? be.find((b) => b.id === h.leadChildId) : undefined;
    const lopX = q?.classId ? lop.find((l) => l.id === q.classId) : undefined;
    const donX = don.find((d) => d.id === h.orderId);
    const dongX = dongDon.find((d) => d.id === h.orderItemId);
    return {
      id: h.id,
      loai: h.loai,
      trangThai: h.trangThai,
      lyDo: anSoTienNeuThieuQuyen(h.lyDo, coXemTien),
      chiTiet,
      daQuyet: daQuyet ? { ...daQuyet, lyDo: anSoTienNeuThieuQuyen(daQuyet.lyDo, coXemTien), dauVan: anSoTienNeuThieuQuyen(daQuyet.dauVan, coXemTien) } : null,
      ghiChuDong: anSoTienNeuThieuQuyen(h.resolvedNote, coXemTien),
      taoLuc: h.createdAt.toISOString(),
      capNhatLuc: h.updatedAt.toISOString(),
      dongLuc: h.resolvedAt ? h.resolvedAt.toISOString() : null,
      quaHan: laQuaHan({ trangThai: h.trangThai, updatedAt: h.updatedAt }, now),
      coSo: ten(h.centerId, coSo),
      don: donX ? { id: donX.id, ma: donX.code } : null,
      dongDon: dongX ? { id: dongX.id, ten: dongX.itemName } : null,
      khoa: ten(h.courseId, khoa),
      hocVien: ten(h.studentId, hocVien),
      be: beX ? { id: beX.id, ten: beX.fullName } : null,
      lop: lopX ? { id: lopX.id, ten: lopX.name } : null,
      quyenHoc: q
        ? { id: q.id, trangThai: q.status, soBuoiMua: q.purchaseSessions, daTieuThu: soBuoiDaTieuThu, soTien: coXemTien ? q.netAmount : null }
        : null,
      coXemTien,
      hanhDong: hanhDongDuocPhep(
        { loai: h.loai, trangThai: h.trangThai, coQuyenHoc: q !== null, trangThaiQuyenHoc: q?.status ?? null, daTieuThu: q ? soBuoiDaTieuThu > 0 : false, quyenCanDuyet },
        { coQuyenManage, coBat, coQuyenDuyetNgoaiLe },
      ),
      coQuyenManage,
      coQuyenDuyetNgoaiLe,
      coBat,
      deXuatHocVuot: dx && quyenCanDuyet
        ? { soBaiCan: dx.soBaiCan, tran: dx.tran, baiDaGiu: dinhDangDaiBai(dx.baiDaGiu), baiBoQua: dinhDangDaiBai(dx.baiBoQua), baiDeXuatThem: dinhDangDaiBai(dx.baiDeXuatThem), quyenCan: quyenCanDuyet }
        : null,
    };
  });

  return { dong, tong, trang: soTrang0, soTrang };
}

/** Đếm dòng ĐANG MỞ theo loại trong tầm nhìn của người xem — cho dải tổng quan trên trang. */
export async function demDangMo(actor: Actor): Promise<Record<LoaiHangDoi, number>> {
  canXem(actor);
  const sdb = scopedDb(actor);
  const g = await sdb.studyEntitlementXuLy.groupBy({ by: ["loai"], where: { trangThai: "OPEN" }, _count: { _all: true } });
  const ra: Record<LoaiHangDoi, number> = { CHO_CHUYEN_DOI: 0, CHO_XEP_LOP: 0, CHO_DUYET_HOC_VUOT: 0, CAN_THU_HOI: 0, TREO_DUYET_TAY: 0, THIEU_QUYEN_HOC: 0, LECH_DU_LIEU: 0 };
  for (const x of g) ra[x.loai] = x._count._all;
  return ra;
}
