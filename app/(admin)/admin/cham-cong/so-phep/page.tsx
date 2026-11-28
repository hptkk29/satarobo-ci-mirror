// app/(admin)/admin/cham-cong/so-phep/page.tsx — SỔ PHÉP NĂM theo khối (P2.1A, 11/10/2026).
//
// Một bảng: người có ca ở khối (60 ngày gần đây) × còn lại / đã cấp / đã dùng trong NĂM đang xem, kèm
// đối soát chuỗi số dư và biến động gần nhất. Bút toán tay chỉ hiện khi có `hr_attendance:adjust` ở
// khối — cùng cổng action kiểm (luật 12: nút hiện ⇔ bấm được).
//
// Chính sách phép (bao nhiêu ngày, cộng dồn, chuyển năm…) CHƯA chốt ⇒ màn này không tự cấp gì; khi
// công tắc `shift.soPhepBat` tắt thì nói rõ là duyệt đơn chưa trừ sổ (không để người xem tưởng số dư
// đang chạy).
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { ASK_WHO, loadModuleScope, type ModuleAction } from "@/lib/cham-cong/module-scope";
import { docCauHinhSoPhep } from "@/lib/cham-cong/so-phep";
import { doiSoatSoPhep, lichSuPhep, loaiNghiSoPhep, soDuPhepCuaNguoi } from "@/lib/cham-cong/so-phep-db";
import { nhanNgayPhep } from "@/lib/cham-cong/so-phep-thuan";
import { hrefWith } from "@/lib/cham-cong/scope-href";
import { vnAddDays, vnDateOnly, vnYmd } from "@/lib/time/vn";
import { PageHeader } from "@/components/admin/ui/page-header";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { ModuleNav } from "@/components/admin/cham-cong/module-nav";
import { ScopeBar } from "@/components/admin/cham-cong/scope-bar";
import { SectionCard } from "@/components/admin/cham-cong/section-card";
import { BangSoPhep, type DongBangSoPhep } from "./_components/bang-so-phep";

