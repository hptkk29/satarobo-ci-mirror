// lib/nguon/hoa-hong-gioi-thieu.ts — «DÒNG HOA HỒNG» của NHÂN SỰ ở màn «Link giới thiệu của tôi» (chủ dự án 21/11/2026, thiết kế một trang).
//
// Nguồn số: SỔ hoa hồng thật (`CommissionTransaction`) — KHÔNG tính lại. Dòng «của tôi» = dòng mà người hưởng là CHÍNH nhân sự đang đăng nhập ở vai «Nhân sự giới thiệu»
// (`roleCode = REFERRER_EMPLOYEE` ∧ `beneficiaryEmployeeId` = hồ sơ của phiên), HOẶC dòng trả cho hồ sơ giới thiệu (đối tác affiliate) của chính họ. Dòng Sale / quản lý / chủ nguồn
// mà cùng người đó hưởng ở vai KHÁC thì KHÔNG nằm ở đây (màn này là hoa hồng GIỚI THIỆU).
//
// Trạng thái là trạng thái CHI TRẢ THẬT của sổ (`payoutStatus`) + dòng đảo (thu hồi) — hệ thống KHÔNG có trạng thái «chờ đủ N ngày», nên không dựng.
// An toàn dữ liệu: cùng luật với «Thu nhập thêm» (`thu-nhap-them.ts`): SĐT chỉ đi xuống dạng CHE, không trả id lead / id dòng sổ; tìm theo SĐT chỉ khớp khi gõ ĐỦ số, khớp ở máy chủ.
import type { CommissionEntryKind, CommissionPayoutStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { docNhanSuCuaToi, partyIdsCuaNhanSu } from "@/lib/affiliate/doi-tac-nhan-su";
import { nationalPhone } from "@/lib/phone";
import { khopSoDienThoai } from "./thu-nhap-them";

/** Vai người hưởng của nhân sự giới thiệu — mã của danh mục vai (`lib/hoa-hong/vai-huong.ts`). */
const VAI_NHAN_SU_GIOI_THIEU = "REFERRER_EMPLOYEE";
const TRAN = 500;

export type TrangThaiDongHH = "DANG_GIU" | "CHO_DUYET" | "CHO_CHI" | "DA_TRA" | "THU_HOI";
export const NHAN_TRANG_THAI_DONG_HH: Readonly<Record<TrangThaiDongHH, string>> = {
  DANG_GIU: "Đang giữ",
  CHO_DUYET: "Chờ duyệt",
  CHO_CHI: "Đã duyệt · chờ chi",
  DA_TRA: "Đã trả",
  THU_HOI: "Thu hồi · hoàn tiền",
};

const DONG_DAO: readonly CommissionEntryKind[] = ["REVERSAL", "LEGACY_REVERSAL"];

/** Trạng thái hiển thị của MỘT dòng sổ (thuần). Dòng đảo / số âm ⇒ thu hồi, bất kể trạng thái chi. */
export function trangThaiDongHH(d: { entryKind: CommissionEntryKind; amount: number; payoutStatus: CommissionPayoutStatus }): TrangThaiDongHH {
  if (DONG_DAO.includes(d.entryKind) || d.amount < 0) return "THU_HOI";
  switch (d.payoutStatus) {
    case "ON_HOLD":
      return "DANG_GIU";
    case "PENDING":
      return "CHO_DUYET";
    case "APPROVED":
    case "EXPORTED":
      return "CHO_CHI";
    case "PAID":
      return "DA_TRA";
  }
}

/** `0912345220` → `09** *** 220` (2 số đầu + 3 số cuối). Không chuẩn hoá được ⇒ che toàn bộ. */
export function cheSdtDongHH(raw: unknown): string {
  const n = nationalPhone(raw);
  if (!n || n.length < 8) return "** *** ***";
  return `${n.slice(0, 2)}** *** ${n.slice(-3)}`;
}

/** 0.05 ⇒ "5%"; 0.035 ⇒ "3,5%"; mức cố định ⇒ "Cố định". */
export function nhanMuc(rate: Prisma.Decimal | number | null, fixedAmount: number | null): string {
  if (rate !== null && rate !== undefined) {
    const pt = Math.round(Number(rate) * 10000) / 100;
    return `${pt.toLocaleString("vi-VN")}%`;
  }
  return fixedAmount !== null ? "Cố định" : "—";
}

const ngayThang = (d: Date): string => new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }).format(d);

export type DongHoaHongGioiThieu = {
  /** Khoá React — KHÔNG phải id dòng sổ. */
  khoa: string;
  phuHuynh: string | null;
  sdtChe: string | null;
  /** «RoboSim 2 · mua mới» — dòng đơn của khoản thu (khoá phụ huynh đăng ký). */
  khoaHoc: string;
  /** Số phụ huynh ĐÃ ĐÓNG ở khoản thu sinh ra dòng này, GỒM VAT (`grossAmount` của sổ — chủ dự án 22/11/2026). Dòng cọc = số cọc, không phải học phí cả khoá. */
  daDong: number;
  muc: string;
  hoaHong: number;
  trangThai: TrangThaiDongHH;
  /** Nhãn hiển thị — «Đã trả 05/11» khi đã trả. */
  nhanTrangThai: string;
};

export type HoaHongGioiThieu = {
  /** Σ dòng ĐÃ TRẢ (kể cả dòng đảo đã trả) — trên MỌI dòng của người này (tính ở DB), không chỉ các dòng đang hiện. */
  daNhan: number;
  /** Σ dòng CHƯA trả (đang giữ · chờ duyệt · chờ chi), kể cả dòng thu hồi chưa trả. */
  dangCho: number;
  soChoDuyet: number;
  soChoChi: number;
  soDangGiu: number;
  dong: DongHoaHongGioiThieu[];
  biCat: boolean;
};

