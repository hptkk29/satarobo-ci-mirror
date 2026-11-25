import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { ChuyenLopError, TRANG_THAI_KHONG_CHUYEN_LOP, chuyenLopTrongTx } from "@/lib/enrollments/chuyen-lop";
import { huyDongHocVuotKhiDoiBuoiBatDau } from "@/lib/hoc-bu/dong-service";
import { kiemBuoiBatDau, kiemSoBuoiBu, vaiChonDuoc, xetTheoBuoiBatDau, type VaiXepLop } from "@/lib/lms/xep-lop-theo-buoi-bat-dau";
import { docHinhThucLop } from "@/lib/orders/hinh-thuc-lop";
import { docPhamViDong } from "@/lib/orders/pham-vi/doc-dong";
import { doiBuoiBatDauCuaDon, suaBuoiBatDauGhiDanh } from "@/lib/orders/hoc-vuot-chuyen-doi";

// lib/orders/sua-ghi-danh-chuyen-doi.ts — «SỬA GHI DANH» ở màn chuyển đổi đơn [chủ dự án, 15/11/2026]:
// *"màn chuyển-đổi phần sửa buổi bắt đầu sửa thành sửa ghi danh, và có thể sửa cả lớp ghi danh, các buổi bù cũng sẽ được sửa theo nếu bị lệch"*.
//
// KHÔNG viết lõi thứ hai. Hai lõi đã có, chạy NỐI ĐUÔI trong MỘT giao dịch:
//   1. `chuyenLopTrongTx` (lib/enrollments/chuyen-lop.ts) — phép chuyển lớp của màn /chuyen-lop: ghi danh mới ở lớp đích, ghi danh cũ TRANSFERRED, giá + khoản thu + dòng đơn
//      đi theo, điểm danh + nhận xét đi theo, sĩ số kiểm lại trong giao dịch.
//   2. `suaBuoiBatDauGhiDanh` (hoc-vuot-chuyen-doi.ts) — đồng bộ buổi bắt đầu ↔ yêu cầu học vượt ↔ dòng cần bù ↔ sổ lượt, TÍNH THEO LỚP HIỆN TẠI của ghi danh.
//
// Chỉ đổi buổi bắt đầu (không đổi lớp) ⇒ đi thẳng `doiBuoiBatDauCuaDon` — hành vi CŨ, không đụng.
//
// ⚠️ CHỖ NỐI giữa hai lõi là nơi hỏng, nên mọi thứ ở đây xoay quanh nó:
//   · `suaBuoiBatDauGhiDanh` TỪ CHỐI bằng `return { ok: false }` — nhưng chuyển lớp đã ghi rồi. `return` KHÔNG rollback (luật rollback, CLAUDE.md) ⇒ mọi từ chối ở đây là `throw`
//     (`LoiSuaGhiDanh`), ngoài giao dịch mới dịch sang câu cho người dùng.
//   · Yêu cầu học vượt (`EnrollmentCatchUpRequest.enrollmentId @unique`) vẫn trỏ ghi danh CŨ sau khi chuyển. Không dời nó TRƯỚC bước đồng bộ thì bước đó không thấy yêu cầu, tạo yêu
//     cầu THỨ HAI và cộng lượt lần nữa (sổ lượt theo học viên × khoá, không theo lớp), còn lượt của yêu cầu cũ không bao giờ được rút.
//   · `diTheoGiaVaTienSangGhiDanhMoi` dừng im ở «KHONG_CO_GI_DE_MANG» (ghi danh mới chuyển đổi chưa có giá, chưa khoản nào gắn) TRƯỚC khi dời dòng đơn ⇒ dòng đơn ở lại ghi danh
//     cũ (TRANSFERRED) và màn chuyển đổi đọc sai. Chỉ mã vô hại đó ta dời dòng đơn tay; mọi mã khác (hoàn tiền / bảo lưu / ghi danh mới đã có giá) ⇒ throw, rollback cả chuyển lớp.
//
// CỔNG (đứng TRƯỚC phép ghi đầu tiên; từ chối = không ghi gì):
//   · cùng KHOÁ (`chuyenLopTrongTx` không kiểm — nó dùng cho cả đổi khoá F4) · lớp còn nhận ghi danh · sĩ số (kiểm lại trong `chuyenLopTrongTx`);
//   · lớp theo VAI và trần học vượt (`xetTheoBuoiBatDau` + `vaiChonDuoc`) — cùng cổng của màn chuyển đổi; lớp khác cơ sở chỉ Quản trị tối cao;
//   · dòng mua theo PHẠM VI HỌC: KHÔNG đổi lớp ở đây (quyền học gắn theo lớp) — chỉ sửa buổi bắt đầu như cũ;
//   · bé ĐÃ CÓ ĐIỂM DANH ở lớp hiện tại: KHÔNG đổi lớp ở đây (điểm danh đi theo sang lớp mới còn `sinhDongCanBu` không nhìn điểm danh ⇒ sinh dòng bù cho buổi đã học) — dùng /chuyen-lop;
//   · bé có dòng cần bù ORDER_CONVERSION của lớp cũ ĐÃ XẾP / ĐÃ BÙ: không tự huỷ sau lưng người xếp bù ⇒ xử lý ở /hoc-bu trước.
// Người gọi PHẢI đã kiểm quyền (`enrollments:override-progress` + `enrollments:transfer`) và tầm nhìn cơ sở của đơn.

