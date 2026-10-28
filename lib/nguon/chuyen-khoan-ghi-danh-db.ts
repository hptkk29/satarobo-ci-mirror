// lib/nguon/chuyen-khoan-ghi-danh-db.ts — TẦNG DB của «P7-B v2 · khoản thu và giá đi theo ghi danh đang học» (nhóm G2; v2 27/10/2026). Lõi quyết định: `chuyen-khoan-ghi-danh.ts` (thuần).
//
// ── QUY ƯỚC ───────────────────────────────────────────────────────────────────────────────────────────────
//   · v2: mọi hàm ĐỌC/GHI nhận danh sách cặp `cap` (do người ký chọn) BẮT BUỘC. Không còn quét «mọi ghi danh đóng còn giữ khoản»: cặp không có trong `cap` không bao giờ được đọc-để-ghi.
//   · Số câu đọc CỐ ĐỊNH, không theo số cặp.
//
// ── PHÉP GHI: HAI bảng, MỖI phép một `updateMany` CÓ ĐIỀU KIỆN ───────────────────────────────────────────────
//   · Payment.enrollmentId (ghi danh cũ → ghi danh mới) — `where` đòi đang gắn ghi danh cũ, PAYMENT đã xác nhận (`KHOAN_DA_XAC_NHAN`, chưa xoá), không điều chỉnh; số dòng đổi PHẢI bằng số khoản đã ký (`saleStatus` do kế hoạch thuần kiểm lại dưới khoá hàng);
//   · Enrollment: năm cột giá của ghi danh MỚI (CẢ NĂM NULL → GIÁ GÓI ĐÃ KÝ) và của ghi danh CŨ (giá cũ → CẢ NĂM NULL) — `where` đòi đang đúng snapshot.
//   KHÔNG Order, OrderItem, Receipt, hoá đơn điện tử, hoa hồng, ngân hàng, số tiền/trạng thái/ngày thu của Payment. Bằng chứng KHÔNG đụng nằm TRONG transaction: «ảnh chụp bất biến» chụp TRƯỚC phép ghi đầu tiên và SAU phép ghi
//   cuối; khác nhau một byte ⇒ `throw` ⇒ cả lô lùi.
//
// ── THỨ TỰ (lưới `[CKG-W*]` canh) ───────────────────────────────────────────────────────────────────────────
//   khoá Payment → Enrollment (`FOR UPDATE`, CHỈ các hàng của cặp được chọn) → ĐỌC LẠI + lập lại kế hoạch (dòng ký chứa VÂN TAY dữ liệu) → cổng số duyệt → trả sớm khi không còn gì (KHÔNG cổng, KHÔNG claim) → ảnh chụp «trước» →
//   cổng Wave 1 → claim nonce (phép ghi ĐẦU TIÊN) → chuyển khoản + chuyển giá (lệch ⇒ throw) + audit → đọc lại phải ra «đã xong» và đúng trạng thái đích → ảnh chụp «sau» = «trước» → audit mức lượt.
import type { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { writeAudit } from "@/lib/audit/audit-log";
import { KHOAN_DA_XAC_NHAN } from "@/lib/finance/debt";
import { docQuyenHocDayDu, docQuyenHocTomTat } from "./chuyen-khoan-quyen-hoc";
import { claimPheDuyet, kiemCongGhiTruocGhi, WORKFLOW_WAVE1, type DauVaoCongGhi } from "@/lib/security/cong-ghi-wave1";
import { dungBanGhiLuotWaveC, khoaLuotChayWaveC, quyetDinhGhiWaveC, type LuotChayWaveC } from "./wave-c-chung";
import {
  ENTITY_LUOT_CHUYEN_KHOAN,
  GIA_TRONG,
  HANH_DONG_CHUYEN_GIA,
  HANH_DONG_CHUYEN_KHOAN,
  HANH_DONG_CHUYEN_KHOAN_LUOT,
  LY_DO_CHUYEN_KHOAN,
  TRANG_THAI_GHI_DANH_DONG,
  cungGiaChuyen,
  laGiaTrong,
  lapKeHoachChuyenKhoan,
  truocSauCapChuyen,
  type CapYeuCau,
  type GhiDanhChuyen,
  type KeHoachChuyenKhoan,
  type KhoanChuyen,
  type UngVienChuyen,
} from "./chuyen-khoan-ghi-danh";

export type KhachChuyenKhoan = PrismaClient | Prisma.TransactionClient;

export const ACTOR_CHUYEN_KHOAN = { id: null, name: "Script P7-B khoản thu và giá đi theo ghi danh đang học (chuyen-khoan-ghi-danh)" } as const;

export function quyetDinhGhiChuyenKhoan(i: { soDuyet: number | null; keHoach: KeHoachChuyenKhoan; ghiDuoc: boolean | null }): string | null {
  return quyetDinhGhiWaveC({
    soDuyet: i.soDuyet,
    dung: i.keHoach.dung,
    loiTomTat: i.keHoach.loiLo.map((x) => `${x.cuId}:${x.ma}`),
    soGhi: i.keHoach.ghi.length,
    ghiDuoc: i.ghiDuoc,
    tenBang: "Enrollment",
    donViDem: "CẶP GHI DANH",
  });
}

const gia = (e: { listPrice: number | null; discountType: string | null; discountAmount: number | null; tuition: number | null; finalPrice: number | null }) => ({
  listPrice: e.listPrice, discountType: e.discountType, discountAmount: e.discountAmount, tuition: e.tuition, finalPrice: e.finalPrice,
});
const SEL_ENR = { id: true, studentId: true, courseId: true, centerId: true, status: true, deletedAt: true, transferredToId: true, listPrice: true, discountType: true, discountAmount: true, tuition: true, finalPrice: true } as const;
type EnrRow = { id: string; studentId: string; courseId: string | null; centerId: string | null; status: string; deletedAt: Date | null; transferredToId: string | null; listPrice: number | null; discountType: string | null; discountAmount: number | null; tuition: number | null; finalPrice: number | null };
const toGD = (e: EnrRow): GhiDanhChuyen => ({ id: e.id, studentId: e.studentId, courseId: e.courseId, centerId: e.centerId, status: e.status, deletedAt: e.deletedAt, transferredToId: e.transferredToId, gia: gia(e) });

const thayBigint = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);
const bam = (x: unknown) => createHash("sha256").update(JSON.stringify(x, thayBigint), "utf8").digest("hex");

