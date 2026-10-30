"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";

import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb, passesScope } from "@/lib/db-scope";
import { getAuditActor } from "@/lib/audit/log";
import { khopHocVien, MUC_KHOP, type HoSoHocVien, type MucKhop } from "@/lib/finance/doi-chieu-hoc-vien";
import { ghiGiaoDichCuChoHocVienInTx } from "@/lib/finance/ghi-giao-dich-cu";
import { phanLoaiTrung, type MucTrung } from "@/lib/finance/trung-giao-dich-cu";
import { getAssignableSales } from "@/lib/sales/assignable";
import { KHOAN_DA_GHI_NHAN } from "@/lib/finance/ghi-nhan";
import type { GiaoDichSheet } from "@/lib/finance/nhap-giao-dich-sheet";

/**
 * NHẬP GIAO DỊCH HỌC PHÍ CŨ — đối chiếu (xem thử) và ghi.
 *
 * ⚠️ FILE EXCEL KHÔNG ĐI QUA ĐÂY. Nó được đọc ở TRÌNH DUYỆT và chỉ những trường cần
 * thiết mới gửi lên: tên, SĐT, số tiền, ngày, ghi chú. CCCD học viên, CCCD phụ huynh và
 * địa chỉ nhà — vốn có trong file — không bao giờ rời máy người nhập. Đó cũng là lý do
 * việc này không đi đường script + GitHub workflow như các đợt trước.
 *
 * Khoá khớp là (SĐT phụ huynh, họ tên) — chủ dự án chốt 14/09/2026, vì mã học viên trong
 * sheet và mã trên hệ thống là hai hệ đánh số khác nhau.
 */

const giaoDichSchema = z.object({
  sheet: z.string().min(1).max(120),
  dong: z.number().int().nonnegative(),
  maHV: z.string().max(40).nullable(),
  hoTen: z.string().max(200).nullable(),
  sdt: z.string().max(20).nullable(),
  hocPhi: z.number().int().nonnegative(),
  /** ISO string — Date không qua được ranh giới Server Action một cách đáng tin. */
  ngay: z.string().max(40).nullable(),
  khoa: z.string().max(200).nullable(),
  coSo: z.string().max(200).nullable(),
  tinhTrang: z.string().max(120),
  ghiChu: z.string().max(500),
  /**
   * Tên sale ghi trong cột "Sales" của sheet — dạng tên gọi ("Diệu", "Nhật Hạ").
   * `.transform` về `null`: `GiaoDichSheet.sale` là `string | null`, để `undefined` lọt
   * qua là mỗi chỗ đọc phải tự nhớ ba trạng thái thay vì hai.
   */
  sale: z
    .string()
    .max(120)
    .nullish()
    .transform((v) => v ?? null),
});

const emSchema = z.object({
  sdt: z.string().max(20).nullable(),
  hoTen: z.string().max(200).nullable(),
  tongTien: z.number().int().nonnegative(),
  soDot: z.number().int().nonnegative(),
  giaoDich: z.array(giaoDichSchema).min(1).max(50),
});

const xemThuSchema = z.object({ ds: z.array(emSchema).min(1).max(2000) });

export type DongDoiChieu = {
  sdt: string | null;
  hoTen: string | null;
  maHVSheet: string | null;
  tongTien: number;
  soDot: number;
  muc: MucKhop;
  hocVienId: string | null;
  ungVien: HoSoHocVien[];
  /** Số dòng sheet của em này đã nhập ở lượt trước — hiện ra để không ai tưởng bị mất. */
  daNhapTruoc: number;
  /** Σ tiền ĐÃ GHI NHẬN của em trong hệ thống — thước đo chống nhập trùng. */
  daCoTien: number;
  /** Số đơn hiện có. CHỈ để hiển thị; quyết định dựa vào TIỀN, xem lib/finance/trung-giao-dich-cu.ts. */
  soDonHienCo: number;
  mucTrung: MucTrung;
  /** Ghi được tự động không (chỉ khi chưa có đồng nào trong hệ thống). */
  nenNhap: boolean;
};

