/**
 * lib/nguon/doc-chi-tiet-nguon.ts — ĐỌC cho trang chi tiết MỘT nguồn (SPEC nguồn động §4 mục 3/7): chính sách ÁP DỤNG THẬT, hoa hồng nguồn ↔ giao dịch khác,
 * lịch sử thao tác. CHỈ ĐỌC; đường ghi là `danh-muc-ghi.ts`.
 *
 * ── «Áp dụng thật» là câu trả lời của CHÍNH engine ──────────────────────────────────────────────────────────────
 * Không viết lại «cụ thể thắng chung» ở đây: mỗi ô là kết quả của `chonQuyTac` qua `dungMaTran` (cùng bộ chọn với lúc quét sổ). Nên cờ `commissionEnabled = false`
 * tự làm các rule phạm vi nguồn BIẾN MẤT khỏi bảng (engine bỏ qua chúng) — và ta liệt kê riêng những phiên bản đó kèm LÝ DO bị bỏ qua, để người đọc không tưởng
 * chính sách riêng đang chạy.
 *
 * ── Cách ly ────────────────────────────────────────────────────────────────────────────────────────────────────
 *  · Chính sách/phiên bản: `scopedDb(actor)` (chính sách của cơ sở khác không hiện ra);
 *  · TIỀN: đi qua `phamViNguoiXem` — MỘT phạm vi với sổ hoa hồng (người chỉ có `view-self` thấy phần CỦA MÌNH; QLCS thấy cơ sở mình; Hội sở thấy tất). Actor không có
 *    quyền xem hoa hồng ⇒ `null` (không phải 0: «không được xem» khác «chưa có»). Không bao giờ đọc thẳng bảng sổ không điều kiện.
 *  · Lịch sử: cấu hình nguồn là dữ liệu CHUNG, không PII/tiền ⇒ ai có `sources:view` cũng đọc (nơi gọi gác).
 *
 * `now` BẮT BUỘC (luật 19).
 *
 * ── Quyền nằm Ở ĐÂY, không ở nơi gọi (res3 LOW-11 · res4 MEDIUM-3, 09/10/2026) ───────────────────────────────────────────────
 * Ba hàm đọc cấu hình/chính sách/lịch sử của MỘT nguồn nhận `actor` và tự gác `sources:view` (ném `PermissionError`). Trước đó quyền để cho "nơi gọi" — mà nơi gọi chưa tồn tại — nên người
 * viết trang sau này chỉ cần quên một dòng là lịch sử audit (có tên người, lý do) hiện ra cho bất kỳ ai. `docHoaHongCuaNguon` đã gác bằng `phamViNguoiXem` (trả `null`, không ném: «không được xem» ≠ «0 đồng»).
 */
import type { Prisma } from "@prisma/client";
import type { Actor } from "@/lib/auth/actor";
import { can, PermissionError } from "@/lib/auth/can";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import { docDuLieuMaTran } from "@/lib/hoa-hong/chinh-sach-doc";
import { THU_TU_PHAM_VI_MAC_DINH } from "@/lib/hoa-hong/chon-quy-tac";
import { phamViNguoiXem } from "@/lib/hoa-hong/doc-so";
import { dungMaTran, type OMaTran } from "@/lib/hoa-hong/ma-tran-chinh-sach";
import { moTaNguoiHuong, tachHoaHongNguon, type ChuNguon, type DongChiTiet, type HoaHongTach, type VaiHuongTho } from "./chi-tiet-nguon";
import { chuyenTrangThaiDuoc, truongBiKhoa, type TrangThaiNguon, type TruongSua } from "./danh-muc-ghi-dau-vao";
import { dinhTienCuaNguon, docDinhTienNguon, ruleChuChayChoNguon } from "./dinh-tien-nguon";
import { docNguonVaDaDung, type NguonDaDung } from "./danh-muc-ghi";

