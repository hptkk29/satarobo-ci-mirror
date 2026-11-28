/**
 * lib/nguon/doc-form-nguon.ts — ĐỌC dữ liệu cho biểu mẫu Tạo / Sửa nguồn và cho nút đổi trạng thái (SPEC nguồn động §4; giao diện tab Nguồn). CHỈ ĐỌC; đường ghi là `danh-muc-ghi.ts`.
 *
 * ── Quyền nằm Ở ĐÂY (bài học res3 LOW-11 · res4 MEDIUM-3) ─────────────────────────────────────────────────────
 * Hai hàm biểu mẫu tự gác `sources:manage` (ném `PermissionError`): biểu mẫu là màn của người SỬA, và nó lộ nhân sự phụ trách + cây đơn vị. Người chỉ có `sources:view` đọc danh mục /
 * chi tiết, không mở được biểu mẫu — đúng khoá mà `taoNguonAction` / `suaNguonAction` kiểm, nên nút «Sửa» và cổng ghi không lệch nhau (luật 12).
 *
 * ── Cây đơn vị theo tầm nhìn người xem ─────────────────────────────────────────────────────────────────────────
 * «Phạm vi đơn vị» của nguồn chỉ là nhãn để báo cáo (cột trần, không FK, không cách ly). Vẫn cắt theo tầm nhìn: Hội sở / quản trị hệ thống thấy cả cây; vai khác chỉ thấy cây con của mình
 * (`visibleOrgUnitIds`). Đơn vị ĐANG gán cho nguồn luôn có mặt trong danh sách (kể cả ngoài tầm nhìn) để ô chọn không âm thầm bỏ giá trị đang lưu khi Lưu.
 */
import type { Actor } from "@/lib/auth/actor";
import { can, PermissionError } from "@/lib/auth/can";
import { db } from "@/lib/db";
import type { BoiCanhSua, NguonFormView } from "./form-nguon";
import { docNguonDeSua } from "./doc-chi-tiet-nguon";
import { docDinhTienNguon, ruleChuChayChoNguon } from "./dinh-tien-nguon";
import { layBangNguonTheoPage, layCuaSoGhiCongNgay, layNhomNhanSuMacDinh } from "./feature";
import { maDichMacDinh } from "./quy-nguon";

export type DonViChon = { id: string; ma: string; ten: string; loai: string; doSau: number };

export type DuLieuFormTao = {
  donVi: DonViChon[];
  /** Thứ tự hiển thị gợi ý = sau nguồn cuối cùng (không UNKNOWN), tối đa 9998. */
  thuTuGoiY: number;
  cuaSoMacDinhNgay: number;
  /** Rule vai SOURCE_OWNER chạy trên một nguồn MỚI (phạm vi không gắn nguồn) — để «Kích hoạt ngay» nói thật (`chanKhiTao`). Quyền kích hoạt do nơi gọi điền. */
  ruleChuChay: boolean;
};

export type DuLieuFormSua = Omit<DuLieuFormTao, "ruleChuChay"> & {
  nguon: NguonFormView;
  /** Thứ biểu mẫu sửa không tự biết (trừ `coQuyenKichHoat`/`nowIso`: nơi gọi điền). */
  boiCanh: Omit<BoiCanhSua, "coQuyenKichHoat" | "nowIso">;
};

function batQuyenQuanLy(actor: Actor): void {
  if (!can(actor, "sources:manage")) throw new PermissionError();
}

/** Mã nguồn mà quy nguồn dùng làm đích mặc định (ngừng / lưu trữ / tắt chọn / đặt hạn bị chặn). MỘT câu đọc, dùng cho cả danh sách. */
export async function docMaDichMacDinh(): Promise<string[]> {
  const [nhomNhanSuMacDinh, bangPage] = await Promise.all([layNhomNhanSuMacDinh(), layBangNguonTheoPage()]);
  return [...maDichMacDinh({ nhomNhanSuMacDinh, bangPage })];
}

async function docDonViChon(actor: Actor, themId: string | null): Promise<DonViChon[]> {
  const thay = actor.isSuperAdmin || actor.isHoLevel ? {} : { id: { in: actor.visibleOrgUnitIds } };
  const rows = await db.orgUnit.findMany({
    where: { deletedAt: null, status: "ACTIVE", ...(themId ? { OR: [thay, { id: themId }] } : thay) },
    orderBy: [{ path: "asc" }, { name: "asc" }],
    select: { id: true, code: true, name: true, type: true, depth: true },
  });
  return rows.map((o) => ({ id: o.id, ma: o.code, ten: o.name, loai: o.type, doSau: o.depth ?? 0 }));
}

async function docThuTuGoiY(): Promise<number> {
  const r = await db.leadSourceGroup.aggregate({ where: { code: { not: "UNKNOWN" } }, _max: { sortOrder: true } });
  const max = r._max.sortOrder;
  return max === null ? 100 : Math.min(max + 10, 9998);
}

/** Dữ liệu cho `/nguon/tao`. */
export async function docFormTaoNguon(actor: Actor): Promise<DuLieuFormTao> {
  batQuyenQuanLy(actor);
  const [donVi, thuTuGoiY, cuaSoMacDinhNgay, dt] = await Promise.all([docDonViChon(actor, null), docThuTuGoiY(), layCuaSoGhiCongNgay(), docDinhTienNguon(db, [])]);
  return { donVi, thuTuGoiY, cuaSoMacDinhNgay, ruleChuChay: ruleChuChayChoNguon(dt, null) };
}

/** Dữ liệu cho `/nguon/[maNguon]/sua`. `null` = không có nguồn mang mã này. */
export async function docFormSuaNguon(actor: Actor, code: string): Promise<DuLieuFormSua | null> {
  batQuyenQuanLy(actor);
  const v = await docNguonDeSua(actor, code);
  if (!v) return null;
  const [donVi, thuTuGoiY, cuaSoMacDinhNgay, dichMacDinh] = await Promise.all([
    docDonViChon(actor, v.ownerOrgUnitId),
    docThuTuGoiY(),
    layCuaSoGhiCongNgay(),
    docMaDichMacDinh(),
  ]);
  const nguon: NguonFormView = {
    id: v.id,
    code: v.code,
    name: v.name,
    description: v.description,
    sourceType: v.sourceType,
    referrerRequirement: v.referrerRequirement,
    requiresNote: v.requiresNote,
    selectable: v.selectable,
    status: v.status,
    isSystem: v.isSystem,
    sortOrder: v.sortOrder,
    attributionWindowDays: v.attributionWindowDays,
    commissionEnabled: v.commissionEnabled,
    ownerOrgUnitId: v.ownerOrgUnitId,
    ownerEmployee: v.ownerEmployee,
    effectiveFrom: v.effectiveFrom,
    effectiveTo: v.effectiveTo,
    capNhatLuc: v.capNhatLuc,
    daDung: v.daDung,
  };
  return {
    donVi,
    thuTuGoiY,
    cuaSoMacDinhNgay,
    nguon,
    // «Nguồn này dính rule nào» đọc MỘT lần ở `docNguonDeSua` (`docDinhTienNguon` — CÙNG hàm với cổng ghi), không truy vấn chép tay ở đây.
    boiCanh: { laDichMacDinh: dichMacDinh.includes(v.code), dinhTien: v.dinhTien },
  };
}
