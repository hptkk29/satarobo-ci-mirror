// app/(admin)/admin/cham-cong/xac-nhan-cong/page.tsx — P2.2 XÁC NHẬN CÔNG + KHIẾU NẠI CÔNG theo khối × kỳ.
//
// Hai khối: (1) ai đã / chưa / cần xác nhận lại bảng công — tập người ĐÚNG tập `lockPeriod` khoá
// (`nguoiTrongKy`); (2) khiếu nại của kỳ, có nút xử lý. Nút hiện ⇔ server nhận (luật 12): xử lý khiếu nại
// cần `hr_attendance:approve` ở khối (đúng người duyệt đơn), xác nhận thay cần `hr_attendance:close-period`.
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ASK_WHO, loadModuleScope, type ModuleAction } from "@/lib/cham-cong/module-scope";
import { currentPeriodKey, parsePeriodKey } from "@/lib/cham-cong/period";
import { hrefWith, shiftKy } from "@/lib/cham-cong/scope-href";
import { baoCaoXacNhan, trangThaiKyXacNhan, xacNhanCongDangBat } from "@/lib/cham-cong/xac-nhan-cong";
import { PageHeader } from "@/components/admin/ui/page-header";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { ModuleNav } from "@/components/admin/cham-cong/module-nav";
import { TuLamMoiKhiCoThongBao } from "@/components/cham-cong/tu-lam-moi-khi-co-thong-bao";
import { ScopeBar } from "@/components/admin/cham-cong/scope-bar";
import { SectionCard } from "@/components/admin/cham-cong/section-card";
import { BangXacNhan, DanhSachKhieuNai, NutMoiXacNhan } from "./_components/bang-xac-nhan";

export const metadata = { title: "Xác nhận công | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

const VIEW: ModuleAction = "hr_attendance:view";
const APPROVE: ModuleAction = "hr_attendance:approve";
const CLOSE: ModuleAction = "hr_attendance:close-period";
const BASE = "/cham-cong/xac-nhan-cong";

export default async function XacNhanCongPage({ searchParams }: { searchParams: Promise<{ coSo?: string; ky?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fcham-cong%2Fxac-nhan-cong");
  const sp = await searchParams;
  // Mặc định THÁNG TRƯỚC: xác nhận chỉ mở sau ngày cuối kỳ, nên tháng đang chạy luôn trống.
  const ky = sp.ky && parsePeriodKey(sp.ky) ? sp.ky : shiftKy(currentPeriodKey(), -1);
  const scope = await loadModuleScope(session.user.id);
  const visible = scope.blocksWith(VIEW);
  if (visible.length === 0) {
    return (
      <div className="max-w-6xl">
        <PageHeader title="Xác nhận công" />
        <ModuleNav active="xacnhan" scope={scope} ctx={{ ky, coSo: sp.coSo ?? null }} />
        <NoPermission permission={VIEW} what="xác nhận công" askWho={ASK_WHO[VIEW]} />
      </div>
    );
  }
  const block = scope.pick(sp.coSo, VIEW) ?? visible[0];
  const coSo = block.id;
  const bat = await xacNhanCongDangBat();
  const kyLabel = ky.split("-").reverse().join("/");
  const header = (
    <>
      <PageHeader
        title={`Xác nhận công tháng ${kyLabel}`}
        subtitle="Nhân sự xác nhận bảng công ngày của mình hoặc gửi khiếu nại. Số liệu đổi sau khi đã xác nhận thì xác nhận cũ tự thành “cần xác nhận lại”. Còn khiếu nại chưa kết luận thì chưa chốt được kỳ."
      />
      <ModuleNav active="xacnhan" scope={scope} ctx={{ ky, coSo }} />
      <TuLamMoiKhiCoThongBao userId={session.user.id} />
      <ScopeBar basePath={BASE} blocks={visible.map((b) => ({ id: b.id, label: b.label }))} coSo={coSo} />
      <nav aria-label="Chọn kỳ" className="mb-3 flex flex-wrap gap-2 text-sm">
        {[shiftKy(ky, -1), ky, shiftKy(ky, 1)].map((k) => (
          <a
            key={k}
            href={hrefWith(BASE, { ky: k, coSo })}
            aria-current={k === ky ? "page" : undefined}
            className={k === ky ? "rounded-md bg-primary px-3 py-1 font-semibold text-primary-foreground" : "rounded-md border border-border px-3 py-1 text-foreground hover:bg-muted"}
          >
            Tháng {k.split("-").reverse().join("/")}
          </a>
        ))}
      </nav>
    </>
  );
  if (!bat) {
    return (
      <div className="max-w-6xl">
        {header}
        <EmptyState
          title="Xác nhận công đang tắt"
          description="Tham số “Bật xác nhận công + khiếu nại công” đang tắt: nhân sự chưa thấy ô xác nhận / khiếu nại, và chốt kỳ không hỏi khiếu nại."
        />
      </div>
    );
  }
  const [{ dong, khieuNai, soCanMoi }, tt] = await Promise.all([baoCaoXacNhan(coSo, ky), trangThaiKyXacNhan(coSo, ky, new Date())]);
  const dem = (t: string) => dong.filter((d) => d.trangThai === t).length;
  const moiDuoc = scope.has(CLOSE, coSo) && tt.daKetThuc && !tt.daKhoa && soCanMoi > 0;
  return (
    <div className="max-w-6xl">
      {header}
      {dong.length === 0 ? (
        <EmptyState title="Chưa có ai" description="Kỳ này khối chưa có ai có ca hoặc lượt quét." />
      ) : (
        <SectionCard
          actions={moiDuoc ? <NutMoiXacNhan coSo={coSo} ky={ky} soCanMoi={soCanMoi} /> : undefined}
          title={`Bảng xác nhận — ${block.label} · ${dem("DA_XAC_NHAN") + dem("HR_XAC_NHAN_THAY")}/${dong.length} đã xác nhận · ${dem("CHUA_XAC_NHAN")} chưa · ${dem("CAN_XAC_NHAN_LAI")} cần xác nhận lại`}
        >
          <BangXacNhan coSo={coSo} ky={ky} dong={dong} xacNhanThayDuoc={scope.has(CLOSE, coSo)} />
        </SectionCard>
      )}
      <SectionCard title={`Khiếu nại (${khieuNai.length})`}>
        {khieuNai.length === 0 ? (
          <p className="text-sm text-muted-foreground">Kỳ này chưa có khiếu nại nào.</p>
        ) : (
          <DanhSachKhieuNai
            xuLyDuoc={scope.has(APPROVE, coSo)}
            khieuNai={khieuNai.map((k) => ({
              id: k.id,
              ten: k.ten,
              category: k.category,
              critical: k.critical,
              status: k.status,
              workDate: k.workDate,
              linkedRequestId: k.linkedRequestId,
              messages: k.messages.map((m) => ({ body: m.body, statusTo: m.statusTo, createdAt: m.createdAt, laNhanSu: m.authorId === k.userId })),
            }))}
          />
        )}
      </SectionCard>
    </div>
  );
}
