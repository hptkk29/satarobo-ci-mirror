// lib/entitlements/hoc-vuot-duyet.ts — "XIN DUYỆT HỌC VƯỢT THÊM" KHI SỐ BÀI CẦN HỌC VƯỢT VƯỢT TRẦN. THUẦN, không DB.
//
// Quyết định 5 của chủ dự án (13/10/2026), chọn phương án "CHỈ KHI VƯỢT TRẦN":
//   · học vượt ≤ trần (mặc định 6, cấu hình theo cơ sở) ⇒ tự áp theo KEEP_LATEST như PR3, KHÔNG ai duyệt, KHÔNG có dòng nào;
//   · số bài cần học vượt > trần ⇒ máy VẪN giữ N bài gần nhất (KEEP_LATEST, không đổi) và MỞ một dòng CHO_DUYET_HOC_VUOT xin duyệt phần vượt trần;
//   · người có `entitlements:approve-exception` (Giám đốc, Admin) duyệt phần vượt trần; `entitlements:manage` (QLCS) KHÔNG duyệt được nhưng đóng / từ chối
//     được như mọi dòng khác. NGOẠI LỆ duy nhất của QLCS: khi cấu hình trần "thiếu / không rõ" (`capRoRang = false` — giá trị cài đặt lạ bị `cauHinhPhamViTuCaiDat`
//     đổi sang mặc định an toàn) thì QLCS duyệt được MIỄN LÀ tổng bài học vượt sau duyệt vẫn trong trần MẶC ĐỊNH của hệ thống; vượt trần mặc định ⇒ approve-exception.
//
// Duyệt = các bài bị bỏ được ĐƯA LẠI vào học vượt, đi đúng cơ chế đã có: `skippedSessions` co lại (bài bị bỏ là một TIỀN TỐ liền từ `start`, nên đưa lại các bài CUỐI
// của tiền tố thì phần còn bỏ vẫn là một tiền tố), `configSnapshot.xepLop.requiredCatchupLessons/catchupSessions` dài thêm, và mỗi bài có buổi đã dạy sinh một
// `MakeupNeed` ORDER_CONVERSION qua `taoDongHocBu`. Không đụng `StudyEntitlementUsage`, `OrderItem.studentId/enrollmentId`, điểm danh hay cổng phụ huynh.
import type { KetQuaXepLop } from "./bat-dau-khi-xep-lop";
import { chiaBaiThanhBuoi } from "./hoc-vuot";
import { CAU_HINH_PHAM_VI_MAC_DINH, type CauHinhPhamVi, type ChinhSachVuotTran } from "./pham-vi-hoc";
import { baiBoQuaTuSo } from "./tieu-thu";

export const KHOA_DE_XUAT_HOC_VUOT = "hocVuot" as const;

export interface DeXuatHocVuot {
  /** Số bài lớp đã dạy trước khi học viên vào (= bài giữ + bài bỏ). */
  readonly soBaiCan: number;
  readonly tran: number;
  readonly chinhSach: ChinhSachVuotTran;
  /** Bài máy đã giữ làm học vượt (KEEP_LATEST: các bài GẦN NHẤT). */
  readonly baiDaGiu: readonly number[];
  /** Bài máy đã bỏ (liền từ `start`). */
  readonly baiBoQua: readonly number[];
  /** Bài đề xuất học vượt THÊM = toàn bộ bài đã bỏ. */
  readonly baiDeXuatThem: readonly number[];
  /** `false` ⇒ cấu hình trần thiếu / không rõ (xem đầu file). */
  readonly capRoRang: boolean;
  readonly baiMoiBuoi: number;
}

/** `null` khi KHÔNG vượt trần (không bài nào bị bỏ) — khi đó không có dòng nào, hành vi PR3 nguyên văn. */
export function deXuatHocVuot(x: KetQuaXepLop, cauHinh: CauHinhPhamVi, capRoRang: boolean, baiMoiBuoi: number): DeXuatHocVuot | null {
  if (x.catchupMode !== "OVER_CAP_SKIPPED" || x.skippedLessons.length === 0) return null;
  return {
    soBaiCan: x.skippedLessons.length + x.requiredCatchupLessons.length,
    tran: cauHinh.catchUpMaxSessions,
    chinhSach: cauHinh.catchUpOverCapPolicy,
    baiDaGiu: [...x.requiredCatchupLessons],
    baiBoQua: [...x.skippedLessons],
    baiDeXuatThem: [...x.skippedLessons],
    capRoRang,
    baiMoiBuoi,
  };
}

