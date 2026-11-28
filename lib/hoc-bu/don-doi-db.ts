// lib/hoc-bu/don-doi-db.ts — XÉT LẠI học bù khi một ĐƠN bị huỷ / hoàn (T06, 07/10/2026). Chạy từ DomainEvent `order.voided`.
//
// Trước T06 đường tiền (`changeOrderStatusAction`) không biết học bù tồn tại:
//   · HB-21  đơn PHÍ học bù bị huỷ/hoàn sau khi bé đã được xếp vào case hoặc đã bù xong ⇒ bù không thu tiền, không ai thấy (checker TV-05);
//   · HB-18  đơn KHOÁ HỌC bị huỷ/hoàn ⇒ lượt bù của bé không đổi (sổ cấp theo đơn lúc khởi tạo) — hoặc, với công thức cũ, TĂNG về đủ khoá.
//
// Vì sao đi qua DomainEvent chứ không gọi thẳng trong transaction huỷ đơn: huỷ/hoàn đơn là đường TIỀN — một lỗi ở sổ lượt không được
// làm đơn không huỷ được. Sự kiện ghi cùng transaction (huỷ đơn rollback ⇒ không có sự kiện) còn việc xét lại chạy sau, có thử lại,
// idempotent (khoá chống lặp của sổ + điều kiện trạng thái của từng bước).
//
// KHÔNG tự hoàn tiền, KHÔNG huỷ dòng cần bù: xét lại chỉ (a) gỡ bé CHƯA ĐIỂM DANH khỏi case nếu suất của bé dựa vào đơn phí vừa mất
// (gỡ được xếp lại khi đã thu lại phí — thuận nghịch), (b) NÓI RA ở audit khi bé đã bù xong (không rút lại được buổi đã học), và
// (c) điều chỉnh lượt (ADJUSTMENT có lý do) khi đơn khoá học bị loại.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ghiNhatKy } from "@/lib/hoc-bu/nhat-ky";
import { phatCanThuPhi } from "@/lib/hoc-bu/su-kien";
import { docPhiCuaDong, donPhiConSong } from "@/lib/hoc-bu/phi-dong-db";
import { docHinhThucLop } from "@/lib/orders/hinh-thuc-lop";
import { goBeKhoiCaseTrongTx } from "@/lib/hoc-bu/case-db";
import { tongLuotCongThuc } from "@/lib/hoc-bu/luot-cong-thuc-db";
import { dieuChinhLuot } from "@/lib/hoc-bu/so-luot";

type Tx = Prisma.TransactionClient;

export type KetQuaDonDoi = {
  /** Bé chưa điểm danh đã được gỡ khỏi case vì đơn phí của suất bị huỷ/hoàn. */
  goKhoiCase: number;
  /** Dòng đã bù xong mà đơn phí bị huỷ/hoàn sau đó — chỉ ghi audit. */
  daBuXong: number;
  /** Tài khoản lượt được điều chỉnh vì đơn khoá học bị loại. */
  dieuChinhLuot: { studentId: string; courseId: string; delta: number }[];
};

const TEN_HE_THONG = "Hệ thống (xét lại sau khi đơn bị huỷ/hoàn)";

