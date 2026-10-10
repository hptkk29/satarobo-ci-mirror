// S1 · chọn cơ sở (tab) cho màn Zalo CRM — bộ luật THUẦN, không db, không env.
//
// Chốt 9.7 của kế hoạch: SUPER_ADMIN chọn cơ sở bằng TAB, mỗi tab một phiên SSO vào org
// tương ứng. Ở đây luật được viết một lần cho MỌI vai thay vì rẽ nhánh theo vai:
// danh sách tab = các cơ sở người này nhìn thấy ∩ các cơ sở đã ánh xạ orgCode. Quản lý
// cơ sở ra đúng một tab (khung không hiện thanh tab), quản trị hệ thống ra nhiều tab.
// Không có `if (isSuperAdmin)` nào — thêm cơ sở là thêm dữ liệu, không sửa mã.

// Khuôn `orgCode` lấy từ module thuần dùng chung với nút "Nhắn Zalo" — hai bên PHẢI
// cùng một khuôn, vì bên kia dựng `?org=` còn bên này đọc nó. Chép lại là mở đường cho
// hai khuôn trôi khỏi nhau rồi nút sinh ra thứ màn này loại đi mà không ai thấy.
import { KHUON_ORG_CODE } from "@/lib/integrations/zalocrm/compose-url";

export type CoSoZaloCrm = {
  centerId: string;
  /** `Center.code` — "CS1", "CS2". Khoá của bảng ánh xạ. */
  centerCode: string;
  ten: string;
  /** `Organization.code` bên ZaloCRM. */
  orgCode: string;
};

export type KetQuaChonCoSo = {
  /** Tab hiển thị, đã sắp xếp ổn định theo tên cơ sở. */
  danhSach: CoSoZaloCrm[];
  /** Cơ sở đang mở — `null` khi danh sách rỗng. */
  dangChon: CoSoZaloCrm | null;
  /**
   * `?org=` trên URL trỏ tới thứ người này KHÔNG được xem. Nơi gọi dùng cờ này để báo
   * cho người dùng biết mình đã bị đưa về cơ sở khác, thay vì lặng lẽ đổi tab.
   */
  chonKhongHopLe: boolean;
};

/**
 * Lọc + chọn cơ sở cho màn Zalo CRM.
 *
 * 🔴 `chon` (tham số `?org=` trên URL) TUYỆT ĐỐI KHÔNG được tin: nó chỉ dùng để TÌM
 * trong danh sách đã lọc. Nếu ký vé SSO thẳng theo `?org=` thì một tư vấn viên CS1 gõ
 * `/zalo-crm?org=cs2` là cầm được vé vào tổ chức ZaloCRM của CS2 — và Sata sẽ không báo
 * lỗi gì, vì cổng trang `zalocrm:use` đã cho qua từ trước. Đây là lý do hàm này tồn tại
 * và có test riêng.
 *
 * `visibleCenterIds` là nguồn tầm nhìn duy nhất: nó đã tính sẵn "HO/ROOT ⇒ mọi cơ sở"
 * trong `buildActor`, nên không cần (và không được) rẽ nhánh theo vai ở đây. Mảng rỗng
 * ⇒ danh sách rỗng — fail-closed, không rơi về "cho xem cơ sở đầu tiên".
 *
 * `Center` nằm trong `SCOPE_EXEMPT` nên `scopedDb` KHÔNG lọc hộ; phép giao dưới đây
 * chính là chỗ cách ly cơ sở của màn này.
 */
export function chonCoSoZaloCrm(input: {
  centers: readonly { id: string; code: string | null; name: string }[];
  /** Setting `zalocrm.orgCodes`: khoá = `Center.code`, giá trị = `orgCode`. */
  orgCodes: Readonly<Record<string, string>>;
  visibleCenterIds: readonly string[];
  /** Giá trị `?org=` trên URL — dữ liệu người dùng, chỉ dùng để tra cứu. */
  chon?: string | null;
}): KetQuaChonCoSo {
  const nhinThay = new Set(input.visibleCenterIds);
  const daDung = new Set<string>();
  const danhSach: CoSoZaloCrm[] = [];

  for (const c of input.centers) {
    if (!c.code) continue; // `Center.code` là String? — cơ sở mới có thể chưa đặt mã
    if (!nhinThay.has(c.id)) continue;
    const orgCode = input.orgCodes[c.code];
    if (typeof orgCode !== "string" || !KHUON_ORG_CODE.test(orgCode)) continue;
    // Hai cơ sở khai trùng orgCode là lỗi gõ trong ô JSON. Giữ cơ sở đầu thay vì sinh
    // hai tab dẫn về cùng một nơi — người dùng tưởng mình đổi cơ sở mà không đổi.
    if (daDung.has(orgCode)) continue;
    daDung.add(orgCode);
    danhSach.push({ centerId: c.id, centerCode: c.code, ten: c.name, orgCode });
  }

  // Thứ tự ổn định: tab không được nhảy chỗ giữa hai lần tải trang.
  danhSach.sort((a, b) => a.ten.localeCompare(b.ten, "vi"));

  const yeuCau = typeof input.chon === "string" ? input.chon.trim() : "";
  const khop = yeuCau ? (danhSach.find((c) => c.orgCode === yeuCau) ?? null) : null;

  return {
    danhSach,
    dangChon: khop ?? danhSach[0] ?? null,
    chonKhongHopLe: Boolean(yeuCau) && khop === null && danhSach.length > 0,
  };
}
