// lib/nguon/gan-payment-ghi-danh-db.ts — TẦNG DB của «gắn Payment.enrollmentId cho 9 khoản thu của 6 đơn sống» (Wave 1, PHASE B.2). Lõi quyết định: `gan-payment-ghi-danh.ts` (thuần).
//
// ── QUY ƯỚC (giống `sua-gia-ghi-danh-db.ts`) ────────────────────────────────────────────────────────────────
//   · Mọi hàm nhận client làm tham số BẮT BUỘC; `bang` (PHẠM VI + ghi danh đích + khoản) cũng BẮT BUỘC, không mặc định (luật 7). Script truyền hằng `BANG_GAN_PAYMENT`, ca DB truyền bảng fixture.
//
// ── PHÉP GHI DUY NHẤT: MỘT cột của MỘT bảng ────────────────────────────────────────────────────────────────
//   Payment.enrollmentId (NULL → ghi danh đích) qua `payment.updateMany` CÓ ĐIỀU KIỆN `{ id, enrollmentId: null, amount, deletedAt: null, orderItemId }` — đúng giao thức của `thucHienKeHoachGan` (payment.ts)
//   nhưng KHÔNG ghi lại `amount` / `note` (không có gì để ghi lại: số tiền không bao giờ tách).
//   ⚠️ KHÔNG gọi thẳng `thucHienKeHoachGan` / `napGanGhiDanhCuaDon`: `payment.ts` kéo theo `server-only` (chỉ nạp được trong Next), nên một script tsx không import được nó. Thay vào đó:
//     · PLANNER là CHÍNH `lapKeHoachGanGhiDanh` (thuần, import được) chạy trên dữ liệu nạp bằng bản sao CÓ TEST TƯƠNG ĐƯƠNG của `napGanGhiDanhCuaDon` (`[GPD-DB-PAR*]` so với bản thật);
//     · phép ghi có CÙNG điều kiện `where` + CÙNG dòng audit (`module=finance, entityType=Payment, action=UPDATE`) với đường chuẩn (`[GPD-DB-PAR*]` so trạng thái cuối).
//   Bằng chứng KHÔNG đụng gì khác nằm TRONG transaction: «ảnh chụp bất biến» (Order · dòng đơn · Enrollment · MỌI cột Payment trừ `enrollmentId`/`updatedAt` · giao dịch ngân hàng + phân bổ ·
//   phiếu yêu cầu · hoá đơn điện tử + dòng nối · số dòng Receipt/hoa hồng/StudentTransaction/hoàn tiền) chụp TRƯỚC phép ghi đầu tiên và SAU phép ghi cuối; khác một byte ⇒ `throw` ⇒ cả lô lùi.
//
// ── THỨ TỰ TRONG TRANSACTION (lưới `[GPG-W*]` canh) ─────────────────────────────────────────────────────────
//   khoá Order → OrderItem → Enrollment → Payment (`FOR UPDATE`) → ĐỌC LẠI + lập lại kế hoạch → cổng số duyệt/lệch → ảnh chụp «trước» → cổng Wave 1 → claim nonce (phép ghi ĐẦU TIÊN)
//   → `payment.updateMany` (count≠1 ⇒ throw) + audit → đọc lại phải ra «cả lô đã gắn ĐÚNG» → ảnh chụp «sau» = «trước» → audit mức lượt. Lô đã gắn đúng (chạy lại) ⇒ 0 dòng ghi, KHÔNG cổng, KHÔNG claim.
import type { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { writeAudit } from "@/lib/audit/audit-log";
import { lapKeHoachGanGhiDanh, giuNguyenTien, type GhiDanhUngVien } from "@/lib/finance/ke-hoach-gan-ghi-danh";
import { khoanDaKhoaHoaDon } from "@/lib/finance/hoa-don/khoa-khoan";
import { soTienRong } from "@/lib/finance/hoa-don/nguon-khoan";
import { laKhoanDaGhiNhan } from "@/lib/finance/ghi-nhan";
import { expandPhoneVariants } from "@/lib/phone";
import { claimPheDuyet, kiemCongGhiTruocGhi, WORKFLOW_WAVE1, type DauVaoCongGhi } from "@/lib/security/cong-ghi-wave1";
import {
  HANH_DONG_GAN_PAYMENT_LUOT,
  LY_DO_GAN_PAYMENT,
  NGUON_GHI_GAN_PAYMENT,
  dungBanGhiLuotGanPayment,
  khoaLuotChayGanPayment,
  lapKeHoachGanPayment,
  quyetDinhGhiGanPayment,
  type DuLieuGanPayment,
  type KeHoachGanPayment,
  type KetQuaPlannerChuan,
  type LuotChayGanPayment,
  type MucGanPayment,
} from "./gan-payment-ghi-danh";

export type KhachGanPayment = PrismaClient | Prisma.TransactionClient;

export const ACTOR_GAN_PAYMENT = { id: null, name: "Script gắn khoản thu vào ghi danh (gan-payment-ghi-danh)" } as const;

type Bang = Readonly<Record<string, MucGanPayment>>;

/** Planner chuẩn cho MỘT đơn: nạp dữ liệu như `napGanGhiDanhCuaDon` rồi chạy CHÍNH `lapKeHoachGanGhiDanh`. `trongTam` = mọi cơ sở (đường tự động — cổng cơ sở nằm ở lõi: khoản/ghi danh/đơn cùng cơ sở). */
export async function chayPlannerChuan(c: KhachGanPayment, orderId: string): Promise<{ khoan: { id: string; amount: number }[]; ketQua: KetQuaPlannerChuan[] }> {
  const dong = await c.payment.findMany({
    where: { orderId, deletedAt: null },
    select: { id: true, amount: true, adjustmentOfId: true, deletedAt: true, paymentType: true, saleStatus: true, accountantStatus: true, enrollmentId: true },
  });
  const rong = soTienRong(dong);
  const khoan = dong
    .filter((p) => laKhoanDaGhiNhan(p) && p.enrollmentId === null)
    .map((p) => ({ id: p.id, amount: p.amount, paymentType: p.paymentType, accountantStatus: p.accountantStatus, rong: rong.get(p.id) ?? p.amount }));
  if (khoan.length === 0) return { khoan: [], ketQua: [] };

  const don = await c.order.findUnique({
    where: { id: orderId },
    select: { customerPhone: true, studentId: true, items: { select: { studentId: true, totalPrice: true, discountAmount: true, metadata: true } } },
  });
  if (!don) return { khoan: khoan.map((k) => ({ id: k.id, amount: k.amount })), ketQua: [] };
  const dongDon = don.items.map((it) => {
    const m = it.metadata as Record<string, unknown> | null;
    return { studentId: it.studentId, courseId: typeof m?.courseId === "string" && m.courseId ? m.courseId : null, thanhTien: it.totalPrice - (it.discountAmount ?? 0) };
  });
  const idHocVien = new Set<string>();
  for (const d of dongDon) if (d.studentId) idHocVien.add(d.studentId);
  if (don.studentId) idHocVien.add(don.studentId);
  if (don.customerPhone) {
    const cuaPhuHuynh = await c.student.findMany({ where: { parentPhone: { in: expandPhoneVariants([don.customerPhone]) }, deletedAt: null }, select: { id: true } });
    for (const s of cuaPhuHuynh) idHocVien.add(s.id);
  }
  const dsGhiDanh =
    idHocVien.size === 0
      ? []
      : await c.enrollment.findMany({
          where: { studentId: { in: [...idHocVien] }, deletedAt: null },
          select: { id: true, studentId: true, finalPrice: true, centerId: true, courseId: true, class: { select: { courseId: true } } },
          orderBy: { createdAt: "asc" },
        });
  const khoa = await khoanDaKhoaHoaDon(c, khoan.map((k) => k.id));
  const ghiDanh: GhiDanhUngVien[] = dsGhiDanh.map((e) => ({
    enrollmentId: e.id,
    studentId: e.studentId,
    courseId: e.class?.courseId ?? e.courseId,
    finalPrice: e.finalPrice ?? 0,
    centerId: e.centerId,
  }));
  const kh = lapKeHoachGanGhiDanh({
    khoan,
    dongDon,
    ghiDanh,
    coHocVien: idHocVien.size > 0,
    daKhoa: new Map(khoa.map((k) => [k.paymentId, { trangThai: k.trangThai, so: [k.kyHieu, k.soHoaDon].filter(Boolean).join("-") || "(chưa ghi số)" }])),
    trongTam: () => true,
  });
  const ketQua = kh.dong.map((d): KetQuaPlannerChuan =>
    d.ketQua === "BO_QUA"
      ? { paymentId: d.paymentId, ketQua: "BO_QUA", soPhan: d.phanThu.length, enrollmentId: null, amount: null, giuNguyenTien: false, maBoQua: d.ma }
      : { paymentId: d.paymentId, ketQua: d.ketQua, soPhan: d.phan.length, enrollmentId: d.phan[0]?.enrollmentId ?? null, amount: d.phan[0]?.amount ?? null, giuNguyenTien: giuNguyenTien(d.phan, d.soTien), maBoQua: null },
  );
  return { khoan: khoan.map((k) => ({ id: k.id, amount: k.amount })), ketQua };
}

/** ĐỌC dữ liệu cho các mã trong `bang`. Số câu đọc CỐ ĐỊNH theo số bảng (cộng 1 planner/đơn), không theo số khoản. */
export async function docDuLieuGanPayment(c: KhachGanPayment, bang: Bang): Promise<DuLieuGanPayment[]> {
  const ma = Object.keys(bang);
  const donList = await c.order.findMany({
    where: { code: { in: ma } },
    orderBy: { code: "asc" },
    select: {
      id: true, code: true, type: true, deletedAt: true, studentId: true, centerId: true, totalAmount: true, leadId: true,
      items: { select: { id: true, type: true, studentId: true, enrollmentId: true }, orderBy: { id: "asc" } },
    },
  });
  const orderIds = donList.map((d) => d.id);
  // Ghi danh đích = ghi danh PHASE A đã gắn vào dòng đơn (đọc từ DB, không từ mã nguồn).
  const enrIds = [...new Set(donList.flatMap((d) => d.items.flatMap((i) => (i.enrollmentId ? [i.enrollmentId] : []))))];
  const dichIds = enrIds;

  const [ghiDanh, payments, nganHang, phanBo] = await Promise.all([
    c.enrollment.findMany({ where: { id: { in: enrIds } }, select: { id: true, studentId: true, status: true, centerId: true, deletedAt: true, discountType: true, tuition: true, finalPrice: true } }),
    c.payment.findMany({
      where: { orderId: { in: orderIds } },
      select: { id: true, orderId: true, amount: true, paymentType: true, saleStatus: true, accountantStatus: true, enrollmentId: true, orderItemId: true, adjustmentOfId: true, centerId: true, note: true, deletedAt: true },
    }),
    // ỨNG VIÊN giao dịch ngân hàng: mọi giao dịch có phân bổ vào phiếu yêu cầu của CHÍNH các đơn này (mọi trạng thái, mọi số tiền) — lõi tự lọc.
    c.$queryRaw<{ id: string; provider: string; providerTxnId: string; amount: number; status: string; centerId: string | null; tong: number; orderId: string; vao: number }[]>`
      SELECT bt.id AS id, bt.provider AS provider, bt."providerTxnId" AS "providerTxnId", bt.amount AS amount, bt.status::text AS status, bt."centerId" AS "centerId",
             (SELECT COALESCE(SUM(a.amount), 0) FROM "PaymentAllocation" a WHERE a."bankTransactionId" = bt.id)::int AS tong,
             pr."orderId" AS "orderId", SUM(pa.amount)::int AS vao
      FROM "PaymentAllocation" pa
      JOIN "PaymentRequest" pr ON pr.id = pa."paymentRequestId"
      JOIN "BankTransaction" bt ON bt.id = pa."bankTransactionId"
      WHERE pr."orderId" = ANY(${orderIds}::text[])
      GROUP BY bt.id, pr."orderId" ORDER BY bt.id`,
    c.$queryRaw<{ orderId: string; tong: number }[]>`
      SELECT pr."orderId" AS "orderId", COALESCE(SUM(pa.amount), 0)::int AS tong
      FROM "PaymentAllocation" pa
      JOIN "PaymentRequest" pr ON pr.id = pa."paymentRequestId"
      JOIN "BankTransaction" bt ON bt.id = pa."bankTransactionId"
      WHERE pr."orderId" = ANY(${orderIds}::text[]) AND bt.status::text = 'MATCHED'
      GROUP BY pr."orderId"`,
  ]);
  const moiPaymentIds = payments.map((p) => p.id);
  const leadIds = [...new Set(donList.flatMap((d) => (d.leadId ? [d.leadId] : [])))];

  const [khoa, bienLai, giaoDichHH, giu, tranhChap, slotHH, dieuChinhHH, dongHH, hocVienGD, hoanTien, butToanTro, ngoai] = await Promise.all([
    khoanDaKhoaHoaDon(c, moiPaymentIds),
    c.receipt.findMany({ where: { paymentId: { in: moiPaymentIds } }, select: { paymentId: true } }),
    c.commissionTransaction.findMany({ where: { OR: [{ paymentId: { in: moiPaymentIds } }, { orderId: { in: orderIds } }] }, select: { paymentId: true, orderId: true } }),
    c.commissionHold.findMany({ where: { paymentId: { in: moiPaymentIds } }, select: { paymentId: true } }),
    c.commissionDispute.findMany({ where: { paymentId: { in: moiPaymentIds } }, select: { paymentId: true } }),
    c.commissionCalcSlot.findMany({ where: { paymentId: { in: moiPaymentIds } }, select: { paymentId: true } }),
    c.commissionAdjustmentRequest.findMany({ where: { paymentId: { in: moiPaymentIds } }, select: { paymentId: true } }),
    c.commissionLine.findMany({ where: { OR: [{ enrollmentId: { in: dichIds } }, { leadId: { in: leadIds } }] }, select: { enrollmentId: true, leadId: true } }),
    c.studentTransaction.findMany({ where: { orderId: { in: orderIds } }, select: { orderId: true } }),
    c.refundRequest.findMany({ where: { enrollmentId: { in: dichIds } }, select: { enrollmentId: true } }),
    c.payment.findMany({ where: { adjustmentOfId: { in: moiPaymentIds } }, select: { adjustmentOfId: true } }),
    // Chỉ khoản SỐNG: khoản xoá mềm (vd bút toán backfill cũ của đơn khác) không vào công nợ nên không chặn lô; lệch trên khoản xoá mềm của CHÍNH 6 đơn đã có lưới riêng (PAYMENT_XOA_LECH).
    c.payment.findMany({ where: { enrollmentId: { in: dichIds }, deletedAt: null }, select: { id: true, enrollmentId: true } }),
  ]);

  const out: DuLieuGanPayment[] = [];
  for (const d of donList) {
    const itemEnr = d.items.find((i) => i.type === "COURSE_ENROLLMENT")?.enrollmentId ?? null;
    const ge = itemEnr === null ? null : (ghiDanh.find((g) => g.id === itemEnr) ?? null);
    const cua = payments.filter((p) => p.orderId === d.id);
    const song = cua.filter((p) => p.deletedAt === null);
    const idCua = new Set(cua.map((p) => p.id));
    const dich = itemEnr;
    const cuaDon = (paymentId: string | null) => paymentId !== null && idCua.has(paymentId);
    const tacDungPhu =
      bienLai.filter((x) => cuaDon(x.paymentId)).length +
      giaoDichHH.filter((x) => cuaDon(x.paymentId) || x.orderId === d.id).length +
      giu.filter((x) => cuaDon(x.paymentId)).length +
      tranhChap.filter((x) => cuaDon(x.paymentId)).length +
      slotHH.filter((x) => cuaDon(x.paymentId)).length +
      dieuChinhHH.filter((x) => cuaDon(x.paymentId)).length +
      dongHH.filter((x) => (dich !== null && x.enrollmentId === dich) || (d.leadId !== null && x.leadId === d.leadId)).length +
      hocVienGD.filter((x) => x.orderId === d.id).length +
      hoanTien.filter((x) => dich !== null && x.enrollmentId === dich).length +
      butToanTro.filter((x) => x.adjustmentOfId !== null && idCua.has(x.adjustmentOfId)).length;
    const planner = await chayPlannerChuan(c, d.id);
    out.push({
      don: { id: d.id, code: d.code, type: d.type, deletedAt: d.deletedAt, studentId: d.studentId, centerId: d.centerId, totalAmount: d.totalAmount, items: d.items.map((i) => ({ id: i.id, type: i.type, studentId: i.studentId, enrollmentId: i.enrollmentId })) },
      ghiDanh: ge === null ? null : { id: ge.id, studentId: ge.studentId, status: ge.status, centerId: ge.centerId, deletedAt: ge.deletedAt, discountType: ge.discountType, tuition: ge.tuition, finalPrice: ge.finalPrice },
      paymentSong: song.map((p) => ({ id: p.id, amount: p.amount, paymentType: p.paymentType, saleStatus: p.saleStatus, accountantStatus: p.accountantStatus, enrollmentId: p.enrollmentId, orderItemId: p.orderItemId, adjustmentOfId: p.adjustmentOfId, centerId: p.centerId, note: p.note })),
      paymentDaXoa: cua.filter((p) => p.deletedAt !== null).map((p) => ({ id: p.id, enrollmentId: p.enrollmentId })),
      nganHang: nganHang.filter((g) => g.orderId === d.id).map((g) => ({ id: g.id, provider: g.provider, providerTxnId: g.providerTxnId, amount: g.amount, status: g.status, centerId: g.centerId, tongPhanBo: g.tong, phanBoVaoDon: g.vao })),
      tongPhanBoDon: phanBo.find((x) => x.orderId === d.id)?.tong ?? 0,
      trongHoaDon: Object.fromEntries(khoa.filter((k) => idCua.has(k.paymentId)).map((k) => [k.paymentId, k.hoaDonId])),
      tacDungPhu,
      paymentNgoaiGanGhiDanh: ngoai.filter((x) => dich !== null && x.enrollmentId === dich && !idCua.has(x.id)).length,
      plannerChuan: planner.ketQua,
    });
  }
  return out;
}

export async function docKeHoachGanPayment(c: KhachGanPayment, bang: Bang): Promise<KeHoachGanPayment> {
  return lapKeHoachGanPayment({ bang, du: await docDuLieuGanPayment(c, bang) });
}

/**
 * ẢNH CHỤP BẤT BIẾN: mọi thứ chủ dự án CẤM đổi. Order · dòng đơn · Enrollment (MỌI cột) · MỌI Payment (cả đã xoá) TRỪ `enrollmentId` và `updatedAt` (hai thứ DUY NHẤT phép ghi được đổi — `updatedAt` do Prisma tự
 * đặt) · giao dịch ngân hàng + phân bổ + phiếu yêu cầu · hoá đơn điện tử + dòng nối · số dòng phụ (Receipt, hoa hồng các loại, StudentTransaction, hoàn tiền). sha256 của JSON ổn định. Chụp TRƯỚC và SAU phép ghi.
 */
export async function anhChupBatBienGanPayment(c: KhachGanPayment, bang: Bang): Promise<string> {
  const ma = Object.keys(bang);
  const donList = await c.order.findMany({ where: { code: { in: ma } }, orderBy: { id: "asc" }, include: { items: { orderBy: { id: "asc" } } } });
  const orderIds = donList.map((d) => d.id);
  const enrIds = [...new Set(donList.flatMap((d) => d.items.flatMap((i) => (i.enrollmentId ? [i.enrollmentId] : []))))];
  const leadIds = donList.flatMap((d) => (d.leadId ? [d.leadId] : []));
  const [ghiDanh, paymentTho, nganHang, phanBo, phieuYeuCau, hoaDonKhoan, soPhu] = await Promise.all([
    c.enrollment.findMany({ where: { id: { in: enrIds } }, orderBy: { id: "asc" } }),
    c.payment.findMany({ where: { orderId: { in: orderIds } }, orderBy: { id: "asc" } }),
    c.$queryRaw<unknown[]>`
      SELECT bt.* FROM "BankTransaction" bt
      WHERE bt.id IN (SELECT pa."bankTransactionId" FROM "PaymentAllocation" pa JOIN "PaymentRequest" pr ON pr.id = pa."paymentRequestId" WHERE pr."orderId" = ANY(${orderIds}::text[]))
      ORDER BY bt.id`,
    c.$queryRaw<unknown[]>`
      SELECT pa.* FROM "PaymentAllocation" pa
      WHERE pa."paymentRequestId" IN (SELECT id FROM "PaymentRequest" WHERE "orderId" = ANY(${orderIds}::text[]))
         OR pa."bankTransactionId" IN (SELECT pa2."bankTransactionId" FROM "PaymentAllocation" pa2 JOIN "PaymentRequest" pr2 ON pr2.id = pa2."paymentRequestId" WHERE pr2."orderId" = ANY(${orderIds}::text[]))
      ORDER BY pa.id`,
    c.$queryRaw<unknown[]>`SELECT pr.* FROM "PaymentRequest" pr WHERE pr."orderId" = ANY(${orderIds}::text[]) ORDER BY pr.id`,
    c.$queryRaw<unknown[]>`
      SELECT hk.*, hd."trangThai"::text AS "hd_trangThai", hd."tongTien" AS "hd_tongTien", hd."soHoaDon" AS "hd_soHoaDon", hd."updatedAt" AS "hd_updatedAt"
      FROM "HoaDonKhoan" hk JOIN "HoaDonDienTu" hd ON hd.id = hk."hoaDonId"
      WHERE hk."paymentId" IN (SELECT id FROM "Payment" WHERE "orderId" = ANY(${orderIds}::text[])) ORDER BY hk."hoaDonId", hk."paymentId"`,
    Promise.all([
      c.receipt.count({ where: { payment: { orderId: { in: orderIds } } } }),
      c.commissionTransaction.count({ where: { OR: [{ orderId: { in: orderIds } }, { payment: { orderId: { in: orderIds } } }] } }),
      c.commissionHold.count({ where: { payment: { orderId: { in: orderIds } } } }),
      c.commissionDispute.count({ where: { payment: { orderId: { in: orderIds } } } }),
      c.commissionCalcSlot.count({ where: { payment: { orderId: { in: orderIds } } } }),
      c.commissionAdjustmentRequest.count({ where: { payment: { orderId: { in: orderIds } } } }),
      c.commissionLine.count({ where: { OR: [{ enrollmentId: { in: enrIds } }, { leadId: { in: leadIds } }] } }),
      c.studentTransaction.count({ where: { orderId: { in: orderIds } } }),
      c.refundRequest.count({ where: { enrollmentId: { in: enrIds } } }),
    ]),
  ]);
  // Payment: bỏ ĐÚNG hai khoá phép ghi được đổi.
  const payments = paymentTho.map((p) => {
    const { enrollmentId: _e, updatedAt: _u, ...con } = p;
    void _e;
    void _u;
    return con;
  });
  return createHash("sha256")
    .update(JSON.stringify({ donList, ghiDanh, payments, nganHang, phanBo, phieuYeuCau, hoaDonKhoan, soPhu }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), "utf8")
    .digest("hex");
}

export type DauVaoGhiGanPayment = {
  /** PHẠM VI CỨNG + ghi danh đích + khoản. BẮT BUỘC khai (luật 7). */
  bang: Bang;
  /** `null` = không truyền `--expect`. */
  soDuyet: number | null;
  /** `has_table_privilege(…"Payment"…, 'UPDATE')`; `null` = không kiểm được. */
  ghiDuoc: boolean | null;
  actor: { id: null; name: string };
  luotChay: LuotChayGanPayment;
  /** Cổng ghi Wave 1 (artifact owner ký). BẮT BUỘC khai: không có đường ghi nào không qua cổng. */
  congGhi: DauVaoCongGhi;
};

export type KetQuaGhiGanPayment = { daGhi: number; daGanHet: boolean; keHoachSha: string };

/** GHI. Trước transaction chỉ để BÁO SỚM; cổng chặn thật nằm TRONG transaction (`ghiGanPaymentTrongTx`). MỘT transaction cho cả lô. */
export async function ghiGanPayment(c: PrismaClient, input: DauVaoGhiGanPayment): Promise<KetQuaGhiGanPayment> {
  const truoc = quyetDinhGhiGanPayment({ soDuyet: input.soDuyet, keHoach: await docKeHoachGanPayment(c, input.bang), ghiDuoc: input.ghiDuoc });
  if (truoc !== null) throw new Error(truoc);
  return c.$transaction((tx) => ghiGanPaymentTrongTx(tx, input), { timeout: 120_000, maxWait: 15_000 });
}

/** Phần TRONG transaction — export riêng để ca DB gọi THẲNG. Mọi cổng đứng TRƯỚC phép ghi đầu tiên; từ chối là `throw` (luật rollback: `return` KHÔNG rollback). */
export async function ghiGanPaymentTrongTx(tx: Prisma.TransactionClient, input: DauVaoGhiGanPayment): Promise<KetQuaGhiGanPayment> {
  const ma = Object.keys(input.bang);
  // 1) KHOÁ hàng sẽ đọc/ghi, theo thứ tự cố định (tránh khoá chéo).
  await tx.$queryRaw`SELECT id FROM "Order" WHERE code = ANY(${ma}::text[]) ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "OrderItem" WHERE "orderId" IN (SELECT id FROM "Order" WHERE code = ANY(${ma}::text[])) ORDER BY id FOR UPDATE`;
  // Ghi danh đích đọc từ dòng đơn (đã khoá ngay trên) — không từ mã nguồn.
  await tx.$queryRaw`SELECT id FROM "Enrollment" WHERE id IN (SELECT "enrollmentId" FROM "OrderItem" WHERE "orderId" IN (SELECT id FROM "Order" WHERE code = ANY(${ma}::text[])) AND "enrollmentId" IS NOT NULL) ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Payment" WHERE "orderId" IN (SELECT id FROM "Order" WHERE code = ANY(${ma}::text[])) ORDER BY id FOR UPDATE`;

  // 2) ĐỌC LẠI sau khi khoá + lập lại kế hoạch bằng CHÍNH hàm thuần; cổng số duyệt/lệch.
  const kh = await docKeHoachGanPayment(tx, input.bang);
  const loi = quyetDinhGhiGanPayment({ soDuyet: input.soDuyet, keHoach: kh, ghiDuoc: input.ghiDuoc });
  if (loi !== null) throw new Error(loi);

  // Cả lô đã gắn đúng (chạy lại) ⇒ không có gì để duyệt: 0 dòng ghi, KHÔNG cổng, KHÔNG claim.
  if (kh.ghi.length === 0) return { daGhi: 0, daGanHet: kh.daGanHet, keHoachSha: kh.sha };

  // 3) Ảnh chụp bất biến «trước».
  const truoc = await anhChupBatBienGanPayment(tx, input.bang);

  // 4) CỔNG WAVE 1 — TRƯỚC phép ghi đầu tiên; dòng do CHÍNH lõi dựng. Claim `wg:<nonce>` là PHÉP GHI ĐẦU TIÊN.
  const duoc = await kiemCongGhiTruocGhi(tx, input.congGhi, WORKFLOW_WAVE1.ganPaymentGhiDanh, kh.dongDauRa);
  await claimPheDuyet(tx, duoc, { appliedAt: input.congGhi.now, rowCount: kh.ghi.length, runRef: input.congGhi.runRef });

  // 5) GHI. Điều kiện «khoản vẫn chưa gắn · đúng số tiền · còn sống · đúng dòng đơn» trong `where`; count ≠ 1 ⇒ THROW cả lô — không `continue`, không tách.
  let daGhi = 0;
  for (const g of kh.ghi) {
    const r = await tx.payment.updateMany({
      where: { id: g.paymentId, enrollmentId: null, amount: g.amount, deletedAt: null, orderItemId: g.orderItemId, orderId: g.orderId },
      data: { enrollmentId: g.enrollmentId },
    });
    if (r.count !== 1) throw new Error(`Gắn khoản ${g.paymentId} (${g.code}): khoản không còn «chưa gắn · đúng số tiền · còn sống» giữa chừng — lùi cả lô.`);
    daGhi++;
    await writeAudit({
      actor: input.actor,
      module: "finance",
      entityType: "Payment",
      entityId: g.paymentId,
      action: "UPDATE",
      oldValues: { enrollmentId: null },
      newValues: { enrollmentId: g.enrollmentId, soTien: g.amount, maDon: g.code, maGiaoDich: g.providerTxnId, source: NGUON_GHI_GAN_PAYMENT },
      changedFields: ["enrollmentId"],
      reason: LY_DO_GAN_PAYMENT,
      orgUnitId: null,
      tx,
    });
  }

  // 6) ĐỌC LẠI: cả lô phải ra «đã gắn ĐÚNG», và không bất biến nào bị đổi.
  const sau = await docKeHoachGanPayment(tx, input.bang);
  if (sau.dung || !sau.daGanHet) {
    throw new Error(`Sau khi ghi, kế hoạch không ra «cả lô đã gắn đúng» (${sau.loi.map((x) => `${x.code}:${x.ma}`).join(" · ") || "chưa đủ"}) — lùi cả lô.`);
  }
  const anhSau = await anhChupBatBienGanPayment(tx, input.bang);
  if (anhSau !== truoc) throw new Error("Ảnh chụp bất biến (Order · dòng đơn · Enrollment · mọi cột Payment trừ enrollmentId · giao dịch ngân hàng · hoá đơn · số dòng phụ) ĐỔI sau phép ghi — lùi cả lô.");

  // 7) Bản ghi MỨC LƯỢT CHẠY — cùng transaction.
  if (input.soDuyet === null) throw new Error("ghiGanPaymentTrongTx: thiếu soDuyet sau khi cổng đã qua.");
  await writeAudit({
    actor: input.actor,
    module: "finance",
    entityType: "GanPaymentGhiDanh",
    entityId: khoaLuotChayGanPayment(input.luotChay.nguonChay),
    action: HANH_DONG_GAN_PAYMENT_LUOT,
    oldValues: null,
    newValues: dungBanGhiLuotGanPayment({ luot: input.luotChay, soDuyet: input.soDuyet, keHoach: kh, daGhi }),
    changedFields: ["expectedCount", "actualCount"],
    reason: "Lượt chạy gắn khoản thu vào ghi danh: người bấm · số đã duyệt · số thực ghi",
    tx,
  });
  return { daGhi, daGanHet: true, keHoachSha: kh.sha };
}

/** KIỂM SAU GHI (chỉ đọc): cả lô đã gắn đúng + số Payment sống đã gắn ghi danh (PHẢI = tổng khoản của bảng) + khoản xoá mềm vẫn chưa gắn. */
export async function kiemSauGhiGanPayment(
  c: KhachGanPayment,
  bang: Bang,
): Promise<{ keHoach: KeHoachGanPayment; paymentDaGan: number; tongKhoanBang: number; xoaMemDaGan: number }> {
  const keHoach = await docKeHoachGanPayment(c, bang);
  const ma = Object.keys(bang);
  const paymentDaGan = await c.payment.count({ where: { order: { code: { in: ma } }, deletedAt: null, enrollmentId: { not: null } } });
  const xoaMemDaGan = await c.payment.count({ where: { order: { code: { in: ma } }, deletedAt: { not: null }, enrollmentId: { not: null } } });
  return { keHoach, paymentDaGan, tongKhoanBang: Object.values(bang).reduce((s, m) => s + m.soKhoan, 0), xoaMemDaGan };
}
