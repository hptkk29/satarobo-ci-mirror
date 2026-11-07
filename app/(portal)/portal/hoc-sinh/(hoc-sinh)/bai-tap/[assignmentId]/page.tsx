import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActiveStudent } from "@/lib/portal/session";
import { docHvBaiTapChiTiet } from "@/lib/portal/hv-du-lieu";
import { diemHienThi } from "@/lib/portal/hv-bai-tap-thuan";
import { resolveMediaUrl } from "@/lib/storage/signed-url";
import { ngayGioVN } from "@/lib/format/date";
import { HvThe } from "@/components/portal/hv-ui";
import { HvNopBai } from "@/components/portal/hv-nop-bai";
import { XUNG_GV } from "@/lib/portal/hv-dieu-huong";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bài về nhà | Cổng học sinh Sata Robo", robots: { index: false } };

// Chi tiết một bài về nhà trong Cổng học sinh: đề bài + nộp bài. Dùng CHÍNH loader và hành động nộp bài của cổng phụ huynh
// (cùng cổng hạn nộp / nộp trễ / chấm rồi không nộp lại), chỉ khác giao diện — và chỉ đọc bài của đúng con trong token chế độ học sinh.
export default async function HvBaiTapChiTietRoute({ params }: { params: Promise<{ assignmentId: string }> }) {
  const { studentId } = await requireActiveStudent({ choHocSinh: true });
  const { assignmentId } = await params;
  const kq = await docHvBaiTapChiTiet(studentId, assignmentId);
  if (!kq) notFound();
  const { a, buoi, hanBai } = kq;
  const sub = a.submission;
  const daCham = sub?.status === "GRADED";

  const tep = await Promise.all(
    [...a.documents.map((d) => ({ id: d.id, ten: d.title, url: d.fileUrl })), ...a.attachments.map((f) => ({ id: f.id, ten: f.fileName, url: f.fileUrl }))].map(
      async (t) => ({ ...t, url: await resolveMediaUrl(t.url) }),
    ),
  );
  const dsNop =
    sub && sub.files.length > 0
      ? sub.files.map((f) => ({ url: f.fileUrl, name: f.fileName, size: f.fileSize ?? 0, mime: f.mimeType ?? "" }))
      : sub?.fileUrl
        ? [{ url: sub.fileUrl, name: sub.fileName ?? "Tệp đã nộp", size: 0, mime: "" }]
        : [];
  const daNop = await Promise.all(dsNop.map(async (f) => ({ ...f, url: await resolveMediaUrl(f.url) })));
  const diem = daCham && sub?.score != null ? diemHienThi(sub.score, a.totalPoints) : null;

  return (
    <>
      <Link href="/portal/hoc-sinh/bai-tap" className="self-start text-sm font-bold text-[var(--sr-purple-text)] no-underline">
        ← Bài tập & bài thi
      </Link>
      <HvThe vien="cam" className="gap-[18px] p-6">
        <div className="flex flex-col gap-1.5">
          <div className="text-xs font-bold text-[var(--sr-orange-text)]">BÀI VỀ NHÀ{buoi !== null ? ` · BUỔI ${buoi}` : ""}</div>
          <h1 className="m-0 break-words text-[22px] font-bold leading-[29px]">{a.title}</h1>
          <div className="text-sm text-muted-foreground">
            {a.dueAt ? `Hạn nộp ${ngayGioVN(a.dueAt)}${hanBai.nhan ? ` · ${hanBai.nhan}` : ""}` : "Chưa đặt hạn nộp"}
            {` · ${a.totalPoints} điểm`}
          </div>
        </div>
        {(a.description || a.instructions) && (
          <div className="flex flex-col gap-2.5 rounded-2xl bg-background p-3.5 text-sm leading-[21px]">
            {a.description && <p className="m-0 whitespace-pre-wrap">{a.description}</p>}
            {a.instructions && (
              <p className="m-0 whitespace-pre-wrap text-[var(--sr-ink-body)]">
                <b>Hướng dẫn: </b>
                {a.instructions}
              </p>
            )}
          </div>
        )}
        {tep.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {tep.map((t) => (
              <a
                key={t.id}
                href={t.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-10 items-center rounded-xl border border-border bg-card px-3.5 text-[13px] font-bold text-foreground no-underline"
              >
                {t.ten}
              </a>
            ))}
          </div>
        )}
        {daCham && (
          <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-[var(--sr-success-bg)] p-4">
            <span className="grid min-h-[60px] min-w-[60px] place-items-center rounded-[18px] bg-card px-1 font-display text-[22px] font-extrabold text-[var(--sr-success)]">
              {diem ? diem.chu : "✓"}
            </span>
            <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-1">
              <b>{XUNG_GV[0]?.toUpperCase()}{XUNG_GV.slice(1)} đã chấm bài này</b>
              {sub?.feedback && <span className="text-sm leading-[21px]">{sub.feedback}</span>}
            </div>
          </div>
        )}
        <HvNopBai
          assignmentId={a.id}
          allowText={a.allowText}
          allowFile={a.allowFile}
          initialText={sub?.textAnswer ?? null}
          initialFiles={daNop}
          daCham={daCham}
          xung={XUNG_GV}
        />
      </HvThe>
    </>
  );
}
