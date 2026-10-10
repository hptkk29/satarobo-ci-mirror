// lib/hoa-hong/hang-cho-so-doc.ts — ĐỌC hàng chờ SỔ (`CommissionHold`) cho tab Sổ / Kỳ: MỘT hàm đọc, MỘT chỗ đếm, hai trục phân loại từ MỘT mã.
//
// ⭐ ĐỊNH NGHĨA DUY NHẤT của «hàng chờ sổ». Tab Sổ (hàng chờ trước sổ, pill, công tắc «Cần xử lý (N)», chip loại, bảng), tab Kỳ (việc dang dở) và mọi consumer khác
// GỌI hàm này — KHÔNG tự đếm `CommissionHold` bằng điều kiện riêng. Hai chiều phân loại, cùng đọc từ MỘT mã (`hang-cho-so-nhom.ts`):
//   · `nhom` — có CHẶN KHOÁ KỲ không (CHAN_KHOA_KY | CHUA_PHAN_GIAI_NGUOI_HUONG | SO_DU_AM) — tab Kỳ dùng;
//   · `loai` — cần xử lý VIỆC GÌ (chưa phân giải người hưởng · chờ chính sách · vượt trần · thiếu dữ liệu thanh toán · chờ điều chỉnh · số dư âm) — chip tab Sổ dùng.
// Hai bộ đếm `dem` / `demTheoLoai` đến từ CÙNG một `groupBy` theo mã ⇒ cùng tổng; `canXuLy` = Σ `demTheoLoai` = Σ `dem` là con số DUY NHẤT của «Cần xử lý (N)»
// (lưới `[NHH-SO-DOC-*]`, `[NHH-SO-DB-15]`). Số liệu «blocker chặn khoá kỳ» của một kỳ cụ thể KHÔNG lấy ở đây mà ở `demHangChoChan(client, periodId)` (`ky-service.ts`)
// — chính câu đếm cổng khoá dùng.
//
// Nguồn: docs/source-commission/04 §7.1, §10.5 · 05 TRX-06 · 06 §2.2, §6 ("vai treo tách khỏi hàng chờ chặn"). Chốt Stage 3 (b): đơn KHÔNG có lead ⇒ hàng chờ
// `UNRESOLVED_BENEFICIARY` hiển thị «Chưa phân giải người hưởng» — không chặn khoá kỳ, không lẫn với hàng chờ chặn, và KHÔNG phải hàng chờ nguồn.
//
// Quyền + cách ly (cùng luật với `docSoHoaHong`, nhưng KHÔNG có nhánh view-self):
//   · hàng chờ mang số tiền và tên vai của NGƯỜI KHÁC (`tienVai`) ⇒ cần `commission:view-center`; chỉ có `view-self` ⇒ `PermissionError` (fail-closed, không trả mảng rỗng);
//   · tầm nhìn cơ sở = `getModelVisibleCenterIds("CommissionHold", actor)`; hàng chờ chưa quy được cơ sở (`centerId` NULL — vd `NO_ORG_UNIT`) KHÔNG nằm trong
//     `centerId IN (...)` nên chỉ người có tầm nhìn "ALL" thấy (khớp chú thích schema);
//   · tham số `centerId` của bộ lọc chỉ THU HẸP trong tầm nhìn, không bao giờ mở rộng (AND, không OR).
// Hàm nằm ở `lib/hoa-hong/**` (ngoài `app/**`) nên cổng ESLint "cấm import db trần" không soi — lưới `[NHH-H-NL-04/05]` (Postgres thật, có đối chứng dương) là lưới canh.
//
// ── Link "việc tiếp theo" ──────────────────────────────────────────────────────────────────────────────────
// `quyen` (người xem mở được trang đích nào) do TRANG tính từ đúng cổng của trang đích. Không truyền ⇒ KHÔNG link nào (fail-closed, luật 12): một link dẫn tới
// trang đá người ta về /dashboard là lời hứa suông.
import { CommissionHoldCode, type Prisma, type PrismaClient } from "@prisma/client";