const RONG: HoaHongGioiThieu = { daNhan: 0, dangCho: 0, soChoDuyet: 0, soChoChi: 0, soDangGiu: 0, dong: [], biCat: false };

/** Dòng hoa hồng GIỚI THIỆU của nhân sự đang đăng nhập (`userId` từ PHIÊN). Không có hồ sơ nhân sự ⇒ rỗng. Tổng tính trên MỌI dòng; `q`/`trangThai` chỉ lọc danh sách. */
export async function docHoaHongGioiThieuNhanSu(p: { userId: string; q?: string; trangThai?: TrangThaiDongHH | null }): Promise<HoaHongGioiThieu> {
  const nhanSu = await docNhanSuCuaToi(p.userId);
  if (!nhanSu) return RONG;
  const partyIds = await partyIdsCuaNhanSu(p.userId);
  const cuaToi: Prisma.CommissionTransactionWhereInput = {
    OR: [
      { roleCode: VAI_NHAN_SU_GIOI_THIEU, beneficiaryEmployeeId: nhanSu.employeeId },
      ...(partyIds.length > 0 ? [{ beneficiaryAffiliateId: { in: partyIds } }] : []),
    ],
  };
  // TỔNG tính ở DB trên MỌI dòng (danh sách bên dưới có trần 500 dòng — cộng trên danh sách là thiếu tiền với người nhiều dòng).
  // Đếm theo trạng thái chỉ tính dòng DƯƠNG không phải dòng đảo — khớp `trangThaiDongHH` (dòng đảo / âm là «thu hồi», không phải «chờ duyệt»).
  const [tongTheoTrangThai, demTheoTrangThai] = await Promise.all([
    db.commissionTransaction.groupBy({ by: ["payoutStatus"], where: cuaToi, _sum: { amount: true }, orderBy: { payoutStatus: "asc" } }),
    db.commissionTransaction.groupBy({
      by: ["payoutStatus"],
      where: { AND: [cuaToi, { amount: { gt: 0 }, entryKind: { notIn: [...DONG_DAO] } }] },
      _count: { _all: true },
      orderBy: { payoutStatus: "asc" },
    }),
  ]);
  let daNhan = 0;
  let dangCho = 0;
  for (const g of tongTheoTrangThai) {
    const t = g._sum.amount ?? 0;
    if (g.payoutStatus === "PAID") daNhan += t;
    else dangCho += t;
  }
  let soChoDuyet = 0;
  let soChoChi = 0;
  let soDangGiu = 0;
  for (const g of demTheoTrangThai) {
    const n = g._count._all;
    if (g.payoutStatus === "PENDING") soChoDuyet += n;
    else if (g.payoutStatus === "APPROVED" || g.payoutStatus === "EXPORTED") soChoChi += n;
    else if (g.payoutStatus === "ON_HOLD") soDangGiu += n;
  }

  const rows = await db.commissionTransaction.findMany({
    where: cuaToi,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: TRAN + 1,
    select: {
      entryKind: true,
      amount: true,
      grossAmount: true,
      rate: true,
      fixedAmount: true,
      payoutStatus: true,
      payoutStatusAt: true,
      transactionTypeCode: true,
      leadId: true,
      orderItemId: true,
    },
  });
  const biCat = rows.length > TRAN;
  const tat = rows.slice(0, TRAN);

  const leadIds = [...new Set(tat.flatMap((r) => (r.leadId ? [r.leadId] : [])))];
  const itemIds = [...new Set(tat.flatMap((r) => (r.orderItemId ? [r.orderItemId] : [])))];
  const [leads, items] = await Promise.all([
    leadIds.length ? db.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, parentName: true, childName: true, phone: true } }) : [],
    itemIds.length ? db.orderItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, itemName: true } }) : [],
  ]);
  const leadTheoId = new Map(leads.map((l) => [l.id, l]));
  const itemTheoId = new Map(items.map((i) => [i.id, i]));

  const q = (p.q ?? "").trim();
  const qThuong = q.toLowerCase();
  const dong: DongHoaHongGioiThieu[] = [];
  tat.forEach((r, i) => {
    const tt = trangThaiDongHH(r);
    const lead = r.leadId ? leadTheoId.get(r.leadId) : undefined;
    if (p.trangThai && tt !== p.trangThai) return;
    if (q) {
      const khop = !!lead && (khopSoDienThoai(q, lead.phone) || lead.parentName.toLowerCase().includes(qThuong) || (lead.childName ?? "").toLowerCase().includes(qThuong));
      if (!khop) return;
    }
    const loai = r.transactionTypeCode === "NEW" ? "mua mới" : r.transactionTypeCode === "RENEWAL" ? "gia hạn" : null;
    const tenKhoa = (r.orderItemId ? itemTheoId.get(r.orderItemId)?.itemName : null) ?? "—";
    dong.push({
      khoa: `d${i}`,
      phuHuynh: lead?.parentName ?? null,
      sdtChe: lead ? cheSdtDongHH(lead.phone) : null,
      khoaHoc: loai ? `${tenKhoa} · ${loai}` : tenKhoa,
      daDong: r.grossAmount,
      muc: nhanMuc(r.rate, r.fixedAmount),
      hoaHong: r.amount,
      trangThai: tt,
      nhanTrangThai: tt === "DA_TRA" && r.payoutStatusAt ? `Đã trả ${ngayThang(r.payoutStatusAt)}` : NHAN_TRANG_THAI_DONG_HH[tt],
    });
  });
  return { daNhan, dangCho, soChoDuyet, soChoChi, soDangGiu, dong, biCat };
}
