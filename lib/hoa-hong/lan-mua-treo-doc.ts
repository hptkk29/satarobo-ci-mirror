// lib/hoa-hong/lan-mua-treo-doc.ts — ĐO số hold do LỊCH SỬ MUA CHƯA CHỐT (CHỈ ĐỌC): `PREVIOUS_PURCHASE_UNRESOLVED` và `BACKFILL_ORDER_TIME_UNVERIFIED`.
//
// Nguồn yêu cầu: chủ dự án 2026-10-17 (§5) — «189 dòng đơn dev chưa có thanh toán dương và chưa huỷ ⇒ giữ HOLD an toàn, KHÔNG đoán, KHÔNG tự loại đơn khỏi lịch sử trong code; người vận hành
// phải NHÌN ĐƯỢC số này». Tài liệu: docs/source-commission/08 §17.v4, 04 §5.2 «Luật v3».
//
// ── Ba tầng số, từ rộng đến hẹp — đừng gộp ───────────────────────────────────────────────────────────────────────────────────
//   1. `dongChuaThuChuaHuy`   — dòng học phí của đơn CÒN SỐNG mà đơn chưa có khoản thực thu dương nào, theo trạng thái đơn. Đây là thứ «189 dòng» đo. Mỗi dòng như vậy làm một lần mua
//                               SAU của học viên bị giữ cho tới khi nó được thu / huỷ. ĐỊNH NGHĨA Ở MỨC ĐƠN (đơn nhiều dòng học phí: mọi dòng cùng tính) — khác bộ phân loại ở chỗ bộ phân loại quy
//                               khoản về từng dòng (`quyKhoanTheoDong`); với đơn một dòng (hầu hết) hai cách ra y hệt.
//   2. `ungVien`              — CẬN TRÊN của số dòng/ học viên có thể bị giữ, tính bằng SQL thuần (câu in ra ở script để chạy trên bản sao chỉ-đọc của prod TRƯỚC cutover). Là cận trên vì SQL không
//                               tái hiện các nhánh ưu tiên của bộ phân loại (đã có tiền lệ chắc ⇒ RENEWAL thắng; dính đổi khoá / chuyển cơ sở / bảo lưu ⇒ hold loại khác trước).
//   3. `chinhXac`             — CHẠY CHÍNH BỘ PHÂN LOẠI (`phanLoaiDongDon`) trên các dòng ứng viên và đếm theo `maLuat`. Đây là số khoản THỰC SỰ sẽ bị giữ. Luôn ⊆ tầng 2 (test `[LMT-DB-*]` ghim).
//
// ⚠️ CHỈ ĐỌC: không `create/update/delete/upsert`, không `$executeRaw` (lưới `[LMT-W1]`). `client` là tham số BẮT BUỘC (luật 7).
// ⚠️ SQL ở đây phải khớp luật ở MỘT chỗ: danh sách trạng thái thực thu lấy từ `TRANG_THAI_THUC_THU`, nhãn nguồn audit lấy từ hai hằng của `phan-loai-giao-dich-db.ts` — lưới `[LMT-W2]` canh.
import { Prisma, type PrismaClient } from "@prisma/client";

import { TRANG_THAI_THUC_THU, WHERE_THUC_THU } from "@/lib/finance/thuc-thu";

import { AUDIT_NGUON_DON_GHI_BU, AUDIT_NGUON_DON_NHAP_CU, phanLoaiDongDon } from "./phan-loai-giao-dich-db";

export type KhachDocLanMua = PrismaClient | Prisma.TransactionClient;

/** Cùng tập loại dòng với `docLanMuaTheoHocVien` (`COURSE_ENROLLMENT` / `COURSE_PACKAGE`). */
const LOAI_DONG_HOC_PHI = ["COURSE_ENROLLMENT", "COURSE_PACKAGE"] as const;

// ── SQL ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const sqlDanhSach = (xs: readonly string[]): Prisma.Sql => Prisma.join(xs.map((x) => Prisma.sql`${x}`));
const locCoSo = (centerId: string | undefined): Prisma.Sql => (centerId ? Prisma.sql`AND o."centerId" = ${centerId}` : Prisma.empty);

