/**
 * lib/affiliate/tu-tao-link.ts — ĐỐI TÁC TỰ TẠO LINK trên cổng `/portal/gioi-thieu` (AFF-WEB): chọn Campaign → Website → Trang đích → Tạo → Copy / QR.
 *
 * ── Không có đường ghi thứ hai ─────────────────────────────────────────────────────────────────────────────────────
 * Hàm này CHỈ chuẩn bị đầu vào rồi gọi `phatLink` (`ghi-link.ts`) — cùng hàm với tab «Link / QR / Mã» của Admin. Nghĩa là mọi luật còn nguyên: khoá campaign → website → membership,
 * `kiemPhatLink` → `kiemChuoiLink` (đối tác ACTIVE, membership trong cửa sổ ngày, campaign đang chạy, website ACTIVE ∧ bật theo dõi ∧ ĐÃ GẮN campaign, trang đích bật), hạn mức
 * `SO_LINK_HOAT_DONG_TOI_DA` link/membership, token ngẫu nhiên thử lại khi đụng khoá, nhật ký cùng transaction.
 *
 * ── Cổng riêng của cổng đối tác (làm TRƯỚC `phatLink`, vì `phatLink` tin chủ thể đã được xác thực) ──────────────────
 *  1. SỞ HỮU nằm TRONG truy vấn: membership phải thuộc một đối tác mà tài khoản VÀO ĐƯỢC (`partyIdsVaoDuoc` — cùng hàm với menu và trang cổng: bảng nối ACTIVE ∪ cột legacy). `userId` lấy từ PHIÊN; `partyId` suy từ DB — client KHÔNG gửi `partyId`, `type`, hay bất kỳ id
 *     nào khác ngoài `membershipId` / `siteId` (lược đồ `.strict()` từ chối khoá lạ). Membership của người khác ra cùng một câu lỗi với membership không tồn tại.
 *  2. Trang đích: CHỈ trang `isActive` ∧ mẫu «đúng» KHÔNG có dấu `*`. `kiemPhatLink` thì chấp nhận cả mẫu tiền tố (`/khoa-hoc/*` khớp `/khoa-hoc/bat-ky`) — nhưng đối tác tự gõ đường dẫn nào cũng được nếu để nó
 *     quyết; ở cổng này đường dẫn đối tác gửi PHẢI bằng đúng MỘT mẫu «đúng» đang bật của website. Giấu trang wildcard ở giao diện là chưa đủ: server tự kiểm lại.
 *  3. Loại link luôn `LINK` (QR dựng từ chính link đó, theo yêu cầu, không phải một dòng riêng).
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { phatLink, type KetQuaPhatLink } from "./ghi-link";
import { DO_DAI_NHAN_LINK_TOI_DA } from "./ghi-link-dau-vao";
import { partyIdsVaoDuoc } from "./tai-khoan-truy-cap";
import { chuanHoaDuongDanMau } from "./website-hop-le";
import type { NguoiGhi } from "./chung";

const idChuoi = z.string().trim().min(1).max(64);

export const tuTaoLinkSchema = z
  .object({
    membershipId: idChuoi,
    siteId: idChuoi,
    /** Trang đích đã chọn (AFF-L6). Tên miền KHÔNG nhận từ client — suy từ DÒNG trang đích ở `phatLink`. */
    landingPageId: idChuoi.nullish().transform((v) => (v ? v : null)),
    landingPath: z.string().max(300),
    label: z
      .string()
      .trim()
      .max(DO_DAI_NHAN_LINK_TOI_DA)
      .nullish()
      .transform((v) => (v && v !== "" ? v : null)),
  })
  .strict();

const KHONG_THAY_CHUONG_TRINH = "Không tìm thấy chương trình của bạn.";

export async function tuTaoLink(p: { nguoi: NguoiGhi; vao: unknown; now: Date }): Promise<KetQuaPhatLink> {
  const kq = tuTaoLinkSchema.safeParse(p.vao);
  if (!kq.success) {
    const i = kq.error.issues[0];
    return { ok: false, loi: i?.message ?? "Dữ liệu không hợp lệ.", truong: typeof i?.path[0] === "string" ? i.path[0] : "chung" };
  }
  const v = kq.data;

  // 1. Sở hữu — trong truy vấn. Người khác / không tồn tại ⇒ cùng một câu. Cùng điểm vào `partyIdsVaoDuoc` với menu và trang: tài khoản bị TẠM NGỪNG / GỠ liên kết không tạo được link.
  const duocVao = await partyIdsVaoDuoc(p.nguoi.userId);
  const m = duocVao.length === 0 ? null : await db.affiliateMembership.findFirst({ where: { id: v.membershipId, partyId: { in: duocVao } }, select: { id: true, partyId: true } });
  if (!m) return { ok: false, loi: KHONG_THAY_CHUONG_TRINH, truong: "membershipId" };

  // 2. Trang đích: đúng MỘT mẫu «đúng» (không `*`) đang bật của website đã chọn.
  const mau = chuanHoaDuongDanMau(v.landingPath);
  if (!mau.ok || mau.kieu !== "CHINH_XAC") return { ok: false, loi: "Chọn một trang đích trong danh sách.", truong: "landingPath" };
  // AFF-L6: theo ID (+ đúng website, đang bật, bật theo dõi, mẫu «đúng» khớp đường dẫn gửi lên). Cùng đường dẫn ở hai tên miền là hai trang đích — id mới phân biệt được.
  const trang = await db.affiliateLandingPage.findFirst({
    // Không gửi `landingPageId` (client cũ) ⇒ trang đích trên TÊN MIỀN CỦA WEBSITE (`hostKey` rỗng); gửi ⇒ đúng trang đó, ở tên miền của nó.
    where: { ...(v.landingPageId ? { id: v.landingPageId } : { hostKey: "" }), siteId: v.siteId, isActive: true, trackingEnabled: true, pathPattern: mau.mau },
    select: { id: true },
  });
  if (!trang) return { ok: false, loi: "Trang đích này không còn trong danh sách được phép — hãy tải lại trang.", truong: "landingPath" };

  // 3. MỘT đường ghi: `phatLink`. Cổng chuỗi + hạn mức nằm trong đó.
  return phatLink({
    nguoi: p.nguoi,
    vao: { partyId: m.partyId, membershipId: m.id, siteId: v.siteId, landingPageId: trang.id, landingPath: mau.mau, type: "LINK", label: v.label },
    now: p.now,
  });
}
