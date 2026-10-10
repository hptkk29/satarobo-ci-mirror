/**
 * lib/nguon/doc-gan-nguon.ts — ĐỌC dữ liệu cho Sheet "Gán nguồn" VÀ khối "Nguồn" trên chi tiết lead (06 §5.1, §5.6).
 * MỘT hàm cho hai chỗ (luật 12b): khối trên lead và Sheet cùng nói một câu về cùng một lead.
 *
 * ── Thứ tự không đảo được (cùng khuôn `doi-nguon-lead.ts`) ──────────────────────────────────────────────────
 *  1. LEAD qua `scopedDb(actor)` + `passesScope` TRƯỚC mọi thứ. Lead ngoài tầm nhìn ⇒ `null` — không phân biệt "không có"
 *     với "không được xem" (không lộ tồn tại). `LeadAttribution` không có cột cơ sở: cách ly CHỈ đến từ Lead.
 *  2. Quyền đổi nguồn hỏi qua `quyenDoiNguon` (doi-nguon.ts) — CÙNG hàm mà cổng server `quyetDinhDoiNguon` gọi. Nút "Đổi nguồn"
 *     vẽ từ kết quả này; vẽ bằng một điều kiện khác là lời hứa suông (luật 12).
 *  3. Người giới thiệu hiện bằng TÊN + mã, không SĐT/email. Tên phụ huynh che theo `canViewPii`.
 *
 * ⚠️ KHÔNG có cổng `sources:view` ở đây: nơi gọi gác trước (xem `docNguonLead` — cùng lời dặn của rà soát 08/10).
 */
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { passesScope, scopedDb } from "@/lib/db-scope";
import { WHERE_THUC_THU } from "@/lib/finance/thuc-thu";
import { maskPersonName } from "@/lib/lead/pii";
import { locNhomChon, type LoaiNguoi, type NhomChon } from "./chon-nguon";
import { conTrongCuaSoGhiCong, cuaSoHieuLuc, hanCuaSoGhiCong } from "./cua-so-ghi-cong";
import { lyDoCuaDong, type LyDoHangCho } from "./doc-hang-cho";
import { quyenDoiNguon, type QuyenDoiNguon } from "./doi-nguon";
import type { KiemQuyen } from "./doi-nguon-lead";
import { nguonHieuLucChoEngine } from "./nguon-chup";
import { quyetDinhNutBoSungSale, type NutBoSungSale } from "./bo-sung-sale";

export type NguoiHienThi = { loai: LoaiNguoi; ten: string; ma: string | null; moTa: string | null };

export type NguonHienTai = {
  groupId: string;
  groupCode: string;
  groupName: string;
  /** Giải trình nhóm "Khác"; null nếu không có. */
  giaiTrinh: string | null;
  nguoi: NguoiHienThi | null;
  thieuNguoi: boolean;
  /** Nguồn do Page mapping tự xác định và khoá (`signals.khoaNguon`). */
  khoa: boolean;
  canhBao: string[];
  /** Mã `signals.xemTay[]` — lý do cần người xem. */
  xemTay: string[];
  /** Vấn đề tính theo đúng điều kiện của hàng chờ (`lyDoCuaDong`). */
  vanDe: LyDoHangCho[];
  cachXacDinh: string;
  luat: string;
  /** ISO. */
  ngayGhiCong: string;
  /** ISO — hết ngày cuối của cửa sổ ghi công. */
  hanGhiCong: string;
  /** Hôm nay (`now` truyền vào) còn trong cửa sổ ghi công không. Quá hạn ⇒ GIỮ nguồn, không sinh hoa hồng thu hút. */
  conHanGhiCong: boolean;
  nhanGoc: string | null;
  /** ISO — khoá lạc quan: gửi lại khi bấm Lưu, nguồn đổi trong lúc đang xem thì máy chủ báo "vừa được thay đổi". */
  capNhatLuc: string;
};

export type ChoGanNguon = {
  leadId: string;
  /** Đã che theo `canViewPii`. */
  tenLead: string;
  coSo: { code: string | null; name: string } | null;
  /** `Lead.source` — đường vào cũ, chỉ để tham khảo. */
  duongVao: string | null;
  /** null ⇒ lead chưa có quy nguồn (tạo trước khi bật cờ, chờ di trú): chưa gán được. */
  nguon: NguonHienTai | null;
  danhMuc: NhomChon[];
  quyen: QuyenDoiNguon;
  /**
   * Nút «Bổ sung Sale phụ trách phụ huynh» — vẽ hay không, và nếu không thì nói gì. MỘT quyết định (`quyetDinhNutBoSungSale`) cho khối trên lead; ghép từ `quyen` ở trên
   * (cùng `quyenDoiNguon` với cổng máy chủ). `KHONG_CAN` khi lead chưa có quy nguồn.
   */
  boSungSale: NutBoSungSale;
  /** Khoản thu đã kế toán xác nhận trên các đơn của lead; null ⇒ chưa có khoản nào. */
  thucThu: { soKhoan: number; tong: number } | null;
};