/**
 * Danh sách TÀI KHOẢN SALE mà lượt nhập này được phép gán.
 *
 * Dùng chung cho CẢ màn xem thử (đổ vào ô chọn) lẫn đường ghi (gác id client gửi lên).
 * Hai danh sách khác nhau thì màn hiện một người mà server từ chối đúng người đó.
 *
 * ⚠️ `centerIds: []` trong `getAssignableSales` nghĩa là MỌI CƠ SỞ, không phải "không cơ
 * sở nào" — nên người cấp cơ sở mà `visibleCenterIds` rỗng phải trả về TẬP RỖNG tại chỗ,
 * đừng rơi vào nhánh `[]` (fail-closed, luật 7 · docs/luat-doc-so-va-ket-luan.md).
 */
async function dsSaleGanDuoc(actor: Awaited<ReturnType<typeof resolveActor>>) {
  const toanHeThong = actor.isSuperAdmin || actor.isHoLevel;
  if (!toanHeThong && actor.visibleCenterIds.length === 0) return [];
  return getAssignableSales({ centerIds: toanHeThong ? [] : actor.visibleCenterIds });
}

async function gacQuyen() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Cùng cổng với ghi nhận khoản thu — đây là hành vi GHI TIỀN.
  if (!(await checkPermission("payments:record"))) return null;
  return session;
}

/** Chuẩn hoá dữ liệu client gửi lên thành `GiaoDichSheet` (ngày về Date). */
function veGiaoDich(g: z.infer<typeof giaoDichSchema>): GiaoDichSheet {
  const d = g.ngay ? new Date(g.ngay) : null;
  return { ...g, ngay: d && !Number.isNaN(d.getTime()) ? d : null };
}

/**
 * XEM THỬ — đối chiếu danh sách em trong file với hồ sơ hệ thống. KHÔNG ghi gì.
 */
