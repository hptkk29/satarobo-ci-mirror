// lib/hoc-bu/lich-su-luot-db.ts — ĐỌC lịch sử cấp lượt học bù / duyệt học vượt và SỬA (17/11/2026). Luật thuần ở `lich-su-luot-thuan.ts`.
//
// Đọc: bút toán ADJUSTMENT của sổ lượt (QLCS cấp / giảm / sửa · duyệt học vượt · theo đơn). `MakeupCreditAccount` KHÔNG mang `centerId`, nên phạm vi cơ sở được ép ở đây
// qua cơ sở của HỌC VIÊN (`getModelVisibleCenterIds("Student")`) — cùng mức nhìn mà `scopedDb(actor).student` cho.
//
// Sửa: ghi bút toán BÙ TRỪ qua `dieuChinhLuot` (NƠI DUY NHẤT ghi sổ lượt), nhật ký CÙNG giao dịch. Người gọi PHẢI đã kiểm quyền `makeup:waive`.
import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getModelVisibleCenterIds, scopedDb } from "@/lib/db-scope";
import { LoiHocBu } from "@/lib/hoc-bu/loi";
import { ghiNhatKy } from "@/lib/hoc-bu/nhat-ky";
import type { NguoiHocBu } from "@/lib/hoc-bu/pham-vi";
import { dieuChinhLuot } from "@/lib/hoc-bu/so-luot";
import {
  hieuLucQlcs,
  kiemSuaHocVuot,
  kiemSuaQlcs,
  lyDoSua,
  nguonSuaHocVuot,
  nguonSuaQlcs,
  phanLoaiButToan,
  suaDuoc,
  type NhomButToan,
} from "@/lib/hoc-bu/lich-su-luot-thuan";

export type LocLichSu = {
  trang: number;
  soDong: number;
  /** `qlcs` · `vuot` · `don` — bỏ trống = tất cả. */
  nguon?: "qlcs" | "vuot" | "don";
  /** Tên / mã học viên. */
  tim?: string;
};

const TIEN_TO_NGUON: Record<NonNullable<LocLichSu["nguon"]>, string> = {
  qlcs: "ADJUSTMENT:qlcs:",
  vuot: "ADJUSTMENT:hocvuot:",
  don: "ADJUSTMENT:don:",
};

export type DongLichSu = {
  id: string;
  luc: Date;
  studentId: string;
  hocVien: string;
  maHocVien: string | null;
  khoa: string;
  nhom: NhomButToan;
  nhan: string;
  /** Số lượt bút toán này đã ghi (có dấu). */
  delta: number;
  /** Số lượt HIỆU LỰC sau các lần sửa — chỉ có cho bút toán sửa được. */
  hieuLuc: number | null;
  lyDo: string;
  nguoi: string;
  suaDuoc: boolean;
  /** Sổ lượt HIỆN TẠI của học viên ở khoá này. */
  so: { tong: number; dangGiu: number; daDung: number; con: number };
  yeuCau: null | {
    id: string;
    trangThai: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
    maDon: string;
    lop: string;
    buoiBatDau: number;
    phaiBu: number;
    xin: number;
  };
  /** Bút toán này là bù trừ của bút toán nào (nhóm QLCS_SUA). */
  suaCho: string | null;
};

function phamViHocVien(actor: NguoiHocBu): Prisma.StudentWhereInput {
  const ids = getModelVisibleCenterIds("Student", actor);
  return ids === "ALL" ? {} : { centerId: { in: ids } };
}