/**
 * ĐỌC ứng viên: CHỈ các ghi danh cũ nằm trong `cap`. Cố định 14 câu. Mỗi ứng viên mang VÂN TAY (`dauVan`) băm nội dung đầy đủ của: hai ghi danh · mọi khoản thu của hai ghi danh và của các đơn liên quan ·
 * dòng đơn · biên lai · hoa hồng · quyền học — đổi một byte ở bất kỳ đâu trong đó thì dòng ký đổi.
 */
export async function docUngVienChuyen(c: KhachChuyenKhoan, cap: readonly CapYeuCau[]): Promise<UngVienChuyen[]> {
  if (cap.length === 0) return [];
  const cuIds = cap.map((x) => x.cuId);
  const capMoiIds = cap.map((x) => x.moiId);
  const khoan = await c.payment.findMany({
    where: { deletedAt: null, enrollmentId: { in: cuIds } },
    select: { id: true, orderId: true, orderItemId: true, enrollmentId: true, amount: true, paidDate: true, paymentType: true, saleStatus: true, accountantStatus: true, adjustmentOfId: true },
    orderBy: { id: "asc" },
  });
  const donIds = [...new Set(khoan.map((k) => k.orderId))];
  const dongIds = [...new Set(khoan.flatMap((k) => (k.orderItemId ? [k.orderItemId] : [])))];
  const [cuRows, dongDon, dongCuaDon] = await Promise.all([
    c.enrollment.findMany({ where: { id: { in: cuIds } }, select: SEL_ENR }),
    c.orderItem.findMany({ where: { id: { in: dongIds } }, select: { id: true, enrollmentId: true } }),
    c.orderItem.findMany({ where: { orderId: { in: donIds }, type: "COURSE_ENROLLMENT" }, select: { id: true, orderId: true, enrollmentId: true } }),
  ]);
  const dongCuaDonTheo = new Map<string, { id: string; enrollmentId: string | null }[]>();
  for (const d of dongCuaDon) dongCuaDonTheo.set(d.orderId, [...(dongCuaDonTheo.get(d.orderId) ?? []), d]);

  const r1Cua = new Map<string, Set<string>>();
  const khoanTheoCu = new Map<string, KhoanChuyen[]>();
  const donCuaCu = new Map<string, Set<string>>();
  for (const k of khoan) {
    const cu = k.enrollmentId as string;
    const dong = k.orderItemId ? dongDon.find((d) => d.id === k.orderItemId) ?? null : null;
    // R1: dòng đơn của khoản; nếu khoản không gắn dòng thì chỉ nhận khi đơn có ĐÚNG MỘT dòng khoá học.
    const donDong = dongCuaDonTheo.get(k.orderId) ?? [];
    const diem = dong !== null ? dong.enrollmentId : donDong.length === 1 ? donDong[0]!.enrollmentId : null;
    if (diem !== null && diem !== cu) r1Cua.set(cu, (r1Cua.get(cu) ?? new Set()).add(diem));
    donCuaCu.set(cu, (donCuaCu.get(cu) ?? new Set()).add(k.orderId));
    khoanTheoCu.set(cu, [
      ...(khoanTheoCu.get(cu) ?? []),
      {
        id: k.id, orderId: k.orderId, amount: k.amount, paidDate: k.paidDate, paymentType: k.paymentType, saleStatus: k.saleStatus, accountantStatus: k.accountantStatus, adjustmentOfId: k.adjustmentOfId,
        dongDonTroToi: dong === null ? null : dong.enrollmentId, coDongDon: dong !== null,
      },
    ]);
  }
  const moiIds = [...new Set([...cuRows.flatMap((e) => (e.transferredToId ? [e.transferredToId] : [])), ...[...r1Cua.values()].flatMap((s) => [...s]), ...capMoiIds])];
  const tatCa = [...new Set([...cuIds, ...moiIds])];
  const [moiRows, khoanMoiTong, bienLai, hoaHong, hoanTien, baoLuu, ghiDanhDayDu, khoanDayDu, dongDayDu, bienLaiDayDu, hoaHongDayDu, quyenHocDayDu] = await Promise.all([
    c.enrollment.findMany({ where: { id: { in: moiIds } }, select: SEL_ENR }),
    c.payment.groupBy({ by: ["enrollmentId"], where: { deletedAt: null, enrollmentId: { in: moiIds } }, _count: { _all: true }, _sum: { amount: true } }),
    c.receipt.groupBy({ by: ["enrollmentId"], where: { deletedAt: null, enrollmentId: { in: tatCa } }, _count: { _all: true } }),
    c.commissionLine.groupBy({ by: ["enrollmentId"], where: { enrollmentId: { in: tatCa } }, _count: { _all: true } }),
    c.refundRequest.groupBy({ by: ["enrollmentId"], where: { enrollmentId: { in: tatCa } }, _count: { _all: true } }),
    c.studentReserve.groupBy({ by: ["enrollmentId"], where: { enrollmentId: { in: tatCa } }, _count: { _all: true } }),
    // — nguyên liệu VÂN TAY: đọc đầy đủ cột (gồm updatedAt) để mọi thay đổi đều lộ —
    c.enrollment.findMany({ where: { id: { in: tatCa } }, orderBy: { id: "asc" } }),
    c.payment.findMany({ where: { OR: [{ enrollmentId: { in: tatCa } }, { orderId: { in: donIds } }] }, orderBy: { id: "asc" } }),
    c.orderItem.findMany({ where: { orderId: { in: donIds } }, orderBy: { id: "asc" } }),
    c.receipt.findMany({ where: { OR: [{ enrollmentId: { in: tatCa } }, { payment: { orderId: { in: donIds } } }] }, orderBy: { id: "asc" } }),
    c.commissionLine.findMany({ where: { enrollmentId: { in: tatCa } }, orderBy: { id: "asc" } }),
    docQuyenHocDayDu(c, tatCa),
  ]);
  const dem = (rows: { enrollmentId: string | null; _count: { _all: number } }[], id: string) => rows.find((r) => r.enrollmentId === id)?._count._all ?? 0;
  const co = (id: string) => ({ bienLai: dem(bienLai, id), hoaHong: dem(hoaHong, id), hoanTien: dem(hoanTien, id), baoLuu: dem(baoLuu, id) });
  const demMoi = (id: string) => khoanMoiTong.find((r) => r.enrollmentId === id)?._count._all ?? 0;
  const tongMoi = (id: string) => khoanMoiTong.find((r) => r.enrollmentId === id)?._sum.amount ?? 0;
  const yTheoCu = new Map(cap.map((y) => [y.cuId, y]));

  return cuRows
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((e): UngVienChuyen => {
      const r1 = [...(r1Cua.get(e.id) ?? [])];
      const dich = new Set<string>([...r1, ...(e.transferredToId ? [e.transferredToId] : [])]);
      const moiId = dich.size === 1 ? [...dich][0]! : null;
      const moi = moiId === null ? null : moiRows.find((m) => m.id === moiId) ?? null;
      const y = yTheoCu.get(e.id)!;
      const khoanCu = khoanTheoCu.get(e.id) ?? [];
      // Vân tay của CẶP (cả ghi danh mới được YÊU CẦU, kể cả khi bằng chứng chưa chỉ tới nó).
      const cuaCap = new Set<string>([e.id, y.moiId, ...(moiId === null ? [] : [moiId])]);
      const donCap = donCuaCu.get(e.id) ?? new Set<string>();
      const dauVan = bam({
        v: 2,
        ghiDanh: ghiDanhDayDu.filter((x) => cuaCap.has(x.id)),
        khoan: khoanDayDu.filter((x) => (x.enrollmentId !== null && cuaCap.has(x.enrollmentId)) || donCap.has(x.orderId)),
        dong: dongDayDu.filter((x) => donCap.has(x.orderId)),
        bienLai: bienLaiDayDu.filter((x) => (x.enrollmentId !== null && cuaCap.has(x.enrollmentId)) || khoanCu.some((k) => k.id === x.paymentId)),
        hoaHong: hoaHongDayDu.filter((x) => x.enrollmentId !== null && cuaCap.has(x.enrollmentId)),
        quyenHoc: { coBang: quyenHocDayDu.coBang, hang: quyenHocDayDu.hang.filter((x) => x.enrollmentId !== null && cuaCap.has(x.enrollmentId)) },
      });
      const moiDayDu = moi === null ? null : toGD(moi);
      // ĐÃ XONG = chính trạng thái đích của yêu cầu này, đọc từ ghi danh mới ĐƯỢC YÊU CẦU (sau khi khoản đã dời thì ghi danh cũ không còn dây R1 nào để chỉ tới nó):
      // ghi danh mới đúng giá gói đã ký + giữ đúng Σ tiền; ghi danh cũ không giá, không khoản sống.
      const moiYeuCau = moiRows.find((m) => m.id === y.moiId) ?? null;
      const daXong =
        moiYeuCau !== null &&
        cungGiaChuyen(gia(moiYeuCau), y.giaMoi) &&
        laGiaTrong(toGD(e).gia) &&
        khoanCu.length === 0 &&
        demMoi(moiYeuCau.id) > 0 &&
        tongMoi(moiYeuCau.id) === y.giaMoi.finalPrice;
      return {
        cu: toGD(e),
        r1,
        r2: e.transferredToId,
        moi: moiDayDu,
        khoanCu,
        khoanMoi: moi === null ? 0 : demMoi(moi.id),
        moiCo: moi === null ? { bienLai: 0, hoaHong: 0, hoanTien: 0, baoLuu: 0 } : co(moi.id),
        cuCo: co(e.id),
        dauVan,
        daXong,
      };
    });
}

