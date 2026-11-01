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
  /**
   * Khoản Sale THÊM trên dòng LÚC TẠO ĐƠN (= `OrderItem.discountAmount` ngay khi ghi) [20/10/2026]. Dấu cũ không có khoá này ⇒ 0.
   *
   * ⚠️ VÌ SAO GHI VÀO DẤU: để phân biệt "khoản thêm đã qua cổng trần + cổng duyệt lúc tạo đơn" với MỘT ĐỒNG NÀO KHÁC làm `discountAmount` đổi
   * SAU đó (miễn giảm công nợ, sửa tay…). Cấp quyền học chỉ coi dòng là nhất quán khi `discountAmount === giamThem` — hạ giá dòng dưới giá báo bằng
   * đường khác vẫn báo `dauKhongKhop` như trước (hiện trạng chờ Q12/D3, ghim ở `[CD2-MG-01]`).
   */
  readonly giamThem: number;
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
export function metadataDongPhamVi(courseId: string, p: DongPhamVi, giamThem: number = 0): Record<string, unknown> {
  const gia48 = p.pricingSnapshot.gia48;
  const khoi: PhamViDong = {
    phienBan: PHIEN_BAN_PHAM_VI,
    loaiMua: p.loaiMua,
    soBuoiMua: p.soBuoi,
    niemYet: p.niemYet,
    giamGia: p.niemYet - p.thanhTien,
    thanhTien: p.thanhTien,
    giamThem,
    donGiaMoiBuoi: gia48 % TONG_SO_BUOI_KHOA_AP_LUAT === 0 ? gia48 / TONG_SO_BUOI_KHOA_AP_LUAT : null,
    pricingSnapshot: p.pricingSnapshot,
  };
  // Khoá `giamThem` CHỈ ghi khi > 0: dấu của dòng không có khoản thêm giữ NGUYÊN từng byte như trước 20/10/2026.
  const { giamThem: gt, ...conLai } = khoi;
  return { courseId, soBuoi: p.soBuoi, [KHOA_PHAM_VI]: gt > 0 ? { ...conLai, giamThem: gt } : conLai };
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
  /**
   * Khoản Sale thêm của dòng (`TienDong.giam`) [20/10/2026]. Mặc định 0 là FAIL-CLOSED: chỗ gọi quên truyền thì dấu không ghi khoản thêm,
   * và mọi nơi đọc "tiền thực" thấy `discountAmount ≠ giamThem` ⇒ `dauKhongKhop` (không cấp quyền học) chứ không cấp nhầm. Đường tạo đơn thật
   * (`createOrderManualAction`) PHẢI truyền — lưới `[GTW-02]` canh.
   */
  giamThem: number = 0,
): Record<string, unknown> | null {
  if (ketQua.kieu === "SCOPE") {
    const p = ketQua.dong[i];
    if (p && courseId) return metadataDongPhamVi(courseId, p, giamThem);
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
  // `giamThem` vắng ⇒ 0 (dấu trước 20/10/2026). Có mặt thì phải là số nguyên trong [0, thanhTien] — hỏng ⇒ KHÔNG tin dấu.
  const giamThem = k.giamThem === undefined ? 0 : k.giamThem;
  if (!laSoNguyen(giamThem) || giamThem < 0 || (laSoNguyen(thanhTien) && giamThem > thanhTien)) return null;
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
    giamThem,
    donGiaMoiBuoi,
    pricingSnapshot: pricingSnapshot as unknown as PricingSnapshotDong,
  };
}

/**
 * TIỀN THỰC của một dòng SCOPE sau khi Sale thêm khoản giảm [20/10/2026] — MỘT chỗ cho mọi nơi hỏi "dòng này thật sự phải trả bao nhiêu".
 *
 * `phamVi.thanhTien` là giá THEO CHÍNH SÁCH (= `unitPrice × quantity` của dòng); khoản Sale thêm nằm ở `OrderItem.discountAmount`. Khách phải trả
 * `thanhTien − discountAmount`. Trước khi mở lại khoản thêm, hai con số này luôn bằng nhau (dòng SCOPE không có khoản riêng) nên các nơi đọc dấu
 * (cấp quyền học · đối soát lệch · giá ghi danh khi chuyển đổi) được phép so thẳng với `thanhTien`; nay so thẳng là báo `dauKhongKhop` OAN và
 * không cấp quyền học cho khách đã đóng đủ.
 *
 * Trả `null` (⇒ KHÔNG tin dòng) khi dòng không còn khớp dấu: giá nền `unitPrice × quantity` hay `totalPrice` khác `thanhTien` (dấu giả / dòng bị sửa),
 * hoặc `discountAmount` không phải số nguyên trong [0, thanhTien]. Đây KHÔNG kiểm khoản thêm có đúng trần không (trần đổi theo thời gian,
 * đã gác lúc tạo đơn) — chỉ kiểm dòng còn nhất quán về tiền.
 */
export function tienThucDongPhamVi(
  pv: Pick<PhamViDong, "thanhTien" | "giamThem">,
  d: { readonly unitPrice: number; readonly quantity: number; readonly totalPrice: number; readonly discountAmount: number },
): { readonly giamThem: number; readonly thanhTienThuc: number } | null {
  if (!laSoNguyen(d.unitPrice) || !laSoNguyen(d.quantity) || !laSoNguyen(d.totalPrice) || !laSoNguyen(d.discountAmount)) return null;
  if (d.unitPrice * d.quantity !== pv.thanhTien || d.totalPrice !== pv.thanhTien) return null;
  if (d.discountAmount < 0 || d.discountAmount > pv.thanhTien) return null;
  // Khoản thêm phải ĐÚNG là khoản đã ghi vào dấu lúc tạo đơn (đã qua cổng trần + cổng duyệt). Đổi `discountAmount` SAU đó bằng đường khác ⇒ KHÔNG tin.
  if (d.discountAmount !== pv.giamThem) return null;
  return { giamThem: d.discountAmount, thanhTienThuc: pv.thanhTien - d.discountAmount };
}

/** Đơn có ít nhất một dòng SCOPE hợp lệ. Dành cho các cổng "đơn SCOPE không được sửa/chia đợt/convert" ở PR sau. */
export function laDonPhamVi(dong: readonly { readonly metadata: unknown }[]): boolean {
  return dong.some((d) => docPhamViDong(d.metadata) !== null);
}
