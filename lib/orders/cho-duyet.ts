// lib/orders/cho-duyet.ts — "ĐƠN NÀY CÓ ĐANG CHỜ DUYỆT KHÔNG". THUẦN, không DB.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO MỘT TỆP RIÊNG [25/09/2026]
//
// Chủ dự án: *"đưa mục duyệt đơn vào trong màn đơn hàng, các đơn hàng cần duyệt thì thiết
// kế nổi bật lên để QLCS biết sẽ có những đơn nào cần duyệt"*.
//
// Từ nay cùng một câu hỏi được hỏi ở HAI chỗ: khối "Chờ duyệt" (tra DB bằng `where`) và
// từng dòng của bảng đơn (suy trong bộ nhớ từ các cột đã nạp). Hai chỗ mà hai công thức
// thì có ngày lệch — và khi lệch, màn hình **nói dối**: bảng gắn cờ "chờ duyệt" cho một
// đơn mà khối duyệt không liệt kê, hoặc ngược lại. Đúng lớp lỗi đã trả giá ở nội dung CK
// (một mã QR, hai nguồn chữ).
//
// `WHERE_CHO_DUYET` và `laDonChoDuyet` là hai mặt của MỘT luật, và `[CDT-05]` khoá chúng
// vào nhau bằng cách đo đủ mọi tổ hợp.
//
// ─────────────────────────────────────────────────────────────────────────────
// BA PHẦN, KHÔNG PHẢI HAI [25/09/2026]
//
// Phần thứ ba — SỐ BUỔI không khớp mốc học phần (12/24/36/48, chỉ áp cho khoá đủ 4 học
// phần) — thêm vào theo chốt của chủ dự án: *"khi sale tạo đơn, nếu buổi học khác 12 24
// 36 48 tức 1 học phần, 2 học phần, 3 học phần, 4 học phần thì phải qua quản lý duyệt"*.
// Luật xét ở `lib/orders/so-buoi-hoc-phan.ts`; ở đây chỉ còn là một cột trạng thái.
//
// ⚠️ NHÃN VÀ CÂU CHẶN QR DỰNG TỪ DANH SÁCH, KHÔNG PHẢI if/else.
// Bản trước dùng `if (giamGia && traGop) … else giamGia ? … : …` — với HAI cờ thì nó
// đúng; thêm cờ thứ ba là nó trả nhãn SAI (đơn chỉ vướng số buổi sẽ được gắn nhãn "Chờ
// duyệt trả góp") mà **không ca nào đỏ và không lỗi nào báo**. Ba cờ ⇒ 7 tổ hợp; viết
// tay 7 nhánh là mời đúng con bug ấy quay lại ở lần thêm cờ thứ tư.

// Chỉ nhập KIỂU (bị xoá lúc biên dịch) — tệp này vẫn thuần, không kéo Prisma Client vào
// bundle nào. Nhưng nhờ nó, sai một chữ trong chuỗi enum là lỗi BIÊN DỊCH chứ không phải
// một câu `where` lặng lẽ không khớp dòng nào.
import type {
  DiscountApprovalStatus,
  InstallmentApprovalStatus,
  SoBuoiApprovalStatus,
} from "@prisma/client";

/** Đúng chuỗi enum Prisma dùng chung cho cả ba cột duyệt. */
const CHO_DUYET = "PENDING_APPROVAL";

/**
 * MỌI quyền cho phép duyệt đơn — giữ MỘT trong số này là duyệt được.
 *
 * ⚠️ MỘT nguồn cho BA chỗ hỏi [gom 25/09/2026]: nút trên màn danh sách
 * (`cho-duyet-server.ts:duocDuyetDon`), cổng thô của server action
 * (`duyet/_actions.ts`), và danh sách người nhận tin báo (`bao-cho-duyet.ts`). Trước hôm
 * nay hai trong ba chỗ chép tay đúng hai chuỗi này. Lệch nhau thì triệu chứng đi theo
 * cặp và không ai nối được hai đầu: người có quyền nhưng KHÔNG nhận được tin báo, hoặc
 * nhận tin rồi bấm vào thì bị từ chối.
 *
 * Đây vừa là `Action` của matrix v1 vừa là khoá `RolePermission.action` của v2 — cùng chuỗi.
 */
export const QUYEN_DUYET_DON = ["discounts:approve", "installments:approve"] as const;

/**
 * Mảnh `where` của Prisma: đơn đang chờ duyệt ở ÍT NHẤT MỘT phần.
 *
 * ⚠️ Đây là bản sao duy nhất được phép tồn tại. Gõ lại `"PENDING_APPROVAL"` trong một câu
 * tra khác là mở đường cho hai định nghĩa — `[CDT-06]` canh chính chỗ đó.
 */
export const WHERE_CHO_DUYET: {
  OR: [
    { discountApprovalStatus: DiscountApprovalStatus },
    { installmentApprovalStatus: InstallmentApprovalStatus },
    { soBuoiApprovalStatus: SoBuoiApprovalStatus },
  ];
} = {
  OR: [
    { discountApprovalStatus: CHO_DUYET },
    { installmentApprovalStatus: CHO_DUYET },
    { soBuoiApprovalStatus: CHO_DUYET },
  ],
};

export type PhanChoDuyet = {
  /** Có phần nào đang chờ duyệt không — thứ quyết định dòng có được tô sáng hay không. */
  co: boolean;
  /** Khoản GIẢM GIÁ vượt ngưỡng đang chờ duyệt. */
  giamGia: boolean;
  /** Kế hoạch TRẢ GÓP vượt ngưỡng số đợt đang chờ duyệt. */
  traGop: boolean;
  /** SỐ BUỔI bán ra không khớp mốc học phần, đang chờ duyệt. */
  soBuoi: boolean;
};