export async function docKeHoachChuyenKhoan(c: KhachChuyenKhoan, cap: readonly CapYeuCau[]): Promise<KeHoachChuyenKhoan> {
  return lapKeHoachChuyenKhoan(await docUngVienChuyen(c, cap), cap);
}

const boKhoa = <T extends Record<string, unknown>>(o: T, ...khoa: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !khoa.includes(k)));
export const COT_GIA_CHUYEN = ["listPrice", "discountType", "discountAmount", "tuition", "finalPrice", "updatedAt"] as const;

/** Phần của kế hoạch mà ảnh chụp cần: cặp + khoản. (Hoàn tác dùng chung hàm này với dòng dựng từ nhật ký lượt chạy.) */
export type PhamViAnhChup = { ghi: readonly { cuId: string; moiId: string; khoanIds: readonly string[] }[] };

/**
 * ẢNH CHỤP BẤT BIẾN của đúng phạm vi kế hoạch: Order + dòng đơn (MỌI cột) · MỌI Payment của các đơn (cả đã xoá; TRỪ `enrollmentId` + `updatedAt` của đúng các khoản được chuyển) · phân bổ + giao dịch ngân hàng · Receipt ·
 * hoá đơn điện tử · hoa hồng (NỘI DUNG dòng) · yêu cầu hoàn · bảo lưu · Enrollment của cả hai phía (MỌI cột TRỪ năm cột giá + `updatedAt`). Tập đơn / khoản / ghi danh lấy từ KẾ HOẠCH nên không đổi giữa «trước» và «sau».
 */
