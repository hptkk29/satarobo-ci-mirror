// app/(admin)/admin/cham-cong/ghi-chu/page.tsx — GHI CHÚ LỊCH: phần chữ ghép vào tin nhắc lịch
// ngày mai (tab VIỆC CỐ ĐỊNH + GHI CHÚ & GHI ĐÈ của Sheet). Không tham gia tính công.
//
// Ba điều dễ vỡ:
//  1. Ghi chú theo NGÀY **không** che việc cố định theo THỨ. Cron `runShiftBrief` đọc HỢP của hai
//     loại (`brief-db.ts:39`) rồi để `mode` quyết định (`brief.ts`): APPEND nối thêm, REPLACE thay
//     toàn bộ, SUPPRESS tắt tin. Nhãn trên màn phải nói đúng thế — bản cũ ghi "ngày thắng thứ" nên
//     người vận hành tạo ghi chú ngày mode APPEND để "thay" việc cố định và tin gửi đi có cả hai dòng.
//  2. Xoá là XOÁ CỨNG và hiện chưa ghi audit ⇒ phải hỏi lại hai bước, không đặt thùng rác một cú bấm
//     cạnh nút Sửa như bản cũ.
//  3. `?coSo` chỉ THU HẸP về một khối. Không truyền = mọi khối xem được, y như trước.
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { getSetting } from "@/lib/settings/service";
import { HO_CENTER_ID, loadCenterMap } from "@/lib/cham-cong/home-center";
import { ASK_WHO, loadModuleScope, type ModuleAction } from "@/lib/cham-cong/module-scope";
import { PageHeader } from "@/components/admin/ui/page-header";
import { PageHelp } from "@/components/admin/ui/page-help";
import { NoPermission } from "@/components/admin/ui/states";
import { ModuleNav } from "@/components/admin/cham-cong/module-nav";
import { ConfigTabs } from "@/components/admin/cham-cong/config-tabs";
import { ScopeBar } from "@/components/admin/cham-cong/scope-bar";
import { NoteManager, type NoteRow } from "./_components/note-manager";

export const metadata = { title: "Ghi chú lịch | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

const BASE = "/cham-cong/ghi-chu";
const VIEW: ModuleAction = "hr_attendance:view";
const ASSIGN: ModuleAction = "hr_attendance:assign";

interface Props {
  searchParams: Promise<{ coSo?: string; ky?: string }>;
}

export default async function GhiChuPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fcham-cong%2Fghi-chu");

  const sp = await searchParams;
  const scope = await loadModuleScope(session.user.id);
  const visible = scope.blocks.filter((b) => b.perms[ASSIGN] || b.perms[VIEW]);
  const ky = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.ky ?? "") ? (sp.ky as string) : null;
  const coSo = visible.some((b) => b.id === sp.coSo) ? (sp.coSo as string) : null;
  const ctx = { ky, coSo };

  const head = (
    <>
      <PageHeader
        title="Ghi chú lịch"
        subtitle="Việc cố định theo thứ và ghi chú theo ngày, ghép vào tin nhắc lịch gửi cho nhân sự tối hôm trước."
      />
      <ModuleNav active="cauhinh" scope={scope} ctx={ctx} />
    </>
  );

  if (visible.length === 0) {
    return (
      <div className="max-w-6xl">
        {head}
        <NoPermission permission={VIEW} what="ghi chú lịch" askWho={ASK_WHO[VIEW]} />
      </div>
    );
  }

  const pool = coSo ? visible.filter((b) => b.id === coSo) : visible;
  const map = await loadCenterMap();
  const sdb = scopedDb(await resolveActor(session.user.id));
  // Giờ gửi đè được theo cơ sở ⇒ khi đang xem một khối cụ thể thì hỏi đúng đơn vị đó.
  const orgUnitId =
    coSo && coSo !== HO_CENTER_ID
      ? (Object.values(map.byCode).find((c) => c.centerId === coSo)?.orgUnitId ?? null)
      : null;

  const [notes, briefHour] = await Promise.all([
    sdb.shiftBriefNote.findMany({
      where: { centerId: { in: pool.map((b) => b.id) } },
      orderBy: [{ date: "asc" }, { weekday: "asc" }, { createdAt: "asc" }],
    }),
    getSetting("shift.briefNoteHourVN", { orgUnitId }),
  ]);

  const label = new Map(pool.map((b) => [b.id, b.label]));
  const rows: NoteRow[] = notes.map((n) => ({
    id: n.id,
    centerId: n.centerId,
    centerLabel: label.get(n.centerId) ?? n.centerId,
    weekday: n.weekday,
    // Cột `@db.Date` ⇒ cắt chuỗi ISO, không đổi múi giờ; action nhận lại đúng định dạng này.
    date: n.date ? n.date.toISOString().slice(0, 10) : null,
    audience: n.audience,
    mode: n.mode,
    text: n.text,
    isActive: n.isActive,
  }));

  const gioGui = `${String(briefHour).padStart(2, "0")}:00`;

  return (
    <div className="max-w-6xl">
      {head}
      <ConfigTabs active="ghi-chu" scope={scope} ctx={ctx} />

      <ScopeBar
        basePath={BASE}
        blocks={visible.map((b) => ({ id: b.id, label: b.label }))}
        coSo={coSo}
        allLabel="Tất cả khối"
        keep={ky ? { ky } : undefined}
      />

      <PageHelp guideSlug="nhan-su-giao-vien">
        <p>
          Mỗi tối lúc <b className="tabular-nums">{gioGui}</b>, hệ thống gửi cho nhân sự tin nhắc lịch
          ca ngày mai. Nội dung khai ở đây được ghép thêm vào tin đó — nó không ảnh hưởng tới công.
        </p>
        <p className="mt-2">
          <b>Việc cố định theo thứ</b> lặp lại hằng tuần, <b>ghi đè theo ngày</b> chỉ áp một ngày —
          và cả hai đều được gửi. Muốn THAY nội dung của hôm đó thì chọn cách gửi{" "}
          <b>Thay toàn bộ</b>; muốn TẮT hẳn tin thì chọn <b>Không gửi tin</b>.
        </p>
        <p className="mt-2">
          Cách gửi: <b>Gửi kèm</b> thêm một dòng vào tin · <b>Thay toàn bộ</b> thay hết nội dung tin ·{" "}
          <b>Không gửi tin</b> tắt tin của khối hôm đó (trừ khi có mục Thay toàn bộ). Gửi cho{" "}
          <b>Kinh doanh</b> / <b>Giáo viên</b> lọc theo nhóm ghi trong khung ca tuần của từng người.
        </p>
        <p className="mt-2">
          Đổi giờ gửi ở{" "}
          <Link href="/cau-hinh-van-hanh" className="font-medium text-primary hover:underline">
            Cấu hình vận hành
          </Link>{" "}
          (khoá <span className="font-mono">shift.briefNoteHourVN</span>) — màn này chỉ khai nội dung.
        </p>
      </PageHelp>

      <NoteManager rows={rows} blocks={pool.map((b) => ({ id: b.id, label: b.label, canAssign: b.perms[ASSIGN] }))} gioGui={gioGui} />
    </div>
  );
}
