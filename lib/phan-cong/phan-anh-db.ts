// lib/phan-cong/phan-anh-db.ts — ĐƯỜNG GHI phản ánh ô công Parttime (GĐ6, docs/phan-cong-gop/KHAO-SAT.md chốt 4, 5, 8).
//
//   · guiPhanAnh   — giáo viên phản ánh ô của CHÍNH MÌNH (người × ngày × ca), kèm mốc giờ đề xuất ghi thêm;
//   · duyetPhanAnh — QLCS duyệt ⇒ GHI THÊM lượt quét (`ghiDongChinhTay`, GHI_THEM, căn cứ `PHAN_ANH`) + đánh dấu ngày cần tính lại, cùng
//                    giao dịch với phép đổi trạng thái; không duyệt ⇒ bắt buộc lý do. Không sửa thẳng kết quả ô (chốt 5);
//   · rutPhanAnh   — giáo viên rút phản ánh đang chờ.
// Luật ở `phan-anh.ts` (thuần). Mọi cổng đứng TRƯỚC phép ghi đầu tiên; lỗi sau khi đã ghi ⇒ `throw` (luật rollback). Thông báo gửi SAU commit.
// Chỉ kỳ LUẬT MỚI (≥ 2026-11): kỳ 10 không có đường này.
import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { notifyStaff } from "@/lib/notifications/notify";
import { quanLyCoSo } from "@/lib/notifications/nguoi-nhan-phia-sale";
import { dungDongChinhTay, ghiDongChinhTay, kiemDanhSachMoc } from "@/lib/cham-cong/sua-gio-quet";
import { tranMocCuaNgay } from "./tran-moc-db";
import { markAttendanceDayDirty } from "@/lib/cham-cong/recompute";
import { TRANG_THAI_SONG } from "@/lib/parttime/phan-cong";
import { thamSoApDung } from "@/lib/parttime/phan-cong-db";
import { lyDoKhongDuyetDuoc, lyDoKhongGuiDuoc } from "./phan-anh";
import { docKyLuatMoi } from "./ky-luat-db";

export class LoiPhanAnh extends Error {}

const ngayDb = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const HREF_GV = "/teacher/phan-cong/cong-o";
const HREF_QL = "/cham-cong/phan-cong/thang?tab=phan-anh";

async function trangThaiKy(centerId: string, periodKey: string): Promise<string | null> {
  return (await db.attendancePeriod.findFirst({ where: { centerId, periodKey }, select: { status: true } }))?.status ?? null;
}

/** Người này có việc (phân công dạy còn sống / trực còn sống) ở cơ sở này, ngày này. */
async function coViecTrongNgay(userId: string, centerId: string, ngay: string): Promise<boolean> {
  const [pc, truc] = await Promise.all([
    db.sessionStaffAssignment.count({ where: { userId, centerId, ngay: ngayDb(ngay), status: { in: [...TRANG_THAI_SONG] } } }),
    db.operationsDutyAssignment.count({ where: { userId, centerId, workDate: ngayDb(ngay), status: { in: [...TRANG_THAI_SONG] } } }),
  ]);
  return pc + truc > 0;
}

export async function guiPhanAnh(p: {
  userId: string;
  centerId: string;
  ngay: string;
  ca: string;
  lyDo: string;
  moc: readonly (string | null)[];
  /** BẮT BUỘC (luật 7) — do máy chủ tính (giờ VN). */
  homNay: string;
}): Promise<{ id: string }> {
  const periodKey = p.ngay.slice(0, 7);
  const [ky, coViec, ts, tuKy] = await Promise.all([trangThaiKy(p.centerId, periodKey), coViecTrongNgay(p.userId, p.centerId, p.ngay), thamSoApDung(db, p.ngay), docKyLuatMoi()]);
  const loi = lyDoKhongGuiDuoc({ ngay: p.ngay, homNay: p.homNay, trangThaiKy: ky, lyDo: p.lyDo, coViec, tuKyLuatMoi: tuKy });
  if (loi) throw new LoiPhanAnh(loi);
  if (!ts?.ca.some((c) => c.ma === p.ca)) throw new LoiPhanAnh("Ca không thuộc khung ca của chính sách.");
  const kiem = kiemDanhSachMoc(ngayDb(p.ngay), p.moc, "GHI_THEM", await tranMocCuaNgay(p.userId, p.ngay));
  if (!kiem.ok) throw new LoiPhanAnh(kiem.error);
  const ou = await db.orgUnit.findFirst({ where: { centerId: p.centerId, type: "CENTER" }, select: { id: true } });
  let id: string;
  try {
    id = (
      await db.phanAnhCong.create({
        data: { userId: p.userId, centerId: p.centerId, orgUnitId: ou?.id ?? null, ngay: ngayDb(p.ngay), ca: p.ca, periodKey, lyDo: p.lyDo.trim(), moc: [...p.moc] },
        select: { id: true },
      })
    ).id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new LoiPhanAnh("Ô này đang có phản ánh chờ duyệt.");
    throw e;
  }
  try {
    const ql = await quanLyCoSo(p.centerId);
    if (ql.length)
      await notifyStaff({ userIds: ql, dedupeKey: `phan-cong.phan-anh-moi:${id}`, title: "Phản ánh ô công mới", body: `Ngày ${p.ngay} · ca ${p.ca}: ${p.lyDo.trim().slice(0, 120)}`, href: HREF_QL });
  } catch {
    // Thông báo không làm hỏng việc đã ghi.
  }
  return { id };
}

