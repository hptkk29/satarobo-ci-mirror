import { withCron } from "@/lib/cron/handler";
import {
  formatDriftMarkdown,
  pruneDriftLog,
  runDriftReport,
  saveDriftRun,
} from "@/lib/org/drift-report";

export const dynamic = "force-dynamic";

// ⚠️ Job này chạy 52 truy vấn đếm TUẦN TỰ. Đo thật 11/08 từ máy dev ở VN qua transaction
// pooler tới Supabase ap-northeast-1: **35 giây** — quá mặc định 15s của Vercel Function.
//
// Phần lớn 35s đó là ĐỘ TRỄ ĐƯỜNG TRUYỀN chứ không phải công việc thật (52 lượt đi-về ×
// ~600ms). Trên Vercel region `hnd1` (Tokyo, cùng vùng với DB) độ trễ mỗi lượt còn vài
// mili-giây nên thực tế sẽ nhanh hơn hàng chục lần. NHƯNG "chắc là sẽ nhanh" không phải
// lưới an toàn: nếu nó vượt mặc định thì job chết lặng và ta mất đúng thứ đang dựng ra để
// phát hiện lệch. Khai tường minh 60s.
//
// Nếu về sau số bảng tăng làm job chạm trần này, cách sửa ĐÚNG là gộp 52 câu đếm thành
// MỘT câu (UNION ALL), không phải nâng tiếp maxDuration.
export const maxDuration = 60;

// Nền Hệ thống P1 · US-07 AC3 — đối soát `centerId` ↔ `orgUnitId` hằng đêm, 03:00 VN
// (vercel.json: 0 20 * * * UTC). Chạy SAU cron đối soát nhóm chat (02:00) để hai job
// nặng không đè nhau.
//
// VÌ SAO CẦN CHẠY MÃI, KHÔNG PHẢI MỘT LẦN. PR-A (15/06) đã backfill `orgUnitId` cho 28
// bảng; vậy mà 05/08 vẫn phải viết `scripts/backfill-enrollment-center.ts` vá tay đúng
// thứ migration 20260624010000 đã backfill hồi 24/06 — vì đường ghi mới tiếp tục đẻ dòng
// thiếu. Cơ chế ghi kép (lib/org/dual-write.ts) bịt phần lớn, nhưng đường nào đi thẳng
// SQL (`$executeRaw`, migration, script) thì không qua nó. Job này là lưới cuối.
//
// CHỈ ĐỌC + ghi nhật ký. KHÔNG tự sửa dữ liệu: sửa mù trên 52 bảng lúc 3h sáng là cách
// nhanh nhất biến một lỗi nhỏ thành sự cố lớn. Muốn vá thì chạy tay
// `scripts/nen-p1-backfill-orgunit.ts --apply` sau khi đọc báo cáo.
//
// Luật cứng #8 ("không cron nào GHI thay đổi quyền") KHÔNG bị chạm: job này không đụng
// UserOrgRole/PermissionGrant/RoleDef; `orgUnitId` ở đây là cột dữ liệu nghiệp vụ, và tới
// hết P4 phạm vi quyền vẫn resolve theo `centerId`.
//
// withCron = verifyCronAuth (CRON_SECRET, sai/thiếu → 401 trước mọi việc) + try/catch JSON.
export const GET = withCron("orgunit-drift", async () => {
  const rep = await runDriftReport();
  const runId = await saveDriftRun(rep, "cron đêm");
  const pruned = await pruneDriftLog(30); // AC3 — "log giữ 30 ngày"

  // In cả bảng Markdown ra log: khi có lệch, người trực đọc được ngay trong Vercel log
  // mà không phải mở DB.
  console.log(`[orgunit-drift] ${formatDriftMarkdown(rep)}`);

  return {
    ok: true,
    data: {
      runId,
      tablesChecked: rep.tablesChecked,
      driftCount: rep.drift.length,
      totalRows: rep.totalRows,
      durationMs: rep.durationMs,
      prunedRuns: pruned,
      // Mẫu số = 0 thì "0 lệch" KHÔNG chứng minh được gì (prod dọn sạch dữ liệu 01/08).
      // Trả cờ này ra để dashboard/cổng P4 không đếm nhầm một đêm rỗng là một đêm sạch.
      inconclusive: rep.totalRows === 0,
      drift: rep.drift.map((d) => ({
        model: d.model,
        nullMeaning: d.nullMeaning,
        scoped: d.scoped,
        totalRows: d.totalRows,
        missingOrgUnit: d.missingOrgUnit,
        mismatched: d.mismatched,
      })),
    },
  };
});
