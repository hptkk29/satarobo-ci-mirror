/**
 * lib/nguon/thu-thap-tin-hieu.ts — TẦNG ĐỌC của resolver: gom mọi tín hiệu thành `TinHieuQuyNguon` (03 §2.2, §2.2a, §2.2b).
 *
 * ── Tra bằng `db` KHÔNG scope, ghi bằng `tx` (T11) ──────────────────────────────────────────────────────────
 * Hai đường nhập Excel chạy trong `sdb.$transaction` — client ĐÃ BỌC phạm vi cơ sở. Tra kế thừa theo SĐT / SĐT nhân viên /
 * người giới thiệu qua client đó là BỎ SÓT IM LẶNG dữ liệu của cơ sở khác (kết quả rỗng vẫn là kết quả hợp lệ). Nên tham số
 * `dbKhongScope` có kiểu `typeof db` (không phải `Prisma.TransactionClient`), BẮT BUỘC, không mặc định (luật 7) — lưới
 * `[QN-W7]` canh cả chữ ký lẫn chỗ gọi. Kết quả tra KHÔNG trả ra giao diện: chỉ chui vào `TinHieuQuyNguon`.
 *
 * ── Số câu tra CỐ ĐỊNH theo LÔ (T12) ───────────────────────────────────────────────────────────────────────
 * Không N+1: đường Excel ghi cả lượt trong MỘT transaction 180 giây từng chết ở 60 giây. Mọi phép tra nhận MẢNG khoá
 * của cả lô → một `findMany`. Trần ghim bởi ca `[NHH-SRC-07e-perf]`.
 */
import type { db } from "@/lib/db";
import { normalizeAffiliateCode } from "@/lib/affiliate";
import { canonicalPhone, phoneKey, phoneVariants } from "@/lib/phone";
import { layBangNguonTheoPage, layCoNguonHieuLuc, layCuaSoGhiCongNgay, layNhomNhanSuMacDinh } from "./feature";
import { docNguonChup } from "./nguon-chup";
import { VAI_SANG_NGUON_MAC_DINH, type MaVaiNguon } from "./danh-muc-goc";
import { chonSaleCuaPhuHuynh, type HocVienCuaPhuHuynh } from "./sale-cua-phu-huynh";
import { chuanHoaMaNhanVien } from "./ma-nhan-vien";
import { giaiNguonChon, type NhomTraCuu } from "./giai-nguon-chon";
import { trongKhoangHieuLuc } from "./hieu-luc-nguon";
import { chonGocKeThua, dungCauHinhQuyNguon } from "./quy-nguon";
import {
  ANH_CHUP_TRONG,
  type AnhChupNguon,
  type CauHinhQuyNguon,
  type KeThuaGoc,
  type NguoiGioiThieu,
  type NguoiNhapDaGiai,
  type NguonChonDaGiai,
  type NguonChonDauVao,
  type QuangCaoTin,
  type TinHieuQuyNguon,
  type UtmTin,
} from "./tin-hieu";

type BangNguonTheoPage = Awaited<ReturnType<typeof layBangNguonTheoPage>>;

/** Client KHÔNG scope — xem đầu tệp. */
export type DbKhongScope = typeof db;

/** Đầu vào thô của MỘT lần nhập. Mọi trường BẮT BUỘC khai (luật 7): thiếu là `tsc` liệt kê chỗ gọi. */
export type DauVaoTinHieu = {
  bayGio: Date;
  duongVao: string;
  conversionEntry: string | null;
  /** Nhãn nguồn do người nhập/file khai (hoặc nhãn máy của đường vào). null = không khai. */
  nhanKhai: string | null;
  laNhapExcel: boolean;
  /** SĐT khách (thô hoặc canonical); null/"" = chưa có. */
  sdtKhach: string | null;
  /** Mã NV của NGƯỜI NHẬP trên phiếu (chưa chuẩn hoá). */
  maNvNguoiNhap: string | null;
  /** `User.id` của người nhập khi có phiên đăng nhập. */
  nguoiNhapUserId: string | null;
  /** Nhân sự do người nhập CHỌN làm người giới thiệu (picker). */
  nhanSuGioiThieuEmployeeId: string | null;
  phuHuynhGioiThieu: { parentUserId: string | null; studentId: string | null } | null;
  /**
   * Lựa chọn tường minh ở ô chọn nguồn (PR7). TUỲ CHỌN có chủ đích (trái nếp "mọi trường bắt buộc" của tệp này): vắng mặt = không có ô
   * chọn = hành vi cũ, KHÔNG nguy hiểm — khác `nhanSuGioiThieuEmployeeId`, quên khai không làm mất nguồn hay mở quyền. Làm nó bắt buộc
   * là sửa thêm ~10 chỗ gọi của đường Excel/webhook mà không đường nào có ô chọn.
   */
  nguonChon?: NguonChonDauVao | null;
  ref: string | null;
  refSau: readonly string[];
  quangCao: QuangCaoTin;
  utm: UtmTin;
  pageId: string | null;
};