/**
 * Câu 1 — dòng học phí chưa thu dương, đơn chưa huỷ, theo trạng thái đơn. `centerId` chỉ để test khoanh vùng; bản in cho người vận hành không có tham số.
 */
export function sqlDongChuaThuChuaHuy(centerId?: string): Prisma.Sql {
  return Prisma.sql`SELECT o."status"::text AS trang_thai, count(*)::int AS so_dong
FROM "OrderItem" oi
JOIN "Order" o ON o.id = oi."orderId"
WHERE oi."type"::text IN (${sqlDanhSach(LOAI_DONG_HOC_PHI)})
  AND o."status" <> 'CANCELLED'
  ${locCoSo(centerId)}
  AND NOT EXISTS (
    SELECT 1 FROM "Payment" p
    WHERE p."orderId" = o.id AND p."deletedAt" IS NULL
      AND p."accountantStatus"::text IN (${sqlDanhSach(TRANG_THAI_THUC_THU)}) AND p.amount > 0)
GROUP BY o."status"
ORDER BY 2 DESC, 1`;
}

/**
 * Bảng `dong`: mỗi dòng học phí kèm học viên, khoá thứ tự mua (giờ máy chủ), cờ «giờ tạo chưa kiểm chứng», đã huỷ / đã thu. KHÔNG đọc `Payment.paidDate` hay `newValues.paidDate` ở đâu cả (luật v3).
 * `chua_kiem` + giờ máy chủ = đúng nhận diện của `docDonGioTaoChuaKiem` (AuditLog `finance/Payment/CREATE source=bulk-convert-backfill` và `finance/Order/CREATE source=nhap-giao-dich-cu`).
 */
function cteDong(centerId?: string): Prisma.Sql {
  return Prisma.sql`WITH gio AS (
  SELECT p."orderId" AS order_id, a."createdAt" AS gio
  FROM "AuditLog" a JOIN "Payment" p ON p.id = a."entityId"
  WHERE a."module" = 'finance' AND a."action" = 'CREATE' AND a."entityType" = 'Payment' AND a."newValues"->>'source' = ${AUDIT_NGUON_DON_GHI_BU}
  UNION ALL
  SELECT a."entityId", a."createdAt"
  FROM "AuditLog" a
  WHERE a."module" = 'finance' AND a."action" = 'CREATE' AND a."entityType" = 'Order' AND a."newValues"->>'source' = ${AUDIT_NGUON_DON_NHAP_CU}
), flag AS (
  SELECT order_id, min(gio) AS gio FROM gio GROUP BY order_id
), dong AS (
  SELECT oi.id AS oi_id, o.id AS order_id, o.code, o."status"::text AS trang_thai,
         COALESCE(f.gio, o."createdAt") AS tao, (f.order_id IS NOT NULL) AS chua_kiem,
         COALESCE(oi."studentId", e."studentId") AS hoc_vien, (o."status" = 'CANCELLED') AS da_huy,
         EXISTS (
           SELECT 1 FROM "Payment" p
           WHERE p."orderId" = o.id AND p."deletedAt" IS NULL
             AND p."accountantStatus"::text IN (${sqlDanhSach(TRANG_THAI_THUC_THU)}) AND p.amount > 0) AS da_thu
  FROM "OrderItem" oi
  JOIN "Order" o ON o.id = oi."orderId"
  LEFT JOIN "Enrollment" e ON e.id = oi."enrollmentId"
  LEFT JOIN flag f ON f.order_id = o.id
  WHERE oi."type"::text IN (${sqlDanhSach(LOAI_DONG_HOC_PHI)}) ${locCoSo(centerId)}
)`;
}

/** `y` đứng trước `x` theo khoá K = (giờ máy chủ, id đơn) — so id theo COLLATE "C" cho khớp phép so chuỗi của JS. */
const SQL_Y_TRUOC_X = Prisma.raw(`(y.tao < x.tao OR (y.tao = x.tao AND y.order_id COLLATE "C" < x.order_id COLLATE "C"))`);

export type LoaiUngVien = "PREVIOUS_PURCHASE_UNRESOLVED" | "BACKFILL_ORDER_TIME_UNVERIFIED";

