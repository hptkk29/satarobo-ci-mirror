import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { PageHeader } from "@/components/admin/ui/page-header";
import { StatusPill, type PillTone } from "@/components/admin/ui/status-pill";
import { EmptyState } from "@/components/admin/ui/states";
import { docRaSoat } from "@/lib/hoc-bu/ra-soat-db";
import { lienKetPhatHien } from "@/lib/hoc-bu/ra-soat-lien-ket";
import { LUAT, type Finding, type MaLuat, type MucNghiemTrong, type PhanLoai } from "@/lib/hoc-bu/toan-ven";

// "Rà soát dữ liệu Học bù" — màn CHỈ ĐỌC (12/10/2026). Hiện kết quả của checker toàn vẹn T01 cho người quản lý: nhóm theo VIỆC cần quyết, mỗi phát hiện có liên kết tới màn xử lý có sẵn.
//
// KHÔNG có nút tự sửa, KHÔNG có Server Action, KHÔNG lưu trạng thái "đã rà" (không bảng mới — theo dõi việc rà soát là backlog B-31). Sửa hàng loạt chỉ đi qua
// `scripts/hoc-bu-sua-du-lieu.ts` (dry-run + `--expect`) do chủ dự án chạy. Checker chỉ chạy khi bấm "Chạy rà soát" (?chay=1), không chạy mỗi lần mở trang.
export const metadata = { title: "Rà soát dữ liệu Học bù | Admin" };
export const dynamic = "force-dynamic";