export async function anhChupBatBienChuyenKhoan(c: KhachChuyenKhoan, kh: PhamViAnhChup): Promise<string> {
  const khoanIds = new Set(kh.ghi.flatMap((g) => g.khoanIds));
  const enrIds = [...new Set(kh.ghi.flatMap((g) => [g.cuId, g.moiId]))];
  const donTho = await c.payment.findMany({ where: { id: { in: [...khoanIds] } }, select: { orderId: true } });
  const orderIds = [...new Set(donTho.map((p) => p.orderId))];
  const [orders, paymentsTho, ghiDanhTho, phanBo, nganHang, hoaDonKhoan, bienLai, hhLine, hhTrx, hoan, baoLuu, thuc] = await Promise.all([
    c.order.findMany({ where: { id: { in: orderIds } }, orderBy: { id: "asc" }, include: { items: { orderBy: { id: "asc" } } } }),
    c.payment.findMany({ where: { orderId: { in: orderIds } }, orderBy: { id: "asc" } }),
    c.enrollment.findMany({ where: { id: { in: enrIds } }, orderBy: { id: "asc" } }),
    c.$queryRaw<unknown[]>`
      SELECT pa.* FROM "PaymentAllocation" pa
      WHERE pa."paymentRequestId" IN (SELECT id FROM "PaymentRequest" WHERE "orderId" = ANY(${orderIds}::text[]))
         OR pa."bankTransactionId" IN (SELECT pa2."bankTransactionId" FROM "PaymentAllocation" pa2 JOIN "PaymentRequest" pr2 ON pr2.id = pa2."paymentRequestId" WHERE pr2."orderId" = ANY(${orderIds}::text[]))
      ORDER BY pa.id`,
    c.$queryRaw<unknown[]>`
      SELECT bt.* FROM "BankTransaction" bt
      WHERE bt.id IN (SELECT pa."bankTransactionId" FROM "PaymentAllocation" pa JOIN "PaymentRequest" pr ON pr.id = pa."paymentRequestId" WHERE pr."orderId" = ANY(${orderIds}::text[]))
      ORDER BY bt.id`,
    c.$queryRaw<unknown[]>`
      SELECT hk.*, hd."trangThai"::text AS "hd_trangThai", hd."tongTien" AS "hd_tongTien", hd."soHoaDon" AS "hd_soHoaDon", hd."updatedAt" AS "hd_updatedAt"
      FROM "HoaDonKhoan" hk JOIN "HoaDonDienTu" hd ON hd.id = hk."hoaDonId"
      WHERE hk."paymentId" IN (SELECT id FROM "Payment" WHERE "orderId" = ANY(${orderIds}::text[])) ORDER BY hk."hoaDonId", hk."paymentId"`,
    c.receipt.findMany({ where: { OR: [{ paymentId: { in: [...khoanIds] } }, { enrollmentId: { in: enrIds } }] }, orderBy: { id: "asc" } }),
    c.commissionLine.findMany({ where: { enrollmentId: { in: enrIds } }, orderBy: { id: "asc" } }),
    c.commissionTransaction.findMany({ where: { orderId: { in: orderIds } }, orderBy: { id: "asc" } }),
    c.refundRequest.findMany({ where: { enrollmentId: { in: enrIds } }, orderBy: { id: "asc" } }),
    c.studentReserve.findMany({ where: { enrollmentId: { in: enrIds } }, orderBy: { id: "asc" } }),
    docQuyenHocDayDu(c, enrIds),
  ]);
  const payments = paymentsTho.map((p) => (khoanIds.has(p.id) ? boKhoa(p, "enrollmentId", "updatedAt") : p));
  const ghiDanh = ghiDanhTho.map((e) => boKhoa(e, ...COT_GIA_CHUYEN));
  return bam({ orders, payments, ghiDanh, phanBo, nganHang, hoaDonKhoan, bienLai, hhLine, hhTrx, hoan, baoLuu, thuc });
}

