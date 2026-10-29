import Link from "next/link";
import { requireActiveStudent } from "@/lib/portal/session";
import { portalDb } from "@/lib/portal/db";
import { hasMediaConsent } from "@/lib/lms/media-consent";
import { resolveMediaUrl } from "@/lib/storage/signed-url";
import { isPortalV2Enabled } from "@/lib/flags";
import { getStudentPhotos } from "@/lib/portal/photos";
import { HinhAnhPageV2 } from "@/components/portal/hinh-anh-page";
import { formatDateVN } from "@/lib/format/date";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Hình ảnh | Sata Robo",
  robots: { index: false },
};

const ACTIVE_ENROLLMENT = ["CONFIRMED", "STUDYING", "ACTIVE"] as const;

export default async function HinhAnhPage() {
  const { ctx, studentId } = await requireActiveStudent();
  const pdb = portalDb({
    parentUserId: ctx.parentUserId,
    childIds: ctx.children.map((c) => c.id),
  });

  // Portal v2 — trang Hình ảnh lớp giống SataUI.
  if (isPortalV2Enabled()) {
    const data = await getStudentPhotos(studentId);
    return (
      <HinhAnhPageV2
        kids={ctx.children.map((c) => ({ id: c.id, name: c.name }))}
        activeId={ctx.activeStudent?.id ?? null}
        studentName={ctx.activeStudent?.name ?? "con"}
        data={data}
      />
    );
  }

  // Privacy (C3.2/C6.4): chỉ hiện ảnh khi PH đã ĐỒNG Ý dùng hình ảnh. Thu hồi → ẩn ngay.
  const consentGranted = await hasMediaConsent(studentId);

  // Lớp của con + ảnh APPROVED hiện cho PH khi: (a) ảnh được gắn thẻ con, HOẶC
  // (b) ảnh được ĐÁNH DẤU "Ảnh chung cả lớp" (isClassWide) của lớp con đang học.
  // Ảnh gắn thẻ HS khác → KHÔNG hiện. Ảnh không tag & KHÔNG class-wide cũng ẩn
  // (bất biến C6.2). Vẫn yêu cầu consent của con.
  const enr = await pdb.enrollment.findMany({
    where: {
      studentId,
      status: { in: [...ACTIVE_ENROLLMENT] },
      deletedAt: null,
    }, // FIX-C3
    select: { classId: true },
  });
  const classIds = enr.map((e) => e.classId);

  const rawMedia =
    consentGranted && classIds.length > 0
      ? await pdb.classSessionMedia.findMany({
          where: {
            classId: { in: classIds },
            status: "APPROVED",
            OR: [
              { tags: { some: { studentId } } }, // (a) gắn thẻ con
              { isClassWide: true }, // (b) ảnh chung cả lớp (đánh dấu rõ ràng)
            ],
          },
          select: {
            id: true,
            fileUrl: true,
            caption: true,
            takenAt: true,
            approvedAt: true,
            createdAt: true,
            // Đánh dấu ảnh có tag con → ưu tiên hiển thị trước (AC3).
            tags: { where: { studentId }, select: { id: true }, take: 1 },
          },
          orderBy: [{ takenAt: "desc" }, { createdAt: "desc" }],
          take: 200,
        })
      : [];

  // Ưu tiên ảnh có tag con, rồi tới ảnh chung cả lớp.
  const sorted = [...rawMedia].sort(
    (a, b) => (b.tags.length > 0 ? 1 : 0) - (a.tags.length > 0 ? 1 : 0),
  );

  // Signed URL khi bật flag MEDIA_SIGNED_URL (OFF → fileUrl trần).
  const displayUrls = await Promise.all(
    sorted.map((m) => resolveMediaUrl(m.fileUrl)),
  );

  const media = sorted.map((m, i) => ({
    id: m.id,
    url: displayUrls[i] ?? m.fileUrl,
    caption: m.caption,
    takenAt: m.takenAt?.toISOString() ?? null,
    tagged: m.tags.length > 0,
  }));

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-neutral-900">Hình ảnh</h1>
      <p className="-mt-3 text-sm text-neutral-500">
        Ảnh hoạt động của con tại lớp (đã được trung tâm duyệt).
      </p>

      {!consentGranted ? (
        // Chưa đồng ý dùng hình ảnh → giải thích + lối tới trang bật đồng ý (C6.4/L7).
        <div className="space-y-3 rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center">
          <p className="text-sm text-neutral-600">
            Bạn cần bật{" "}
            <span className="font-semibold">đồng ý dùng hình ảnh</span> cho con
            thì trung tâm mới hiển thị ảnh hoạt động tại lớp. Bạn có thể thu hồi
            bất cứ lúc nào.
          </p>
          <Link
            href="/portal/ho-so-con/chi-tiet"
            className="inline-flex items-center rounded-lg bg-orange-700 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-800"
          >
            Bật đồng ý trong Hồ sơ con
          </Link>
        </div>
      ) : media.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
          Chưa có hình ảnh nào.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {media.map((m) => (
            <figure
              key={m.id}
              className="overflow-hidden rounded-xl border border-neutral-200 bg-white"
            >
              <a href={m.url} target="_blank" rel="noopener noreferrer">
                <img
                  src={m.url}
                  alt={m.caption ?? "Ảnh lớp"}
                  className="h-32 w-full object-cover sm:h-40"
                />
              </a>
              <figcaption className="space-y-0.5 p-2">
                {m.takenAt && (
                  <p className="text-[11px] text-neutral-500">
                    {formatDateVN(m.takenAt)}
                  </p>
                )}
                {m.caption && (
                  <p className="text-xs text-neutral-600">{m.caption}</p>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