export async function xemThuNhapGiaoDichAction(input: unknown) {
  const session = await gacQuyen();
  if (!session) return { ok: false as const, error: "Không có quyền ghi nhận khoản thu" };

  const parsed = xemThuSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  // Ô chọn "gán cho sale" đổ từ đây — cùng nguồn với cổng gác ở đường ghi.
  const taiKhoanSale = await dsSaleGanDuoc(actor);

  // Tra MỘT lần cho mọi SĐT thay vì mỗi em một câu — 115 em là 115 lượt đi DB.
  const dsSdt = [...new Set(parsed.data.ds.map((e) => e.sdt).filter((s): s is string => !!s))];
  const hoSo = dsSdt.length
    ? await sdb.student.findMany({
        where: { deletedAt: null, parentPhone: { in: dsSdt } },
        select: {
          id: true,
          name: true,
          parentPhone: true,
          studentCode: true,
          center: { select: { name: true } },
        },
      })
    : [];

  const theoSdt = new Map<string, HoSoHocVien[]>();
  for (const h of hoSo) {
    if (!h.parentPhone) continue;
    const item: HoSoHocVien = {
      id: h.id,
      name: h.name,
      parentPhone: h.parentPhone,
      studentCode: h.studentCode,
      centerName: h.center?.name ?? null,
    };
    const cu = theoSdt.get(h.parentPhone);
    if (cu) cu.push(item);
    else theoSdt.set(h.parentPhone, [item]);
  }

  // Dòng nào đã nhập ở lượt trước — để màn nói "đã có", không để người tưởng bị mất.
  const { dauDongSheet } = await import("@/lib/finance/payment-markers");
  const moiDau = parsed.data.ds.flatMap((e) =>
    e.giaoDich.map((g) => ({ sdt: e.sdt, hoTen: e.hoTen, dau: dauDongSheet(g.sheet, g.dong) })),
  );
  const daCo = moiDau.length
    ? await sdb.payment.findMany({
        where: { deletedAt: null, OR: moiDau.map((x) => ({ note: { contains: x.dau } })) },
        select: { note: true },
      })
    : [];
  const noteDaCo = daCo.map((p) => p.note ?? "");

  // ── CHỐNG NHẬP TRÙNG ────────────────────────────────────────────────────────
  // Chủ dự án: "bỏ trùng các học viên đã được tạo đơn hàng rồi."
  //
  // ⚠️ Thước đo là TIỀN, không phải SỐ ĐƠN: nhóm cần chữa nhất lại chính là nhóm ĐÃ CÓ
  // ĐƠN mà CHƯA CÓ TIỀN (chốt hàng loạt qua `allowNoPayment` — có Order, có Enrollment,
  // không Payment nào). Lọc theo "có đơn" là bỏ sót đúng nhóm đang đi cứu.
  //
  // Đếm tiền qua CẢ HAI đường liên kết: `Payment.enrollmentId → Enrollment.studentId` và
  // `Payment.orderId → Order.studentId`. Chỉ đếm một đường là bỏ lọt khoản còn lại.
  const idKhop = [...new Set(hoSo.map((h) => h.id))];
  const tienTheoEm = new Map<string, number>();
  const donTheoEm = new Map<string, number>();
  if (idKhop.length > 0) {
    const khoan = await sdb.payment.findMany({
      where: {
        ...KHOAN_DA_GHI_NHAN,
        OR: [
          { enrollment: { studentId: { in: idKhop } } },
          { order: { studentId: { in: idKhop } } },
        ],
      },
      select: {
        id: true,
        amount: true,
        enrollment: { select: { studentId: true } },
        order: { select: { studentId: true } },
      },
    });
    // Một khoản có thể khớp CẢ HAI đường — đếm theo id khoản để không cộng đôi.
    const daTinh = new Set<string>();
    for (const k of khoan) {
      const sid = k.enrollment?.studentId ?? k.order?.studentId;
      if (!sid || daTinh.has(k.id)) continue;
      daTinh.add(k.id);
      tienTheoEm.set(sid, (tienTheoEm.get(sid) ?? 0) + k.amount);
    }
    const don = await sdb.order.groupBy({
      by: ["studentId"],
      where: { deletedAt: null, studentId: { in: idKhop } },
      _count: { _all: true },
    });
    for (const d of don) {
      if (d.studentId) donTheoEm.set(d.studentId, d._count._all);
    }
  }

  const rows: DongDoiChieu[] = parsed.data.ds.map((e) => {
    const kq = khopHocVien({ sdt: e.sdt, hoTen: e.hoTen }, theoSdt.get(e.sdt ?? "") ?? []);
    const daNhapTruoc = e.giaoDich.filter((g) => {
      const d = dauDongSheet(g.sheet, g.dong);
      return noteDaCo.some((n) => n.includes(d));
    }).length;
    const daCoTien = kq.hocVienId ? (tienTheoEm.get(kq.hocVienId) ?? 0) : 0;
    const soDonHienCo = kq.hocVienId ? (donTheoEm.get(kq.hocVienId) ?? 0) : 0;
    const trung = phanLoaiTrung({ daCoTien, tienTrongFile: e.tongTien, soDon: soDonHienCo });

    return {
      sdt: e.sdt,
      hoTen: e.hoTen,
      maHVSheet: e.giaoDich[0]?.maHV ?? null,
      tongTien: e.tongTien,
      soDot: e.soDot,
      muc: kq.muc,
      hocVienId: kq.hocVienId,
      ungVien: kq.ungVien,
      daNhapTruoc,
      daCoTien,
      soDonHienCo,
      mucTrung: trung.muc,
      // Ghi tự động CHỈ khi khớp chắc VÀ chưa có đồng nào trong hệ thống.
      nenNhap: kq.muc === MUC_KHOP.KHOP && trung.nenNhap,
    };
  });

  return {
    ok: true as const,
    rows,
    taiKhoanSale,
    tomTat: {
      tongEm: rows.length,
      khop: rows.filter((r) => r.muc === MUC_KHOP.KHOP).length,
      canChon: rows.filter(
        (r) => r.muc === MUC_KHOP.LECH_TEN || r.muc === MUC_KHOP.TRUNG_HO_SO,
      ).length,
      khongThay: rows.filter((r) => r.muc === MUC_KHOP.KHONG_THAY).length,
      tienKhop: rows
        .filter((r) => r.muc === MUC_KHOP.KHOP)
        .reduce((s, r) => s + r.tongTien, 0),
      daNhapTruoc: rows.reduce((s, r) => s + r.daNhapTruoc, 0),
      daCoTien: rows.filter((r) => r.daCoTien > 0).length,
      sanSang: rows.filter((r) => r.nenNhap).length,
      tienSanSang: rows.filter((r) => r.nenNhap).reduce((s, r) => s + r.tongTien, 0),
    },
  };
}