/**
 * BÁO CÁO TRƯỚC/SAU từng cặp (chỉ đọc; không tên/SĐT/email): giá · đã thu · nợ của hai ghi danh trước và sau lệnh; tổng tiền trước = sau; và những thứ lệnh KHÔNG đổi nhưng người duyệt phải thấy —
 * số biên lai · hoá đơn đã gắn khoản · dòng hoa hồng · quyền học (số buổi mua/đã dùng) · điểm danh của học viên (đếm theo trạng thái).
 */
export type BaoCaoCap = {
  cuId: string;
  moiId: string;
  code: string;
  truocSau: ReturnType<typeof truocSauCapChuyen>;
  bienLai: { cu: string[]; moi: string[] };
  hoaDon: { soKhoanCoHoaDon: number; soHoaDon: string[] };
  hoaHong: { cu: number; moi: number; tongCu: number };
  quyenHoc: { coBang: boolean; cu: { mua: number; daDung: number }[]; moi: { mua: number; daDung: number }[] };
  diemDanh: Record<string, number>;
};

export async function baoCaoTruocSauChuyenKhoan(c: KhachChuyenKhoan, kh: KeHoachChuyenKhoan): Promise<BaoCaoCap[]> {
  if (kh.ghi.length === 0) return [];
  const cuIds = kh.ghi.map((g) => g.cuId);
  const moiIds = kh.ghi.map((g) => g.moiId);
  const tat = [...cuIds, ...moiIds];
  const khoanIds = kh.ghi.flatMap((g) => [...g.khoanIds]);
  const [enrs, moiTong, bl, hdk, hh, qh] = await Promise.all([
    c.enrollment.findMany({ where: { id: { in: tat } }, select: { id: true, studentId: true } }),
    c.payment.groupBy({ by: ["enrollmentId"], where: { deletedAt: null, enrollmentId: { in: moiIds } }, _sum: { amount: true } }),
    c.receipt.findMany({ where: { deletedAt: null, enrollmentId: { in: tat } }, select: { code: true, enrollmentId: true } }),
    c.$queryRaw<{ paymentId: string; soHoaDon: string | null }[]>`
      SELECT hk."paymentId", hd."soHoaDon" FROM "HoaDonKhoan" hk JOIN "HoaDonDienTu" hd ON hd.id = hk."hoaDonId" WHERE hk."paymentId" = ANY(${khoanIds}::text[])`,
    c.commissionLine.findMany({ where: { enrollmentId: { in: tat } }, select: { enrollmentId: true, amount: true } }),
    docQuyenHocTomTat(c, tat),
  ]);
  const hsId = [...new Set(enrs.map((e) => e.studentId))];
  const dd = await c.attendance.groupBy({ by: ["studentId", "status"], where: { studentId: { in: hsId } }, _count: { _all: true } });
  return kh.ghi.map((g) => {
    const sid = enrs.find((e) => e.id === g.cuId)?.studentId ?? "";
    const tongMoiTruoc = moiTong.find((r) => r.enrollmentId === g.moiId)?._sum.amount ?? 0;
    const diemDanh: Record<string, number> = {};
    for (const r of dd.filter((x) => x.studentId === sid)) diemDanh[r.status] = r._count._all;
    const hoaDonCuaCap = hdk.filter((x) => g.khoanIds.includes(x.paymentId));
    return {
      cuId: g.cuId,
      moiId: g.moiId,
      code: g.code,
      truocSau: truocSauCapChuyen(g, tongMoiTruoc),
      bienLai: { cu: bl.filter((x) => x.enrollmentId === g.cuId).map((x) => x.code), moi: bl.filter((x) => x.enrollmentId === g.moiId).map((x) => x.code) },
      hoaDon: { soKhoanCoHoaDon: new Set(hoaDonCuaCap.map((x) => x.paymentId)).size, soHoaDon: [...new Set(hoaDonCuaCap.map((x) => x.soHoaDon ?? "(chưa số)"))] },
      hoaHong: { cu: hh.filter((x) => x.enrollmentId === g.cuId).length, moi: hh.filter((x) => x.enrollmentId === g.moiId).length, tongCu: hh.filter((x) => x.enrollmentId === g.cuId).reduce((s, x) => s + x.amount, 0) },
      quyenHoc: {
        coBang: qh.coBang,
        cu: qh.hang.filter((x) => x.enrollmentId === g.cuId).map((x) => ({ mua: x.purchaseSessions, daDung: x.consumedSessions })),
        moi: qh.hang.filter((x) => x.enrollmentId === g.moiId).map((x) => ({ mua: x.purchaseSessions, daDung: x.consumedSessions })),
      },
      diemDanh,
    };
  });
}