import type { Actor } from "@/lib/auth/actor";
import { can, PermissionError } from "@/lib/auth/can";
import { db } from "@/lib/db";
import { getModelVisibleCenterIds } from "@/lib/db-scope";

import { docMaNguonCuaLead } from "@/lib/nguon/doc-ma-nguon-lead";

import { KEY_XEM_CO_SO } from "./doc-so";
import type { MaHold } from "./hang-cho";
import { hanhDongTiep, laDonChuaNoiLead, lyDoHienThi, VAI_CHU_NGUON, type BuocKeTiep, type QuyenLienKet } from "./hang-cho-so";
import {
  laDoiDuocSangKySau,
  LOAI_HANG_CHO_SO,
  loaiCuaMa,
  maCuaLoai,
  maCuaNhom,
  NHAN_MA_HANG_CHO,
  NHOM_HANG_CHO_SO,
  nhomCuaMa,
  type LoaiHangChoSo,
  type NhomHangChoSo,
} from "./hang-cho-so-nhom";

type Khach = PrismaClient | Prisma.TransactionClient;

/** Cỡ trang mặc định của bảng hàng chờ ở tab Sổ. */
export const KICH_THUOC_HANG_CHO_SO = 25;

const KHONG_QUYEN: QuyenLienKet = { don: false, lead: false, chinhSach: false, nguoiPhuTrach: false, nguon: false };

export type BoLocHangChoSo = {
  nhom?: NhomHangChoSo;
  /** Lọc theo LOẠI việc cần xử lý; cùng `nhom` thì là AND. */
  loai?: LoaiHangChoSo;
  /** Thu hẹp theo cơ sở — chỉ có hiệu lực TRONG tầm nhìn của người xem. */
  centerId?: string;
  /**
   * Chỉ hàng chờ ĐANG CHẶN khoá kỳ này ("2026-10"). Điều kiện đi vào `phamViChung` nên MỌI con số đi kèm (`tongSo`, `canXuLy`, `dem`, `demTheoLoai`) đếm CÙNG tập — lọc mỗi danh sách mà để
   * chip đếm tổng là hai con số cùng nhãn khác phạm vi. Kèm `centerId` ⇒ lọc theo cơ sở CỦA KỲ (`blockingPeriod.centerId`), khớp ĐÚNG phép đếm của cổng khoá (`demHangChoChanTheoMa`: theo
   * `blockingPeriodId`, không theo `centerId` của hàng chờ). Tầm nhìn cơ sở của người xem vẫn áp.
   */
  ky?: string;
  trang?: number;
  coTrang?: number;
  /** Trang đích nào người xem mở được; thiếu ⇒ không dòng nào có link. */
  quyen?: QuyenLienKet;
};

export type DongHangChoSo = {
  id: string;
  holdKey: string;
  ma: MaHold;
  /** Tên tiếng Việt của mã — thứ in lên màn. */
  tenMa: string;
  nhom: NhomHangChoSo;
  loai: LoaiHangChoSo;
  /** Đang CHẶN một kỳ cụ thể (`blockingPeriodId` có giá trị). Hàng chờ treo luôn `false`. */
  chanKhoa: boolean;
  /** Kỳ đang bị chặn ("2026-10"); null khi không chặn kỳ nào. */
  kyChan: string | null;
  /** "Dời sang kỳ sau" có nghĩa với hàng chờ này không — `laDoiDuocSangKySau`, CÙNG hàm mà điều phối server kiểm. Trang chỉ vẽ nút khi cờ này ∧ người xem giữ quyền quản lý kỳ. */
  doiDuoc: boolean;
  paymentId: string | null;
  orderId: string | null;
  orderItemId: string | null;
  studentId: string | null;
  tenHocVien: string | null;
  /** `null` = chưa quy được cơ sở — chỉ tầm nhìn toàn hệ thống thấy. */
  centerId: string | null;
  coSo: { code: string | null; ten: string } | null;
  /** Vai treo (SALE, SALE_ADMIN…) — chỉ có ở hàng chờ treo. */
  vai: string | null;
  /** Mã lý do treo do resolver ghi (`KHONG_CO_LEAD`…); `null` khi không phải hàng chờ treo / không có. */
  lyDoMa: string | null;
  /** Lý do bằng chữ, LUÔN có (nhãn mã nếu engine không ghi câu nào). Với hàng chờ treo có tiền tố «Vai X: ». */
  lyDo: string;
  /** Đơn không có lead — dấu hiệu để UI nói «Đơn chưa nối lead» thay vì «lỗi dữ liệu». */
  khongCoLead: boolean;
  /** Việc kế tiếp bằng chữ + link CHỈ khi người xem mở được trang đích. */
  buoc: BuocKeTiep["buoc"];
  lienKet: BuocKeTiep["lienKet"];
  /** Số tiền của vai bị treo (VND) — `null` nếu hàng chờ không mang số này. */
  tienVai: number | null;
  taoLuc: Date;
};