const ghiSchema = z.object({
  ds: z
    .array(
      z.object({
        /** Do client gửi: em đã khớp tự động, hoặc người vừa chọn tay. */
        hocVienId: z.string().min(1),
        giaoDich: z.array(giaoDichSchema).min(1).max(50),
        /**
         * Tài khoản SALE mà người nhập đã map từ tên trong sheet. `null` = chưa map.
         *
         * Server TỰ GÁC: id phải là một sale hợp lệ (`getAssignableSales`). Client gửi id
         * bất kỳ mà server tin là gán đơn cho người không phải sale, và hoa hồng/thành
         * tích chạy sai chỗ.
         */
        saleUserId: z.string().min(1).nullish(),
      }),
    )
    .min(1)
    .max(2000),
});

/**
 * GHI THẬT — mỗi em một transaction riêng.
 *
 * ⚠️ KHÔNG gói cả 115 em vào một transaction: một em hỏng là rollback sạch công của cả
 * lượt, và người vận hành không biết phải làm lại từ đâu. Từng em một thì em hỏng được
 * nêu tên, còn lại vẫn vào — và lượt sau chạy lại không cộng đôi nhờ dấu dòng.
 */
export async function ghiNhapGiaoDichAction(input: unknown) {
  const session = await gacQuyen();
  if (!session) return { ok: false as const, error: "Không có quyền ghi nhận khoản thu" };

  const parsed = ghiSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const au = getAuditActor(session);

  // Tra MỘT LẦN cho cả lượt — 115 em là 115 lượt đi DB nếu tra trong vòng lặp.
  const saleHopLe = new Set((await dsSaleGanDuoc(actor)).map((s) => s.id));

  let thanhCong = 0;
  let tongTien = 0;
  let boQuaDaCo = 0;
  let chuaGanGhiDanh = 0;
  const loi: string[] = [];

  for (const em of parsed.data.ds) {
    // scopedDb auto-scope READ; đây là đường GHI nên tự gác.
    const hv = await sdb.student.findUnique({
      where: { id: em.hocVienId },
      select: { id: true, centerId: true, name: true, deletedAt: true },
    });
    if (!hv || hv.deletedAt || !passesScope("Student", hv, actor)) {
      loi.push(`${em.hocVienId}: không tìm thấy học viên trong phạm vi của bạn`);
      continue;
    }

    // Sale phải là sale THẬT trong hệ thống — client gửi id bất kỳ thì đơn gán cho người
    // không phải sale, và hoa hồng/thành tích chạy sai chỗ. Danh sách hợp lệ tra MỘT LẦN
    // ở ngoài vòng lặp (`saleHopLe`).
    const saleUserId = em.saleUserId && saleHopLe.has(em.saleUserId) ? em.saleUserId : null;
    if (em.saleUserId && !saleUserId) {
      loi.push(`${hv.name}: sale được chọn không hợp lệ — đơn ghi theo người nhập`);
    }

    try {
      const kq = await sdb.$transaction((txRaw) =>
        ghiGiaoDichCuChoHocVienInTx(txRaw as unknown as Prisma.TransactionClient, {
          actor: { id: au.actorId, name: au.actorName },
          hocVienId: hv.id,
          giaoDich: em.giaoDich.map(veGiaoDich),
          saleUserId,
        }),
      );
      if ("loi" in kq) {
        loi.push(`${hv.name}: ${kq.loi}`);
        continue;
      }
      if (kq.daGhi > 0) thanhCong += 1;
      tongTien += kq.tongTien;
      boQuaDaCo += kq.boQuaDaCo;
      if (kq.chuaGanGhiDanh && kq.daGhi > 0) chuaGanGhiDanh += 1;
    } catch (e) {
      loi.push(`${hv.name}: ${e instanceof Error ? e.message : "lỗi không rõ"}`);
    }
  }

  revalidatePath("/payments");
  revalidatePath("/cong-no");
  revalidatePath("/thieu-hoc-phi");

  return { ok: true as const, thanhCong, tongTien, boQuaDaCo, chuaGanGhiDanh, loi };
}