export const metadata = { title: "Sổ phép năm | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

const VIEW: ModuleAction = "hr_attendance:view";
const ADJUST: ModuleAction = "hr_attendance:adjust";
const BASE = "/cham-cong/so-phep";

const NHAN_BUT_TOAN: Record<string, string> = {
  OPENING: "Cấp đầu kỳ",
  ACCRUAL: "Cộng dồn",
  CARRY_OVER: "Chuyển từ năm trước",
  LEAVE_USED: "Duyệt đơn nghỉ",
  LEAVE_REFUND: "Hoàn do huỷ đơn",
  MANUAL_ADJUSTMENT: "Điều chỉnh tay",
  EXPIRY: "Hết hạn",
};

const NHAN_LECH: Record<string, string> = {
  DUT_CHUOI: "đứt chuỗi số dư",
  SAI_CONG: "số dư sau ≠ trước + biến động",
  AM: "số dư âm khi chính sách không cho ứng",
};

export default async function SoPhepPage({ searchParams }: { searchParams: Promise<{ coSo?: string; nam?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fcham-cong%2Fso-phep");
  const sp = await searchParams;
  const scope = await loadModuleScope(session.user.id);
  const visible = scope.blocksWith(VIEW);
  if (visible.length === 0) {
    return (
      <div className="max-w-6xl">
        <PageHeader title="Sổ phép năm" />
        <ModuleNav active="sophep" scope={scope} ctx={{ coSo: sp.coSo ?? null }} />
        <NoPermission permission={VIEW} what="sổ phép năm" askWho={ASK_WHO[VIEW]} />
      </div>
    );
  }
  const block = scope.pick(sp.coSo, VIEW) ?? visible[0];
  const coSo = block.id;
  const dieuChinhDuoc = scope.has(ADJUST, coSo);
  const now = new Date();
  const namNay = Number(vnYmd(now).slice(0, 4));
  const namXin = Number(sp.nam);
  const nam = Number.isInteger(namXin) && namXin >= 2020 && namXin <= namNay + 1 ? namXin : namNay;

  const cauHinh = await docCauHinhSoPhep();
  const lt = await loaiNghiSoPhep(cauHinh.maLoai);
  const header = (
    <>
      <PageHeader
        title="Sổ phép năm"
        subtitle="Quỹ phép năm của từng người, tính theo phút và hiển thị theo ngày công. Mỗi biến động là một dòng sổ không sửa được — sai thì ghi bút toán điều chỉnh kèm lý do."
      />
      <ModuleNav active="sophep" scope={scope} ctx={{ coSo }} />
      <ScopeBar basePath={BASE} blocks={visible.map((b) => ({ id: b.id, label: b.label }))} coSo={coSo} />
    </>
  );
  if (!lt) {
    return (
      <div className="max-w-6xl">
        {header}
        <EmptyState
          title="Chưa có loại nghỉ để trừ sổ"
          description={`Tham số “Mã loại nghỉ trừ sổ phép” đang là ${cauHinh.maLoai}, nhưng danh mục loại nghỉ không có mã này.`}
        />
      </div>
    );
  }

  const sdb = scopedDb(await resolveActor(session.user.id));
  const caGanDay = await sdb.shiftAssignment.findMany({
    where: { centerId: coSo, workDate: { gte: vnDateOnly(vnAddDays(now, -60)) } },
    select: { userId: true },
    distinct: ["userId"],
  });
  const userIds = caGanDay.map((c) => c.userId);
  const q = { leaveTypeId: lt.id, year: nam };
  const [users, so, lichSu, lech] = await Promise.all([
    userIds.length
      ? sdb.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
      : Promise.resolve([]),
    soDuPhepCuaNguoi(userIds, q),
    lichSuPhep(userIds, q, 30),
    doiSoatSoPhep(userIds, { ...q, choAm: cauHinh.choAm }),
  ]);
  const ten = new Map(users.map((u) => [u.id, u.name ?? u.email ?? u.id]));
  const ngay = (phut: number) => nhanNgayPhep(phut, cauHinh.phutMotNgay);
  const dong: DongBangSoPhep[] = userIds
    .map((id) => {
      const d = so.get(id)!;
      return { userId: id, ten: ten.get(id) ?? id, soDu: ngay(d.soDu), soDuPhut: d.soDu, daCap: ngay(d.daCap), daDung: ngay(d.daDung) };
    })
    .sort((a, b) => b.soDuPhut - a.soDuPhut || a.ten.localeCompare(b.ten, "vi"));

  return (
    <div className="max-w-6xl">
      {header}
      <nav aria-label="Chọn năm" className="mb-3 flex flex-wrap gap-2 text-sm">
        {[namNay - 1, namNay, namNay + 1].map((n) => (
          <a
            key={n}
            href={hrefWith(BASE, { coSo, nam: String(n) })}
            aria-current={n === nam ? "page" : undefined}
            className={n === nam ? "rounded-md bg-primary px-3 py-1 font-semibold text-primary-foreground" : "rounded-md border border-border px-3 py-1 text-foreground hover:bg-muted"}
          >
            Năm {n}
          </a>
        ))}
      </nav>
      {!cauHinh.bat && (
        <p role="status" className="mb-3 rounded-md border border-state-warning-ink/30 bg-state-warning-soft px-3 py-2 text-sm text-state-warning-ink">
          Sổ phép đang <b>TẮT</b> (tham số “Bật sổ phép năm”): duyệt đơn {lt.name} hiện <b>chưa trừ</b> quỹ. Số dư dưới đây
          chỉ gồm bút toán tay. Chính sách phép chưa chốt — chưa bật trên môi trường thật.
        </p>
      )}
      {lech.length > 0 && (
        <SectionCard title={`Đối soát: ${lech.length} chỗ lệch`}>
          <p className="mb-2 text-sm text-muted-foreground">
            Sổ có dòng không khớp chuỗi số dư — dấu hiệu có đường ghi đi vòng (sửa tay trong DB, bản sao dữ liệu). Không sửa
            lịch sử; xử lý bằng bút toán điều chỉnh kèm lý do.
          </p>
          <ul className="divide-y divide-border text-sm">
            {lech.map((l, i) => (
              <li key={i} className="py-2">
                {l.loai === "AM" ? (
                  <>
                    <span className="font-medium text-foreground">{ten.get(l.userId) ?? l.userId}</span>
                    <span className="text-state-danger-ink"> · {NHAN_LECH[l.loai]} ({ngay(l.soDu)})</span>
                  </>
                ) : (
                  <span className="text-state-danger-ink">
                    Dòng {l.id.slice(-8)} · {NHAN_LECH[l.loai]}: mong {l.mongDoi} phút, thực {l.thucTe} phút
                  </span>
                )}
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
      {dong.length === 0 ? (
        <EmptyState title="Chưa có ai" description="Khối này chưa có người được xếp ca trong 60 ngày gần đây." />
      ) : (
        <SectionCard title={`${lt.name} · ${nam} — ${block.label}`}>
          <BangSoPhep coSo={coSo} nam={nam} phutMotNgay={cauHinh.phutMotNgay} dong={dong} dieuChinhDuoc={dieuChinhDuoc} />
        </SectionCard>
      )}
      {lichSu.length > 0 && (
        <SectionCard title="Biến động gần đây">
          <ul className="divide-y divide-border text-sm">
            {lichSu.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="font-medium text-foreground">{ten.get(r.userId) ?? r.userId}</span>
                  <span className="text-muted-foreground"> · {NHAN_BUT_TOAN[r.transactionType] ?? r.transactionType}</span>
                  {r.note ? <span className="text-muted-foreground"> — {r.note}</span> : null}
                </span>
                <span className="flex shrink-0 items-baseline gap-3">
                  <span className="text-xs text-muted-foreground tabular-nums">{vnYmd(r.createdAt)}</span>
                  <b className={r.minutes >= 0 ? "text-state-success-ink tabular-nums" : "text-state-danger-ink tabular-nums"}>
                    {r.minutes >= 0 ? "+" : ""}
                    {ngay(r.minutes)}
                  </b>
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}
