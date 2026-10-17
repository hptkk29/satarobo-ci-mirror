// lib/orders/pham-vi/doc-dong.ts — GHI và ĐỌC dấu "mua theo phạm vi học" trên `OrderItem.metadata`. THUẦN.
//
// Đợt này KHÔNG có migration: dấu nằm trong `OrderItem.metadata` (Json đã có) dưới MỘT khoá riêng `phamVi`, kèm
// `courseId` và `soBuoi` (hai khoá mà các đường đọc hiện có đã hiểu). Cột thật (`purchaseModel`, `purchaseKind`…)
// là việc của PR migration trong làn tuần tự (BANG-DIEU-PHOI §5); khi có, hàm đọc ở đây là chỗ DUY NHẤT phải đổi.
//
// ── `soBuoi` PHẢI được ghi cho dòng SCOPE ────────────────────────────────────────────────────────────────────────
// `convertLeadV2` suy `Enrollment.buoiBatDau` từ `soBuoiChoGhiDanh(dongDon…)` = `OrderItem.metadata.soBuoi`
// (`lib/crm/convert-lead-v2.ts` ~dòng 233–243, qua `lib/finance/gia-tu-dong-don.ts:126`). Thiếu nó ⇒ `null` ⇒
// `buoiBatDau = NULL` ⇒ "học đủ khoá": khách mua 12 buổi được học cả 48. Ghim ở `[ĐSC-05]` bằng cách chạy ĐÚNG hàm đọc đó.
// ⚠️ Ghi `soBuoi` thì convert hiện hành đặt `buoiBatDau = tổng − mua + 1` (học các buổi CUỐI, quyết định 28/09) — SAI với
// mô hình mới (neo ở đầu học phần). Đó là việc của khu vực xếp lớp/convert; đến lúc đó cờ phải còn TẮT.
//
// ── `phamVi` KHÔNG PHẢI CHỨNG CHỈ ────────────────────────────────────────────────────────────────────────────────
// `metadata` đi vào từ payload client. Nên:
//   · `boPhamViCuaClient` GỠ khoá `phamVi` khỏi metadata client gửi, ở MỌI dòng, MỌI chế độ cờ — kể cả TẮT. Đây là chỗ
//     DUY NHẤT đường cờ-TẮT khác đường cũ, và chỉ khác với payload có khoá dự trữ này (không client thật nào gửi).
//     Lý do không đợi cờ bật: một dòng tạo lúc cờ TẮT mang `phamVi` giả sẽ nằm đó mãi, và ngày khu vực "tiền về"
//     cấp quyền học từ dấu này thì khách trả 1.000.000đ nhận quyền 48 buổi.
//   · Dù vậy `docPhamViDong` chỉ là phép KIỂM HÌNH DẠNG + nhất quán nội bộ, KHÔNG xác thực nguồn. Khu vực cấp quyền
//     học PHẢI đối chiếu thêm với số tiền thật của dòng (`OrderItem.unitPrice × quantity − discountAmount` phải bằng
//     `thanhTien`) trước khi tin.
import { SO_BUOI_HOP_LE, TONG_SO_BUOI_KHOA_AP_LUAT } from "@/lib/orders/so-buoi-hoc-phan";
import type { DongPhamVi, KetQuaDon } from "./ke-hoach-don";
import type { PricingSnapshotDong } from "@/lib/pricing/ke-hoach-dong-don";

/** Khoá dự trữ trong `OrderItem.metadata`. Chỉ máy chủ được ghi nó. */
export const KHOA_PHAM_VI = "phamVi" as const;

/** Tăng khi đổi HÌNH DẠNG của khối `phamVi`; `docPhamViDong` từ chối phiên bản lạ thay vì đoán. */
export const PHIEN_BAN_PHAM_VI = 1 as const;

/** `PurchaseKind` của schema trừ `CUSTOM` (số buổi lẻ bị từ chối ở đợt đầu — MT-11). */
export type LoaiMuaDong = "FULL" | "MILESTONE";

export interface PhamViDong {
  readonly phienBan: typeof PHIEN_BAN_PHAM_VI;
  readonly loaiMua: LoaiMuaDong;
  readonly soBuoiMua: number;
  /** Giá niêm yết tại mốc (trước giảm theo chính sách). */
  readonly niemYet: number;
  /** `niemYet − thanhTien`: số tiền giảm theo chính sách. */
  readonly giamGia: number;
  readonly thanhTien: number;
  /** `gia48 ÷ 48` khi chia hết; `null` khi không (không làm tròn tiền — QĐ-34). */
  readonly donGiaMoiBuoi: number | null;
  readonly pricingSnapshot: PricingSnapshotDong;
}

const laDoiTuong = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/**
 * Gỡ khoá `phamVi` khỏi metadata client gửi. Không có khoá ⇒ trả CHÍNH đối tượng đầu vào (cùng tham chiếu: đường cũ
 * không đổi một byte); có khoá ⇒ bản sao không còn khoá đó.
 */
