// lib/nguon/lead-cho-don-moi.ts — TÌM LEAD CHO ĐƠN MỚI ở hai đường tạo đơn chưa nối `Order.leadId` (PR0b, doc 03 §5.4: O1 · O2).
//
// VÌ SAO: hoa hồng đọc người hưởng SALE / SALE_ADMIN từ `Lead.convertedById` / `Lead.adminId` QUA `Order.leadId` (`commission-run.ts`). Đơn không có `leadId` ⇒ hai tầng đó TREO. Đo prod 06/10: 102/146 đơn chưa chết
// thiếu `leadId`, trải tới đúng ngày đo — tức đường tạo đơn còn đang đẻ thêm. `noi-don.ts` (D8) nối đơn CŨ; tệp này chặn lỗ chảy lại.
//
// LUẬT (cùng gốc D8, SIẾT THÊM hai chỗ sau review độc lập 26/10 — cả hai đều ĐÃ CHẠY THẬT ra lỗi):
//   1. Đơn CÓ học viên ⇒ CHỈ đi theo `Student.leadId` (lead còn sống). KHÔNG lùi về SĐT. SĐT phụ huynh trùng không chứng minh học viên này thuộc hồ sơ lead kia: đơn của bé B bị nối vào lead L của bé C
//      (cùng phụ huynh) thì lúc convert L, `linkRecordedPaymentsToEnrollments` (gom khoản theo `order.leadId`) GẮN TIỀN CỦA B VÀO GHI DANH CỦA C, và lead L bị đẩy sang «Đã đăng ký» vì tiền của bé khác.
//      Và lead đó phải ĐÃ CONVERT (`convertedAt`): `Student.leadId` trỏ lead CHƯA convert thì lần convert sau đó (bé khác của lead) sẽ gom khoản của đơn này (gom theo `order.leadId`, rơi về khớp theo khoá học) về ghi danh của bé khác — reviewer chạy thật 26/10.
//   2. Đơn KHÔNG có học viên (khách lẻ) ⇒ tra theo `canonicalPhone(customerPhone)` khớp `phoneKey(lead.phone)` của lead còn sống (đúng luật D8).
//   Đúng MỘT lead ⇒ MOT (gắn). ≥ 2 lead khác nhau ⇒ NHIEU (KHÔNG tự gắn). 0 ⇒ KHONG. SĐT không chuẩn hoá được ⇒ KHONG, KHÔNG lùi về so chuỗi thô.
//   3. CÁCH LY CƠ SỞ: chỉ xét lead CÙNG cơ sở với đơn (hoặc lead chưa có cơ sở) — gắn lead của cơ sở khác vừa làm hoa hồng chảy sang Sale cơ sở khác, vừa lộ cho người quản lý cơ sở này rằng
//      «SĐT đó có hồ sơ ở cơ sở kia» (thông báo NHIEU, dòng lịch sử `don.tao` ghi lên lead người khác).
//
// Nhận client cho phép KHÔNG scope: quyết định gắn lead là quyết định về QUY CÔNG, không phải quyền XEM; nhưng chính vì không scope nên phép lọc cơ sở ở trên là BẮT BUỘC (`phamVi`).
// Chỉ trả id + loại, không trả tên/SĐT.
import type { PrismaClient } from "@prisma/client";
import { phanLoaiNoiDon } from "@/lib/nguon/noi-don";
import { canonicalPhone, expandPhoneVariants, phoneKey } from "@/lib/phone";

export type KetQuaLeadChoDonMoi =
  | { loai: "MOT"; leadId: string; nguon: "HOC_VIEN" | "SDT" }
  | { loai: "NHIEU"; leadIds: string[]; nguon: "HOC_VIEN" | "SDT" }
  | { loai: "KHONG"; lyDo: "SDT_KHONG_CHUAN_HOA" | "KHONG_CO_LEAD" | "HOC_VIEN_CHUA_NOI_LEAD" };