export type DemHangChoSo = {
  /** Theo trục tính chất (chặn khoá / chưa phân giải / số dư âm) — tab Kỳ. Không phụ thuộc bộ lọc `nhom`/`loai`. */
  dem: Record<NhomHangChoSo, number>;
  /** Theo LOẠI việc cần xử lý (chip của tab Sổ). Cùng tổng với `dem`; không phụ thuộc bộ lọc `nhom`/`loai` (số trên chip không nhảy khi bấm chip khác). */
  demTheoLoai: Record<LoaiHangChoSo, number>;
  /** Mọi hàng chờ MỞ trong tầm nhìn = Σ `demTheoLoai` — pill «Cần xử lý (N)». Một con số, không ai cộng lại ở chỗ gọi. */
  canXuLy: number;
};

export type KetQuaHangChoSo = DemHangChoSo & {
  dong: DongHangChoSo[];
  /** Số dòng khớp bộ lọc (để phân trang). */
  tongSo: number;
  trang: number;
  coTrang: number;
};

const TAT_CA_MA = Object.values(CommissionHoldCode) as MaHold[];

const COT = {
  id: true,
  holdKey: true,
  code: true,
  status: true,
  paymentId: true,
  orderId: true,
  orderItemId: true,
  studentId: true,
  blockingPeriodId: true,
  blockingPeriod: { select: { period: true } },
  centerId: true,
  detail: true,
  createdAt: true,
} satisfies Prisma.CommissionHoldSelect;

const laBanGhi = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function batQuyen(actor: Actor): void {
  if (!can(actor, KEY_XEM_CO_SO)) throw new PermissionError();
}

/** Phạm vi chung của MỌI phép đếm/đọc: hàng chờ MỞ, trong tầm nhìn cơ sở, thu hẹp theo `centerId` nếu có. KHÔNG chứa bộ lọc nhóm (pill không nhảy theo bộ lọc). */
function phamViChung(actor: Actor, centerId: string | null | undefined, ky: string | null | undefined): Prisma.CommissionHoldWhereInput[] {
  const cs = getModelVisibleCenterIds("CommissionHold", actor);
  const chung: Prisma.CommissionHoldWhereInput[] = [{ status: "OPEN" }];
  if (cs !== "ALL") chung.push({ centerId: { in: cs } });
  if (ky) chung.push({ blockingPeriod: { period: ky, ...(centerId ? { centerId } : {}) } });
  else if (centerId) chung.push({ centerId });
  return chung;
}

