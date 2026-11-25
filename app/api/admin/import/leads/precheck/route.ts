import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { expandPhoneVariants } from "@/lib/phone";
import { resolveActor } from "@/lib/auth/actor";
import {
  scopedDb,
  getModelVisibleCenterIds,
  logScopeBypass,
} from "@/lib/db-scope";
import { normalizePhone } from "@/lib/lead/import";
import { checkPermission } from "@/lib/auth/check-permission";

// POST /api/admin/import/leads/precheck — đối chiếu SĐT trong file với lead ĐÃ CÓ
// trong CRM để báo ngay ở bước preview (kèm tên PH + tên con cho Sale duyệt).
// Server import (route cha) vẫn là chốt chặn cuối — endpoint này chỉ là UX.
// Dedupe TOÀN HỆ THỐNG như route import → bypass HẸP (chỉ 4 field, không lộ
// note/email) + ghi audit AC10. Gate cùng quyền với import: leads:create.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await checkPermission("leads:create"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const phonesRaw = (body as { phones?: unknown[] })?.phones;
  if (!Array.isArray(phonesRaw)) return NextResponse.json({ matches: [] });
  if (phonesRaw.length > 5000) {
    return NextResponse.json({ error: "Quá 5000 SĐT" }, { status: 400 });
  }

  // Chuẩn hoá y HỆT server import (normalizePhone) — preview khớp 100% kết quả thật.
  const phones = [...new Set(phonesRaw.map((p) => normalizePhone(p)).filter(Boolean))];
  if (phones.length === 0) return NextResponse.json({ matches: [] });

  const actor = await resolveActor(session.user.id);
  if (getModelVisibleCenterIds("Lead", actor) !== "ALL") {
    await logScopeBypass(actor, "import/leads/precheck: đối chiếu SĐT lead toàn hệ thống");
  }
  const matches = await scopedDb(actor, { bypass: true }).lead.findMany({
    // AUTH-SĐT P1 — preview phải thấy cả lead lưu dạng `0…` cũ, nếu không thì
    // màn xem trước báo "không trùng" rồi import thật lại gộp.
    where: { phone: { in: expandPhoneVariants(phones) }, deletedAt: null },
    select: { phone: true, parentName: true, childName: true, status: true },
  });
  return NextResponse.json({ matches });
}