const TONE_NGHIEM_TRONG: Record<MucNghiemTrong, PillTone> = { CRITICAL: "danger", HIGH: "danger", MEDIUM: "warning", LOW: "muted" };
const NHAN_PHAN_LOAI: Record<PhanLoai, { nhan: string; tone: PillTone }> = {
  AUTO_FIXABLE: { nhan: "Có thể sửa tự động (script)", tone: "info" },
  NEEDS_MANUAL_REVIEW: { nhan: "Cần người quyết", tone: "warning" },
  INVALID: { nhan: "Dữ liệu hỏng", tone: "danger" },
  SAFE: { nhan: "Không gấp", tone: "muted" },
};
const THU_TU_NGHIEM_TRONG: MucNghiemTrong[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const TOI_DA_MOI_LUAT = 25;

export default async function RaSoatPage({ searchParams }: { searchParams: Promise<{ chay?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Chỉ người xem được MỌI học viên trong tầm nhìn cơ sở (quản lý cơ sở / quản lý lớp / quản trị): báo cáo có tên học viên của mọi Sale.
  if (!(await checkPermission("makeup:view-all"))) redirect("/dashboard?error=unauthorized");
  const sp = await searchParams;

  const dau = (
    <PageHeader
      title="Rà soát dữ liệu Học bù"
      subtitle="Chỉ đọc — hệ thống KHÔNG tự sửa gì ở đây. Mỗi phát hiện dẫn tới màn bạn tự xử lý (có ghi nhật ký)."
      actions={
        <Link href="/hoc-bu" className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:bg-muted sm:min-h-9">
          ← Về Học bù
        </Link>
      }
    />
  );

  if (sp.chay !== "1") {
    return (
      <div>
        {dau}
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">
            Rà soát đọc toàn bộ dòng cần bù và case Học bù, đối chiếu 28 luật toàn vẹn (số lượt, phí, điểm danh, trùng lịch, công dạy bù…). Chạy mất vài giây; không ghi gì vào dữ liệu.
          </p>
          <Link
            href="/hoc-bu/ra-soat?chay=1"
            className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 sm:min-h-10"
          >
            Chạy rà soát
          </Link>
        </div>
      </div>
    );
  }

  const { ketQua, luc, tuNgayYmd } = await docRaSoat();
  const tong = ketQua.findings.length;
  const nghiem = ketQua.findings.filter((f) => f.nghiemTrong === "CRITICAL" || f.nghiemTrong === "HIGH").length;
  const nhomTheoPhatHien = new Map<string, string>();
  for (const g of ketQua.nhomGoc) for (const p of g.phatHien) nhomTheoPhatHien.set(p, g.id);

  return (
    <div>
      {dau}
      <div className="mb-5 rounded-xl border border-border bg-card p-4">
        <p className="text-sm text-foreground">
          <strong>{tong}</strong> phát hiện · <strong>{nghiem}</strong> mức CRITICAL/HIGH · <strong>{ketQua.nhomGoc.length}</strong> nhóm liên quan nhau
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Chạy lúc {luc.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })} · xét từ {tuNgayYmd}.{" "}
          <Link href="/hoc-bu/ra-soat?chay=1" className="font-medium text-primary hover:underline">
            Chạy lại
          </Link>
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {THU_TU_NGHIEM_TRONG.map((m) => (
            <StatusPill key={m} tone={TONE_NGHIEM_TRONG[m]}>
              {m} · {ketQua.findings.filter((f) => f.nghiemTrong === m).length}
            </StatusPill>
          ))}
        </div>
      </div>

      {tong === 0 ? (
        <EmptyState title="Không có phát hiện nào" description="Mọi luật đã chạy và sạch." />
      ) : (
        <>
          {ketQua.nhomGoc.length > 0 && (
            <section className="mb-6" aria-labelledby="nhom-goc">
              <h2 id="nhom-goc" className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
                Nhóm liên quan nhau — một việc cần quyết
              </h2>
              <ul className="space-y-2">
                {ketQua.nhomGoc.map((g) => (
                  <li key={g.id} className="rounded-lg border border-border bg-card p-3 text-sm">
                    <p className="font-medium text-foreground">
                      {g.phatHien.length} phát hiện · {g.luat.join(", ")}
                    </p>
                    <p className="mt-0.5 break-all font-mono text-xs text-muted-foreground">{g.id}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(Object.keys(LUAT) as MaLuat[]).map((m) => {
            const ds = ketQua.findings.filter((f) => f.luat === m);
            if (ds.length === 0) return null;
            return (
              <section key={m} className="mb-6" aria-labelledby={`luat-${m}`}>
                <h2 id={`luat-${m}`} className="mb-2 text-sm font-bold text-foreground">
                  {m} — {LUAT[m]} <span className="font-normal text-muted-foreground">({ds.length})</span>
                </h2>
                <ul className="space-y-2">
                  {ds.slice(0, TOI_DA_MOI_LUAT).map((f) => (
                    <PhatHien key={`${f.luat}:${f.id}`} f={f} nhom={nhomTheoPhatHien.get(`${f.luat}:${f.id}`)} />
                  ))}
                </ul>
                {ds.length > TOI_DA_MOI_LUAT && (
                  <p className="mt-2 text-xs text-muted-foreground">… và {ds.length - TOI_DA_MOI_LUAT} phát hiện nữa — chạy script kiểm toàn vẹn để xem đủ (bản JSON).</p>
                )}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}

function PhatHien({ f, nhom }: { f: Finding; nhom?: string }) {
  const pl = NHAN_PHAN_LOAI[f.phanLoai];
  return (
    <li className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={TONE_NGHIEM_TRONG[f.nghiemTrong]}>{f.nghiemTrong}</StatusPill>
        <StatusPill tone={pl.tone}>{pl.nhan}</StatusPill>
        {nhom && <span className="text-xs text-muted-foreground">nhóm có từ 2 phát hiện</span>}
      </div>
      <p className="mt-2 text-sm text-foreground">{f.lyDo}</p>
      <p className="mt-1 text-sm text-muted-foreground">Đề xuất: {f.deXuat}</p>
      <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
        {f.thucThe} {f.id}
        {f.hocVien ? ` · ${f.hocVien}` : ""}
      </p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {lienKetPhatHien(f).map((k) => (
          <Link key={k.href} href={k.href} className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline sm:min-h-0">
            {k.nhan} →
          </Link>
        ))}
      </div>
    </li>
  );
}
