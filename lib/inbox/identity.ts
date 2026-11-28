import "server-only";
// lib/inbox/identity.ts — DANH TÍNH NGOÀI ↔ `Lead`, tầng chạm DB.
//
// Luật quyết định nằm ở `identity-rules.ts` (thuần, có test). File này chỉ đi lấy
// ứng viên và ghi kết quả.
//
// ⚠️ Đọc `Lead` ở đây dùng `db` TRẦN chứ không `scopedDb`, CÓ CHỦ ĐÍCH: đường ghi
// này chạy từ WEBHOOK — không có actor, không có phiên. Đổi lại nó chỉ ĐỌC đúng
// `id`/`orgUnitId` để nối và suy đơn vị, KHÔNG trả nội dung nào ra ngoài. Mọi
// đường đọc CÓ NGƯỜI đều qua `lib/inbox/queries.ts`, và ở đó `Lead` đi qua
// `scopedDb`.
import { db } from "@/lib/db";
import { phoneVariants } from "@/lib/phone";
import {
  dieuKienDonViLead,
  quyetDinhNoiTheoSdt,
  type QuyetDinhNoiLead,
} from "@/lib/inbox/identity-rules";
import { lanDonViTuIdentity } from "@/lib/inbox/don-vi";
import type { InboxIdentityLinkSource } from "@prisma/client";

/**
 * Tìm lead theo SĐT, trong phạm vi đơn vị của hội thoại.
 *
 * ⚠️ BẮT BUỘC `{ in: phoneVariants(x) }`, KHÔNG so bằng: DB còn tồn tại CẢ HAI
 * định dạng (`0…` và `84…` — đo trên DEV 03/08: 99 và 8 bản). So bằng một dạng là
 * bỏ sót đúng nửa dữ liệu mà không có dấu hiệu nào.
 *
 * ⚠️ `orgUnitId` là THAM SỐ, không phải `scopedDb`. Hàm này chạy từ webhook — không
 * actor, không phiên — nên bọc `scopedDb` vào đây là webhook không nối được lead
 * nào (đúng bài học `lib/payments/method-lookup.ts`: câu tra dùng để CHẶN phải là
 * câu tra KHÔNG-SCOPE, nếu không thì đúng dòng cần xét bị lọc mất và cổng đọc
 * "không thấy gì" thành "cho qua").
 */
export async function timLeadTheoSdt(
  sdt: unknown,
  orgUnitId?: string | null,
): Promise<{ id: string }[]> {
  const bienThe = phoneVariants(sdt);
  if (bienThe.length === 0) return [];
  return db.lead.findMany({
    where: {
      phone: { in: bienThe },
      deletedAt: null,
      // Chỉ có ĐÚNG MỘT `OR` trong `where` này — mảnh đơn vị không bị `OR` nào khác
      // nuốt. Thêm điều kiện `OR` thứ hai vào đây thì phải gộp bằng `AND` (cùng bài
      // học với `inboxOrgScopeWhere`, `scope.ts`).
      ...dieuKienDonViLead(orgUnitId),
    },
    select: { id: true },
    // Trần 2: chỉ cần biết "đúng một" hay "nhiều hơn một" (`quyetDinhNoiTheoSdt`).
    take: 2,
  });
}

/**
 * Thử nối tự động một danh tính với `Lead` theo SĐT vừa biết được.
 *
 * Chỉ nối khi có ĐÚNG MỘT phiếu khớp. Mọi ca còn lại để MỒ CÔI cho người xử lý —
 * nối nhầm nghĩa là hội thoại của khách A nằm trong hồ sơ khách B, và nó chỉ lộ ra
 * lúc Sale gọi nhầm người.
 */
export async function thuNoiTheoSdt(input: {
  identityId: string;
  sdt: unknown;
  /**
   * Đơn vị của hội thoại (từ nick / từ người phụ trách). Bỏ trống = chưa biết ⇒ tra
   * toàn hệ như trước. Truyền vào là chặn nối chéo cơ sở — xem `dieuKienDonViLead`.
   */
  orgUnitId?: string | null;
}): Promise<QuyetDinhNoiLead> {
  const ungVien = await timLeadTheoSdt(input.sdt, input.orgUnitId);
  const qd = quyetDinhNoiTheoSdt(input.sdt, ungVien);
  if (!qd.noi) return qd;
  await noiIdentityVaoLead({
    identityId: input.identityId,
    leadId: qd.leadId,
    source: "PHONE_MATCH",
    boiUserId: null,
  });
  return qd;
}

/**
 * Nối một danh tính vào `Lead` và LAN đơn vị xuống cả hội thoại lẫn tin nhắn.
 *
 * Lan `orgUnitId` là phần dễ quên nhất: không lan thì hội thoại vẫn nằm trong nhóm
 * mồ côi (ai cũng thấy) dù đã biết nó thuộc cơ sở nào — tức cách ly cơ sở không
 * bao giờ bật lên. Phép lan nằm ở `lib/inbox/don-vi.ts` và CHỈ có một bản.
 *
 * `Lead` là nguồn đơn vị MẠNH NHẤT — nó ghi đè cả đơn vị do nick/người phụ trách
 * gắn trước đó (hồ sơ khách thật thắng phỏng đoán từ kênh).
 */
export async function noiIdentityVaoLead(input: {
  identityId: string;
  leadId: string;
  source: InboxIdentityLinkSource;
  boiUserId: string | null;
}): Promise<void> {
  const lead = await db.lead.findUnique({
    where: { id: input.leadId },
    select: { id: true, orgUnitId: true },
  });
  if (!lead) return;

  await db.$transaction((tx) =>
    lanDonViTuIdentity(tx, {
      identityId: input.identityId,
      orgUnitId: lead.orgUnitId,
      themVaoDanhTinh: {
        leadId: lead.id,
        linkedAt: new Date(),
        linkedById: input.boiUserId,
        linkSource: input.source,
      },
    }),
  );
}

/** Gỡ nối — hội thoại quay lại nhóm mồ côi. Dùng khi nối nhầm. */
export async function goNoiIdentity(input: {
  identityId: string;
  boiUserId: string | null;
}): Promise<void> {
  await db.$transaction((tx) =>
    lanDonViTuIdentity(tx, {
      identityId: input.identityId,
      // Gỡ nối là đường DUY NHẤT được phép ghi `null` xuống đơn vị: người đã xác
      // nhận nối nhầm, hội thoại phải quay về hàng đợi chung để cơ sở khác nhận.
      orgUnitId: null,
      themVaoDanhTinh: {
        leadId: null,
        linkedAt: null,
        linkedById: input.boiUserId,
        linkSource: null,
      },
    }),
  );
}
