// GET /api/admin/xuat/<ma> — xuất danh mục dạng NHẬP-LẠI-ĐƯỢC (xlsx).
//
// MỘT route cho bảy màn: cơ sở · phòng học · lịch nghỉ · học cụ · câu hỏi · học viên · lớp
// trải nghiệm. Spec cột + phép nạp ở `lib/export/nhap-lai.ts`; cổng quyền ở
// `lib/export/quyen-xuat.ts`; danh mục màn ở `lib/export/danh-muc-xuat.ts`.
//
// Bảy route rời sẽ là bảy chỗ để quên một cổng hoặc để lệch một khoá cột. Ở đây cổng chạy
// đúng một lần, cho mọi mã.
//
// ⚠️ **Dòng tiêu đề là KHOÁ MÁY** (`fullName`, `centerSlug`), không phải nhãn tiếng Việt —
// `ExcelImporter` đọc cột theo khoá, nên in nhãn là tệp trông đẹp mà nhập lại thì mọi cột
// rỗng. Nhãn tiếng Việt đi vào sheet chú giải để người mở tệp vẫn hiểu từng cột là gì.
import { NextResponse, type NextRequest } from "next/server";
import { requireLiveSession } from "@/lib/auth/live-session";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { writeAudit } from "@/lib/audit/audit-log";
import { getAuditActor } from "@/lib/audit/log";
import { exportWatermark } from "@/lib/export/watermark";
import { chanXuat } from "@/lib/export/chan-xuat";
import { timManXuat } from "@/lib/export/danh-muc-xuat";
import { BO_XUAT } from "@/lib/export/bo-xuat";
import { dungWorkbook, tenTepAnToan, type CotXuat } from "@/lib/cham-cong/xuat-bang";

export async function GET(req: NextRequest, ctx: { params: Promise<{ ma: string }> }) {
  const session = await requireLiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ma } = await ctx.params;
  const spec = BO_XUAT[ma];
  const man = timManXuat(ma);
  // Mã lạ ⇒ 404, KHÔNG 403. Hai câu trả lời khác nhau cho hai vấn đề khác nhau: "không có
  // đường này" và "có nhưng bạn chưa được phép". Trả 403 cho mã sai là để người sửa đi xin
  // quyền cho một đường không tồn tại.
  if (!spec || !man) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const chan = await chanXuat(ma, session);
  if (chan) return chan;

  const actor = await resolveActor(session.user.id);
  const { cot, dong, bangPhu } = await spec.nap(scopedDb(actor), actor);

  const now = new Date();
  const { actorId, actorName } = getAuditActor(session);

  const wb = dungWorkbook({
    tieuDe: `${man.ten.toUpperCase()} — ${dong.length} dòng`,
    // Tên sheet không dấu: một số bản Excel cũ hỏng khi mở sheet tên có dấu, và tệp này
    // sinh ra để đi qua tay nhiều người.
    tenSheet: "Du lieu",
    // Tiêu đề = KHOÁ. `CotXuat` chỉ cần `nhan`, nên đưa khoá vào đó và giữ nhãn cho sheet
    // chú giải bên dưới.
    cot: cot.map((x) => ({
      nhan: spec.tieuDeLaKhoa ? x.khoa : x.nhan,
      lay: x.lay,
      rong: x.rong,
      chuoi: x.chuoi,
    })) as CotXuat<never>[],
    dong,
    watermark: exportWatermark(actorName, actorId, dong.length, now),
    ghiChu: spec.tieuDeLaKhoa
      ? [
          `Tệp này NHẬP LẠI ĐƯỢC: mở ${man.man}/import rồi tải lên, không cần sửa tiêu đề.`,
          "Dòng tiêu đề là khoá máy — ĐỪNG dịch sang tiếng Việt, màn nhập đọc cột theo khoá.",
          "Sheet “Chu giai” cho biết mỗi khoá là cột gì.",
        ]
      : [
          // Tệp báo cáo KHÔNG lọc theo bộ lọc trên màn — nó lấy toàn bộ phạm vi người xuất
          // được nhìn. Nói thẳng ra, kẻo người ta lọc trên màn rồi tưởng tệp cũng đã lọc.
          "Tệp lấy TOÀN BỘ dữ liệu trong phạm vi bạn được xem — không theo bộ lọc đang đặt trên màn.",
          `Số liệu dựng bằng đúng hàm mà màn ${man.man} đang dùng, nên tệp và màn không lệch nhau.`,
        ],
    // Sheet chú giải chỉ có nghĩa với tệp nhập-lại-được (giải nghĩa khoá máy). Tệp báo cáo
    // đã in nhãn tiếng Việt ngay ở tiêu đề — thêm một sheet lặp lại chính nó là rác.
    // `xuat-bang` gọi khoá này là `ten`; `KetQuaNap` gọi là `tieuDe`. Đổi tên ở ĐÂY, một
    // chỗ, thay vì bắt 12 spec biết cú pháp của tầng dựng workbook.
    bangPhu: (bangPhu ?? []).map((b) => ({ ten: b.tieuDe, cot: b.cot, dong: b.dong })),
    chuGiai: spec.tieuDeLaKhoa ? cot.map((x) => [x.khoa, x.nhan] as [string, string]) : undefined,
  });

  const buf = Buffer.from(await wb.xlsx.writeBuffer());

  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "export",
    entityType: "Export",
    entityId: `${ma}:${now.toISOString().slice(0, 10)}`,
    action: "EXPORT",
    newValues: { man: ma, soDong: dong.length, soCot: cot.length },
  });

  const ten = tenTepAnToan(`${ma}-${now.toISOString().slice(0, 10)}`);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${ten}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