type Tx = Prisma.TransactionClient;
type Nguoi = { id: string | null; name: string };

/** Lỗi nghiệp vụ của «sửa ghi danh» — luôn NÉM (rollback), người gọi bắt và dịch. */
export class LoiSuaGhiDanh extends Error {}

const TRANG_THAI_LOP_NHAN = ["PLANNED", "RECRUITING", "ACTIVE"] as const;

export type VaoSuaGhiDanh = {
  orderId: string;
  enrollmentId: string;
  /** `null`/thiếu = giữ buổi bắt đầu hiện tại. */
  buoiBatDauMoi?: number | null;
  /** `null`/thiếu = không đổi lớp. */
  classIdMoi?: string | null;
  soBuoiBu?: number | null;
  lyDo: string;
  /** Vai của NGƯỜI SỬA (`vaiXepLop`) — BẮT BUỘC (luật 7): quên truyền là cổng lớp theo vai không chạy. */
  vai: VaiXepLop;
  /** Trần học vượt HIỆU LỰC của khoá (`DongChuyenDoi.tran`) — BẮT BUỘC. */
  tran: number;
};

export type KetQuaSuaGhiDanh =
  | { ok: true; buoiBatDau: number; canBu: number; enrollmentId: string; doiLop: boolean }
  | { ok: false; error: string };