export type TinHieuDaThuThap = {
  cauHinh: CauHinhQuyNguon;
  /** code → id của `LeadSourceGroup` (để tầng ghi đổi mã sang id). */
  nhomId: ReadonlyMap<string, string>;
  /** Cùng thứ tự với đầu vào. */
  tin: TinHieuQuyNguon[];
};

const duoc = (v: string | null | undefined): v is string => typeof v === "string" && v.trim() !== "";

export function vaiTaiThoiDiem(
  rows: readonly { effectiveFrom: Date; effectiveTo: Date | null; role: { code: string } }[],
  luc: Date,
): string[] {
  const t = luc.getTime();
  return [
    ...new Set(
      rows
        .filter((r) => r.effectiveFrom.getTime() <= t && (r.effectiveTo === null || t < r.effectiveTo.getTime()))
        .map((r) => r.role.code),
    ),
  ];
}

/**
 * Gom tín hiệu cho CẢ LÔ — số câu tra không phụ thuộc số dòng.
 * Mọi lệnh đọc đi `dbKhongScope`; hàm KHÔNG ghi gì.
 */
export async function thuThapTinHieuTheoLo(
  dbKhongScope: DbKhongScope,
  rows: readonly DauVaoTinHieu[],
): Promise<TinHieuDaThuThap> {
  const [co, bangPage, nhomRows, nhomNhanSu, cuaSoMacDinhNgay] = await Promise.all([
    layCoNguonHieuLuc(),
    rows.some((r) => duoc(r.pageId)) ? layBangNguonTheoPage() : Promise.resolve<BangNguonTheoPage>({}),
    dbKhongScope.leadSourceGroup.findMany({
      select: { id: true, code: true, status: true, requiresNote: true, selectable: true, referrerRequirement: true, effectiveFrom: true, effectiveTo: true, attributionWindowDays: true, ownerEmployeeId: true },
    }),
    layNhomNhanSuMacDinh(),
    // Cửa sổ ghi công CHUNG lúc ghi: chụp con số HIỆU LỰC vào `signals.nguon` khi nguồn không có cửa sổ riêng (xem `nguon-chup.ts`).
    layCuaSoGhiCongNgay(),
  ]);
  // Nguồn NGOÀI khoảng hiệu lực không chọn được cho lead MỚI (SPEC §1.1): đo tại thời điểm của lô = `bayGio` MUỘN NHẤT trong lô (lead sống: chính là
  // lúc nhập; lô di trú: mốc của dòng cuối). Một mốc cho cả lô vì `cauHinh` dựng MỘT lần — số câu tra cố định theo lô (T12).
  const mocLo = rows.reduce((m, r) => (r.bayGio.getTime() > m.getTime() ? r.bayGio : m), new Date(0));
  const cauHinh = dungCauHinhQuyNguon({
    nhom: nhomRows.map((g) => ({
      code: g.code,
      active: g.status === "ACTIVE" && trongKhoangHieuLuc(g, mocLo),
      requiresNote: g.requiresNote,
      selectable: g.selectable,
      referrerRequirement: g.referrerRequirement,
      cuaSoRiengNgay: g.attributionWindowDays,
      chuNhanVienId: g.ownerEmployeeId,
    })),
    co,
    vaiSangNguon: VAI_SANG_NGUON_MAC_DINH,
    nhomNhanSu,
    cuaSoMacDinhNgay,
  });
  const nhomId = new Map(nhomRows.map((g) => [g.code, g.id]));

  // ── Tập khoá của cả lô ──
  const bienThe = [...new Set(rows.flatMap((r) => (duoc(r.sdtKhach) ? phoneVariants(r.sdtKhach) : [])))];
  const maNv = new Map<string, string[]>(); // mã thô → các dạng để tra
  for (const r of rows) {
    if (duoc(r.maNvNguoiNhap)) maNv.set(r.maNvNguoiNhap, [r.maNvNguoiNhap.trim(), chuanHoaMaNhanVien(r.maNvNguoiNhap)]);
  }
  const userIds = [...new Set(rows.map((r) => r.nguoiNhapUserId).filter(duoc))];
  const empIdChon = [...new Set(rows.flatMap((r) => [r.nhanSuGioiThieuEmployeeId, r.nguonChon?.employeeId]).filter(duoc))];
  // Lựa chọn từ ô chọn nguồn: ba loại người cần kiểm TỒN TẠI trước khi ghi (FK Restrict). Chỉ tra khi có dòng mang lựa chọn ⇒ đường
  // không có ô chọn không tốn thêm câu nào ([NHH-SRC-07e-perf]).
  const chonRows = rows.filter((r): r is typeof r & { nguonChon: NguonChonDauVao } => !!r.nguonChon);
  const idHocVienChon = [...new Set(chonRows.map((r) => r.nguonChon.studentId).filter(duoc))];
  const idPhuHuynhChon = [...new Set(chonRows.map((r) => r.nguonChon.parentUserId).filter(duoc))];
  const idDoiTacChon = [...new Set(chonRows.map((r) => r.nguonChon.affiliateId).filter(duoc))];
  const maAff = [...new Set(rows.map((r) => normalizeAffiliateCode(r.ref)).filter((c): c is string => c !== null))];
  const pageIds = [...new Set(rows.map((r) => r.pageId).filter(duoc))];
  const coSdt = bienThe.length > 0;

  // ── Các lượt tra — mỗi lượt MỘT câu cho cả lô ──
  const [leadCungSdt, nvSdt, userNvSdt, nvTheoMa, userRows, empChon, aff, pageMaster, hocVienChon, phuHuynhChon, doiTacChon] = await Promise.all([
    coSdt
      ? dbKhongScope.lead.findMany({
          where: { phone: { in: bienThe }, deletedAt: null },
          select: {
            id: true,
            phone: true,
            attribution: {
              select: {
                attributedAt: true,
                inheritedFromLeadId: true,
                referrerKind: true,
                referrerEmployeeId: true,
                referrerParentUserId: true,
                referrerStudentId: true,
                referrerAffiliateId: true,
                referrerMissing: true,
                otherSourceNote: true,
                referrerRoleCode: true,
                referrerSaleUserId: true,
                signals: true,
                group: { select: { code: true } },
                originalGroup: { select: { code: true } },
              },
            },
          },
        })
      : Promise.resolve([]),
    coSdt ? dbKhongScope.employee.findMany({ where: { phone: { not: null } }, select: { phone: true } }) : Promise.resolve([]),
    coSdt
      ? dbKhongScope.user.findMany({ where: { employeeId: { not: null }, phone: { not: null } }, select: { phone: true } })
      : Promise.resolve([]),
    maNv.size > 0
      ? dbKhongScope.employee.findMany({
          where: { employeeCode: { in: [...new Set([...maNv.values()].flat())] } },
          select: { id: true, employeeCode: true, orgUnitId: true, status: true, userAccount: { select: { id: true } } },
        })
      : Promise.resolve([]),
    userIds.length > 0
      ? dbKhongScope.user.findMany({ where: { id: { in: userIds } }, select: { id: true, employeeId: true } })
      : Promise.resolve([]),
    empIdChon.length > 0
      ? dbKhongScope.employee.findMany({
          where: { id: { in: empIdChon } },
          select: { id: true, employeeCode: true, orgUnitId: true, status: true, phone: true, userAccount: { select: { id: true } } },
        })
      : Promise.resolve([]),
    maAff.length > 0
      ? dbKhongScope.affiliate.findMany({ where: { code: { in: maAff }, isActive: true }, select: { id: true, code: true } })
      : Promise.resolve([]),
    pageIds.length > 0
      ? dbKhongScope.facebookPageMapping.findMany({ where: { pageId: { in: pageIds }, isActive: true }, select: { pageId: true } })
      : Promise.resolve([]),
    idHocVienChon.length > 0
      ? dbKhongScope.student.findMany({ where: { id: { in: idHocVienChon }, deletedAt: null }, select: { id: true } })
      : Promise.resolve([]),
    idPhuHuynhChon.length > 0
      ? dbKhongScope.user.findMany({ where: { id: { in: idPhuHuynhChon }, deletedAt: null }, select: { id: true } })
      : Promise.resolve([]),
    idDoiTacChon.length > 0
      ? dbKhongScope.affiliate.findMany({ where: { id: { in: idDoiTacChon }, isActive: true }, select: { id: true } })
      : Promise.resolve([]),
  ]);

  // Vai: gom userId của mọi người cần suy nhóm → MỘT câu.
  const empIdTuUser = [...new Set(userRows.map((u) => u.employeeId).filter(duoc))];
  const empTuUser = empIdTuUser.length > 0
    ? await dbKhongScope.employee.findMany({
        where: { id: { in: empIdTuUser } },
        select: { id: true, employeeCode: true, orgUnitId: true, userAccount: { select: { id: true } } },
      })
    : [];
  const thongTinNv = new Map<string, { employeeCode: string | null; orgUnitId: string | null }>(
    [...nvTheoMa, ...empChon, ...empTuUser].map((e) => [e.id, { employeeCode: e.employeeCode, orgUnitId: e.orgUnitId }] as const),
  );
  const userIdCuaEmp = new Map<string, string | null>([
    ...nvTheoMa.map((e) => [e.id, e.userAccount?.id ?? null] as const),
    ...empChon.map((e) => [e.id, e.userAccount?.id ?? null] as const),
    ...empTuUser.map((e) => [e.id, e.userAccount?.id ?? null] as const),
  ]);
  const userIdVai = [...new Set([...userIdCuaEmp.values(), ...userRows.map((u) => u.id)].filter(duoc))];
  const vaiRows = userIdVai.length > 0
    ? await dbKhongScope.userOrgRole.findMany({
        where: { userId: { in: userIdVai }, status: "ACTIVE" },
        select: { userId: true, effectiveFrom: true, effectiveTo: true, role: { select: { code: true } } },
      })
    : [];
  const vaiTheoUser = new Map<string, typeof vaiRows>();
  for (const v of vaiRows) vaiTheoUser.set(v.userId, [...(vaiTheoUser.get(v.userId) ?? []), v]);

  // ── Chỉ mục ──
  const sdtNhanVien = new Set<string>();
  for (const p of [...nvSdt.map((e) => e.phone), ...userNvSdt.map((u) => u.phone)]) {
    const c = canonicalPhone(p);
    if (c !== null) sdtNhanVien.add(c);
  }
  const leadTheoSdt = new Map<string, typeof leadCungSdt>();
  for (const l of leadCungSdt) {
    const k = phoneKey(l.phone);
    leadTheoSdt.set(k, [...(leadTheoSdt.get(k) ?? []), l]);
  }
  const empTheoMa = new Map(nvTheoMa.map((e) => [e.employeeCode, e]));
  const empTheoId = new Map(empChon.map((e) => [e.id, e]));
  const userTheoId = new Map(userRows.map((u) => [u.id, u]));
  const affTheoMa = new Map(aff.map((a) => [a.code, a]));
  const pageCo = new Set(pageMaster.map((p) => p.pageId));
  const hocVienCoSet = new Set(hocVienChon.map((x) => x.id));
  const phuHuynhCoSet = new Set(phuHuynhChon.map((x) => x.id));
  const doiTacCoSet = new Set(doiTacChon.map((x) => x.id));
  const nhomTraCuu: NhomTraCuu[] = nhomRows.map((g) => ({
    id: g.id,
    code: g.code,
    active: g.status === "ACTIVE" && trongKhoangHieuLuc(g, mocLo),
    requiresNote: g.requiresNote,
    selectable: g.selectable,
    referrerRequirement: g.referrerRequirement,
    cuaSoRiengNgay: g.attributionWindowDays,
    chuNhanVienId: g.ownerEmployeeId,
  }));
  const nhomTheoId = new Map(nhomTraCuu.map((g) => [g.id, g]));

  const giaiNguoi = (empId: string, userId: string | null, luc: Date): NguoiNhapDaGiai => ({
    employeeId: empId,
    employeeCode: thongTinNv.get(empId)?.employeeCode ?? null,
    orgUnitId: thongTinNv.get(empId)?.orgUnitId ?? null,
    roleCodes: userId ? vaiTaiThoiDiem(vaiTheoUser.get(userId) ?? [], luc) : [],
    vaiTuHienTai: false,
  });

  // ── Sale phụ trách của PHỤ HUYNH giới thiệu (ảnh chụp `referrerSaleUserId`) ──
  // Chỉ tra khi có dòng mang PH giới thiệu (picker hoặc ô chọn nguồn) ⇒ đường không có PH không tốn thêm câu nào ([NHH-SRC-07e-perf]).
  // MỘT câu cho cả lô; thêm MỘT câu nữa chỉ khi học viên được chọn có phụ huynh mà anh/chị/em của bé chưa được nạp.
  const phCuaDong = rows.map((r) => {
    const ph = r.phuHuynhGioiThieu ?? (r.nguonChon && (duoc(r.nguonChon.studentId) || duoc(r.nguonChon.parentUserId)) ? r.nguonChon : null);
    return ph ? { studentId: duoc(ph.studentId) ? ph.studentId : null, parentUserId: duoc(ph.parentUserId) ? ph.parentUserId : null } : null;
  });
  const idHvPh = [...new Set(phCuaDong.flatMap((p) => (p?.studentId ? [p.studentId] : [])))];
  const idPhPh = [...new Set(phCuaDong.flatMap((p) => (p?.parentUserId ? [p.parentUserId] : [])))];
  const chonHocVienPh = {
    id: true,
    parentUserId: true,
    lead: { select: { id: true, convertedById: true, assignedToId: true, convertedAt: true, createdAt: true, deletedAt: true } },
  } as const;
  const hocVienPh: HocVienCuaPhuHuynh[] =
    idHvPh.length + idPhPh.length > 0
      ? await dbKhongScope.student.findMany({
          where: { deletedAt: null, OR: [...(idHvPh.length > 0 ? [{ id: { in: idHvPh } }] : []), ...(idPhPh.length > 0 ? [{ parentUserId: { in: idPhPh } }] : [])] },
          select: chonHocVienPh,
        })
      : [];
  const phThem = [
    ...new Set(
      phCuaDong.flatMap((p) => {
        if (!p?.studentId || p.parentUserId) return [];
        const pu = hocVienPh.find((h) => h.id === p.studentId)?.parentUserId ?? null;
        return pu && !idPhPh.includes(pu) ? [pu] : [];
      }),
    ),
  ];
  if (phThem.length > 0) {
    hocVienPh.push(...(await dbKhongScope.student.findMany({ where: { deletedAt: null, parentUserId: { in: phThem } }, select: chonHocVienPh })));
  }

  const tin: TinHieuQuyNguon[] = rows.map((r, chiSo) => {
    const ph = phCuaDong[chiSo]!;
    const saleCuaPhuHuynh = ph ? chonSaleCuaPhuHuynh({ studentId: ph.studentId, parentUserId: ph.parentUserId, hocVien: hocVienPh, bayGio: r.bayGio }) : null;
    // 1. Kế thừa — bản gốc nhất của MỌI lead cùng SĐT đã có attribution.
    let keThua: KeThuaGoc | null = null;
    const khach = duoc(r.sdtKhach) ? canonicalPhone(r.sdtKhach) : null;
    if (duoc(r.sdtKhach)) {
      const ds = (leadTheoSdt.get(phoneKey(r.sdtKhach)) ?? [])
        .filter((l) => l.attribution !== null)
        .map((l) => ({ leadId: l.id, attributedAt: l.attribution!.attributedAt, inheritedFromLeadId: l.attribution!.inheritedFromLeadId, a: l.attribution! }));
      const goc = chonGocKeThua(ds);
      if (goc) {
        const a = goc.a;
        const nguoi: NguoiGioiThieu | null =
          a.referrerKind === "EMPLOYEE" && a.referrerEmployeeId
            ? { kind: "EMPLOYEE", employeeId: a.referrerEmployeeId }
            : a.referrerKind === "PARENT"
              ? { kind: "PARENT", parentUserId: a.referrerParentUserId, studentId: a.referrerStudentId }
              : a.referrerKind === "AFFILIATE" && a.referrerAffiliateId
                ? { kind: "AFFILIATE", affiliateId: a.referrerAffiliateId }
                : null;
        keThua = {
          leadId: goc.leadId,
          attributedAt: a.attributedAt,
          groupCode: a.group.code,
          originalGroupCode: a.originalGroup.code,
          nguoi,
          referrerMissing: a.referrerMissing,
          otherSourceNote: a.otherSourceNote,
          anhChup: docAnhChup(a),
        };
      }
    }

    // 2. Người nhập (gõ máy): ưu tiên phiên đăng nhập, rồi mã NV trên phiếu (chỉ nhân viên ACTIVE/ON_LEAVE khi đi bằng MÃ).
    let nguoiNhap: NguoiNhapDaGiai | null = null;
    let maNvKhongGiai: string | null = null;
    if (duoc(r.nguoiNhapUserId)) {
      const u = userTheoId.get(r.nguoiNhapUserId);
      if (u?.employeeId) nguoiNhap = giaiNguoi(u.employeeId, r.nguoiNhapUserId, r.bayGio);
    }
    if (nguoiNhap === null && duoc(r.maNvNguoiNhap)) {
      const dang = maNv.get(r.maNvNguoiNhap) ?? [];
      const e = dang.map((m) => empTheoMa.get(m)).find((x) => x !== undefined);
      if (e && (e.status === "ACTIVE" || e.status === "ON_LEAVE")) {
        nguoiNhap = giaiNguoi(e.id, e.userAccount?.id ?? null, r.bayGio);
      } else {
        maNvKhongGiai = chuanHoaMaNhanVien(r.maNvNguoiNhap);
      }
    }

    // 3. Nhân sự người nhập CHỌN làm người giới thiệu (picker) — chỉ ACTIVE/ON_LEAVE được claim MỚI (D13).
    let nhanSuGioiThieu: NguoiNhapDaGiai | null = null;
    let sdtNguoiGt: string | null = null;
    if (duoc(r.nhanSuGioiThieuEmployeeId)) {
      const e = empTheoId.get(r.nhanSuGioiThieuEmployeeId);
      if (e && (e.status === "ACTIVE" || e.status === "ON_LEAVE")) {
        nhanSuGioiThieu = giaiNguoi(e.id, e.userAccount?.id ?? null, r.bayGio);
        sdtNguoiGt = e.phone;
      }
    }

    // 3b. Lựa chọn tường minh ở ô chọn nguồn (PR7): giải nhóm GHI + kiểm người/giải trình/tồn tại (hàm thuần `giaiNguonChon`).
    let nguonChon: NguonChonDaGiai | null = null;
    if (r.nguonChon) {
      const ns = r.nguonChon.employeeId ? empTheoId.get(r.nguonChon.employeeId) : undefined;
      nguonChon = giaiNguonChon({
        chon: r.nguonChon,
        nhomTheoId,
        vaiSangNguon: VAI_SANG_NGUON_MAC_DINH,
        tra: {
          nhanSu: ns
            ? { status: ns.status, ...(({ roleCodes, employeeCode, orgUnitId }) => ({ roleCodes, employeeCode: employeeCode ?? null, orgUnitId: orgUnitId ?? null }))(giaiNguoi(ns.id, ns.userAccount?.id ?? null, r.bayGio)) }
            : null,
          hocVienCo: r.nguonChon.studentId ? hocVienCoSet.has(r.nguonChon.studentId) : false,
          phuHuynhCo: r.nguonChon.parentUserId ? phuHuynhCoSet.has(r.nguonChon.parentUserId) : false,
          doiTacCo: r.nguonChon.affiliateId ? doiTacCoSet.has(r.nguonChon.affiliateId) : false,
          saleCuaPhuHuynh,
        },
      });
      // Cảnh báo "SĐT người giới thiệu trùng SĐT khách" cũng áp cho người chọn ở ô chọn nguồn (03 §4).
      if (ns && sdtNguoiGt === null) sdtNguoiGt = ns.phone;
    }

    // 4. Mã giới thiệu.
    const maRef = normalizeAffiliateCode(r.ref);
    const a = maRef !== null ? affTheoMa.get(maRef) : undefined;
    const ref = duoc(r.ref)
      ? { code: maRef ?? r.ref.trim(), hopLe: a !== undefined, affiliateId: a?.id ?? null }
      : null;

    // 5. Page.
    const page = duoc(r.pageId)
      ? (() => {
          const d = Object.prototype.hasOwnProperty.call(bangPage, r.pageId) ? bangPage[r.pageId] : undefined;
          return {
            pageId: r.pageId,
            trongDanhMuc: pageCo.has(r.pageId),
            dich: d ? { groupCode: d.groupCode, campaignCode: d.campaignCode ?? null } : null,
          };
        })()
      : null;

    return {
      bayGio: r.bayGio,
      duongVao: r.duongVao,
      conversionEntry: r.conversionEntry,
      nhanKhai: duoc(r.nhanKhai) ? r.nhanKhai.trim() : null,
      laNhapExcel: r.laNhapExcel,
      nguoiNhap,
      maNvKhongGiai,
      nhanSuGioiThieu,
      phuHuynhGioiThieu: r.phuHuynhGioiThieu,
      saleCuaPhuHuynh,
      nguonChon,
      ref,
      refSau: r.refSau,
      quangCao: r.quangCao,
      utm: r.utm,
      page,
      keThua,
      sdtTrungNhanVien: khach !== null && sdtNhanVien.has(khach),
      sdtNguoiGioiThieuTrungKhach: khach !== null && canonicalPhone(sdtNguoiGt) === khach,
    };
  });

  return { cauHinh, nhomId, tin };
}