/**
 * Đơn này đang chờ duyệt phần nào.
 *
 * ⚠️ Ba tham số khai BẮT BUỘC (luật 7). Cho phép thiếu là mở đúng một lỗi CÂM: chỗ gọi
 * quên `select` một trong ba cột thì mọi đơn đọc ra "không chờ duyệt", bảng sạch sẽ, và
 * quản lý không bao giờ biết có đơn đang nằm chờ. Bắt buộc ⇒ `tsc` bắt tại chỗ gọi, đúng
 * cái lợi ngoài dự kiến của luật 7 ghi trong `docs/luat-doc-so-va-ket-luan.md`.
 */
export function laDonChoDuyet(o: {
  discountApprovalStatus: string | null;
  installmentApprovalStatus: string | null;
  soBuoiApprovalStatus: string | null;
}): PhanChoDuyet {
  const giamGia = o.discountApprovalStatus === CHO_DUYET;
  const traGop = o.installmentApprovalStatus === CHO_DUYET;
  const soBuoi = o.soBuoiApprovalStatus === CHO_DUYET;
  return { co: giamGia || traGop || soBuoi, giamGia, traGop, soBuoi };
}

/**
 * Ba phần theo MỘT thứ tự cố định, mỗi phần một cụm chữ ngắn và một câu đầy đủ.
 *
 * Một bảng, hai chỗ dùng (nhãn trên dòng bảng · câu chặn xuất QR). Tách đôi là mở đường
 * cho một phần có tên ở chỗ này mà không có tên ở chỗ kia.
 *
 * ⚠️ THỨ TỰ LÀ MỘT, dùng cho mọi chỗ in ra — kể cả tin báo (`tin-cho-duyet.ts`). Trước
 * 25/09 nhãn bảng đọc "giảm giá + trả góp" còn câu chặn QR đọc kế hoạch trước; hai thứ
 * tự cho cùng một đơn làm người đọc tưởng đang xem hai đơn khác nhau. Giữ thứ tự của
 * NHÃN BẢNG vì đó là thứ người ta nhìn nhiều nhất.
 */
const PHAN: readonly {
  khoa: keyof Omit<PhanChoDuyet, "co">;
  cum: string;
  cau: string;
}[] = [
  {
    khoa: "giamGia",
    cum: "giảm giá",
    cau: "ưu đãi trên đơn vượt mức cho phép",
  },
  {
    khoa: "traGop",
    cum: "trả góp",
    cau: "kế hoạch chia đợt vượt mức cho phép",
  },
  {
    khoa: "soBuoi",
    cum: "số buổi",
    // KHÔNG nói "vượt mức": bán 20 buổi không vượt gì cả, nó chỉ không rơi đúng mốc.
    // Câu lỗi nói sai bản chất là câu lỗi sale đọc xong đi sửa nhầm chỗ.
    cau: "số buổi bán ra không khớp mốc học phần",
  },
];

function dangCho(p: PhanChoDuyet): typeof PHAN {
  return PHAN.filter((x) => p[x.khoa]);
}

/**
 * Danh sách cụm chữ của các phần đang chờ, vd `["giảm giá", "số buổi"]`.
 *
 * ⚠️ NỘI BỘ, cố ý không export [26/09/2026]. Nó từng được export cho dải "CẦN BẠN DUYỆT"
 * ở đầu thẻ duyệt; chủ dự án bỏ dải ấy, nên nay chỉ còn `nhanChoDuyet` dùng. Giữ một
 * export không ai gọi là mời người sau dựng lại đúng thứ vừa gỡ.
 */
function cumChoDuyet(p: PhanChoDuyet): string[] {
  return dangCho(p).map((x) => x.cum);
}

/**
 * Nhãn ngắn in trên dòng bảng. `null` khi đơn không chờ duyệt.
 *
 * Nói RÕ chờ duyệt CÁI GÌ, không chỉ "chờ duyệt": một nhãn chung biến việc "mở ra mới
 * biết" thành thói quen.
 */
export function nhanChoDuyet(p: PhanChoDuyet): string | null {
  if (!p.co) return null;
  const cum = cumChoDuyet(p);
  return cum.length > 0 ? `Chờ duyệt ${cum.join(" + ")}` : null;
}

/**
 * CÂU CHẶN XUẤT QR — một nguồn cho CẢ HAI cổng [gom về đây 25/09/2026].
 *
 * ⚠️ Có ĐÚNG HAI cửa phát mã QR và trước hôm nay chúng chép tay cùng một điều kiện:
 *   · `app/(admin)/admin/orders/_qr-core.ts` → `guardIssuable` (đường phiếu thu);
 *   · `app/(admin)/admin/orders/[id]/page.tsx` → `lyDoChuaDuyet` (trang đơn dựng URL ảnh
 *     VietQR THẲNG, không qua `_qr-core`).
 * Gác một cửa là thủng — chú thích ở chính hai chỗ đó đã ghi điều này từ 23/09, nhưng
 * cách chống thủng lại là *nhớ sửa cả hai*. Thêm cờ thứ ba cho thấy cách ấy không bền:
 * quên một cửa thì mã QR vẫn phát ra cho một đơn chưa ai ký, và không lỗi nào báo.
 *
 * `null` = không có gì chặn.
 */
export function lyDoChuaDuyetQr(p: PhanChoDuyet): string | null {
  if (!p.co) return null;
  const cau = dangCho(p).map((x) => x.cau);
  if (cau.length === 0) return null;
  const gop = cau.join("; ");
  return `${gop.charAt(0).toUpperCase()}${gop.slice(1)} — chờ Quản lý cơ sở duyệt mới xuất được mã QR`;
}