export function boPhamViCuaClient(md: Record<string, unknown> | null): Record<string, unknown> | null {
  if (md === null || !(KHOA_PHAM_VI in md)) return md;
  const conLai = { ...md };
  delete conLai[KHOA_PHAM_VI];
  return conLai;
}

/**
 * Metadata của MỘT dòng SCOPE: `courseId` + `soBuoi` + `phamVi`, KHÔNG mang khoá nào khác của client (whitelist).
 * `leadChildId` do `veMetadataConLead` thêm sau — cùng đường với dòng cũ.
 */
export function metadataDongPhamVi(courseId: string, p: DongPhamVi): Record<string, unknown> {
  const gia48 = p.pricingSnapshot.gia48;
  const khoi: PhamViDong = {
    phienBan: PHIEN_BAN_PHAM_VI,
    loaiMua: p.loaiMua,
    soBuoiMua: p.soBuoi,
    niemYet: p.niemYet,
    giamGia: p.niemYet - p.thanhTien,
    thanhTien: p.thanhTien,
    donGiaMoiBuoi: gia48 % TONG_SO_BUOI_KHOA_AP_LUAT === 0 ? gia48 / TONG_SO_BUOI_KHOA_AP_LUAT : null,
    pricingSnapshot: p.pricingSnapshot,
  };
  return { courseId, soBuoi: p.soBuoi, [KHOA_PHAM_VI]: khoi };
}

/**
 * Metadata cuối cùng của dòng `i` — MỘT chỗ cho cả hai nhánh, để chỗ gọi không phải rẽ.
 *   · kết quả SCOPE ⇒ `metadataDongPhamVi` (courseId lấy từ metadata client; planner chỉ SCOPE khi đã có courseId);
 *   · còn lại     ⇒ metadata client đã gỡ khoá dự trữ.
 */
export function metadataChoDong(
  ketQua: KetQuaDon,
  i: number,
  metadataKhach: Record<string, unknown> | null,
  courseId: string | null,
): Record<string, unknown> | null {
  if (ketQua.kieu === "SCOPE") {
    const p = ketQua.dong[i];
    if (p && courseId) return metadataDongPhamVi(courseId, p);
    // Không thể xảy ra (SCOPE bắt buộc có courseId). Ném thay vì ghi một dòng SCOPE không dấu.
    throw new Error("metadataChoDong: dòng SCOPE thiếu courseId hoặc kế hoạch");
  }
  return boPhamViCuaClient(metadataKhach);
}

const laSoNguyen = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x);

/**
 * Đọc dấu phạm vi của một dòng đơn. `null` = dòng KHÔNG phải SCOPE hoặc dấu hỏng/lạ — đọc là FAIL-CLOSED về
 * "không phải SCOPE" chứ không đoán. Kiểm hình dạng và nhất quán nội bộ (xem đầu tệp: KHÔNG xác thực nguồn).
 */
export function docPhamViDong(metadata: unknown): PhamViDong | null {
  if (!laDoiTuong(metadata)) return null;
  const k = metadata[KHOA_PHAM_VI];
  if (!laDoiTuong(k)) return null;
  if (k.phienBan !== PHIEN_BAN_PHAM_VI) return null;
  if (k.loaiMua !== "FULL" && k.loaiMua !== "MILESTONE") return null;
  const { soBuoiMua, niemYet, giamGia, thanhTien, donGiaMoiBuoi, pricingSnapshot } = k;
  if (!laSoNguyen(soBuoiMua) || !SO_BUOI_HOP_LE.includes(soBuoiMua)) return null;
  if (!laSoNguyen(niemYet) || !laSoNguyen(giamGia) || !laSoNguyen(thanhTien)) return null;
  if (thanhTien < 0 || giamGia < 0 || niemYet !== thanhTien + giamGia) return null;
  if (donGiaMoiBuoi !== null && !laSoNguyen(donGiaMoiBuoi)) return null;
  // `soBuoi` ngoài khối phải khớp — đó là khoá mà `convertLeadV2` đọc; lệch thì hai nơi nói hai số buổi.
  if (metadata.soBuoi !== soBuoiMua) return null;
  if ((soBuoiMua === TONG_SO_BUOI_KHOA_AP_LUAT) !== (k.loaiMua === "FULL")) return null;
  if (!laDoiTuong(pricingSnapshot) || pricingSnapshot.soBuoi !== soBuoiMua || pricingSnapshot.thanhTien !== thanhTien) return null;
  return {
    phienBan: PHIEN_BAN_PHAM_VI,
    loaiMua: k.loaiMua,
    soBuoiMua,
    niemYet,
    giamGia,
    thanhTien,
    donGiaMoiBuoi,
    pricingSnapshot: pricingSnapshot as unknown as PricingSnapshotDong,
  };
}

/** Đơn có ít nhất một dòng SCOPE hợp lệ. Dành cho các cổng "đơn SCOPE không được sửa/chia đợt/convert" ở PR sau. */
export function laDonPhamVi(dong: readonly { readonly metadata: unknown }[]): boolean {
  return dong.some((d) => docPhamViDong(d.metadata) !== null);
}