/** Một lần chuyển lớp + đồng bộ buổi bắt đầu / bù, TRONG giao dịch của người gọi. NÉM `LoiSuaGhiDanh` / `ChuyenLopError` khi từ chối. */
export async function suaGhiDanhDoiLopTrongTx(
  tx: Tx,
  p: VaoSuaGhiDanh & { classIdMoi: string },
  nguoi: Nguoi,
  bayGio: Date,
): Promise<{ buoiBatDau: number; canBu: number; enrollmentId: string }> {
  const ly = p.lyDo.trim();
  if (ly.length < 10) throw new LoiSuaGhiDanh("Ghi lý do ít nhất 10 ký tự");

  // ── CỔNG (chỉ đọc) ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const gd = await tx.enrollment.findFirst({
    where: { id: p.enrollmentId, deletedAt: null },
    select: {
      id: true,
      studentId: true,
      classId: true,
      courseId: true,
      centerId: true,
      buoiBatDau: true,
      status: true,
      course: { select: { totalSessions: true } },
    },
  });
  if (!gd) throw new LoiSuaGhiDanh("Không tìm thấy ghi danh");
  if (!gd.classId || !gd.courseId) throw new LoiSuaGhiDanh("Ghi danh thiếu lớp / khoá");
  if ((TRANG_THAI_KHONG_CHUYEN_LOP as readonly string[]).includes(gd.status)) {
    throw new LoiSuaGhiDanh(`Ghi danh đang ${gd.status} — không đổi lớp được`);
  }
  if (gd.classId === p.classIdMoi) throw new LoiSuaGhiDanh("Lớp mới trùng lớp hiện tại");

  const dong = await tx.orderItem.findFirst({
    where: { orderId: p.orderId, enrollmentId: gd.id },
    select: { id: true, metadata: true, order: { select: { centerId: true } } },
  });
  if (!dong) throw new LoiSuaGhiDanh("Ghi danh không thuộc đơn này");
  if (docPhamViDong(dong.metadata) !== null) {
    throw new LoiSuaGhiDanh("Dòng mua theo phạm vi học: quyền học gắn theo lớp nên chưa đổi lớp ở màn này — chỉ sửa buổi bắt đầu, hoặc dùng màn Chuyển lớp");
  }

  const lop = await tx.class.findFirst({
    where: { id: p.classIdMoi, deletedAt: null },
    select: { id: true, name: true, courseId: true, centerId: true, status: true },
  });
  if (!lop) throw new LoiSuaGhiDanh("Không tìm thấy lớp mới");
  if (lop.courseId !== gd.courseId) throw new LoiSuaGhiDanh(`Lớp "${lop.name}" thuộc khoá khác — chỉ đổi lớp trong cùng khoá`);
  if (!(TRANG_THAI_LOP_NHAN as readonly string[]).includes(lop.status)) throw new LoiSuaGhiDanh(`Lớp "${lop.name}" không còn nhận ghi danh (${lop.status})`);
  if (p.vai !== "ADMIN" && dong.order?.centerId && lop.centerId !== dong.order.centerId) {
    throw new LoiSuaGhiDanh(`Lớp "${lop.name}" thuộc cơ sở khác với đơn`);
  }

  // Buổi bắt đầu sau khi sửa + phán quyết lớp mới THEO VAI (trần học vượt) — cùng hàm với màn chuyển đổi.
  const ht = docHinhThucLop(dong.metadata);
  const sMoi = p.buoiBatDauMoi ?? gd.buoiBatDau ?? 1;
  const saiBuoi = kiemBuoiBatDau({ tongSoBuoiKhoa: gd.course?.totalSessions ?? null, soBuoiMua: ht.soBuoi }, sMoi);
  if (saiBuoi) throw new LoiSuaGhiDanh(saiBuoi);
  const soBuoiDaQua = await tx.classSession.count({ where: { classId: lop.id, date: { lte: bayGio } } });
  const x = xetTheoBuoiBatDau({ tongSoBuoiKhoa: gd.course?.totalSessions ?? null, soBuoiMua: ht.soBuoi, buoiBatDau: sMoi, soBuoiDaQua, tran: p.tran });
  if (!vaiChonDuoc(p.vai, x)) throw new LoiSuaGhiDanh(`${lop.name} — ${x.cau}`);
  if (x.soBuoiCanBu > 0 && p.soBuoiBu != null) {
    const saiBu = kiemSoBuoiBu(x.soBuoiCanBu, p.soBuoiBu);
    if (saiBu) throw new LoiSuaGhiDanh(saiBu);
  }

  // Bé đã có điểm danh ở lớp hiện tại ⇒ không đổi lớp ở màn này (xem đầu tệp).
  const diemDanh = await tx.attendance.count({ where: { studentId: gd.studentId, session: { classId: gd.classId } } });
  if (diemDanh > 0) {
    throw new LoiSuaGhiDanh(`Bé đã có ${diemDanh} lượt điểm danh ở lớp hiện tại — đổi lớp bằng màn Chuyển lớp (điểm danh đi theo học viên)`);
  }
  // Dòng cần bù do chuyển đổi của lớp cũ mà đã xếp / đã bù ⇒ không tự huỷ sau lưng người xếp bù.
  const buDangDung = await tx.makeupNeed.count({
    where: {
      studentId: gd.studentId,
      classId: gd.classId,
      sourceType: "ORDER_CONVERSION",
      OR: [{ status: { in: ["SCHEDULED", "COMPLETED"] } }, { caseStudents: { some: {} } }],
    },
  });
  if (buDangDung > 0) {
    throw new LoiSuaGhiDanh(`Bé có ${buDangDung} buổi bù của lớp cũ đã được xếp / đã học bù — xử lý ở màn Học bù trước khi đổi lớp`);
  }

  // ── GHI ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const kq = await chuyenLopTrongTx(tx, { oldEnrollmentId: gd.id, targetClassId: lop.id, reason: ly, actor: nguoi, giaVaTien: "THEO_GHI_DANH" });
  const moiId = kq.newEnrollmentId;

  // Dòng đơn PHẢI theo ghi danh mới — màn chuyển đổi đọc ghi danh qua dòng đơn.
  const sau = await tx.orderItem.findUniqueOrThrow({ where: { id: dong.id }, select: { enrollmentId: true } });
  if (sau.enrollmentId !== moiId) {
    const gv = kq.giaVaTien;
    if (gv && !gv.daDoi && gv.ma === "KHONG_CO_GI_DE_MANG") {
      const r = await tx.orderItem.updateMany({ where: { id: dong.id, enrollmentId: gd.id }, data: { enrollmentId: moiId } });
      if (r.count !== 1) throw new LoiSuaGhiDanh("Dòng đơn đổi giữa chừng — tải lại trang rồi thử lại");
    } else {
      throw new LoiSuaGhiDanh(
        `Không dời được dòng đơn / khoản thu sang ghi danh mới (${gv && !gv.daDoi ? gv.ma : "không rõ"}) — đã lùi cả việc đổi lớp. Xử lý bằng màn Chuyển lớp + kế toán.`,
      );
    }
  }

  // Dòng cần bù HỌC VƯỢT của lớp cũ chưa ai dùng ⇒ gỡ (đã kiểm: không còn dòng đã xếp / đã bù).
  const buoiCu = await tx.classSession.findMany({ where: { classId: gd.classId }, select: { id: true } });
  const soDongGo = await huyDongHocVuotKhiDoiBuoiBatDau(tx, { studentId: gd.studentId, missedSessionIds: buoiCu.map((b) => b.id) });

  // Yêu cầu học vượt: dời sang ghi danh + lớp mới TRƯỚC bước đồng bộ (xem đầu tệp).
  const yc = await tx.enrollmentCatchUpRequest.findUnique({ where: { enrollmentId: gd.id }, select: { id: true, centerId: true } });
  if (yc) {
    const lopMoi = await tx.class.findUniqueOrThrow({ where: { id: lop.id }, select: { orgUnitId: true } });
    await tx.enrollmentCatchUpRequest.update({
      where: { id: yc.id },
      data: { enrollmentId: moiId, classId: lop.id, centerId: kq.targetCenterId ?? yc.centerId, orgUnitId: lopMoi.orgUnitId },
    });
  }

  // Đồng bộ buổi bắt đầu / yêu cầu / dòng bù / sổ lượt THEO LỚP MỚI (cùng hàm với «Sửa buổi bắt đầu»). Từ chối của nó là `return` ⇒ đổi thành NÉM.
  const r = await suaBuoiBatDauGhiDanh(tx, { enrollmentId: moiId, buoiBatDauMoi: sMoi, soBuoiBu: p.soBuoiBu ?? null, lyDo: ly }, nguoi, bayGio);
  if (!r.ok) throw new LoiSuaGhiDanh(r.error);

  await writeAudit({
    tx,
    actor: nguoi,
    module: "enrollment",
    entityType: "Enrollment",
    entityId: moiId,
    action: "enrollment.edit-in-conversion",
    oldValues: { enrollmentId: gd.id, classId: gd.classId, buoiBatDau: gd.buoiBatDau ?? 1 },
    newValues: { enrollmentId: moiId, classId: lop.id, buoiBatDau: r.buoiBatDau, canBu: r.canBu, soDongBuLopCuDaGo: soDongGo },
    reason: ly,
  });
  return { buoiBatDau: r.buoiBatDau, canBu: r.canBu, enrollmentId: moiId };
}

