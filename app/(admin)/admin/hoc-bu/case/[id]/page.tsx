import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkAnyPermission, checkPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { DiemDanhBe, type HanhDongBe } from "@/components/hoc-bu/diem-danh-be";
import { formatDateVN } from "@/lib/format/date";
import { vnYmd } from "@/lib/time/vn";
import { docChiTietCaseV2 } from "@/lib/hoc-bu/case-chi-tiet";
import { trangThaiSucChua } from "@/lib/hoc-bu/hien-thi-thuan";
import { diemDanhBeAction, suaDiemDanhBeAction, danhGiaMucAction, goBeKhoiCaseAction, guiBaiKiemTraBuAction } from "../../_actions";
import { taiLieuCuaCase } from "@/lib/hoc-bu/tai-lieu-bu";
import { KhoiTaiLieuBu } from "@/components/hoc-bu/tai-lieu-bu";
import { NutHuyCase } from "./nut-huy-case";
import { NutNangCap, NutSuaCase } from "./sua-case";

export const metadata = { title: "Case dạy bù | Admin" };
export const dynamic = "force-dynamic";

export default async function CaseBuPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkAnyPermission([...PAGE_GATES["/hoc-bu"]]))) redirect("/dashboard?error=unauthorized");
  const [xemTatCa, coTheXep, coTheNhap] = await Promise.all([
    checkPermission("makeup:view-all"),
    checkPermission("makeup:manage"),
    // Điểm danh + nhận xét: quản lý (admin/QLCS/quản lý lớp). Sale chỉ xem trạng thái (chốt 29/09).
    checkPermission("makeup:attend"),
  ]);

  const sdb = scopedDb(await resolveActor(session.user.id));
  const c = await docChiTietCaseV2(sdb, { caseId: id, chiCuaSale: xemTatCa ? null : session.user.id });
  if (!c) notFound();

  const mo = c.status === "SCHEDULED";
  const [taiLieuTheoBai, phong] = await Promise.all([
    Promise.all(c.boBai.map(async (b) => ({ bai: b, taiLieu: await taiLieuCuaCase({ lessonId: b.id, classIds: c.classIds }) }))),
    coTheXep && mo
      ? sdb.room.findMany({ where: { centerId: c.centerId, status: "ACTIVE" }, orderBy: [{ displayOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, capacity: true } })
      : Promise.resolve([]),
  ]);
  const chuaDiemDanh = c.be.filter((b) => b.status === "PENDING").length;
  const tt =
    c.status === "SCHEDULED"
      ? ({ nhan: "Sắp dạy", tone: "info" } as const)
      : c.status === "COMPLETED"
        ? ({ nhan: "Đã dạy", tone: "success" } as const)
        : c.status === "NO_SHOW"
          ? ({ nhan: "Không bé nào tới", tone: "muted" } as const)
          : ({ nhan: "Đã huỷ", tone: "muted" } as const);
  const suc = trangThaiSucChua(c.soBe, c.sucChua);

  // Server action nhận caseId cố định ở đây — component chỉ truyền id bé / id mục.
  async function diemDanh(p: Parameters<HanhDongBe["diemDanh"]>[0]) {
    "use server";
    return diemDanhBeAction({ caseId: id, ...p });
  }
  async function sua(p: Parameters<NonNullable<HanhDongBe["sua"]>>[0]) {
    "use server";
    return suaDiemDanhBeAction({ caseId: id, ...p });
  }
  async function luuPhieu(p: Parameters<NonNullable<HanhDongBe["luuPhieu"]>>[0]) {
    "use server";
    return danhGiaMucAction({ caseId: id, ...p });
  }

  async function goBe(participantId: string) {
    "use server";
    return goBeKhoiCaseAction({ caseId: id, participantId });
  }
  async function guiBai(examId: string) {
    "use server";
    return guiBaiKiemTraBuAction({ caseId: id, examId });
  }
  const hanhDong: HanhDongBe = { diemDanh, sua, luuPhieu, goBe: coTheXep && mo ? goBe : undefined };

  const khoiTaiLieu = (
    <div className="space-y-4">
        {taiLieuTheoBai.map(({ bai, taiLieu }) => (
          <div key={bai.id}>
            {c.boBai.length > 1 && <h3 className="mb-1.5 text-sm font-medium text-foreground">{bai.ten}</h3>}
            <KhoiTaiLieuBu taiLieu={taiLieu} hrefScorm={null} soCoMat={c.soCoMat} guiBai={coTheNhap ? guiBai : null} />
          </div>
        ))}
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <Link
        href="/hoc-bu?tab=case"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Case dạy bù
      </Link>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              Buổi bù {formatDateVN(c.date)} · {c.startTime}–{c.endTime}
            </h1>
            <StatusPill tone={tt.tone}>{tt.nhan}</StatusPill>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {c.khoa} · {c.boBai.map((b) => b.ten).join(" · ")}
          </p>
        </div>
        {coTheXep && mo && c.daNangCap && chuaDiemDanh === c.soBe && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <NutSuaCase
              d={{
                caseId: c.id,
                phienBan: c.version,
                ymd: vnYmd(c.date),
                startTime: c.startTime,
                endTime: c.endTime,
                teacherId: c.teacherId,
                giaoVien: c.giaoVien,
                roomId: c.roomId,
                note: c.note,
                soBe: c.soBe,
                needIdMau: c.be.find((b) => b.muc[0])?.muc[0]?.makeupNeedId ?? null,
                phong: phong.map((r) => ({ id: r.id, name: r.name, sucChua: r.capacity })),
              }}
            />
            <NutHuyCase caseId={c.id} />
          </div>
        )}
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-border bg-card p-4 text-sm sm:grid-cols-4">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Giáo viên</dt>
          <dd className="truncate font-medium">{c.giaoVien}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Phòng</dt>
          <dd className="truncate font-medium">{c.phong ?? "Chưa xếp"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Học viên</dt>
          <dd className={suc.muc === "VUOT" ? "font-medium tabular-nums text-[color:var(--state-danger)]" : "font-medium tabular-nums"} data-suc-chua={suc.muc}>
            {c.sucChua === null ? c.soBe : `${c.soBe}/${c.sucChua}`}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Có mặt</dt>
          <dd className="font-medium tabular-nums">
            {c.soCoMat}/{c.soBe}
          </dd>
        </div>
        {suc.muc === "VUOT" && (
          <div className="col-span-2 sm:col-span-4">
            <p className="text-xs font-medium text-[color:var(--state-danger)]">{suc.nhan}</p>
          </div>
        )}
        {c.note && (
          <div className="col-span-2 min-w-0 sm:col-span-4">
            <dt className="text-xs text-muted-foreground">Ghi chú</dt>
            <dd className="whitespace-pre-line">{c.note}</dd>
          </div>
        )}
      </dl>

      {coTheXep && !c.daNangCap && (
        <div className="mt-5">
          <NutNangCap caseId={c.id} />
        </div>
      )}

      {/* Một bài: tài liệu đứng TRƯỚC điểm danh như trước. Nhiều bài: điểm danh lên trước (việc chính), tài liệu gập lại ở dưới — 3 bài là 6 thẻ chữ đẩy nút điểm danh xuống quá xa trên điện thoại. */}
      {c.boBai.length === 1 && <div className="mt-6">{khoiTaiLieu}</div>}

      <section className="mt-6 space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold">Điểm danh &amp; đánh giá từng bài</h2>
          {mo && c.daNangCap && <p className="text-xs text-muted-foreground">{chuaDiemDanh ? `Còn ${chuaDiemDanh} bé chưa điểm danh` : "Đã điểm danh xong"}</p>}
        </div>
        {c.daNangCap ? (
          <DiemDanhBe be={c.be} moDiemDanh={mo} coTheNhap={coTheNhap} hanhDong={hanhDong} boiCanh={{ khoa: c.khoa, ngayHienThi: formatDateVN(c.date) }} hrefPhieuGoc="/hoc-bu/phieu/" />
        ) : (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            Case chưa nâng cấp nên chưa điểm danh từng bài được{coTheXep ? " — bấm “Nâng cấp case này” ở trên." : "."}
          </p>
        )}
        {!coTheNhap && (
          <p className="text-xs text-muted-foreground">
            Bạn xem được trạng thái điểm danh và đánh giá từng bài. Việc nhập do giáo viên của buổi bù hoặc quản lý làm.
          </p>
        )}
        {!mo && (
          <p className="text-xs text-muted-foreground">
            {c.status === "COMPLETED"
              ? "Case đã chốt: buổi bù được tính vào công dạy của giáo viên theo phân loại Học bù. Buổi vắng gốc vẫn ghi “vắng”, kèm nhãn đã bù và đánh giá."
              : "Case đã huỷ — các bé chưa học được trả lại danh sách cần bù."}
          </p>
        )}
      </section>

      {c.boBai.length > 1 && (
        <details className="mt-6 rounded-xl border border-border bg-card">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-medium">Tài liệu &amp; bài kiểm tra bù của {c.boBai.length} bài</summary>
          <div className="border-t border-border p-4">{khoiTaiLieu}</div>
        </details>
      )}
    </div>
  );
}