/**
 * Dòng ứng viên bị giữ (khoản thu đã có) — CẬN TRÊN, xem đầu tệp.
 *   · PREVIOUS_PURCHASE_UNRESOLVED: học viên có đơn y CÒN SỐNG, chưa thu đồng nào, đứng TRƯỚC x CHẮC CHẮN (x không phải đơn chưa kiểm chứng).
 *   · BACKFILL_ORDER_TIME_UNVERIFIED:    học viên có đơn y khác (chưa bị loại hẳn) mà đơn đứng SAU của cặp (x, y) là đơn chưa kiểm chứng ⇒ không biết thứ tự.
 */
export function sqlDongUngVien(loai: LoaiUngVien, centerId?: string): Prisma.Sql {
  const dieuKien =
    loai === "PREVIOUS_PURCHASE_UNRESOLVED"
      ? Prisma.sql`NOT y.da_huy AND NOT y.da_thu AND ${SQL_Y_TRUOC_X} AND NOT x.chua_kiem`
      : Prisma.sql`NOT (y.da_huy AND NOT y.da_thu) AND CASE WHEN ${SQL_Y_TRUOC_X} THEN x.chua_kiem ELSE y.chua_kiem END`;
  return Prisma.sql`${cteDong(centerId)}
SELECT DISTINCT x.oi_id, x.order_id, x.code, x.trang_thai, x.hoc_vien
FROM dong x
JOIN dong y ON y.hoc_vien = x.hoc_vien AND y.order_id <> x.order_id
WHERE x.hoc_vien IS NOT NULL AND x.da_thu AND ${dieuKien}`;
}

/** Bản ĐẾM của câu trên — thứ in cho người vận hành chạy trên bản sao chỉ-đọc của prod. */
export function sqlDemUngVien(loai: LoaiUngVien, centerId?: string): Prisma.Sql {
  return Prisma.sql`SELECT count(DISTINCT t.hoc_vien)::int AS so_hoc_vien, count(DISTINCT t.oi_id)::int AS so_dong
FROM (${sqlDongUngVien(loai, centerId)}) t`;
}

/** Số đơn mang dấu «giờ tạo chưa kiểm chứng», theo nguồn — để người vận hành biết coverage của audit trên dữ liệu thật. */
export function sqlDemDonChuaKiem(): Prisma.Sql {
  return Prisma.sql`SELECT
  (SELECT count(DISTINCT p."orderId")::int FROM "AuditLog" a JOIN "Payment" p ON p.id = a."entityId"
    WHERE a."module" = 'finance' AND a."action" = 'CREATE' AND a."entityType" = 'Payment' AND a."newValues"->>'source' = ${AUDIT_NGUON_DON_GHI_BU}) AS ghi_bu,
  (SELECT count(DISTINCT a."entityId")::int FROM "AuditLog" a
    WHERE a."module" = 'finance' AND a."action" = 'CREATE' AND a."entityType" = 'Order' AND a."newValues"->>'source' = ${AUDIT_NGUON_DON_NHAP_CU}) AS nhap_cu`;
}

/**
 * Văn bản SQL của một `Prisma.Sql` để IN cho người vận hành dán chạy: mọi `$n` được thay bằng literal đã escape. Chỉ nhúng được giá trị CHUỖI hằng của tệp này (nhãn nguồn audit, loại dòng,
 * trạng thái thực thu) — gặp kiểu khác thì ném, để không ai vô tình in một giá trị động (mã cơ sở, id) vào câu lệnh chạy trên prod.
 */
export function vanBanSql(q: Prisma.Sql): string {
  return q.text.replace(/\$(\d+)/g, (_m, n: string) => {
    const v = q.values[Number(n) - 1];
    if (typeof v !== "string") throw new Error("vanBanSql: chỉ nhúng được giá trị chuỗi");
    return `'${v.replaceAll("'", "''")}'`;
  });
}