/**
 * Vỏ có giao dịch. Chỉ đổi buổi bắt đầu ⇒ `doiBuoiBatDauCuaDon` (hành vi cũ). Có đổi lớp ⇒ giao dịch Serializable như `transferEnrollment` (sĩ số kiểm-rồi-ghi), thử lại khi
 * xung đột ghi. Người gọi PHẢI đã kiểm quyền + tầm nhìn cơ sở của đơn.
 */
export async function suaGhiDanhCuaDon(p: VaoSuaGhiDanh, nguoi: Nguoi, bayGio: Date): Promise<KetQuaSuaGhiDanh> {
  const classIdMoi = p.classIdMoi?.trim() || null;
  if (!classIdMoi) {
    if (p.buoiBatDauMoi == null) return { ok: false, error: "Chưa chọn gì để đổi (buổi bắt đầu hoặc lớp)" };
    const kq = await doiBuoiBatDauCuaDon(
      { orderId: p.orderId, enrollmentId: p.enrollmentId, buoiBatDauMoi: p.buoiBatDauMoi, soBuoiBu: p.soBuoiBu ?? null, lyDo: p.lyDo },
      nguoi,
      bayGio,
    );
    return kq.ok ? { ok: true, buoiBatDau: kq.buoiBatDau, canBu: kq.canBu, enrollmentId: p.enrollmentId, doiLop: false } : kq;
  }

  for (let lan = 0; ; lan++) {
    try {
      const kq = await db.$transaction((tx) => suaGhiDanhDoiLopTrongTx(tx, { ...p, classIdMoi }, nguoi, bayGio), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 30_000,
        maxWait: 10_000,
      });
      return { ok: true, ...kq, doiLop: true };
    } catch (e) {
      if (e instanceof LoiSuaGhiDanh || e instanceof ChuyenLopError) return { ok: false, error: e.message };
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034" && lan < 2) continue;
      throw e;
    }
  }
}