/** MỘT chỗ đếm: một `groupBy` theo mã rồi gom cả hai trục Ở ĐÂY. */
async function demTheoMa(client: Khach, chung: Prisma.CommissionHoldWhereInput[]): Promise<DemHangChoSo> {
  const theoMa = await client.commissionHold.groupBy({ by: ["code"], where: { AND: chung }, _count: { _all: true } });
  const dem = Object.fromEntries(NHOM_HANG_CHO_SO.map((n) => [n, 0])) as Record<NhomHangChoSo, number>;
  const demTheoLoai = Object.fromEntries(LOAI_HANG_CHO_SO.map((l) => [l, 0])) as Record<LoaiHangChoSo, number>;
  for (const g of theoMa) {
    const ma = g.code as MaHold;
    dem[nhomCuaMa(ma)] += g._count._all;
    demTheoLoai[loaiCuaMa(ma)] += g._count._all;
  }
  const canXuLy = LOAI_HANG_CHO_SO.reduce((t, l) => t + demTheoLoai[l], 0);
  return { dem, demTheoLoai, canXuLy };
}

/**
 * Số hàng chờ MỞ trong tầm nhìn của `actor` (pill của tab, công tắc "Cần xử lý (N)", chip loại). Bộ lọc nhóm/loại KHÔNG là tham số: số trên chip của loại này không được
 * đổi khi người xem bấm chip nhóm khác. Gọi qua `db` của module — trang dưới `app/(admin)` không được import `@/lib/db` trần.
 */
export async function demHangChoSo(actor: Actor, coSoId: string | null): Promise<DemHangChoSo> {
  batQuyen(actor);
  return demTheoMa(db, phamViChung(actor, coSoId, null));
}

type Ngu = {
  leadCua: Map<string, string | null>;
  /** id lead → mã nguồn HIỆN HÀNH. Chỉ dựng khi trang có hàng chờ của vai chủ nguồn (không thêm câu tra cho trang không cần). */
  nguonCua: Map<string, string>;
  tenHs: Map<string, string>;
  coSoCua: Map<string, { code: string | null; ten: string }>;
  tenVai: Map<string, string>;
};

function anhXa(r: Prisma.CommissionHoldGetPayload<{ select: typeof COT }>, ngu: Ngu, quyen: QuyenLienKet): DongHangChoSo {
  const ma = r.code as MaHold;
  const d = laBanGhi(r.detail) ? r.detail : {};
  const treo = ma === "UNRESOLVED_BENEFICIARY";
  const maVai = treo && typeof d.vai === "string" ? d.vai : null;
  const lyDoMa = treo && typeof d.lyDo === "string" ? d.lyDo : null;
  const leadId = r.orderId ? (ngu.leadCua.get(r.orderId) ?? null) : null;
  const tiep = hanhDongTiep({ ma, detail: r.detail, orderId: r.orderId, leadId, nguonCode: leadId ? (ngu.nguonCua.get(leadId) ?? null) : null }, quyen);
  return {
    id: r.id,
    holdKey: r.holdKey,
    ma,
    tenMa: NHAN_MA_HANG_CHO[ma],
    nhom: nhomCuaMa(ma),
    loai: loaiCuaMa(ma),
    chanKhoa: r.blockingPeriodId !== null,
    kyChan: r.blockingPeriod?.period ?? null,
    doiDuoc: laDoiDuocSangKySau({ code: ma, status: r.status, blockingPeriodId: r.blockingPeriodId }),
    paymentId: r.paymentId,
    orderId: r.orderId,
    orderItemId: r.orderItemId,
    studentId: r.studentId,
    tenHocVien: r.studentId ? (ngu.tenHs.get(r.studentId) ?? null) : null,
    centerId: r.centerId,
    coSo: r.centerId ? (ngu.coSoCua.get(r.centerId) ?? null) : null,
    vai: maVai,
    lyDoMa,
    lyDo: lyDoHienThi(ma, r.detail, maVai ? (ngu.tenVai.get(maVai) ?? maVai) : null),
    khongCoLead: laDonChuaNoiLead(ma, r.detail),
    buoc: tiep.buoc,
    lienKet: tiep.lienKet,
    tienVai: treo && typeof d.tienVai === "number" && Number.isFinite(d.tienVai) ? d.tienVai : null,
    taoLuc: r.createdAt,
  };
}

