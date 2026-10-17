// app/(admin)/admin/cham-cong/phan-ca/import/page.tsx — đưa lịch phân ca từ file Sheet vào hệ thống.
//
// Vì sao màn này tồn tại: lịch phân ca vẫn được xếp trên Google Sheet. Đây là đường để người vận
// hành tự đổ nó vào hệ thống mỗi tháng, không phải nhờ dev chạy script.
//
// Điều dễ vỡ:
//  · Gate là `hr_attendance:assign` ở ÍT NHẤT MỘT khối. Trước đây thiếu quyền là `redirect` câm về
//    `/cham-cong` — người dùng tưởng bấm hụt. Nay `NoPermission` nói rõ key + hỏi ai.
//  · `?ky` / `?coSo` là TUỲ CHỌN, chỉ để giữ ngữ cảnh cho ModuleNav và hai nút đi tiếp ở bước 3.
//    Màn này KHÔNG lọc dữ liệu theo chúng — mọi thứ đọc từ chính file.
//  · Danh sách ứng viên ánh xạ đọc qua `scopedDb`: người cấp cơ sở không được thấy tên nhân sự cơ
//    sở khác. Server còn lọc lại lần nữa ở `applyImportAction`, đây chỉ là danh sách hiển thị.
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { loadModuleScope, ASK_WHO } from "@/lib/cham-cong/module-scope";
import { currentPeriodKey, parsePeriodKey } from "@/lib/cham-cong/period";
import { PageHeader } from "@/components/admin/ui/page-header";
import { PageHelp } from "@/components/admin/ui/page-help";
import { NoPermission } from "@/components/admin/ui/states";
import { ModuleNav } from "@/components/admin/cham-cong/module-nav";
import { ImportWizard } from "./_components/import-wizard";
import type { ImportLogRow } from "./_components/import-log";

export const metadata = { title: "Import lịch phân ca | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

const ASSIGN = "hr_attendance:assign" as const;

/** Đọc số trong `AuditLog.newValues` mà không tin nó có hình dạng nào — JSON tự do. */
function so(o: unknown, ...duong: string[]): number {
  let cur: unknown = o;
  for (const k of duong) {
    if (typeof cur !== "object" || cur === null) return 0;
    cur = (cur as Record<string, unknown>)[k];
  }
  return typeof cur === "number" ? cur : 0;
}

/**
 * Giờ + ngày của một lượt import, GHIM múi giờ VN.
 *
 * Không mượn helper dùng chung: nhánh `test` và `main` đang có hai bộ hàm khác nhau
 * (`formatDateTimeVN` bên test dùng `toLocaleString("vi-VN")` KHÔNG ghim múi ⇒ Vercel chạy
 * UTC sẽ in lệch 7 tiếng, đúng landmine TZ của repo). Format tại chỗ thì cùng một mã chạy
 * đúng trên cả hai nhánh.
 */
function gioNgayVN(input: Date): string {
  const gio = input.toLocaleTimeString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
  });
  const ngay = input.toLocaleDateString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  return `${gio} ${ngay}`;
}

export default async function ImportPhanCaPage({
  searchParams,
}: {
  searchParams: Promise<{ ky?: string; coSo?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fcham-cong%2Fphan-ca%2Fimport");
  const sp = await searchParams;

  const scope = await loadModuleScope(session.user.id);
  const ky = sp.ky && parsePeriodKey(sp.ky) ? sp.ky : currentPeriodKey();
  // Khối chỉ dùng để mang ngữ cảnh sang màn khác — giữ khi CÒN hợp lệ, không thì bỏ hẳn.
  const coSo = scope.has(ASSIGN, sp.coSo) ? (sp.coSo as string) : null;
  const ctx = { ky, coSo };

  const header = <PageHeader title="Import lịch phân ca" subtitle="Đọc file Sheet (.xlsx) → soát ánh xạ tên → áp khung ca tuần và lưới tháng." />;

  if (!scope.any(ASSIGN)) {
    return (
      <div className="max-w-6xl">
        {header}
        <ModuleNav active="luoi" scope={scope} ctx={ctx} />
        <NoPermission permission={ASSIGN} what="màn import lịch" askWho={ASK_WHO[ASSIGN]} />
      </div>
    );
  }

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const [employees, logs] = await Promise.all([
    sdb.employee.findMany({
      where: { status: "ACTIVE", userAccount: { isNot: null } },
      select: { fullName: true, employeeCode: true, center: { select: { code: true } }, userAccount: { select: { id: true } } },
      orderBy: { fullName: "asc" },
    }),
    // "Tháng này import chưa?" — nhật ký ghi ở `applyImportAction`, action "IMPORT".
    sdb.auditLog.findMany({
      where: { module: "hr_attendance", entityType: "ShiftAssignment", action: "IMPORT" },
      select: { id: true, actorName: true, entityId: true, newValues: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  const candidates = employees.map((e) => ({
    userId: e.userAccount!.id,
    label: `${e.fullName} · ${e.employeeCode}`,
    centerCode: e.center?.code ?? null,
  }));

  const recent: ImportLogRow[] = logs.map((l) => {
    const v = l.newValues as unknown;
    return {
      id: l.id,
      at: gioNgayVN(l.createdAt),
      actorName: l.actorName,
      scopeLabel: l.entityId && l.entityId !== "khung-ca" ? `Kỳ ${l.entityId}` : "Khung ca tuần",
      countLabel: `${so(v, "assignments", "created")} ô mới · ${so(v, "assignments", "cancelled")} huỷ · ${so(v, "assignments", "keptManual")} giữ tay · ${so(v, "patterns", "upserted")} ô khung ca`,
      skippedNoPermission: so(v, "assignments", "skippedNoPermission"),
    };
  });

  const blockLabels: Record<string, string> = {};
  for (const b of scope.blocks) blockLabels[b.code] = b.label;

  return (
    <div className="max-w-6xl">
      {header}
      <ModuleNav active="luoi" scope={scope} ctx={ctx} />
      <PageHelp guideSlug="nhan-su-giao-vien">
        <p>
          Mỗi tháng chỉ cần làm một lần: tải file lịch phân ca trên Google Sheet về dạng Excel, đọc file, xác nhận
          tên ai là ai (lần sau hệ thống tự nhớ), rồi áp. Ca do đơn đã duyệt hoặc do quản lý sửa tay trên lưới
          KHÔNG bị file đè.
        </p>
        <p className="mt-2">
          Chạy lại cùng một file là an toàn — hệ thống chỉ ghi phần khác, nên nếu đang áp mà mất mạng thì cứ áp lại.
          Hàng thuộc cơ sở bạn không được phân ca sẽ bị bỏ qua và đếm riêng trong kết quả.
        </p>
      </PageHelp>
      <ImportWizard
        candidates={candidates}
        recent={recent}
        blockLabels={blockLabels}
        coSo={coSo}
        defaultKy={ky}
        canDoiSoat={scope.any("hr_attendance:view")}
      />
    </div>
  );
}
