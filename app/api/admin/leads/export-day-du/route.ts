// GET /api/admin/leads/export-day-du — XUẤT TOÀN BỘ THÔNG TIN lead + NGUỒN ĐẦY ĐỦ từng lead (xlsx nhiều sheet).
//
// Một dòng mỗi lead ở sheet «Du lieu» (mọi cột của phiếu + toàn bộ quy nguồn), kèm sheet con: Con · Tin hieu nguon · Lich su trang thai · (Lich su cham soc — chỉ khi có quyền xem PII).
// Luật dữ liệu + che PII ở `lib/nguon/xuat-lead-day-du.ts`; đường này chỉ làm: phiên → CỔNG XUẤT → quyền PII → đọc → dựng tệp → NHẬT KÝ.
//
// Cổng: `chanXuat("lead-day-du")` = vai được phân quyền ở Cấu hình vận hành → Quyền xuất dữ liệu (mặc định CHỈ quản trị tối cao) ∧ `leads:export`. Lead đọc qua `scopedDb` nên người xuất cấp cơ sở chỉ
// nhận lead của cơ sở mình. Khác `/api/admin/leads/export` (15 cột, mặc định QLCS): đường kia KHÔNG đổi — đừng gộp hai đường, vì thêm cột vào nó là âm thầm giao PII mới cho vai đã có quyền cũ.
import { NextResponse } from "next/server";
import { resolveActor } from "@/lib/auth/actor";
import { requireLiveSession } from "@/lib/auth/live-session";
import { canViewLeadPii, checkPermissionDetail } from "@/lib/auth/check-permission";
import { writeAudit } from "@/lib/audit/audit-log";
import { getAuditActor } from "@/lib/audit/log";
import { tenTepAnToan } from "@/lib/cham-cong/xuat-bang";
import { chanXuat } from "@/lib/export/chan-xuat";
import { exportWatermark } from "@/lib/export/watermark";
import { docLeadDayDu } from "@/lib/nguon/xuat-lead-day-du";
import { dungTepLeadDayDu } from "@/lib/nguon/xuat-lead-day-du-tep";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireLiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const chan = await chanXuat("lead-day-du", session);
  if (chan) return chan;

  // PII: cùng hai câu hỏi với `/api/admin/leads/export` — xem được PII nói chung, và trường `phone` có bị DENY riêng không (DENY cấp trường ⇒ vẫn che SĐT dù có PII).
  const canViewPii = await canViewLeadPii();
  const { fieldMask } = await checkPermissionDetail("leads:view-pii");
  const phoneHienDuoc = canViewPii && !fieldMask.includes("phone");

  const actor = await resolveActor(session.user.id);
  const kq = await docLeadDayDu(actor, { canViewPii, phoneHienDuoc });

  const now = new Date();
  const { actorId, actorName } = getAuditActor(session);
  const wb = dungTepLeadDayDu(kq, exportWatermark(actorName, actorId, kq.tong, now));
  const buf = Buffer.from(await wb.xlsx.writeBuffer());

  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "export",
    entityType: "Export",
    entityId: `lead-day-du:${now.toISOString().slice(0, 10)}`,
    action: "EXPORT",
    newValues: { man: "lead-day-du", soLead: kq.tong, soCot: kq.cotLead.length, soSheet: 1 + kq.bangPhu.length, daChePii: kq.daChePii },
  });

  const ten = tenTepAnToan(`lead-day-du-${now.toISOString().slice(0, 10)}`);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${ten}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
