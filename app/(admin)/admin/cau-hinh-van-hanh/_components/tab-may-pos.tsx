// Tab "Máy POS" — khai máy SmartPOS Techcombank thuộc cơ sở nào (docs/pos-the-smartpos.md).
//
// Server Component: nạp danh sách máy + danh sách cơ sở rồi đưa xuống bảng client.
//
// ── PHẠM VI ─────────────────────────────────────────────────────────────────────────────
// Câu đọc `posTerminal` KHÔNG có `where` theo cơ sở — cố ý: `PosTerminal` ∈ SCOPED_MODELS
// (prefix `payments:`), `scopedDb` tự lọc. Kế toán HO (neo vai tại HO) thấy mọi máy; ai
// neo ở một cơ sở chỉ thấy máy của cơ sở đó.
//
// Danh sách cơ sở CHỌN ĐƯỢC đi qua `loadCenterPaymentOptions` — nguồn đã có sẵn cho câu
// hỏi "người này gán được vào cơ sở nào" (`Center` ∈ SCOPE_EXEMPT nên phải lọc tay, và hàm
// đó là chỗ lọc). Mở cơ sở mới là thêm `Center`, không sửa gì ở đây.
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb } from "@/lib/db-scope";
import { loadCenterPaymentOptions } from "@/lib/payments/center-options";
import { nhapPosDuocMoiCoSo } from "@/lib/payments/pos/pham-vi-nhap";
import { BangMayPos, type DongMayPos } from "./tab-may-pos-bang";

export async function TabMayPos() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const [may, moiCoSo, coSoChonDuoc, moXem, moGhi, moQuanLy] = await Promise.all([
    sdb.posTerminal.findMany({
      orderBy: [{ active: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        maThietBi: true,
        maQuay: true,
        ten: true,
        // GĐ2 POS — ba mã Techcombank cấp (cho GĐ4 agent); hiển thị + sửa ở bảng.
        maCuaHang: true,
        maNhaCungCap: true,
        maTcbQuay: true,
        centerId: true,
        active: true,
        createdAt: true,
      },
    }),
    // Tên của MỌI cơ sở (kể cả đã ngừng) — máy cũ có thể nằm ở cơ sở đã đóng, và bảng
    // phải in tên chứ không in mã máy.
    sdb.center.findMany({ select: { id: true, name: true } }),
    loadCenterPaymentOptions(actor),
    // Câu nhắc "import lại file" chỉ kèm LINK sang Biến động số dư khi người xem mở được màn
    // đó — cổng của trang ấy là MỘT trong ba quyền dưới (`bien-dong-so-du/page.tsx`), còn
    // `payments:import-pos` KHÔNG mở cửa trang. Vẽ link cho người sẽ bị đá về /dashboard là
    // lời hứa suông (luật 12).
    checkPermission("payments:view"),
    checkPermission("payments:record"),
    checkPermission("payments:manage"),
  ]);
  const tenCoSo = new Map(moiCoSo.map((c) => [c.id, c.name]));

  const rows: DongMayPos[] = may.map((m) => ({
    id: m.id,
    maThietBi: m.maThietBi,
    maQuay: m.maQuay,
    ten: m.ten,
    maCuaHang: m.maCuaHang,
    maNhaCungCap: m.maNhaCungCap,
    maTcbQuay: m.maTcbQuay,
    centerId: m.centerId,
    tenCoSo: tenCoSo.get(m.centerId) ?? null,
    active: m.active,
    // ISO để client tự định dạng — Date không qua được ranh giới server/client nguyên vẹn.
    taoLuc: m.createdAt.toISOString(),
  }));

  return (
    <BangMayPos
      rows={rows}
      coSo={coSoChonDuoc}
      moDuocBienDong={moXem || moGhi || moQuanLy}
      // Cùng cổng phạm vi mà `_may-pos-actions.ts` hỏi (quyền đã được hỏi để vào tab này).
      choSua={nhapPosDuocMoiCoSo(actor)}
    />
  );
}