export async function docLichSuLuot(actor: NguoiHocBu, loc: LocLichSu): Promise<{ dong: DongLichSu[]; tong: number; trang: number; soTrang: number }> {
  const where: Prisma.MakeupCreditEntryWhereInput = {
    type: "ADJUSTMENT",
    idemKey: loc.nguon ? { startsWith: TIEN_TO_NGUON[loc.nguon] } : { startsWith: "ADJUSTMENT:" },
    account: {
      student: {
        ...phamViHocVien(actor),
        ...(loc.tim ? { OR: [{ name: { contains: loc.tim, mode: "insensitive" } }, { studentCode: { contains: loc.tim, mode: "insensitive" } }] } : {}),
      },
    },
  };
  const tong = await db.makeupCreditEntry.count({ where });
  const soTrang = Math.max(1, Math.ceil(tong / loc.soDong));
  const trang = Math.min(Math.max(1, Math.floor(loc.trang) || 1), soTrang);
  const rows = await db.makeupCreditEntry.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (trang - 1) * loc.soDong,
    take: loc.soDong,
    select: {
      id: true,
      type: true,
      idemKey: true,
      grantedDelta: true,
      reason: true,
      actorId: true,
      createdAt: true,
      account: {
        select: {
          studentId: true,
          courseId: true,
          granted: true,
          held: true,
          consumed: true,
          student: { select: { name: true, studentCode: true } },
          course: { select: { name: true } },
        },
      },
    },
  });
  if (rows.length === 0) return { dong: [], tong, trang, soTrang };

  const loai = rows.map((r) => ({ r, pl: phanLoaiButToan({ type: r.type, idemKey: r.idemKey, grantedDelta: r.grantedDelta }) }));
  const idQlcsGoc = loai.filter((x) => x.pl.nhom === "QLCS_CAP" || x.pl.nhom === "QLCS_GIAM").map((x) => x.r.id);
  const idYeuCau = [...new Set(loai.map((x) => x.pl.requestId).filter((x): x is string => !!x))];

  const [suaVe, yeuCau, nguoi] = await Promise.all([
    idQlcsGoc.length
      ? db.makeupCreditEntry.findMany({
          where: { OR: idQlcsGoc.map((id) => ({ idemKey: { startsWith: `ADJUSTMENT:qlcs:sua:${id}:` } })) },
          select: { idemKey: true, grantedDelta: true },
        })
      : Promise.resolve([]),
    idYeuCau.length
      ? db.enrollmentCatchUpRequest.findMany({
          where: { id: { in: idYeuCau } },
          select: { id: true, status: true, orderId: true, classId: true, startLesson: true, sessionsToCatchUp: true, makeupSessions: true },
        })
      : Promise.resolve([]),
    db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } }),
  ]);
  const [don, lop] = yeuCau.length
    ? await Promise.all([
        db.order.findMany({ where: { id: { in: yeuCau.map((y) => y.orderId) } }, select: { id: true, code: true } }),
        db.class.findMany({ where: { id: { in: yeuCau.map((y) => y.classId) } }, select: { id: true, name: true } }),
      ])
    : [[], []];
  const tenNguoi = new Map(nguoi.map((u) => [u.id, u.name ?? ""]));
  const maDon = new Map(don.map((d) => [d.id, d.code]));
  const tenLop = new Map(lop.map((l) => [l.id, l.name]));
  const yc = new Map(yeuCau.map((y) => [y.id, y]));

  const dong: DongLichSu[] = loai.map(({ r, pl }) => {
    const y = pl.requestId ? yc.get(pl.requestId) : undefined;
    const sua = suaVe.filter((s) => s.idemKey?.startsWith(`ADJUSTMENT:qlcs:sua:${r.id}:`));
    const a = r.account;
    const hieuLuc =
      pl.nhom === "QLCS_CAP" || pl.nhom === "QLCS_GIAM"
        ? hieuLucQlcs(r, sua)
        : pl.nhom === "HOC_VUOT_DUYET" && y?.status === "APPROVED"
          ? y.makeupSessions
          : null;
    return {
      id: r.id,
      luc: r.createdAt,
      studentId: a.studentId,
      hocVien: a.student.name,
      maHocVien: a.student.studentCode,
      khoa: a.course.name,
      nhom: pl.nhom,
      nhan: pl.nhan,
      delta: r.grantedDelta,
      hieuLuc,
      lyDo: r.reason ?? "",
      nguoi: r.actorId ? (tenNguoi.get(r.actorId) ?? "—") : "Hệ thống",
      // Duyệt học vượt chỉ sửa được khi yêu cầu còn APPROVED (đã đổi buổi bắt đầu / huỷ thì không còn số để sửa).
      suaDuoc: suaDuoc(pl.nhom) && (pl.nhom !== "HOC_VUOT_DUYET" || y?.status === "APPROVED"),
      so: { tong: a.granted, dangGiu: a.held, daDung: a.consumed, con: a.granted - a.held - a.consumed },
      yeuCau: y
        ? {
            id: y.id,
            trangThai: y.status,
            maDon: maDon.get(y.orderId) ?? y.orderId,
            lop: tenLop.get(y.classId) ?? "Lớp",
            buoiBatDau: y.startLesson,
            phaiBu: y.sessionsToCatchUp,
            xin: y.makeupSessions,
          }
        : null,
      suaCho: pl.gocId,
    };
  });
  return { dong, tong, trang, soTrang };
}