type Obj = Record<string, unknown>;
const laObj = (v: unknown): Obj => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : {});
const chuoi = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

export async function docChoGanNguon(p: {
  actor: Actor;
  leadId: string;
  /** Đường thật: `(a, t) => checkPermission(a, t)`. */
  kiemQuyen: KiemQuyen;
  /** Có `leads:view-pii` không — BẮT BUỘC, không mặc định (luật 7). */
  canViewPii: boolean;
  /** Số ngày cửa sổ ghi công MẶC ĐỊNH (`nguon.cuaSoGhiCongNgay`) — truyền vào, hàm không đọc setting; nguồn có cửa sổ riêng thì dùng cửa sổ riêng. */
  cuaSoNgay: number;
  /** Đồng hồ — BẮT BUỘC truyền (luật 19): hàm không đọc `new Date()`. */
  now: Date;
}): Promise<ChoGanNguon | null> {
  // 1. CƠ SỞ — lead qua scopedDb + passesScope, TRƯỚC mọi thứ.
  const l = await scopedDb(p.actor).lead.findUnique({
    where: { id: p.leadId },
    select: {
      id: true,
      parentName: true,
      source: true,
      centerId: true,
      orgUnitId: true,
      deletedAt: true,
      center: { select: { code: true, name: true } },
      attribution: {
        select: {
          groupId: true,
          otherSourceNote: true,
          referrerKind: true,
          referrerEmployeeId: true,
          referrerParentUserId: true,
          referrerStudentId: true,
          referrerAffiliateId: true,
          referrerMissing: true,
          referrerSaleUserId: true,
          identificationMethod: true,
          matchedRule: true,
          canhBao: true,
          signals: true,
          attributedAt: true,
          updatedAt: true,
          group: { select: { code: true, name: true, requiresNote: true, attributionWindowDays: true, status: true, selectable: true, effectiveFrom: true, effectiveTo: true } },
        },
      },
    },
  });
  if (!l || l.deletedAt !== null || !passesScope("Lead", l, p.actor)) return null;

  const a = l.attribution;
  const target = { centerId: l.centerId, orgUnitId: l.orgUnitId };
  const s = laObj(a?.signals);

  // 2. Quyền + thực thu + danh mục + tên người giới thiệu — các câu KHÔNG cần nhau chạy cùng lượt.
  const [overwrite, overrideSauThanhToan, quanLyNguon, xemTien, thu, nhomRows, nguoi] = await Promise.all([
    p.kiemQuyen("leads:overwrite", target),
    p.kiemQuyen("sources:override-after-payment", target),
    p.kiemQuyen("sources:manage", target),
    p.kiemQuyen("payments:view", target),
    db.payment.aggregate({
      where: { ...WHERE_THUC_THU, order: { leadId: l.id, deletedAt: null } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.leadSourceGroup.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        referrerRequirement: true,
        requiresNote: true,
        selectable: true,
        status: true,
        sortOrder: true,
        effectiveFrom: true,
        effectiveTo: true,
      },
    }),
    a ? docNguoiGioiThieu(a, p.canViewPii) : Promise.resolve(null),
  ]);

  const soKhoan = thu._count._all;
  const thucThu = soKhoan > 0 ? { soKhoan, tong: thu._sum.amount ?? 0 } : null;
  const khoa = s.khoaNguon === true;
  const quyen = quyenDoiNguon({
    daCoThucThu: thucThu !== null,
    nguonDangKhoa: khoa,
    quyen: { overwrite, overrideSauThanhToan, quanLyNguon },
  });

  const cuaSoRiengNgay = a ? nguonHieuLucChoEngine(a.signals, { cuaSoRiengNgay: a.group.attributionWindowDays, chuNhanVienId: null }).cuaSoRiengNgay : null;
  const xemTay = Array.isArray(s.xemTay) ? s.xemTay.filter((x): x is string => typeof x === "string") : [];
  const nguon: NguonHienTai | null = a
    ? {
        groupId: a.groupId,
        groupCode: a.group.code,
        groupName: a.group.name,
        giaiTrinh: chuoi(a.otherSourceNote),
        nguoi,
        thieuNguoi: a.referrerMissing,
        khoa,
        canhBao: a.canhBao,
        xemTay,
        vanDe: lyDoCuaDong({
          referrerMissing: a.referrerMissing,
          otherSourceNote: a.otherSourceNote,
          canhBao: a.canhBao,
          group: { code: a.group.code, requiresNote: a.group.requiresNote },
        }),
        cachXacDinh: a.identificationMethod,
        luat: a.matchedRule,
        ngayGhiCong: a.attributedAt.toISOString(),
        // Cửa sổ HIỆU LỰC (bản chụp lúc ghi ?? nguồn sống ?? setting) — CÙNG hàm với engine (`nguonHieuLucChoEngine`), để màn hình không nói "còn hạn" khi engine đã coi là ngoài cửa sổ.
        hanGhiCong: hanCuaSoGhiCong(a.attributedAt, cuaSoHieuLuc(cuaSoRiengNgay, p.cuaSoNgay)).toISOString(),
        conHanGhiCong: conTrongCuaSoGhiCong(a.attributedAt, p.now, cuaSoHieuLuc(cuaSoRiengNgay, p.cuaSoNgay)),
        nhanGoc: chuoi(s.nhanGoc),
        capNhatLuc: a.updatedAt.toISOString(),
      }
    : null;

  return {
    leadId: l.id,
    tenLead: p.canViewPii ? (l.parentName ?? "") : maskPersonName(l.parentName),
    coSo: l.center ? { code: l.center.code, name: l.center.name } : null,
    duongVao: l.source,
    nguon,
    danhMuc: locNhomChon(nhomRows, p.now),
    quyen,
    boSungSale: a
      ? quyetDinhNutBoSungSale({
          referrerKind: a.referrerKind,
          coPhuHuynhHoacBe: a.referrerParentUserId !== null || a.referrerStudentId !== null,
          referrerSaleUserId: a.referrerSaleUserId,
          nguon: a.group,
          quyen,
          coQuyenQuanLyNguon: quanLyNguon,
          now: p.now,
        })
      : { kieu: "KHONG_CAN" },
    // Tổng tiền đã thu CHỈ cho người đổi được nguồn (cảnh báo hệ quả của lượt đổi) HOẶC người được xem tiền (`payments:view`).
    // Người chỉ có `sources:view` (vd Marketing HO) không nhận số tiền của lead qua action này — Sheet chỉ vẽ dòng cảnh báo khi đổi được,
    // nhưng dữ liệu đã nằm sẵn trong payload gửi xuống trình duyệt.
    thucThu: quyen.ok || xemTien ? thucThu : null,
  };
}

