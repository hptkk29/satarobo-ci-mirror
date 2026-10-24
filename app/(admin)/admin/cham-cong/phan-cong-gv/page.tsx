// app/(admin)/admin/cham-cong/phan-cong-gv/page.tsx — PHÂN CÔNG GIÁO VIÊN: lưới tuần người × ca S/C/T × T2..CN của một cơ sở.
//
// Lưới là PROJECTION chỉ đọc (docs/cham-cong/parttime/23-LUOI-PHAN-CONG-GV.md): mã ô D/T/TD/TG/… và lương dự kiến được SUY RA từ
// phân công buổi (lớp chính thức · học bù · Trial — bộ đồng bộ Parttime giữ chúng theo vòng đời case) + dòng trực tường minh. Không
// bảng nào lưu mã để tính lương; book / dời / huỷ ở module nguồn tự hiện ở lần tải sau. Công thật vẫn chỉ sinh khi QLCS xác nhận (P5).
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { auth } from "@/lib/auth";
import { ASK_WHO, loadModuleScope, type ModuleAction } from "@/lib/cham-cong/module-scope";
import { khoiParttime } from "@/lib/cham-cong/khoi-parttime";
import { hrefWith } from "@/lib/cham-cong/scope-href";
import { currentPeriodKey } from "@/lib/cham-cong/period";
import { docLuoiTuan } from "@/lib/parttime/luoi-tuan-db";
import { vnYmd } from "@/lib/time/vn";
import { PageHeader } from "@/components/admin/ui/page-header";
import { PageHelp } from "@/components/admin/ui/page-help";
import { NoPermission } from "@/components/admin/ui/states";
import { ModuleNav } from "@/components/admin/cham-cong/module-nav";
import { ScopeBar } from "@/components/admin/cham-cong/scope-bar";
import { BTN_OUTLINE } from "@/components/admin/cham-cong/classes";
import { ChonTuan } from "../phan-cong/_components/chon-tuan";
import { LuoiGv } from "./_components/luoi-gv";

export const metadata = { title: "Phân công giáo viên | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

const VIEW: ModuleAction = "hr_attendance:view";
const BASE = "/cham-cong/phan-cong-gv";
/** Lối sang màn thao tác theo buổi — `href:` literal để lưới `nav-coverage` thấy. */
const PHAN_CONG_BUOI = { href: "/cham-cong/phan-cong" } as const;

function thuHai(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
function congNgay(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;

export default async function PhanCongGvPage({ searchParams }: { searchParams: Promise<{ coSo?: string; tuan?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fcham-cong%2Fphan-cong-gv");
  const sp = await searchParams;
  const scope = await loadModuleScope(session.user.id);
  const now = new Date();
  const homNay = vnYmd(now);
  const tuan = thuHai(sp.tuan && /^\d{4}-\d{2}-\d{2}$/.test(sp.tuan) ? sp.tuan : homNay);
  const denNgay = congNgay(tuan, 6);
  const ky = currentPeriodKey();

  // Khối nào: CÙNG hàm với tab điều hướng và màn Phân công buổi (VIEW hoặc ASSIGN ở một cơ sở).
  const pt = khoiParttime(scope, sp.coSo);
  if (!pt) {
    return (
      <div className="max-w-6xl">
        <PageHeader title="Phân công giáo viên" />
        <ModuleNav active="phancongGv" scope={scope} ctx={{ ky, coSo: sp.coSo ?? null }} />
        <NoPermission permission={VIEW} what="phân công giáo viên" askWho={ASK_WHO[VIEW]} />
      </div>
    );
  }
  const { khoi, block } = pt;
  const coSo = block.id;
  const luoi = await docLuoiTuan({ centerId: coSo, tu: tuan, den: denNgay, now });
  const giu = { coSo, tuan };
  const tongTuan = luoi.dong.reduce((s, d) => s + d.tongTuan, 0);

  return (
    <div className="max-w-6xl 2xl:max-w-none">
      <PageHeader
        title={`Phân công giáo viên — ${block.label}`}
        subtitle="Mỗi giáo viên ba dòng Sáng / Chiều / Tối. Mã ô và lương là DỰ KIẾN, suy từ lớp chính thức, học bù, Trial và ca trực — không nhập tay."
        actions={
          <Link href={hrefWith(PHAN_CONG_BUOI.href, { coSo, tuan })} className={BTN_OUTLINE}>
            Phân công theo buổi
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        }
      />
      <ModuleNav active="phancongGv" scope={scope} ctx={{ ky, coSo }} />
      <ScopeBar
        basePath={BASE}
        blocks={khoi.map((b) => ({ id: b.id, label: b.label }))}
        coSo={coSo}
        keep={{ tuan }}
        right={
          <ChonTuan
            nhan={`${dm(tuan)} – ${dm(denNgay)}/${denNgay.slice(0, 4)}`}
            truoc={hrefWith(BASE, { ...giu, tuan: congNgay(tuan, -7) })}
            sau={hrefWith(BASE, { ...giu, tuan: congNgay(tuan, 7) })}
            tuanNay={thuHai(homNay) === tuan ? null : hrefWith(BASE, { ...giu, tuan: undefined })}
          />
        }
      />

      <PageHelp>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>D</b> 1 tiết đứng chính · <b>T</b> trực đủ ca · <b>TG</b> 1 tiết trợ giảng · <b>TD</b> đứng chính + nửa ca trực · <b>TTG</b> trợ giảng +
            nửa ca trực · <b>D2</b> / <b>D+TG</b> / <b>TG2</b> hai tiết (không còn tiền trực) · <b>+TR</b> có buổi Trial.
          </li>
          <li>
            Trực chỉ tính khi có <b>phân công trực tường minh</b> — chấm công dài không tự thành ca trực. Buổi 60/120 phút chưa có ghi đè được
            duyệt thì chưa tính tiền.
          </li>
          <li>
            Lớp chính thức, học bù và Trial tự hiện / tự đổi theo module gốc. Muốn đổi, mở nguồn từ ô (bấm vào ô) — không sửa ở đây.
          </li>
        </ul>
      </PageHelp>

      <p className="mb-3 text-sm text-muted-foreground">
        {luoi.dong.length} giáo viên · lương dự kiến tuần <b className="tabular-nums text-foreground">{tongTuan.toLocaleString("vi-VN")}đ</b> (chưa phải
        công đã xác nhận)
      </p>
      <LuoiGv luoi={luoi} lopTrialCuaBuoi={luoi.lopTrialCuaBuoi} />
    </div>
  );
}