export async function duyetPhanAnh(p: {
  id: string;
  actor: { id: string; name: string };
  duyet: boolean;
  ghiChu: string | null;
  /** BẮT BUỘC (luật 7, luật 19). */
  now: Date;
}): Promise<void> {
  const r = await db.phanAnhCong.findUnique({ where: { id: p.id } });
  if (!r) throw new LoiPhanAnh("Không tìm thấy phản ánh.");
  const loi = lyDoKhongDuyetDuoc({
    status: r.status,
    nguoiDuyet: p.actor.id,
    nguoiGui: r.userId,
    periodKey: r.periodKey,
    trangThaiKy: await trangThaiKy(r.centerId, r.periodKey),
    duyet: p.duyet,
    ghiChu: p.ghiChu,
    tuKyLuatMoi: await docKyLuatMoi(),
  });
  if (loi) throw new LoiPhanAnh(loi);
  const moc = (Array.isArray(r.moc) ? r.moc : []).map((x) => (typeof x === "string" ? x : null));
  const tranMoc = await tranMocCuaNgay(r.userId, r.ngay.toISOString().slice(0, 10));
  // Dựng dòng TRƯỚC giao dịch (thuần) — mốc không hợp lệ thì từ chối trước mọi phép ghi.
  const dung = p.duyet
    ? dungDongChinhTay({
        userId: r.userId,
        centerId: r.centerId,
        orgUnitId: r.orgUnitId,
        workDate: r.ngay,
        moc,
        cheDo: "GHI_THEM",
        tranMoc,
        actorId: p.actor.id,
        now: p.now,
        lyDo: `Phản ánh ô ca ${r.ca}: ${r.lyDo}`.slice(0, 500),
        canCu: { kieu: "PHAN_ANH", phanAnhId: r.id },
      })
    : null;
  if (dung && !dung.ok) throw new LoiPhanAnh(dung.error);

  await db.$transaction(async (tx) => {
    const doi = await tx.phanAnhCong.updateMany({
      where: { id: r.id, status: "CHO_DUYET" },
      data: { status: p.duyet ? "DA_DUYET" : "KHONG_DUYET", decidedById: p.actor.id, decidedAt: p.now, decisionNote: p.ghiChu?.trim() || null },
    });
    if (doi.count !== 1) throw new LoiPhanAnh("Phản ánh vừa được người khác xử lý — tải lại trang.");
    if (dung?.ok) {
      await ghiDongChinhTay(tx, { userId: r.userId, workDate: r.ngay, cheDo: "GHI_THEM", rows: dung.rows, actorId: p.actor.id, now: p.now, lyDo: r.lyDo, canCu: { kieu: "PHAN_ANH", phanAnhId: r.id } });
      await markAttendanceDayDirty(r.userId, r.ngay, { tx, reason: "phan-anh-cong" });
    }
    await writeAudit({
      actor: p.actor,
      module: "hr_attendance",
      entityType: "PhanAnhCong",
      entityId: r.id,
      action: p.duyet ? "PT_PHAN_ANH_DUYET" : "PT_PHAN_ANH_KHONG_DUYET",
      oldValues: { status: "CHO_DUYET" },
      newValues: { status: p.duyet ? "DA_DUYET" : "KHONG_DUYET", ngay: ymd(r.ngay), ca: r.ca, soMocGhiThem: dung?.ok ? dung.rows.length : 0 },
      reason: p.ghiChu?.trim() || undefined,
      tx,
    });
  });
  try {
    await notifyStaff({
      userIds: [r.userId],
      dedupeKey: `phan-cong.phan-anh-ket-qua:${r.id}`,
      title: p.duyet ? "Phản ánh ô công đã được duyệt" : "Phản ánh ô công không được duyệt",
      body: `Ngày ${ymd(r.ngay)} · ca ${r.ca}${p.duyet ? " — đã ghi thêm lượt quét." : `: ${p.ghiChu?.trim() ?? ""}`}`,
      href: HREF_GV,
    });
  } catch {
    // Thông báo không làm hỏng việc đã ghi.
  }
}

/** Giáo viên rút phản ánh CỦA MÌNH đang chờ. Ghi có điều kiện (chống đua). */
export async function rutPhanAnh(p: { id: string; userId: string }): Promise<void> {
  const r = await db.phanAnhCong.updateMany({ where: { id: p.id, userId: p.userId, status: "CHO_DUYET" }, data: { status: "RUT_LAI" } });
  if (r.count !== 1) throw new LoiPhanAnh("Phản ánh không còn chờ duyệt (hoặc không phải của bạn).");
}