export type DauVaoGhiChuyenKhoan = {
  /** Cặp do người ký chọn. Rỗng ⇒ không có gì để ghi (cổng số duyệt sẽ dừng). */
  cap: readonly CapYeuCau[];
  soDuyet: number | null;
  ghiDuoc: boolean | null;
  actor: { id: null; name: string };
  luotChay: LuotChayWaveC;
  congGhi: DauVaoCongGhi;
};

export type KetQuaGhiChuyenKhoan = { soCap: number; soKhoan: number; keHoachSha: string };

export async function ghiChuyenKhoan(c: PrismaClient, input: DauVaoGhiChuyenKhoan): Promise<KetQuaGhiChuyenKhoan> {
  const truoc = quyetDinhGhiChuyenKhoan({ soDuyet: input.soDuyet, keHoach: await docKeHoachChuyenKhoan(c, input.cap), ghiDuoc: input.ghiDuoc });
  if (truoc !== null) throw new Error(truoc);
  return c.$transaction((tx) => ghiChuyenKhoanTrongTx(tx, input), { timeout: 120_000, maxWait: 15_000 });
}

export async function ghiChuyenKhoanTrongTx(tx: Prisma.TransactionClient, input: DauVaoGhiChuyenKhoan): Promise<KetQuaGhiChuyenKhoan> {
  const cuIds = input.cap.map((x) => x.cuId);
  const capMoiIds = input.cap.map((x) => x.moiId);
  // 1) KHOÁ hàng sẽ đọc/ghi, theo thứ tự cố định: khoản thu sống gắn ghi danh CŨ của cặp → ghi danh (cũ, mới của cặp, đích theo `transferredToId`, đích theo dòng đơn). CHỈ hàng của cặp được chọn.
  await tx.$queryRaw`
    SELECT p.id FROM "Payment" p WHERE p."deletedAt" IS NULL AND p."enrollmentId" = ANY(${cuIds}::text[]) ORDER BY p.id FOR UPDATE OF p`;
  await tx.$queryRaw`
    SELECT e.id FROM "Enrollment" e
    WHERE e.id = ANY(${cuIds}::text[]) OR e.id = ANY(${capMoiIds}::text[])
       OR e.id IN (SELECT e3."transferredToId" FROM "Enrollment" e3 WHERE e3.id = ANY(${cuIds}::text[]) AND e3."transferredToId" IS NOT NULL)
       OR e.id IN (SELECT oi."enrollmentId" FROM "OrderItem" oi WHERE oi."enrollmentId" IS NOT NULL AND oi."orderId" IN (SELECT p2."orderId" FROM "Payment" p2 WHERE p2."deletedAt" IS NULL AND p2."enrollmentId" = ANY(${cuIds}::text[])))
    ORDER BY e.id FOR UPDATE`;

  // 2) ĐỌC LẠI sau khi khoá + lập lại kế hoạch bằng CHÍNH hàm thuần (dòng ký chứa vân tay dữ liệu); cổng số duyệt/lệch.
  const kh = await docKeHoachChuyenKhoan(tx, input.cap);
  const loi = quyetDinhGhiChuyenKhoan({ soDuyet: input.soDuyet, keHoach: kh, ghiDuoc: input.ghiDuoc });
  if (loi !== null) throw new Error(loi);

  // Không còn gì để chuyển (chạy lại: mọi cặp đã ở trạng thái đích) ⇒ 0 dòng ghi, KHÔNG cổng, KHÔNG claim.
  if (kh.ghi.length === 0) return { soCap: 0, soKhoan: 0, keHoachSha: kh.sha };

  // 3) Ảnh chụp bất biến «trước».
  const truoc = await anhChupBatBienChuyenKhoan(tx, kh);

  // 4) CỔNG WAVE 1 — TRƯỚC phép ghi đầu tiên; dòng do CHÍNH lõi dựng. Claim `wg:<nonce>` là PHÉP GHI ĐẦU TIÊN.
  const duoc = await kiemCongGhiTruocGhi(tx, input.congGhi, WORKFLOW_WAVE1.chuyenKhoanGhiDanh, kh.dongDauRa);
  await claimPheDuyet(tx, duoc, { appliedAt: input.congGhi.now, rowCount: kh.ghi.length, runRef: input.congGhi.runRef });

  // 5) GHI. Mọi điều kiện «đang đúng trạng thái đã lập kế hoạch» nằm trong `where`: lệch ⇒ THROW cả lô — không `continue`.
  let soKhoan = 0;
  for (const g of kh.ghi) {
    const r = await tx.payment.updateMany({
      where: { id: { in: [...g.khoanIds] }, enrollmentId: g.cuId, ...KHOAN_DA_XAC_NHAN, paymentType: "PAYMENT", adjustmentOfId: null },
      data: { enrollmentId: g.moiId },
    });
    if (r.count !== g.khoanIds.length) throw new Error(`Chuyển khoản ${g.cuId}→${g.moiId}: đổi ${r.count}/${g.khoanIds.length} khoản — trạng thái không còn như lúc lập kế hoạch — lùi cả lô.`);
    soKhoan += r.count;
    for (const id of g.khoanIds) {
      await writeAudit({
        actor: input.actor, module: "finance", entityType: "Payment", entityId: id, action: HANH_DONG_CHUYEN_KHOAN,
        oldValues: { enrollmentId: g.cuId }, newValues: { enrollmentId: g.moiId, orderCode: g.code }, changedFields: ["enrollmentId"], reason: LY_DO_CHUYEN_KHOAN, orgUnitId: null, tx,
      });
    }

    const moi = await tx.enrollment.updateMany({
      where: { id: g.moiId, deletedAt: null, listPrice: null, discountType: null, discountAmount: null, tuition: null, finalPrice: null },
      data: { listPrice: g.giaMoi.listPrice, discountType: g.giaMoi.discountType, discountAmount: g.giaMoi.discountAmount, tuition: g.giaMoi.tuition, finalPrice: g.giaMoi.finalPrice },
    });
    if (moi.count !== 1) throw new Error(`Chuyển giá ${g.cuId}→${g.moiId}: ghi danh mới không còn trống giá lúc lập kế hoạch — lùi cả lô.`);
    const cu = await tx.enrollment.updateMany({
      where: { id: g.cuId, deletedAt: null, listPrice: g.giaCu.listPrice, discountType: g.giaCu.discountType, discountAmount: g.giaCu.discountAmount, tuition: g.giaCu.tuition, finalPrice: g.giaCu.finalPrice },
      data: { listPrice: null, discountType: null, discountAmount: null, tuition: null, finalPrice: null },
    });
    if (cu.count !== 1) throw new Error(`Chuyển giá ${g.cuId}→${g.moiId}: giá ghi danh cũ không còn đúng snapshot lúc lập kế hoạch — lùi cả lô.`);
    for (const [id, cu0, moi0] of [[g.cuId, g.giaCu, GIA_TRONG], [g.moiId, GIA_TRONG, g.giaMoi]] as const) {
      await writeAudit({
        actor: input.actor, module: "finance", entityType: "Enrollment", entityId: id, action: HANH_DONG_CHUYEN_GIA,
        oldValues: cu0, newValues: moi0, changedFields: ["listPrice", "discountType", "discountAmount", "tuition", "finalPrice"], reason: LY_DO_CHUYEN_KHOAN, orgUnitId: null, tx,
      });
    }
  }

  // 6) ĐỌC LẠI: mọi cặp ở trạng thái đích («đã xong»), và từng cặp đúng giá gói + Σ tiền.
  const sau = await docKeHoachChuyenKhoan(tx, input.cap);
  if (sau.dung || sau.ghi.length !== 0 || sau.daXong.length !== kh.ghi.length) throw new Error(`Sau khi ghi, kế hoạch không ra «đã xong» (${sau.loiLo.map((x) => `${x.cuId}:${x.ma}`).join(" · ") || `còn ${sau.ghi.length} cặp, xong ${sau.daXong.length}/${kh.ghi.length}`}) — lùi cả lô.`);
  for (const g of kh.ghi) {
    const [moi, cu, n] = await Promise.all([
      tx.enrollment.findUniqueOrThrow({ where: { id: g.moiId }, select: SEL_ENR }),
      tx.enrollment.findUniqueOrThrow({ where: { id: g.cuId }, select: SEL_ENR }),
      tx.payment.count({ where: { id: { in: [...g.khoanIds] }, enrollmentId: g.moiId, deletedAt: null } }),
    ]);
    if (!cungGiaChuyen(gia(moi), g.giaMoi) || !cungGiaChuyen(gia(cu), GIA_TRONG) || n !== g.khoanIds.length) throw new Error(`Sau khi ghi, cặp ${g.cuId}→${g.moiId} chưa đúng trạng thái đích — lùi cả lô.`);
  }
  const anhSau = await anhChupBatBienChuyenKhoan(tx, kh);
  if (anhSau !== truoc) throw new Error("Ảnh chụp bất biến (Order · dòng đơn · Payment trừ enrollmentId · ngân hàng · Receipt · hoá đơn · hoa hồng · hoàn tiền · bảo lưu · quyền học · Enrollment trừ cột giá) ĐỔI sau phép ghi — lùi cả lô.");

  // 7) Bản ghi MỨC LƯỢT CHẠY — cùng transaction. `cap` lưu ĐỦ để hoàn tác kiểm lại được (giá cũ · giá mới · khoản · tổng · vân tay lúc ghi).
  if (input.soDuyet === null) throw new Error("ghiChuyenKhoanTrongTx: thiếu soDuyet sau khi cổng đã qua.");
  await writeAudit({
    actor: input.actor, module: "finance", entityType: ENTITY_LUOT_CHUYEN_KHOAN, entityId: khoaLuotChayWaveC(input.luotChay.nguonChay), action: HANH_DONG_CHUYEN_KHOAN_LUOT, oldValues: null,
    newValues: dungBanGhiLuotWaveC({
      luot: input.luotChay, soDuyet: input.soDuyet, soKeHoach: kh.ghi.length, daGhi: kh.ghi.length, keHoachSha: kh.sha,
      chiTiet: { cap: kh.ghi.map((g) => ({ cu: g.cuId, moi: g.moiId, khoan: g.khoanIds, tongTien: g.tongTien, giaCu: g.giaCu, giaMoi: g.giaMoi, dauVanTruoc: g.dauVan })), soKhoan },
    }),
    changedFields: ["expectedCount", "actualCount"], reason: "Lượt chạy P7-B v2 chuyển khoản thu và giá gói sang ghi danh đang học: người bấm · số đã duyệt · số thực ghi", tx,
  });
  return { soCap: kh.ghi.length, soKhoan, keHoachSha: kh.sha };
}