/** Các câu SQL để IN cho người vận hành, theo thứ tự đọc. Không tham số (không khoanh cơ sở). */
export function cauSqlInRa(): { ten: string; moTa: string; sql: string }[] {
  return [
    { ten: "1. dongChuaThuChuaHuy", moTa: "dòng học phí chưa thu dương, đơn chưa huỷ — theo trạng thái đơn (mức ĐƠN)", sql: vanBanSql(sqlDongChuaThuChuaHuy()) },
    { ten: "2. ungVien PREVIOUS_PURCHASE_UNRESOLVED", moTa: "CẬN TRÊN số học viên / dòng bị giữ vì đơn trước chưa thu (PREVIOUS_PURCHASE_UNRESOLVED)", sql: vanBanSql(sqlDemUngVien("PREVIOUS_PURCHASE_UNRESOLVED")) },
    { ten: "3. ungVien BACKFILL_ORDER_TIME_UNVERIFIED", moTa: "CẬN TRÊN số học viên / dòng bị giữ vì thứ tự mua không kiểm chứng được (BACKFILL_ORDER_TIME_UNVERIFIED)", sql: vanBanSql(sqlDemUngVien("BACKFILL_ORDER_TIME_UNVERIFIED")) },
    { ten: "4. donChuaKiem", moTa: "số đơn mang dấu «giờ tạo chưa kiểm chứng» (coverage của audit)", sql: vanBanSql(sqlDemDonChuaKiem()) },
  ];
}

// ── Đọc ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type ViDuHold = {
  /** `Order.code` của đơn mang dòng bị giữ. KHÔNG tên, KHÔNG SĐT, KHÔNG id học viên. */
  maDon: string;
  trangThaiDon: string;
  /** Các đơn đang làm khoản này bị giữ, dạng `CODE [TRẠNG_THÁI]`. */
  donVuongMac: string[];
};

export type NhomHold = { soDong: number; soHocVien: number; soKhoanThu: number; soTienThu: number; viDu: ViDuHold[] };

export type LanMuaTreo = {
  dongChuaThuChuaHuy: { tong: number; theoTrangThai: { trangThai: string; soDong: number }[] };
  donChuaKiem: { ghiBu: number; nhapCu: number };
  ungVien: Record<LoaiUngVien, { soHocVien: number; soDong: number }>;
  chinhXac: {
    soDongDaXet: number;
    lanMuaTruocChuaChot: NhomHold;
    thuTuMuaChuaKiem: NhomHold;
  };
};

const nhomRong = (): NhomHold => ({ soDong: 0, soHocVien: 0, soKhoanThu: 0, soTienThu: 0, viDu: [] });

type HangDem = { so_hoc_vien: number; so_dong: number };
type HangUngVien = { oi_id: string; order_id: string; code: string; trang_thai: string; hoc_vien: string };

/**
 * Đo cả ba tầng. `centerId` chỉ để TEST khoanh vùng (DB test còn dữ liệu của spec khác); script vận hành KHÔNG truyền.
 * `toiDaViDu` chặn độ dài danh sách ví dụ; `tranSoDong` chặn số dòng ứng viên mà bộ phân loại phải chạy — vượt thì NÉM (không cắt im lặng rồi báo «0»).
 */