/** MỘT lần nhập = lô một phần tử của hàm trên (không viết hai bản tra). */
export async function thuThapTinHieu(
  dbKhongScope: DbKhongScope,
  dauVao: DauVaoTinHieu,
): Promise<{ cauHinh: CauHinhQuyNguon; nhomId: ReadonlyMap<string, string>; tin: TinHieuQuyNguon }> {
  const r = await thuThapTinHieuTheoLo(dbKhongScope, [dauVao]);
  return { cauHinh: r.cauHinh, nhomId: r.nhomId, tin: r.tin[0]! };
}

const MA_VAI: readonly MaVaiNguon[] = ["SALE", "MANAGER", "TEACHER", "OTHER_EMPLOYEE"];

/** Ảnh chụp ĐÃ GHI của một dòng quy nguồn (để KẾ THỪA nguyên văn). Cột/JSON lạ ⇒ phần đó null — không đoán. */
function docAnhChup(a: { referrerRoleCode: string | null; referrerSaleUserId: string | null; signals: unknown }): AnhChupNguon {
  const vai = MA_VAI.find((m) => m === a.referrerRoleCode) ?? null;
  const sig = typeof a.signals === "object" && a.signals !== null && !Array.isArray(a.signals) ? (a.signals as Record<string, unknown>) : {};
  const g = sig.nguoiGioiThieu;
  const dauVet =
    typeof g === "object" && g !== null && !Array.isArray(g)
      ? {
          employeeCode: typeof (g as Record<string, unknown>).employeeCode === "string" ? ((g as Record<string, unknown>).employeeCode as string) : null,
          roleCodes: Array.isArray((g as Record<string, unknown>).roleCodes) ? ((g as Record<string, unknown>).roleCodes as unknown[]).filter((x): x is string => typeof x === "string") : [],
          orgUnitId: typeof (g as Record<string, unknown>).orgUnitId === "string" ? ((g as Record<string, unknown>).orgUnitId as string) : null,
        }
      : null;
  // Bản chụp nguồn của hàng gốc: hợp lệ ⇒ kế thừa NGUYÊN VĂN; vắng/hỏng ⇒ null (hàng mới tính lại từ nhóm lúc này, `hoanTat`).
  const bc = docNguonChup(a.signals);
  const nguon = bc.trangThai === "HOP_LE" ? bc.nguon : null;
  if (vai === null && a.referrerSaleUserId === null && dauVet === null && nguon === null) return ANH_CHUP_TRONG;
  return { referrerRoleCode: vai, referrerSaleUserId: a.referrerSaleUserId, nguoiGioiThieu: dauVet, nguon };
}