export type PhienBanRieng = {
  policyCode: string;
  tenChinhSach: string;
  versionNo: number;
  status: string;
  hieuLucTu: string;
  hieuLucDen: string | null;
  soRule: number;
  /** Phiên bản này có đang bị engine BỎ QUA không (nguồn `commissionEnabled = false` mà phiên bản còn sống). */
  biBoQua: boolean;
  lyDoBoQua: string | null;
};

/** Gác quyền XEM cấu hình nguồn. `sources:view` là GLOBAL (cấu hình nguồn là dữ liệu CHUNG, không PII/tiền) nên không cần target. */
function batQuyenXemNguon(actor: Actor): void {
  if (!can(actor, "sources:view")) throw new PermissionError();
}

export type ChinhSachApDungCuaNguon = {
  nguon: { code: string; name: string; status: string; commissionEnabled: boolean; isSystem: boolean };
  chu: ChuNguon;
  /** Các phiên bản chính sách phạm vi RIÊNG nguồn này (mọi trạng thái trừ đã huỷ) — kèm việc engine có đang bỏ qua chúng không. */
  phienBanRieng: PhienBanRieng[];
  /** Bảng «áp dụng thật» theo từng loại giao dịch, tại `now`, đã tách hoa hồng nguồn ↔ giao dịch khác. */
  theoLoai: ({
    loai: "NEW" | "RENEWAL";
    tongPhanTram: string;
    /** null = KHÔNG ĐỌC ĐƯỢC trần (setting hỏng): không bịa 100% — màn hình nói «không đọc được trần», `vuotTran` cũng null (không biết). */
    tranPhanTram: string | null;
    vuotTran: boolean | null;
    khongTinDuoc: boolean;
  } & HoaHongTach)[];
};

const LOAI_XEM: readonly ("NEW" | "RENEWAL")[] = ["NEW", "RENEWAL"];

