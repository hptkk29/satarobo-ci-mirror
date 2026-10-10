// Tab "Nick Zalo CRM" — giao từng nick cho một người.
//
// Server Component: nạp dữ liệu rồi đưa xuống bảng client. Không có nút "Đồng bộ" thủ
// công, vì lý do dưới đây.
//
// ── 🔴 VÌ SAO ĐỒNG BỘ NGAY KHI MỞ MÀN ─────────────────────────────────────────────────
// `ZaloCrmNick` do WEBHOOK tạo, và webhook chỉ biết mã tài khoản — không biết TÊN nick
// lẫn trạng thái kết nối (`nap-su-kien.ts` ghi `status: "UNKNOWN"`, `displayName` để
// trống). Tên thật chỉ về khi ai đó bấm "Đồng bộ nick" ở màn Tích hợp.
//
// Đo được 24/09 trên prod: bảng hiện hai dòng "(chưa có tên) · UNKNOWN" — người dùng
// không có cách nào biết nick nào là nick nào, và cũng không có lý do gì để đoán rằng
// câu trả lời nằm ở một màn khác. Bắt người vận hành nhớ một nút ở nơi khác là thiết kế
// hỏng, không phải thiếu hướng dẫn.
//
// `dongBoNick` an toàn để gọi ở đây: nó nuốt mọi lỗi thành kết quả, và nó CHỈ ghi
// `sataUserId` khi khớp được một `User` có thật qua `externalId` — nên nó không đè lên
// phần giao nick mà màn này vừa ghi.
import { resolveActor } from "@/lib/auth/actor";
import { auth } from "@/lib/auth";
import { scopedDb } from "@/lib/db-scope";
import { docTongQuanNick, dongBoNick } from "@/lib/integrations/zalocrm/nick-admin";
import { nguoiNhanDuocNick, type NguoiNhanDuoc } from "@/lib/integrations/zalocrm/giao-nick";
import { isZalocrmEnabled } from "@/lib/flags";
import { EmptyState } from "@/components/admin/ui/states";
import { BangNickZalo } from "./tab-nick-zalo-bang";

export async function TabNickZalo() {
  if (!isZalocrmEnabled()) {
    return (
      <EmptyState
        title="Zalo CRM chưa bật"
        description="Tính năng đang tắt trên môi trường này. Bật bằng biến môi trường ZALOCRM_ENABLED rồi triển khai lại."
      />
    );
  }

  const session = await auth();
  if (!session?.user?.id) return null;
  const actor = await resolveActor(session.user.id);
  const tamNhin = {
    isSuperAdmin: actor.isSuperAdmin,
    isHoLevel: actor.isHoLevel,
    visibleCenterIds: actor.visibleCenterIds,
  };

  // Lấy tên + trạng thái thật về TRƯỚC khi đọc bảng. Không chặn màn nếu hỏng: `dongBoNick`
  // không bao giờ ném, và bảng vẫn dựng được từ dữ liệu đang có.
  await dongBoNick(tamNhin).catch(() => []);

  const { rows } = await docTongQuanNick(tamNhin);
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Chưa có nick Zalo nào"
        description="Nick hiện ở đây sau khi được quét mã QR trong Zalo CRM và có tin nhắn đầu tiên. Nếu cơ sở của bạn đã có nick mà bảng vẫn trống, nick đó chưa được ánh xạ sang cơ sở nào."
      />
    );
  }

  // Ô chọn người: chỉ nạp cho những cơ sở ĐANG có nick trên màn — nạp cho mọi cơ sở là
  // một câu tra cho mỗi cơ sở mà phần lớn không ai mở tới.
  const sdb = scopedDb(actor);
  const centerIds = [...new Set(rows.map((r) => r.centerId).filter((v): v is string => !!v))];
  const coSo = centerIds.length
    ? await sdb.center.findMany({ where: { id: { in: centerIds } }, select: { id: true, code: true } })
    : [];
  const nguoiTheoCoSo: Record<string, NguoiNhanDuoc[]> = {};
  for (const c of coSo) {
    if (!c.code) continue;
    nguoiTheoCoSo[c.id] = await nguoiNhanDuocNick(c.code);
  }

  return (
    <BangNickZalo
      rows={rows.map((r) => ({
        zcrmAccountId: r.zcrmAccountId,
        displayName: r.displayName,
        status: r.status,
        centerId: r.centerId,
        centerName: r.centerName,
        giao: r.giao,
      }))}
      nguoiTheoCoSo={nguoiTheoCoSo}
    />
  );
}