export async function docHangChoSo(client: Khach, actor: Actor, boLoc: BoLocHangChoSo): Promise<KetQuaHangChoSo> {
  batQuyen(actor);

  const chung = phamViChung(actor, boLoc.centerId, boLoc.ky);
  const loc: Prisma.CommissionHoldWhereInput[] = [...chung];
  if (boLoc.nhom) loc.push({ code: { in: maCuaNhom(boLoc.nhom, TAT_CA_MA) } });
  if (boLoc.loai) loc.push({ code: { in: maCuaLoai(boLoc.loai, TAT_CA_MA) } });
  const where: Prisma.CommissionHoldWhereInput = { AND: loc };
  const coTrang = Math.min(Math.max(boLoc.coTrang ?? 50, 1), 200);
  const trang = Math.max(Math.trunc(boLoc.trang ?? 1) || 1, 1);

  const [rows, tongSo, dem] = await Promise.all([
    client.commissionHold.findMany({ where, select: COT, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (trang - 1) * coTrang, take: coTrang }),
    client.commissionHold.count({ where }),
    demTheoMa(client, chung),
  ]);

  // Tra cứu phụ theo id của những dòng ĐÃ qua cổng tầm nhìn ở trên (không lộ thêm gì).
  const orderIds = [...new Set(rows.flatMap((r) => (r.orderId ? [r.orderId] : [])))];
  const studentIds = [...new Set(rows.flatMap((r) => (r.studentId ? [r.studentId] : [])))];
  const centerIds = [...new Set(rows.flatMap((r) => (r.centerId ? [r.centerId] : [])))];
  const [don, hs, cs, vai] = await Promise.all([
    orderIds.length > 0 ? client.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, leadId: true } }) : Promise.resolve([]),
    studentIds.length > 0 ? client.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    centerIds.length > 0 ? client.center.findMany({ where: { id: { in: centerIds } }, select: { id: true, code: true, name: true } }) : Promise.resolve([]),
    rows.some((r) => r.code === "UNRESOLVED_BENEFICIARY") ? client.beneficiaryRole.findMany({ select: { code: true, name: true } }) : Promise.resolve([]),
  ]);
  // Mã nguồn chỉ để dẫn tới trang chi tiết nguồn khi hàng chờ là của vai CHỦ NGUỒN — các hàng chờ khác không cần, nên không tra.
  const donChuNguon = new Set(rows.filter((r) => r.code === "UNRESOLVED_BENEFICIARY" && laBanGhi(r.detail) && r.detail.vai === VAI_CHU_NGUON).flatMap((r) => (r.orderId ? [r.orderId] : [])));
  const leadChoNguon = don.flatMap((o) => (o.leadId && donChuNguon.has(o.id) ? [o.leadId] : []));
  const nguonCua = leadChoNguon.length > 0 && (boLoc.quyen?.nguon ?? false) ? await docMaNguonCuaLead(client, leadChoNguon) : new Map<string, string>();
  const ngu: Ngu = {
    leadCua: new Map(don.map((o) => [o.id, o.leadId])),
    nguonCua,
    tenHs: new Map(hs.map((h) => [h.id, h.name])),
    coSoCua: new Map(cs.map((c) => [c.id, { code: c.code, ten: c.name }])),
    tenVai: new Map(vai.map((v) => [v.code, v.name])),
  };

  return { dong: rows.map((r) => anhXa(r, ngu, boLoc.quyen ?? KHONG_QUYEN)), tongSo, ...dem, trang, coTrang };
}

/** `docHangChoSo` gắn sẵn `db` cho trang dưới `app/(admin)/**` (cổng ESLint cấm import `@/lib/db` trần ở đó). Cùng một hàm đọc — không có đường thứ hai. */
export function docHangChoSoCuaToi(actor: Actor, boLoc: BoLocHangChoSo): Promise<KetQuaHangChoSo> {
  return docHangChoSo(db, actor, boLoc);
}