export async function docChinhSachApDungCuaNguon(actor: Actor, code: string, now: Date): Promise<ChinhSachApDungCuaNguon | null> {
  batQuyenXemNguon(actor);
  const g = await db.leadSourceGroup.findUnique({
    where: { code },
    include: { ownerEmployee: { select: { fullName: true, employeeCode: true, userAccount: { select: { id: true } } } } },
  });
  if (!g) return null;
  const sdb = scopedDb(actor);
  const [dl, vaiRows, phienBan] = await Promise.all([
    docDuLieuMaTran(actor, null),
    db.beneficiaryRole.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { code: true, name: true, resolverType: true, resolverKey: true, isAcquisition: true },
    }),
    sdb.commissionPolicyVersion.findMany({
      where: { scopeSourceGroupId: g.id, status: { not: "CANCELLED" } },
      select: {
        versionNo: true,
        status: true,
        effectiveFrom: true,
        effectiveTo: true,
        policy: { select: { policyCode: true, name: true } },
        _count: { select: { rules: true } },
        // Kiểu tính của từng dòng: cờ «tham gia hoa hồng theo nguồn» chỉ tắt các dòng THU HÚT; dòng EXCLUDE luôn chạy (`khopPhamVi`).
        rules: { select: { calcKind: true } },
      },
      orderBy: [{ policyId: "asc" }, { versionNo: "desc" }],
    }),
  ]);

  const chu: ChuNguon = g.ownerEmployee
    ? { ten: g.ownerEmployee.fullName, maNv: g.ownerEmployee.employeeCode, coTaiKhoan: g.ownerEmployee.userAccount !== null }
    : null;

  // UNKNOWN không có cột riêng theo `id`: engine tính mức THẤP NHẤT trên mọi nguồn đang hoạt động (D7) — ma trận trả cột «UNKNOWN» khi được đưa đủ danh sách.
  const laKhongRo = g.code === "UNKNOWN";
  const nhomNguon = laKhongRo ? dl.nhomNguon : [{ id: g.id, code: g.code, name: g.name, coHoaHong: g.commissionEnabled }];
  const cotKhoa = laKhongRo ? "UNKNOWN" : g.id;
  const vaiTho = new Map<string, VaiHuongTho>(vaiRows.map((v) => [v.code, v]));

  const theoLoai = LOAI_XEM.map((loai) => {
    const mt = dungMaTran({
      quyTac: dl.quyTac,
      nhomNguon,
      vai: vaiRows.map((v) => ({ code: v.code, name: v.name, isAcquisition: v.isAcquisition })),
      loai,
      orgUnitPath: dl.orgUnitPath,
      rateDate: now,
      thuTuPhamVi: THU_TU_PHAM_VI_MAC_DINH,
      // Trần không đọc được ⇒ KHÔNG giả 100% (`?? 1` làm `vuotTran` luôn sai và màn hình khẳng định «không vượt trần»). Giá trị truyền chỉ để hàm tính chạy; kết quả bị bỏ ở dưới.
      tran: dl.tran ?? 1,
    });
    const dong: DongChiTiet[] = mt.dong.map((d) => {
      const vai = vaiTho.get(d.vai.code)!;
      const o: OMaTran = d.o.find((x) => x.cot === cotKhoa) ?? { cot: cotKhoa, kieu: "KHONG_CO" };
      return { vai: { code: vai.code, name: vai.name, laThuHut: vai.isAcquisition }, nguoiHuong: moTaNguoiHuong(vai, chu), o };
    });
    const tong = mt.tong.find((t) => t.khoa === cotKhoa);
    return {
      loai,
      ...tachHoaHongNguon(dong),
      tongPhanTram: tong?.tongPhanTram ?? "0",
      tranPhanTram: dl.tran === null ? null : mt.tranPhanTram,
      vuotTran: dl.tran === null ? null : (tong?.vuotTran ?? false),
      khongTinDuoc: tong?.khongTinDuoc ?? false,
    };
  });

  return {
    nguon: { code: g.code, name: g.name, status: g.status, commissionEnabled: g.commissionEnabled, isSystem: g.isSystem },
    chu,
    phienBanRieng: phienBan.map((v) => {
      const song = v.status === "ACTIVE" || v.status === "DRAFT";
      const boQua = song && !g.commissionEnabled && v.rules.some((r) => r.calcKind !== "EXCLUDE");
      return {
        policyCode: v.policy.policyCode,
        tenChinhSach: v.policy.name,
        versionNo: v.versionNo,
        status: v.status,
        hieuLucTu: v.effectiveFrom.toISOString(),
        hieuLucDen: v.effectiveTo?.toISOString() ?? null,
        soRule: v._count.rules,
        biBoQua: boQua,
        lyDoBoQua: boQua ? "Nguồn này chưa bật «tham gia hoa hồng theo nguồn» — engine bỏ qua các dòng thu hút (có tỉ lệ) của chính sách phạm vi NGUỒN của nó; dòng «loại trừ» (không trả vai nào đó ở nguồn này) vẫn chạy (chính sách chung vẫn chạy; chính sách theo đối tác / theo người, nếu có, KHÔNG bị cờ này tắt — cờ chỉ điều khiển phạm vi nguồn)." : null,
      };
    }),
    theoLoai,
  };
}

// ── Tiền ──────────────────────────────────────────────────────────────────────────────────────────

export type TienTheoNhom = { soDong: number; tong: number };
export type HoaHongCuaNguon = {
  /** Hoa hồng NGUỒN: vai thu hút khách (`isAcquisition`). */
  nguon: TienTheoNhom;
  /** Hoa hồng giao dịch KHÁC (Sale · QLCS · Marketing · GV Trial …) phát sinh trên các giao dịch của nguồn này. */
  khac: TienTheoNhom;
  tong: TienTheoNhom;
  /** Phạm vi người xem: Hội sở/tất cả cơ sở, hay chỉ phần của cơ sở/chính mình — để màn hình ghi rõ «số này là của phạm vi nào». */
  phamVi: "TAT_CA" | "CO_SO_VA_CUA_TOI" | "CHI_CUA_TOI";
};

