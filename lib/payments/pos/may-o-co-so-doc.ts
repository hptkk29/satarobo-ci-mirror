import "server-only";
// lib/payments/pos/may-o-co-so-doc.ts — NẠP mục "Máy POS quẹt thẻ" của MỘT cơ sở (Việc 2, 09/10/2026).
// Thiết kế: docs/pos-hai-nut-khai-may.md §2.3.
//
// ── GÁC HAI LỚP, Ở MỘT CHỖ ───────────────────────────────────────────────────────────────────────────────────────
// Trang `/centers/<id>/edit` KHÔNG có cổng quyền ở đầu và `Center` ∈ SCOPE_EXEMPT ⇒ mở bằng id bất kỳ. Nên loader tự gác:
//   1. CÁCH LY CƠ SỞ — `passesScope("PosTerminal", { centerId }, actor)`. KHÔNG thay bằng `checkPermission(…, target)`:
//      `payments:view` seed GLOBAL ⇒ `can()` vứt đích (khuôn `[PTTT-11]`).
//   2. CHỨC NĂNG — `payments:view` (xem) / `payments:import-pos` (ghi), kết quả do TRANG hỏi rồi truyền vào (loader không
//      gọi `auth()` — nhờ vậy test dựng được mà không cần phiên).
// Không được xem ⇒ trả `null` TRƯỚC mọi câu đọc: "không quyền ⇒ không đọc, không vẽ".
//
// ── PHẠM VI GHI ──────────────────────────────────────────────────────────────────────────────────────────────────
// `scopedDb` KHÔNG che write. Loader chỉ ĐỌC; ba action trong `centers/_may-pos-actions.ts` tự `passesScope` + hỏi
// `nhapPosDuocMoiCoSo`. `quyen.sua` ở đây chỉ quyết VẼ nút — cùng định nghĩa với action (`duocKhaiMayPos`), không phải cổng.
//
// Luật 19: `now` truyền vào, không đọc đồng hồ thật.
import type { Actor } from "@/lib/auth/actor";
import { passesScope, type scopedDb } from "@/lib/db-scope";
import { docSucKhoeAgent } from "./agent/suc-khoe-doc";
import { quyenMayPos, type DongMayCoSo, type MucMayPosView } from "./may-o-co-so";
import { dongAgentCuaMay } from "./may-o-co-so-agent";
import { nhapPosDuocMoiCoSo } from "./pham-vi-nhap";

type Sdb = ReturnType<typeof scopedDb>;

export async function docMucMayPos(a: {
  /** `scopedDb(actor)` của người xem. */
  sdb: Sdb;
  actor: Actor;
  coSo: { id: string; name: string; isActive: boolean };
  /** `payments:view` hỏi kèm đích. */
  coQuyenXem: boolean;
  /** `payments:import-pos` — cũng là cổng ĐỌC trạng thái POS Agent (cùng cổng với `/bien-dong-so-du/pos-agent`). */
  coQuyenGhi: boolean;
  now: Date;
}): Promise<MucMayPosView | null> {
  const quyen = quyenMayPos({
    trongPhamVi: passesScope("PosTerminal", { centerId: a.coSo.id }, a.actor),
    coQuyenXem: a.coQuyenXem,
    coQuyenGhi: a.coQuyenGhi,
    phamViGhiMoiCoSo: nhapPosDuocMoiCoSo(a.actor),
    coSoDangHoatDong: a.coSo.isActive,
  });
  if (!quyen.xem) return null;

  // MỘT lô: câu đọc máy và (chỉ khi được xem sức khoẻ agent) bộ đọc agent không cần nhau.
  const [may, suKhoe] = await Promise.all([
    a.sdb.posTerminal.findMany({
      // `where` theo CƠ SỞ ĐANG MỞ (câu hỏi của màn này); `scopedDb` lọc thêm theo tầm nhìn người xem. Hai tầng, hai câu hỏi.
      where: { centerId: a.coSo.id },
      orderBy: [{ active: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        maThietBi: true,
        maQuay: true,
        ten: true,
        // GĐ2 POS — ba mã Techcombank cấp (cho GĐ4 agent); hiển thị + sửa ở hộp thoại.
        maCuaHang: true,
        maNhaCungCap: true,
        maTcbQuay: true,
        active: true,
        createdAt: true,
      },
    }),
    a.coQuyenGhi ? docSucKhoeAgent(a.sdb, a.now) : Promise.resolve(null),
  ]);

  // Bộ đọc agent trả agent của MỌI cơ sở người xem thấy (Kế toán HO: tất cả) — chỉ giữ agent của cơ sở NÀY.
  const agentsCoSo = suKhoe ? suKhoe.agents.filter((x) => x.centerId === a.coSo.id) : null;

  const rows: DongMayCoSo[] = may.map((m) => {
    const dong = {
      id: m.id,
      maThietBi: m.maThietBi,
      maQuay: m.maQuay,
      ten: m.ten,
      maCuaHang: m.maCuaHang,
      maNhaCungCap: m.maNhaCungCap,
      maTcbQuay: m.maTcbQuay,
      active: m.active,
      // ISO để client tự định dạng — Date không qua được ranh giới server/client nguyên vẹn.
      taoLuc: m.createdAt.toISOString(),
    };
    return {
      ...dong,
      // Ghép CHẶT máy → agent dùng chính các ô của dòng vừa dựng (không chép lại từng ô thêm một lần nữa).
      agent: agentsCoSo ? dongAgentCuaMay({ ...dong, centerId: a.coSo.id }, agentsCoSo, a.now) : null,
    };
  });

  return {
    coSo: { id: a.coSo.id, ten: a.coSo.name, dangHoatDong: a.coSo.isActive },
    quyen,
    // Link "Mở Biến động số dư" chỉ khi người xem chắc chắn mở được trang đó: `payments:view` là một trong ba quyền của cổng
    // trang ấy (`bien-dong-so-du/page.tsx`); `import-pos` KHÔNG mở cửa trang.
    moDuocBienDong: a.coQuyenXem,
    may: rows,
  };
}