export type KetQuaSuaLuot = { daDoi: boolean; thayDoi: number };

async function hocVienTrongTamNhin(actor: NguoiHocBu, studentId: string): Promise<boolean> {
  return !!(await scopedDb(actor).student.findUnique({ where: { id: studentId }, select: { id: true } }));
}

/**
 * SỬA một bút toán QLCS tự cấp thêm / giảm: ghi bút toán bù trừ để số HIỆU LỰC thành `soMoi`. Cùng `maLan` chạy lại ⇒ không ghi lần hai. Giảm quá phần còn trống ⇒ ném
 * (hoàn tác toàn bộ): sửa nửa vời là để lại một con số không ai chọn.
 */
export async function suaLuotQlcs(
  actor: NguoiHocBu,
  p: { entryId: string; soMoi: number; lyDo: string; maLan: string; ten: string },
): Promise<KetQuaSuaLuot> {
  const goc = await db.makeupCreditEntry.findUnique({
    where: { id: p.entryId },
    select: { id: true, type: true, idemKey: true, grantedDelta: true, makeupNeedId: true, account: { select: { studentId: true, courseId: true } } },
  });
  if (!goc) throw new LoiHocBu("Không tìm thấy bút toán — tải lại trang");
  // Cổng IDOR: bút toán ngoài cơ sở của người sửa hiện như không tồn tại.
  if (!(await hocVienTrongTamNhin(actor, goc.account.studentId))) throw new LoiHocBu("Không tìm thấy bút toán — tải lại trang");
  const pl = phanLoaiButToan({ type: goc.type, idemKey: goc.idemKey, grantedDelta: goc.grantedDelta });
  if (pl.nhom !== "QLCS_CAP" && pl.nhom !== "QLCS_GIAM") throw new LoiHocBu("Chỉ sửa được bút toán do QLCS cấp thêm / giảm — các loại khác sửa ở màn của chúng");

  const nguon = nguonSuaQlcs(goc.id, p.maLan);
  return db.$transaction(async (tx) => {
    const daCo = await tx.makeupCreditEntry.findFirst({ where: { idemKey: `ADJUSTMENT:${nguon}`, account: { studentId: goc.account.studentId, courseId: goc.account.courseId } }, select: { id: true } });
    if (daCo) return { daDoi: false, thayDoi: 0 };
    const suaVe = await tx.makeupCreditEntry.findMany({ where: { idemKey: { startsWith: `ADJUSTMENT:qlcs:sua:${goc.id}:` } }, select: { grantedDelta: true } });
    const hieuLuc = hieuLucQlcs(goc, suaVe);
    const sai = kiemSuaQlcs({ hieuLuc, soMoi: p.soMoi, lyDo: p.lyDo, maLan: p.maLan });
    if (sai) throw new LoiHocBu(sai);

    const lopId =
      (goc.makeupNeedId ? (await tx.makeupNeed.findUnique({ where: { id: goc.makeupNeedId }, select: { classId: true } }))?.classId : null) ??
      (await tx.enrollment.findFirst({ where: { studentId: goc.account.studentId, class: { courseId: goc.account.courseId } }, select: { classId: true } }))?.classId;
    if (!lopId) throw new LoiHocBu("Không xác định được lớp của học viên ở khoá này để ghi sổ");

    const delta = p.soMoi - hieuLuc;
    const ap = await dieuChinhLuot(tx, {
      studentId: goc.account.studentId,
      courseId: goc.account.courseId,
      classId: lopId,
      delta,
      nguon,
      lyDo: lyDoSua(hieuLuc, p.soMoi, p.lyDo, "QLCS sửa bút toán lượt"),
      actorId: actor.userId,
      makeupNeedId: goc.makeupNeedId,
    });
    if (ap !== delta) {
      throw new LoiHocBu(
        ap === 0
          ? "Không còn lượt trống để rút — lượt đang giữ chỗ trong case hoặc đã dùng thì không rút lại được"
          : `Chỉ rút được ${-ap}/${-delta} lượt (phần còn lại đang giữ chỗ hoặc đã dùng) — chọn số lượt khác`,
      );
    }
    await ghiNhatKy(tx, {
      actorId: actor.userId,
      ten: p.ten,
      entityType: "MakeupCreditEntry",
      entityId: goc.id,
      action: "hoc-bu.sua-luot-qlcs",
      oldValues: { hieuLuc },
      newValues: { hieuLuc: p.soMoi, thayDoi: delta, studentId: goc.account.studentId, courseId: goc.account.courseId },
      reason: p.lyDo.trim(),
    });
    return { daDoi: true, thayDoi: delta };
  });
}