/**
 * Tiền đã GHI SỔ của nguồn, tách hai nhóm. `null` ⇒ người xem KHÔNG có quyền xem hoa hồng (khác với «0 đồng»).
 * Số tiền là tổng CÓ DẤU (hoàn/điều chỉnh âm tự trừ vào) — cùng nghĩa với tổng ở màn Sổ hoa hồng.
 */
export async function docHoaHongCuaNguon(actor: Actor, code: string): Promise<HoaHongCuaNguon | null> {
  let pv: ReturnType<typeof phamViNguoiXem>;
  try {
    pv = phamViNguoiXem(actor);
  } catch (e) {
    if (e instanceof PermissionError) return null;
    throw e;
  }
  const g = await db.leadSourceGroup.findUnique({ where: { code }, select: { id: true } });
  if (!g) return null;
  const goc: Prisma.CommissionTransactionWhereInput[] = [...pv.dieuKien, { sourceGroupId: g.id }];
  const dem = async (them: Prisma.CommissionTransactionWhereInput): Promise<TienTheoNhom> => {
    const r = await db.commissionTransaction.aggregate({ where: { AND: [...goc, them] }, _count: { _all: true }, _sum: { amount: true } });
    return { soDong: r._count._all, tong: r._sum.amount ?? 0 };
  };
  const [nguon, khac] = await Promise.all([dem({ beneficiaryRole: { isAcquisition: true } }), dem({ beneficiaryRole: { isAcquisition: false } })]);
  return {
    nguon,
    khac,
    tong: { soDong: nguon.soDong + khac.soDong, tong: nguon.tong + khac.tong },
    phamVi: pv.tamCoSo === "ALL" ? "TAT_CA" : pv.xemCoSo ? "CO_SO_VA_CUA_TOI" : "CHI_CUA_TOI",
  };
}

// ── Lịch sử ───────────────────────────────────────────────────────────────────────────────────────

export type MucLichSuNguon = {
  id: string;
  luc: string;
  hanhDong: string;
  nguoi: string;
  lyDo: string | null;
  truongDoi: string[];
  cu: Record<string, unknown> | null;
  moi: Record<string, unknown> | null;
};

const laObj = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/**
 * Lịch sử thao tác của một nguồn: ghi danh mục (`LeadSourceGroup`) + gán/gỡ Page (`PAGE_MAPPING` — Page nhắc tới MÃ nguồn trong giá trị cũ hoặc mới).
 * Mới nhất trước. Trần 200 dòng. Giá trị trong nhật ký là CẤU HÌNH (không PII, không tiền).
 */