/** Đủ cho cả `PrismaClient` lẫn `Prisma.TransactionClient`. */
export type DocLead = Pick<PrismaClient, "lead" | "student">;

/**
 * Phạm vi cơ sở của lệnh nối — BẮT BUỘC, không có mặc định (luật 7).
 *  · `"TAT_CA"` — người gọi nhìn được mọi cơ sở (cấp HO/ROOT): không cách ly.
 *  · `{ coSo }` — chỉ lead CÙNG cơ sở hoặc lead chưa có cơ sở. `coSo = null` (đơn chưa có cơ sở) KHÔNG phải «không cách ly» mà là FAIL-CLOSED: chỉ lead chưa có cơ sở.
 *    (Bản trước coi `null` là «không cách ly» — reviewer chỉ ra: người quản lý một cơ sở tạo đơn không khai cơ sở ⇒ nối được lead của MỌI cơ sở, và thông báo NHIEU lộ «SĐT đó có ở cơ sở khác».)
 */
export type PhamViCoSoNoiLead = "TAT_CA" | { coSo: string | null };

const trongPhamVi = (leadCenterId: string | null, pv: PhamViCoSoNoiLead): boolean => pv === "TAT_CA" || leadCenterId === null || leadCenterId === pv.coSo;

export async function leadChoDonMoi(
  c: DocLead,
  p: {
    customerPhone: string | null | undefined;
    hocVienIds: readonly string[];
    /** BẮT BUỘC (luật 7): xem `PhamViCoSoNoiLead`. */
    phamVi: PhamViCoSoNoiLead;
  },
): Promise<KetQuaLeadChoDonMoi> {
  const hocVienIds = [...new Set(p.hocVienIds.filter((x) => x.trim().length > 0))];

  // 1. Đơn có học viên ⇒ CHỈ theo Student.leadId.
  if (hocVienIds.length > 0) {
    const hv = await c.student.findMany({ where: { id: { in: hocVienIds } }, select: { leadId: true } });
    const leadIds = [...new Set(hv.map((h) => h.leadId).filter((x): x is string => !!x))];
    if (leadIds.length === 0) return { loai: "KHONG", lyDo: "HOC_VIEN_CHUA_NOI_LEAD" };
    const song = (await c.lead.findMany({ where: { id: { in: leadIds }, deletedAt: null, convertedAt: { not: null } }, select: { id: true, centerId: true } })).filter((l) => trongPhamVi(l.centerId, p.phamVi));
    const loai = phanLoaiNoiDon(song.map((l) => ({ leadId: l.id })));
    if (loai === "MOT") return { loai: "MOT", leadId: song[0]!.id, nguon: "HOC_VIEN" };
    if (loai === "NHIEU") return { loai: "NHIEU", leadIds: song.map((l) => l.id).sort(), nguon: "HOC_VIEN" };
    return { loai: "KHONG", lyDo: "HOC_VIEN_CHUA_NOI_LEAD" };
  }

  // 2. Đơn khách lẻ (không học viên) ⇒ theo SĐT.
  const khoa = canonicalPhone(p.customerPhone);
  if (khoa === null) return { loai: "KHONG", lyDo: "SDT_KHONG_CHUAN_HOA" };
  const rows = await c.lead.findMany({
    where: { deletedAt: null, phone: { in: expandPhoneVariants([p.customerPhone]) } },
    select: { id: true, phone: true, centerId: true },
  });
  const ungVien = rows.filter((r) => phoneKey(r.phone) === khoa && trongPhamVi(r.centerId, p.phamVi));
  const loai = phanLoaiNoiDon(ungVien.map((r) => ({ leadId: r.id })));
  if (loai === "KHONG") return { loai: "KHONG", lyDo: "KHONG_CO_LEAD" };
  if (loai === "NHIEU") return { loai: "NHIEU", leadIds: [...new Set(ungVien.map((r) => r.id))].sort(), nguon: "SDT" };
  return { loai: "MOT", leadId: ungVien[0]!.id, nguon: "SDT" };
}