/** "1–30" · "4, 7" · "3–5, 9". Ổn định (cùng đầu vào ⇒ cùng chuỗi) vì `lyDo` là dấu vân của điều kiện. */
export function dinhDangDaiBai(bai: readonly number[]): string {
  const s = [...new Set(bai)].sort((a, b) => a - b);
  const ra: string[] = [];
  for (let i = 0; i < s.length; ) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j]! + 1) j++;
    ra.push(j - i >= 2 ? `${s[i]}–${s[j]}` : s.slice(i, j + 1).join(", "));
    i = j + 1;
  }
  return ra.join(", ");
}

/** `lyDo` của dòng CHO_DUYET_HOC_VUOT. Không có số tiền. ĐỔI CÂU CHỮ = người đã đóng dòng sẽ thấy nó hiện lại một lần (hướng lỗi an toàn — da-quyet.ts). */
export function lyDoChoDuyetHocVuot(d: DeXuatHocVuot): string {
  return (
    `Lớp đã dạy ${d.soBaiCan} bài trước khi học viên vào — vượt trần học vượt ${d.tran} bài. Máy đã giữ ${d.baiDaGiu.length} bài gần nhất làm học vượt` +
    `${d.baiDaGiu.length > 0 ? ` (bài ${dinhDangDaiBai(d.baiDaGiu)})` : ""} và bỏ ${d.baiBoQua.length} bài (bài ${dinhDangDaiBai(d.baiBoQua)}). ` +
    `Xin duyệt học vượt THÊM ${d.baiDeXuatThem.length} bài (bài ${dinhDangDaiBai(d.baiDeXuatThem)}) — cần người có quyền duyệt ngoại lệ (Giám đốc / Admin).`
  );
}

/** Payload ghi lên dòng (`chiTiet` là khoá giao diện đã đọc cho các loại khác — ở đây dùng khoá riêng để không lẫn). */
export function payloadDeXuat(d: DeXuatHocVuot, ngucCanh: { readonly entitlementId: string; readonly enrollmentId: string; readonly classId: string }): Record<string, unknown> {
  return {
    [KHOA_DE_XUAT_HOC_VUOT]: {
      soBaiCan: d.soBaiCan,
      tran: d.tran,
      chinhSach: d.chinhSach,
      baiDaGiu: [...d.baiDaGiu],
      baiBoQua: [...d.baiBoQua],
      baiDeXuatThem: [...d.baiDeXuatThem],
      capRoRang: d.capRoRang,
      baiMoiBuoi: d.baiMoiBuoi,
      entitlementId: ngucCanh.entitlementId,
      enrollmentId: ngucCanh.enrollmentId,
      classId: ngucCanh.classId,
    },
  };
}

const laDoiTuong = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const laMangSo = (x: unknown): x is number[] => Array.isArray(x) && x.every((n) => typeof n === "number" && Number.isInteger(n));

export interface DeXuatDoc extends DeXuatHocVuot {
  readonly entitlementId: string;
  readonly enrollmentId: string;
  readonly classId: string;
}

/** Đọc lại đề xuất từ `payload`. Hình dạng lạ ⇒ `null` (người gọi từ chối duyệt — KHÔNG đoán). */
export function docDeXuat(payload: unknown): DeXuatDoc | null {
  if (!laDoiTuong(payload)) return null;
  const h = payload[KHOA_DE_XUAT_HOC_VUOT];
  if (!laDoiTuong(h)) return null;
  if (
    typeof h.soBaiCan !== "number" || typeof h.tran !== "number" || typeof h.baiMoiBuoi !== "number" || typeof h.capRoRang !== "boolean" ||
    (h.chinhSach !== "KEEP_LATEST" && h.chinhSach !== "DROP_ALL") ||
    !laMangSo(h.baiDaGiu) || !laMangSo(h.baiBoQua) || !laMangSo(h.baiDeXuatThem) ||
    typeof h.entitlementId !== "string" || typeof h.enrollmentId !== "string" || typeof h.classId !== "string"
  ) return null;
  return {
    soBaiCan: h.soBaiCan, tran: h.tran, chinhSach: h.chinhSach, baiDaGiu: h.baiDaGiu, baiBoQua: h.baiBoQua, baiDeXuatThem: h.baiDeXuatThem,
    capRoRang: h.capRoRang, baiMoiBuoi: h.baiMoiBuoi, entitlementId: h.entitlementId, enrollmentId: h.enrollmentId, classId: h.classId,
  };
}