export async function xetLaiSauKhiDonBiLoai(tx: Tx, p: { orderId: string; denTrangThai: "CANCELLED" | "REFUNDED" }): Promise<KetQuaDonDoi> {
  const kq: KetQuaDonDoi = { goKhoiCase: 0, daBuXong: 0, dieuChinhLuot: [] };
  const items = await tx.orderItem.findMany({
    where: { orderId: p.orderId, type: { in: ["MAKEUP_FEE", "COURSE_ENROLLMENT"] } },
    select: { id: true, type: true, studentId: true, enrollmentId: true, metadata: true, order: { select: { code: true } } },
  });
  if (items.length === 0) return kq;
  const maDon = items[0]!.order.code;

  // ── HB-21: đơn PHÍ học bù ─────────────────────────────────────────────────────────────
  const phiIds = items.filter((i) => i.type === "MAKEUP_FEE").map((i) => i.id);
  if (phiIds.length > 0) {
    const dongs = await docDongDuaVaoPhi(tx, phiIds);
    const tenTrangThai = p.denTrangThai === "CANCELLED" ? "huỷ" : "hoàn";
    for (const d of dongs) {
      await xuLyDongMatPhi(tx, d, kq, {
        maDon,
        lyDoNha: `Đơn phí ${maDon} bị ${tenTrangThai}`,
        hanhDongGo: "hoc-bu.go-khoi-case-vi-phi-bi-loai",
        hanhDongBuXong: "hoc-bu.phi-bi-loai-sau-khi-bu",
        thongTin: { donPhi: maDon, trangThaiDon: p.denTrangThai },
        lyDoGo: "Đơn phí học bù của suất này bị huỷ/hoàn trước khi bé được điểm danh — gỡ khỏi case, xếp lại sau khi thu lại phí.",
        lyDoBuXong: "Bé đã học bù xong nhưng đơn phí học bù bị huỷ/hoàn — buổi đã học không rút lại được; kế toán cần đối soát.",
      });
    }
  }

  // ── HB-18: đơn KHOÁ HỌC ───────────────────────────────────────────────────────────────
  const khoaItems = items.filter((i) => i.type === "COURSE_ENROLLMENT");
  const cap = new Map<string, { studentId: string; courseId: string }>();
  for (const it of khoaItems) {
    let studentId = it.studentId;
    let courseId = docHinhThucLop(it.metadata).courseId;
    if ((!studentId || !courseId) && it.enrollmentId) {
      const gd = await tx.enrollment.findUnique({ where: { id: it.enrollmentId }, select: { studentId: true, courseId: true } });
      studentId = studentId ?? gd?.studentId ?? null;
      courseId = courseId ?? gd?.courseId ?? null;
    }
    if (studentId && courseId) cap.set(`${studentId}|${courseId}`, { studentId, courseId });
  }
  for (const c of [...cap.values()].sort((a, b) => `${a.studentId}|${a.courseId}`.localeCompare(`${b.studentId}|${b.courseId}`))) {
    // Chỉ xét bé ĐÃ có tài khoản: chưa có thì công thức (đã loại đơn huỷ — HB-18) sẽ cấp đúng lúc khởi tạo.
    const tk = await tx.makeupCreditAccount.findUnique({
      where: { studentId_courseId: { studentId: c.studentId, courseId: c.courseId } },
      select: { id: true },
    });
    if (!tk) continue;
    const gd = await tx.enrollment.findFirst({
      where: { studentId: c.studentId, courseId: c.courseId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { classId: true },
    });
    const dong = gd ? null : await tx.makeupNeed.findFirst({ where: { studentId: c.studentId, courseId: c.courseId }, select: { classId: true } });
    const classId = gd?.classId ?? dong?.classId;
    if (!classId) continue; // không còn lớp nào để tính công thức — để checker/người xử lý, không đoán
    const [lop, hv] = await Promise.all([
      tx.class.findUnique({ where: { id: classId }, select: { course: { select: { id: true, totalSessions: true, choPhepHocBu: true } } } }),
      tx.student.findUnique({ where: { id: c.studentId }, select: { leadChildId: true } }),
    ]);
    if (!lop) continue;
    const moi = [...(await tongLuotCongThuc(tx, tx, [{ studentId: c.studentId, classId, leadChildId: hv?.leadChildId ?? null, course: lop.course }])).values()][0] ?? 0;
    // Phần sổ ĐANG theo công thức = GRANT + các ADJUSTMENT theo đơn. Phần "dùng vượt lúc khởi tạo" là chuyện khác, không so ở đây.
    const dangTheo = await tx.makeupCreditEntry.findMany({
      where: { accountId: tk.id, OR: [{ type: "GRANT" }, { type: "ADJUSTMENT", idemKey: { startsWith: "ADJUSTMENT:don:" } }] },
      select: { grantedDelta: true },
    });
    const delta = moi - dangTheo.reduce((s, e) => s + e.grantedDelta, 0);
    if (delta === 0) continue;
    const ap = await dieuChinhLuot(tx, {
      studentId: c.studentId,
      courseId: c.courseId,
      classId,
      delta,
      nguon: `don:${p.orderId}:${p.denTrangThai}`,
      lyDo: `Đơn ${maDon} ${p.denTrangThai === "CANCELLED" ? "bị huỷ" : "được hoàn"} — công thức lượt bù tính lại còn ${moi}`,
      actorId: null,
    });
    if (ap !== 0) kq.dieuChinhLuot.push({ studentId: c.studentId, courseId: c.courseId, delta: ap });
  }
  return kq;
}

type DongDuaVaoPhi = Awaited<ReturnType<typeof docDongDuaVaoPhi>>[number];

/** Dòng cần bù ĐANG dựa vào phí của các dòng đơn này: đã xếp case hoặc đã học, không miễn phí (miễn phí thì suất không dựa vào tiền). */
async function docDongDuaVaoPhi(tx: Tx, phiItemIds: readonly string[]) {
  return tx.makeupNeed.findMany({
    where: { feeOrderItemId: { in: [...phiItemIds] }, freeApprovedAt: null, status: { in: ["SCHEDULED", "COMPLETED"] } },
    select: {
      id: true,
      status: true,
      studentId: true,
      courseId: true,
      classId: true,
      centerId: true,
      orgUnitId: true,
      caseStudents: { where: { status: "PLACED", dungLuot: false }, select: { id: true, makeupNeedId: true, dungLuot: true } },
    },
    orderBy: { id: "asc" },
  });
}

type NguCanhMatPhi = {
  maDon: string;
  lyDoNha: string;
  hanhDongGo: "hoc-bu.go-khoi-case-vi-phi-bi-loai" | "hoc-bu.go-khoi-case-vi-phi-thieu";
  hanhDongBuXong: "hoc-bu.phi-bi-loai-sau-khi-bu" | "hoc-bu.phi-thieu-sau-khi-bu";
  thongTin: Record<string, unknown>;
  lyDoGo: string;
  lyDoBuXong: string;
};

/**
 * MỘT dòng cần bù mất cơ sở tiền (đơn phí bị huỷ/hoàn, HOẶC phí đã thu bị hoàn một phần nên thu thiếu). Luật chung của cả hai đường:
 *   · bé CHƯA điểm danh (dòng SCHEDULED) ⇒ gỡ khỏi case (thuận nghịch: xếp lại khi phí được thu đủ);
 *   · bé ĐÃ học (dòng COMPLETED) ⇒ KHÔNG đảo kết quả học; chỉ ghi ngoại lệ tài chính cho kế toán đối soát.
 */
async function xuLyDongMatPhi(tx: Tx, d: DongDuaVaoPhi, kq: { goKhoiCase: number; daBuXong: number }, ctx: NguCanhMatPhi): Promise<void> {
  if (d.status === "SCHEDULED") {
    for (const sv of d.caseStudents) {
      await goBeKhoiCaseTrongTx(
        tx,
        { ...sv, makeupNeed: { studentId: d.studentId, courseId: d.courseId, classId: d.classId } },
        { actorId: null, lyDoNha: ctx.lyDoNha },
      );
      kq.goKhoiCase += 1;
      await ghiNhatKy(tx, {
        actorId: null,
        ten: TEN_HE_THONG,
        entityType: "MakeupNeed",
        entityId: d.id,
        action: ctx.hanhDongGo,
        newValues: ctx.thongTin,
        reason: ctx.lyDoGo,
        orgUnitId: d.orgUnitId,
      });
    }
    return;
  }
  kq.daBuXong += 1;
  await ghiNhatKy(tx, {
    actorId: null,
    ten: TEN_HE_THONG,
    entityType: "MakeupNeed",
    entityId: d.id,
    action: ctx.hanhDongBuXong,
    newValues: ctx.thongTin,
    reason: ctx.lyDoBuXong,
    orgUnitId: d.orgUnitId,
  });
}

export type KetQuaHoanMotPhan = {
  /** Phí của đơn đã thu đủ (hoặc không có đơn phí) — không có gì phải làm. */
  khongThieu: boolean;
  /** Bé chưa điểm danh đã được gỡ khỏi case vì phí thu thiếu. */
  goKhoiCase: number;
  /** Dòng đã bù xong mà phí thu thiếu — chỉ ghi ngoại lệ tài chính, không đảo kết quả học. */
  daBuXong: number;
  /** Số còn thiếu (đồng); 0 khi đủ. */
  conThieu: number;
};

/**
 * T14 — XÉT LẠI học bù khi một khoản đã thu của ĐƠN PHÍ bị HOÀN MỘT PHẦN (`payment.refunded`). Đơn vẫn sống nên `order.voided` không bao giờ bắn.
 *
 * "Đủ điều kiện xếp case bằng phí" là `đã thu ≥ tổng tiền đơn phí` (cùng phép với danh sách: `daThuDu` ở `danh-sach-db.ts`), KHÔNG chỉ trạng thái đơn. Hoàn một phần
 * làm `đã thu < tổng` ⇒ suất của bé CHƯA học không còn cơ sở tiền ⇒ gỡ khỏi case, dòng về PENDING (derive thành "chờ thu phí" — `CHO_THU`), báo Sale cần thu bổ
 * sung. Bé ĐÃ học thì không đảo (không rút lại được buổi đã học) — ghi ngoại lệ tài chính cho kế toán. Idempotent: lần chạy lại không còn bé nào PLACED để gỡ.
 */
export async function xetLaiSauKhiHoanMotPhan(tx: Tx, p: { orderId: string; paymentId: string | null }): Promise<KetQuaHoanMotPhan> {
  const kq: KetQuaHoanMotPhan = { khongThieu: true, goKhoiCase: 0, daBuXong: 0, conThieu: 0 };
  const phiItems = await tx.orderItem.findMany({ where: { orderId: p.orderId, type: "MAKEUP_FEE" }, select: { id: true } });
  if (phiItems.length === 0) return kq;
  const phi = await docPhiCuaDong(tx, phiItems[0]!.id);
  // Đơn đã huỷ/hoàn/xoá là việc của `order.voided`; chỉ xét đơn CÒN SỐNG mà tiền đã thu bị bớt.
  if (!phi || !donPhiConSong(phi) || phi.daThu >= phi.tongTien) return kq;
  kq.khongThieu = false;
  kq.conThieu = phi.tongTien - phi.daThu;
  const dongs = await docDongDuaVaoPhi(tx, phiItems.map((i) => i.id));
  const thongTin = { donPhi: phi.orderCode, daThu: phi.daThu, tongTien: phi.tongTien, conThieu: kq.conThieu, khoanHoan: p.paymentId };
  for (const d of dongs) {
    await xuLyDongMatPhi(tx, d, kq, {
      maDon: phi.orderCode,
      lyDoNha: `Phí ${phi.orderCode} thu thiếu sau khi hoàn một phần`,
      hanhDongGo: "hoc-bu.go-khoi-case-vi-phi-thieu",
      hanhDongBuXong: "hoc-bu.phi-thieu-sau-khi-bu",
      thongTin,
      lyDoGo: `Phí học bù ${phi.orderCode} đã thu ${phi.daThu.toLocaleString("vi-VN")}đ / ${phi.tongTien.toLocaleString("vi-VN")}đ sau khi hoàn một phần — bé chưa điểm danh được gỡ khỏi case, xếp lại sau khi thu bổ sung.`,
      lyDoBuXong: `Bé đã học bù xong nhưng phí ${phi.orderCode} chỉ còn thu ${phi.daThu.toLocaleString("vi-VN")}đ / ${phi.tongTien.toLocaleString("vi-VN")}đ sau khi hoàn một phần — buổi đã học không rút lại được; kế toán cần đối soát.`,
    });
    if (d.status === "SCHEDULED") {
      await phatCanThuPhi(tx, { makeupNeedId: d.id, studentId: d.studentId, centerId: d.centerId, moc: p.paymentId, thieu: kq.conThieu });
    }
  }
  return kq;
}

/** Chạy trong transaction riêng của handler. */
export function xetLaiDonBiLoai(p: { orderId: string; denTrangThai: "CANCELLED" | "REFUNDED" }): Promise<KetQuaDonDoi> {
  return db.$transaction((tx) => xetLaiSauKhiDonBiLoai(tx, p), { timeout: 60_000, maxWait: 10_000 });
}

/** Chạy trong transaction riêng của handler (`payment.refunded`). */
export function xetLaiHoanMotPhan(p: { orderId: string; paymentId: string | null }): Promise<KetQuaHoanMotPhan> {
  return db.$transaction((tx) => xetLaiSauKhiHoanMotPhan(tx, p), { timeout: 60_000, maxWait: 10_000 });
}