type CotNguoi = {
  referrerKind: "EMPLOYEE" | "PARENT" | "AFFILIATE" | null;
  referrerEmployeeId: string | null;
  referrerParentUserId: string | null;
  referrerStudentId: string | null;
  referrerAffiliateId: string | null;
};

/** Tên người giới thiệu hiện tại. Chỉ tên + mã; KHÔNG SĐT/email. Tra `db` không scope (người có thể ở cơ sở khác). */
async function docNguoiGioiThieu(a: CotNguoi, canViewPii: boolean): Promise<NguoiHienThi | null> {
  if (a.referrerKind === "EMPLOYEE" && a.referrerEmployeeId) {
    const e = await db.employee.findUnique({
      where: { id: a.referrerEmployeeId },
      select: { fullName: true, employeeCode: true, status: true },
    });
    if (!e) return { loai: "NHAN_SU", ten: "(nhân sự không còn trong hệ thống)", ma: null, moTa: null };
    const nghi = e.status !== "ACTIVE" && e.status !== "ON_LEAVE";
    return { loai: "NHAN_SU", ten: e.fullName, ma: e.employeeCode, moTa: nghi ? "đã nghỉ việc" : null };
  }
  if (a.referrerKind === "PARENT") {
    const [u, st] = await Promise.all([
      a.referrerParentUserId
        ? db.user.findUnique({ where: { id: a.referrerParentUserId }, select: { name: true } })
        : Promise.resolve(null),
      a.referrerStudentId
        ? db.student.findUnique({ where: { id: a.referrerStudentId }, select: { name: true, studentCode: true, parentName: true } })
        : Promise.resolve(null),
    ]);
    const goc = u?.name ?? st?.parentName ?? null;
    const ten = goc ? (canViewPii ? goc : maskPersonName(goc)) : "Phụ huynh";
    return {
      loai: "PHU_HUYNH",
      ten,
      ma: st?.studentCode ?? null,
      moTa: st ? `phụ huynh của bé ${st.name}` : null,
    };
  }
  if (a.referrerKind === "AFFILIATE" && a.referrerAffiliateId) {
    const af = await db.affiliate.findUnique({ where: { id: a.referrerAffiliateId }, select: { name: true, code: true } });
    return { loai: "DOI_TAC", ten: af?.name ?? "(đối tác không còn trong hệ thống)", ma: af?.code ?? null, moTa: null };
  }
  return null;
}