/** Tập quyền cần để duyệt đề xuất này. `APPROVE_EXCEPTION` = chỉ người giữ `entitlements:approve-exception`; `MANAGE` = người giữ `entitlements:manage` cũng duyệt được. */
export type QuyenCanDuyet = "APPROVE_EXCEPTION" | "MANAGE";

export function quyenCanDuyetHocVuot(d: Pick<DeXuatHocVuot, "capRoRang" | "baiDaGiu" | "baiDeXuatThem">): QuyenCanDuyet {
  if (d.capRoRang) return "APPROVE_EXCEPTION";
  const tongSauDuyet = d.baiDaGiu.length + d.baiDeXuatThem.length;
  return tongSauDuyet <= CAU_HINH_PHAM_VI_MAC_DINH.catchUpMaxSessions ? "MANAGE" : "APPROVE_EXCEPTION";
}

export class LoiDuyetHocVuot extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoiDuyetHocVuot";
  }
}

export interface DauVaoApDungDuyet {
  readonly startLesson: number;
  readonly skippedSessions: number;
  /** `configSnapshot.xepLop.requiredCatchupLessons` hiện có. */
  readonly requiredHienTai: readonly number[];
  readonly deXuat: Pick<DeXuatHocVuot, "baiBoQua" | "baiDeXuatThem" | "baiMoiBuoi">;
}

export interface KetQuaApDungDuyet {
  readonly skippedMoi: number;
  readonly requiredMoi: readonly number[];
  readonly catchupSessionsMoi: readonly (readonly number[])[];
}

/**
 * Đưa các bài đề xuất vào học vượt. Từ chối (ném) khi đề xuất KHÔNG còn khớp quyền học — cùng thứ tự `baiBoQua`, cùng tiền tố từ `start` — tức dữ liệu đã đổi
 * sau lúc dòng được mở (quyền học bị xếp lại / duyệt rồi). Không đoán: ghi lên dữ liệu cũ là ghi sai.
 */
export function apDungDuyetHocVuot(v: DauVaoApDungDuyet): KetQuaApDungDuyet {
  const hienBoQua = baiBoQuaTuSo(v.startLesson, v.skippedSessions);
  const dx = v.deXuat;
  if (dx.baiBoQua.length === 0 || dx.baiBoQua.length !== hienBoQua.length || dx.baiBoQua.some((b, i) => b !== hienBoQua[i])) {
    throw new LoiDuyetHocVuot("Đề xuất không còn khớp quyền học (số bài đang bị bỏ đã đổi — có thể đã duyệt rồi). Tải lại trang.");
  }
  if (dx.baiDeXuatThem.length === 0 || dx.baiDeXuatThem.some((b) => !hienBoQua.includes(b))) {
    throw new LoiDuyetHocVuot("Bài đề xuất thêm không nằm trong các bài đang bị bỏ.");
  }
  // Đưa lại các bài CUỐI của tiền tố ⇒ phần còn bỏ vẫn liền từ `start`. Đề xuất mặc định là TOÀN BỘ tiền tố; nếu không phải thì phải là một đuôi liền.
  const k = dx.baiDeXuatThem.length;
  const duoi = hienBoQua.slice(hienBoQua.length - k);
  if (duoi.some((b, i) => b !== [...dx.baiDeXuatThem].sort((a, c) => a - c)[i])) {
    throw new LoiDuyetHocVuot("Bài đề xuất thêm phải là các bài CUỐI của phần đang bị bỏ (để phần còn bỏ vẫn liền từ bài đầu).");
  }
  const requiredMoi = [...new Set([...v.requiredHienTai, ...dx.baiDeXuatThem])].sort((a, b) => a - b);
  return {
    skippedMoi: v.skippedSessions - k,
    requiredMoi,
    catchupSessionsMoi: chiaBaiThanhBuoi(requiredMoi, dx.baiMoiBuoi),
  };
}