export async function docLichSuNguon(actor: Actor, code: string, toiDa = 200): Promise<MucLichSuNguon[] | null> {
  batQuyenXemNguon(actor);
  const g = await db.leadSourceGroup.findUnique({ where: { code }, select: { id: true, code: true } });
  if (!g) return null;
  const rows = await db.auditLog.findMany({
    where: {
      OR: [
        { entityType: "LeadSourceGroup", entityId: g.id },
        {
          entityType: "SystemSetting",
          action: "PAGE_MAPPING",
          OR: [{ newValues: { path: ["nguon", "groupCode"], equals: g.code } }, { oldValues: { path: ["nguon", "groupCode"], equals: g.code } }],
        },
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(Math.max(toiDa, 1), 200),
    select: { id: true, createdAt: true, action: true, actorName: true, reason: true, changedFields: true, oldValues: true, newValues: true },
  });
  return rows.map((r) => ({
    id: r.id,
    luc: r.createdAt.toISOString(),
    hanhDong: r.action,
    nguoi: r.actorName,
    lyDo: r.reason,
    truongDoi: r.changedFields,
    cu: laObj(r.oldValues),
    moi: laObj(r.newValues),
  }));
}

// ── Dữ liệu cho biểu mẫu SỬA ──────────────────────────────────────────────────────────────────────

export type NguonDeSuaView = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sourceType: string;
  referrerRequirement: string;
  requiresNote: boolean;
  selectable: boolean;
  status: TrangThaiNguon;
  isSystem: boolean;
  sortOrder: number;
  attributionWindowDays: number | null;
  commissionEnabled: boolean;
  ownerOrgUnitId: string | null;
  ownerEmployee: (NonNullable<ChuNguon> & { id: string }) | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  /** ISO của `updatedAt` — chính là `updatedAtDaThay` mà lệnh sửa/đổi trạng thái đòi (khoá lạc quan). Đọc qua Prisma nên ở độ chính xác mili-giây, KHỚP phép so của cổng ghi. */
  capNhatLuc: string;
  /** «Đã dùng» theo từng loại tham chiếu — để màn hình nói VÌ SAO một ô bị khoá. */
  daDung: NguonDaDung;
  /** Trường đang khoá + lý do (CÙNG hàm với cổng ghi). */
  khoa: { truong: TruongSua; lyDo: string }[];
  /** Trạng thái chuyển sang được THEO BẢNG CHUYỂN (`chuyenTrangThaiDuoc`) — chưa tính các cổng đích-mặc-định / chủ-nguồn / quyền; nút dùng `thaoTacTrangThai`. */
  chuyenDuoc: TrangThaiNguon[];
  /** Nguồn này đang dính chính sách / rule nào (`docDinhTienNguon`) — cho nút trạng thái và biểu mẫu sửa nói thật. */
  dinhTien: { chinhSachRieng: boolean; coDongThuHutRieng: boolean; ruleChuNguonBatKy: boolean; ruleChuChay: boolean };
};

/** Mọi thứ biểu mẫu sửa một nguồn cần. `null` nếu không có nguồn. CHỈ ĐỌC — quyền `sources:view` do nơi gọi gác; ghi vẫn phải qua `sources:manage`. */
export async function docNguonDeSua(actor: Actor, code: string): Promise<NguonDeSuaView | null> {
  batQuyenXemNguon(actor);
  const r = await docNguonVaDaDung(code);
  if (!r) return null;
  const g = r.nguon;
  const [e, dt] = await Promise.all([
    g.ownerEmployeeId
      ? db.employee.findUnique({ where: { id: g.ownerEmployeeId }, select: { id: true, fullName: true, employeeCode: true, userAccount: { select: { id: true } } } })
      : Promise.resolve(null),
    docDinhTienNguon(db, [g.id]),
  ]);
  const dtNguon = dinhTienCuaNguon(dt, g.id);
  const status = g.status as TrangThaiNguon;
  return {
    id: g.id,
    code: g.code,
    name: g.name,
    description: g.description,
    sourceType: g.sourceType,
    referrerRequirement: g.referrerRequirement,
    requiresNote: g.requiresNote,
    selectable: g.selectable,
    status,
    isSystem: g.isSystem,
    sortOrder: g.sortOrder,
    attributionWindowDays: g.attributionWindowDays,
    commissionEnabled: g.commissionEnabled,
    ownerOrgUnitId: g.ownerOrgUnitId,
    ownerEmployee: e ? { id: e.id, ten: e.fullName, maNv: e.employeeCode, coTaiKhoan: e.userAccount !== null } : null,
    effectiveFrom: g.effectiveFrom?.toISOString() ?? null,
    effectiveTo: g.effectiveTo?.toISOString() ?? null,
    capNhatLuc: g.updatedAt.toISOString(),
    daDung: r.daDung,
    khoa: truongBiKhoa({ code: g.code, isSystem: g.isSystem, daDung: r.daDung.daDung }),
    chuyenDuoc: chuyenTrangThaiDuoc({ code: g.code, isSystem: g.isSystem, status }),
    dinhTien: { chinhSachRieng: dtNguon.chinhSachRieng, coDongThuHutRieng: dtNguon.coDongThuHutRieng, ruleChuNguonBatKy: dt.ruleChuBatKy, ruleChuChay: ruleChuChayChoNguon(dt, g.id) },
  };
}