export async function docLanMuaTreo(
  client: KhachDocLanMua,
  opts: { centerId?: string; toiDaViDu: number; tranSoDong: number },
): Promise<LanMuaTreo> {
  const { centerId } = opts;
  const trangThai = await client.$queryRaw<{ trang_thai: string; so_dong: number }[]>(sqlDongChuaThuChuaHuy(centerId));
  const [ghiBuNhapCu] = await client.$queryRaw<{ ghi_bu: number; nhap_cu: number }[]>(sqlDemDonChuaKiem());

  const ungVien = {} as LanMuaTreo["ungVien"];
  const dongUngVien = {} as Record<LoaiUngVien, HangUngVien[]>;
  for (const loai of ["PREVIOUS_PURCHASE_UNRESOLVED", "BACKFILL_ORDER_TIME_UNVERIFIED"] as const) {
    const [d] = await client.$queryRaw<HangDem[]>(sqlDemUngVien(loai, centerId));
    ungVien[loai] = { soHocVien: d?.so_hoc_vien ?? 0, soDong: d?.so_dong ?? 0 };
    dongUngVien[loai] = await client.$queryRaw<HangUngVien[]>(sqlDongUngVien(loai, centerId));
  }

  const canXet = new Map<string, HangUngVien>();
  for (const loai of Object.keys(dongUngVien) as LoaiUngVien[]) for (const h of dongUngVien[loai]) canXet.set(h.oi_id, h);
  if (canXet.size > opts.tranSoDong) {
    throw new Error(`Có ${canXet.size} dòng ứng viên, vượt trần ${opts.tranSoDong}. Đo KHÔNG cắt bớt (cắt rồi báo số nhỏ là báo sai) — nâng --tran-so-dong rồi chạy lại.`);
  }

  const chinhXac: LanMuaTreo["chinhXac"] = { soDongDaXet: canXet.size, lanMuaTruocChuaChot: nhomRong(), thuTuMuaChuaKiem: nhomRong() };
  const hocVien = { chuaChot: new Set<string>(), chuaKiem: new Set<string>() };
  const donCanTraMa = new Set<string>();
  const giu: { nhom: "chuaChot" | "chuaKiem"; h: HangUngVien; vuongMac: string[] }[] = [];

  for (const h of [...canXet.values()].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))) {
    const kq = await phanLoaiDongDon(client, { orderItemId: h.oi_id });
    if (!kq) continue;
    if (kq.maLuat === "PREVIOUS_PURCHASE_UNRESOLVED") giu.push({ nhom: "chuaChot", h, vuongMac: kq.bangChung.lanMuaChuaChotIds });
    else if (kq.maLuat === "BACKFILL_ORDER_TIME_UNVERIFIED") giu.push({ nhom: "chuaKiem", h, vuongMac: kq.bangChung.lanMuaThuTuChuaKiemIds });
    else continue;
    donCanTraMa.add(h.order_id);
  }

  // Tên đơn đang làm vướng (id dòng đơn → mã đơn + trạng thái): một câu cho cả lô.
  const dongVuongMac = [...new Set(giu.flatMap((g) => g.vuongMac))];
  const dongVuong = dongVuongMac.length
    ? await client.orderItem.findMany({ where: { id: { in: dongVuongMac } }, select: { id: true, order: { select: { code: true, status: true } } } })
    : [];
  const tenDon = new Map(dongVuong.map((d) => [d.id, `${d.order.code} [${d.order.status}]`]));

  // Khoản thực thu (dương) của các đơn bị giữ — mức ĐƠN, như tầng 1.
  const khoan = donCanTraMa.size
    ? await client.payment.findMany({ where: { ...WHERE_THUC_THU, amount: { gt: 0 }, orderId: { in: [...donCanTraMa] } }, select: { orderId: true, amount: true } })
    : [];
  const khoanTheoDon = new Map<string, { so: number; tien: number }>();
  for (const k of khoan) {
    const x = khoanTheoDon.get(k.orderId) ?? { so: 0, tien: 0 };
    x.so += 1;
    x.tien += k.amount;
    khoanTheoDon.set(k.orderId, x);
  }

  const donDaDem = { chuaChot: new Set<string>(), chuaKiem: new Set<string>() };
  for (const g of giu) {
    const nhom = g.nhom === "chuaChot" ? chinhXac.lanMuaTruocChuaChot : chinhXac.thuTuMuaChuaKiem;
    nhom.soDong += 1;
    (g.nhom === "chuaChot" ? hocVien.chuaChot : hocVien.chuaKiem).add(g.h.hoc_vien);
    const daDem = donDaDem[g.nhom];
    if (!daDem.has(g.h.order_id)) {
      daDem.add(g.h.order_id);
      const t = khoanTheoDon.get(g.h.order_id);
      nhom.soKhoanThu += t?.so ?? 0;
      nhom.soTienThu += t?.tien ?? 0;
    }
    if (nhom.viDu.length < opts.toiDaViDu) nhom.viDu.push({ maDon: g.h.code, trangThaiDon: g.h.trang_thai, donVuongMac: g.vuongMac.map((id) => tenDon.get(id) ?? id).sort() });
  }
  chinhXac.lanMuaTruocChuaChot.soHocVien = hocVien.chuaChot.size;
  chinhXac.thuTuMuaChuaKiem.soHocVien = hocVien.chuaKiem.size;

  return {
    dongChuaThuChuaHuy: { tong: trangThai.reduce((s, t) => s + t.so_dong, 0), theoTrangThai: trangThai.map((t) => ({ trangThai: t.trang_thai, soDong: t.so_dong })) },
    donChuaKiem: { ghiBu: ghiBuNhapCu?.ghi_bu ?? 0, nhapCu: ghiBuNhapCu?.nhap_cu ?? 0 },
    ungVien,
    chinhXac,
  };
}