/**
 * SỬA số buổi bù đã DUYỆT của một yêu cầu học vượt: bút toán bù trừ + cập nhật `makeupSessions` CÙNG giao dịch (đường "đổi buổi bắt đầu" đọc con số này để rút / cộng lại).
 * Chỉ yêu cầu còn APPROVED. Yêu cầu bị khoá hàng trong giao dịch nên hai người sửa cùng lúc thì người sau thấy số mới và bị từ chối "trùng".
 */
export async function suaLuotHocVuot(
  actor: NguoiHocBu,
  p: { requestId: string; bMoi: number; lyDo: string; maLan: string; ten: string },
): Promise<KetQuaSuaLuot> {
  const trongTam = await scopedDb(actor).enrollmentCatchUpRequest.findFirst({ where: { id: p.requestId }, select: { id: true } });
  if (!trongTam) throw new LoiHocBu("Không tìm thấy yêu cầu học vượt (hoặc ngoài cơ sở của bạn) — tải lại trang");

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "EnrollmentCatchUpRequest" WHERE id = ${p.requestId} FOR UPDATE`;
    const y = await tx.enrollmentCatchUpRequest.findUnique({
      where: { id: p.requestId },
      select: { id: true, status: true, studentId: true, courseId: true, classId: true, makeupSessions: true, sessionsToCatchUp: true, orgUnitId: true },
    });
    if (!y) throw new LoiHocBu("Không tìm thấy yêu cầu học vượt — tải lại trang");
    if (y.status !== "APPROVED") throw new LoiHocBu("Chỉ sửa được yêu cầu đã duyệt — yêu cầu này đã đổi trạng thái, tải lại trang");
    const sai = kiemSuaHocVuot({ bHienTai: y.makeupSessions, bMoi: p.bMoi, phaiBu: y.sessionsToCatchUp, lyDo: p.lyDo, maLan: p.maLan });
    if (sai) throw new LoiHocBu(sai);

    const delta = p.bMoi - y.makeupSessions;
    const ap = await dieuChinhLuot(tx, {
      studentId: y.studentId,
      courseId: y.courseId,
      classId: y.classId,
      delta,
      nguon: nguonSuaHocVuot(y.id, p.maLan),
      lyDo: lyDoSua(y.makeupSessions, p.bMoi, p.lyDo, "QLCS sửa số buổi bù đã duyệt (học vượt)"),
      actorId: actor.userId,
    });
    if (ap !== delta) {
      throw new LoiHocBu(
        ap === 0
          ? "Không còn lượt trống để rút — lượt đang giữ chỗ trong case hoặc đã dùng thì không rút lại được"
          : `Chỉ rút được ${-ap}/${-delta} lượt (phần còn lại đang giữ chỗ hoặc đã dùng) — chọn số buổi khác`,
      );
    }
    await tx.enrollmentCatchUpRequest.update({ where: { id: y.id }, data: { makeupSessions: p.bMoi } });
    await ghiNhatKy(tx, {
      actorId: actor.userId,
      ten: p.ten,
      entityType: "EnrollmentCatchUpRequest",
      entityId: y.id,
      action: "hoc-bu.sua-luot-hoc-vuot",
      orgUnitId: y.orgUnitId,
      oldValues: { makeupSessions: y.makeupSessions },
      newValues: { makeupSessions: p.bMoi, thayDoi: delta, studentId: y.studentId },
      reason: p.lyDo.trim(),
    });
    return { daDoi: true, thayDoi: delta };
  });
}
