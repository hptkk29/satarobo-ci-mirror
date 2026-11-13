// Bảng công tháng — lưới người × ngày, CHỈ ĐỌC, tô màu theo KẾT QUẢ chấm công.
//
// Vì sao là màn riêng chứ không phải một chế độ của `/cham-cong/phan-ca`: lưới phân ca là mặt
// phẳng SỬA (mỗi ô là menu chọn mã ca). Trộn màu kết quả vào đó thì một cú bấm nhầm là đổi ca
// của người khác. Ở đây không có gì bấm được — vào để nhìn, rồi đi tiếp sang màn sửa.
//
// Câu hỏi màn này trả lời trong ba giây: **ai vi phạm nhiều**. Nên ngoài lưới màu còn có cột
// "Vi phạm" (số, đọc được không cần nhìn màu — PRODUCT.md cấm mã hoá trạng thái chỉ bằng màu)
// và hàng xếp sẵn nặng → nhẹ.
import { redirect } from "next/navigation";
import Link from "next/link";
import { FileSpreadsheet } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { vnYmd } from "@/lib/time/vn";
import { HO_CENTER_ID, loadCenterMap } from "@/lib/cham-cong/home-center";
import { loadBangCongThang } from "@/lib/cham-cong/bang-cong-thang-db";
import { ASK_WHO, loadModuleScope, periodStatusOf, type ModuleAction } from "@/lib/cham-cong/module-scope";
import { hrefWith, shiftKy } from "@/lib/cham-cong/scope-href";
import { PageHeader } from "@/components/admin/ui/page-header";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { BTN_OUTLINE } from "@/components/admin/cham-cong/classes";
import { ModuleNav } from "@/components/admin/cham-cong/module-nav";
import { ScopeBar } from "@/components/admin/cham-cong/scope-bar";
import { ChuGiaiBangCong } from "@/components/admin/cham-cong/chu-giai-bang-cong";
import { BangGioCa } from "@/components/cham-cong/ui/bang-gio-ca";
import { BangCongThangGrid } from "@/components/admin/cham-cong/bang-cong-thang-grid";

export const metadata = { title: "Bảng công tháng | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

const BASE = "/cham-cong/bang-cong-thang";
const VIEW: ModuleAction = "hr_attendance:view";
const EXPORT: ModuleAction = "hr_attendance:export";

export default async function BangCongThangPage({
  searchParams,
}: {
  searchParams: Promise<{ ky?: string; coSo?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fcham-cong%2Fbang-cong-thang");

  const sp = await searchParams;
  const scope = await loadModuleScope(session.user.id);
  const visible = scope.blocks.filter((b) => b.perms[VIEW]);
  const ky = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.ky ?? "") ? (sp.ky as string) : vnYmd(new Date()).slice(0, 7);

  if (visible.length === 0) {
    return (
      <div className="max-w-6xl">
        <PageHeader title="Bảng công tháng" />
        <ModuleNav active="bangthang" scope={scope} ctx={{ ky }} />
        <NoPermission permission={VIEW} what="bảng công tháng" askWho={ASK_WHO[VIEW]} />
      </div>
    );
  }

  const block = visible.find((b) => b.id === sp.coSo) ?? visible[0];
  const coSo = block.id;
  const ctx = { ky, coSo };
  const canExport = block.perms[EXPORT];
  /** Mọi khối người này XUẤT được — nguồn của nút "xuất nhiều cơ sở". */
  const khoiXuatDuoc = scope.blocks.filter((b) => b.perms[EXPORT]);

  const today = vnYmd(new Date());
  const map = await loadCenterMap();
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const orgUnitId =
    coSo === HO_CENTER_ID
      ? null
      : (Object.values(map.byCode).find((c) => c.centerId === coSo)?.orgUnitId ?? null);
  const period = await periodStatusOf(sdb, coSo, ky);

  // MỘT nguồn cho cả màn này lẫn file Excel — xem đầu `bang-cong-thang-db.ts`.
  const { rows, days, maCa } = await loadBangCongThang({
    sdb,
    coSo,
    ky,
    orgUnitId,
    today,
    lockedStatus: period.status,
  });

  const monthHref = (delta: number) => hrefWith(BASE, { ky: shiftKy(ky, delta), coSo });
  const tongNang = rows.reduce((s, r) => s + r.dem.nang, 0);
  const tongCongKhoi = Math.round(rows.reduce((s, r) => s + r.tongCong, 0) * 100) / 100;

  return (
    <div className="max-w-full">
      <PageHeader
        title="Bảng công tháng"
        subtitle="Mỗi ô là một ngày. Màu nền là kết quả chấm công — đỏ và đen là thứ cần rà."
        actions={
          canExport ? (
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/api/admin/cham-cong/bang-cong-thang/export?ky=${ky}&coSo=${encodeURIComponent(coSo)}`}
                className={BTN_OUTLINE}
                prefetch={false}
              >
                <FileSpreadsheet className="h-4 w-4" aria-hidden /> Xuất Excel
              </Link>
              {/* Chỉ hiện khi người này xuất được TỪ HAI khối trở lên — nút "tất cả" mà chỉ có
                  một khối là một lời hứa suông (luật 12: affordance phải nói thật). */}
              {khoiXuatDuoc.length > 1 && (
                <Link
                  href={`/api/admin/cham-cong/bang-cong-thang/export?ky=${ky}&coSo=${khoiXuatDuoc
                    .map((b) => encodeURIComponent(b.id))
                    .join(",")}`}
                  className={BTN_OUTLINE}
                  prefetch={false}
                  title="Gộp mọi cơ sở bạn có quyền xuất vào MỘT tệp, có cột Cơ sở để lọc"
                >
                  <FileSpreadsheet className="h-4 w-4" aria-hidden /> Xuất {khoiXuatDuoc.length} cơ sở
                </Link>
              )}
            </div>
          ) : null
        }
      />
      <ModuleNav active="bangthang" scope={scope} ctx={ctx} />
      <ScopeBar
        basePath={BASE}
        blocks={visible.map((b) => ({ id: b.id, label: b.label }))}
        coSo={coSo}
        month={{ ky, prevHref: monthHref(-1), nextHref: monthHref(1) }}
        period={{
          status: period.status,
          standardUnits: period.standardUnits,
          href: hrefWith("/cham-cong/ky-cong", { ky, coSo }),
        }}
        keep={{ ky }}
      />

      {rows.length === 0 ? (
        <EmptyState
          title="Chưa có ai có ca trong tháng này"
          description="Khối này chưa có khung ca tuần, cũng chưa có ca nào trong tháng. Xếp khung ca rồi sinh lưới ở màn Lưới phân ca."
          action={
            <Link href={hrefWith("/cham-cong/phan-ca", { ky, coSo })} className={BTN_OUTLINE}>
              Mở lưới phân ca
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          <ChuGiaiBangCong />
          <BangGioCa maCa={maCa} />
          <p className="text-sm text-muted-foreground">
            Cả khối <b className="tabular-nums text-foreground">
              {tongCongKhoi.toLocaleString("vi-VN", { maximumFractionDigits: 2 })} công
            </b>{" "}
            · <b className="tabular-nums text-foreground">{rows.length} người</b>.{" "}
            {tongNang > 0 ? (
              <>
                <b className="text-state-danger-ink tabular-nums">{tongNang}</b> lượt vi phạm trong
                tháng, xếp người nhiều nhất lên đầu.
              </>
            ) : (
              <>Không có lượt vi phạm nào trong tháng này.</>
            )}
          </p>
          <BangCongThangGrid rows={rows} days={days} blockLabel={block.label} />
        </div>
      )}
    </div>
  );
}