/**
 * KIỂM SAU GHI (chỉ đọc), CHỈ cho các cặp trong `cap`: mỗi cặp phải ở trạng thái đích (khoản ở ghi danh mới, giá gói ở ghi danh mới, ghi danh cũ không giá, Σ tiền = giá gói ⇒ nợ 0)
 * VÀ có trong nhật ký của một lượt ghi (truy được vì sao nó ở đó).
 */
export async function kiemSauGhiChuyenKhoan(
  c: KhachChuyenKhoan,
  cap: readonly CapYeuCau[],
): Promise<{ keHoach: KeHoachChuyenKhoan; capSai: string[]; capKhongCoNhatKy: string[]; conSeChuyen: number }> {
  const keHoach = await docKeHoachChuyenKhoan(c, cap);
  const luot = await c.auditLog.findMany({ where: { entityType: ENTITY_LUOT_CHUYEN_KHOAN, action: HANH_DONG_CHUYEN_KHOAN_LUOT }, orderBy: { createdAt: "desc" }, select: { newValues: true } });
  const trongNhatKy = new Set<string>();
  for (const l of luot) {
    const nv = (l.newValues ?? null) as { chiTiet?: { cap?: { cu: string; moi: string }[] }; cap?: { cu: string; moi: string }[] } | null;
    for (const p of nv?.chiTiet?.cap ?? nv?.cap ?? []) trongNhatKy.add(`${p.cu}>${p.moi}`);
  }
  const capSai: string[] = [];
  const capKhongCoNhatKy: string[] = [];
  const xong = new Set(keHoach.daXong);
  for (const y of cap) {
    if (!xong.has(y.cuId)) capSai.push(`${y.cuId}→${y.moiId}`);
    if (!trongNhatKy.has(`${y.cuId}>${y.moiId}`)) capKhongCoNhatKy.push(`${y.cuId}→${y.moiId}`);
  }
  return { keHoach, capSai, capKhongCoNhatKy, conSeChuyen: keHoach.ghi.length };
}

export { TRANG_THAI_GHI_DANH_DONG };
