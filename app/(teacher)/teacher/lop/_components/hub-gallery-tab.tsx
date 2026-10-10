// hub-gallery-tab.tsx — Tab "Ảnh lớp" của Class Hub.
//
// Album lớp: ảnh gom theo BUỔI (classSessionId → fallback takenAt → mức lớp) + badge
// trạng thái duyệt (MediaStatus). Đăng ảnh TÁI DÙNG UploadPhotoDialog (gate consent
// C6.2/C6.3 + canUploadToClass của admin — GV đăng ĐƯỢC, ảnh vào PENDING chờ duyệt;
// GV KHÔNG duyệt/xoá). ClassSessionMedia ∉ SCOPED_MODELS → pass-through SAU guard
// assignedClassIds (ở caller). ⚠️ Câu 46: tag chỉ TÊN học viên.
import { Calendar, Images } from "lucide-react";
import type { MediaStatus } from "@prisma/client";
import type { Actor } from "@/lib/auth/actor";
import { actorGiangDay, withMakeupException } from "@/lib/db-scope";
import { resolveMediaUrls } from "@/lib/storage/signed-url";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "../../_components/ui/empty-state";
import { UploadPhotoDialog } from "../../anh-lop/_components/upload-photo-dialog";

const dayFmt = new Intl.DateTimeFormat("vi-VN", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Asia/Ho_Chi_Minh",
});
const shortFmt = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Asia/Ho_Chi_Minh",
});
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Asia/Ho_Chi_Minh",
});

const MEDIA_STATUS: Record<MediaStatus, { label: string; cls: string }> = {
  PENDING: {
    label: "Chờ duyệt",
    cls: "bg-state-warning-soft text-state-warning-ink",
  },
  APPROVED: {
    label: "Đã duyệt",
    cls: "bg-state-success-soft text-state-success-ink",
  },
  REJECTED: {
    label: "Từ chối",
    cls: "bg-state-danger-soft text-state-danger-ink",
  },
  // Kho ảnh (chưa gửi PH) — tab hub chỉ HIỆN badge; thao tác gửi/xoá ở trang Ảnh lớp.
  DRAFT: {
    label: "Trong kho",
    cls: "bg-state-info-soft text-state-info-ink",
  },
};

type MediaView = {
  id: string;
  url: string;
  status: MediaStatus;
  caption: string | null;
  isClassWide: boolean;
  tagNames: string[];
};
type AlbumGroup = {
  key: string;
  label: string;
  sortKey: number;
  items: MediaView[];
};

export async function HubGalleryTab({
  actor,
  classId,
}: {
  actor: Actor;
  classId: string;
}) {
  const xdb = withMakeupException(actorGiangDay(actor));

  const media = await xdb.classSessionMedia.findMany({
    where: { classId },
    select: {
      id: true,
      fileUrl: true,
      caption: true,
      status: true,
      isClassWide: true,
      classSessionId: true,
      takenAt: true,
      createdAt: true,
      tags: { select: { studentId: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 400,
  });

  const sessionIds = [
    ...new Set(
      media.map((m) => m.classSessionId).filter((x): x is string => !!x),
    ),
  ];
  const sessions = sessionIds.length
    ? await xdb.classSession.findMany({
        where: { id: { in: sessionIds } },
        select: { id: true, date: true, topic: true },
      })
    : [];
  const sessionMap = new Map(sessions.map((s) => [s.id, s]));

  const studentIds = [
    ...new Set(media.flatMap((m) => m.tags.map((t) => t.studentId))),
  ];
  const students = studentIds.length
    ? await xdb.student.findMany({
        where: { id: { in: studentIds } },
        select: { id: true, name: true },
      })
    : [];
  const nameMap = new Map(students.map((s) => [s.id, s.name]));

  const displayUrls = await resolveMediaUrls(media.map((m) => m.fileUrl));

  const groups = new Map<string, AlbumGroup>();
  media.forEach((m, i) => {
    const view: MediaView = {
      id: m.id,
      url: displayUrls[i] ?? m.fileUrl,
      status: m.status,
      caption: m.caption,
      isClassWide: m.isClassWide,
      tagNames: m.tags.map((t) => nameMap.get(t.studentId) ?? "?"),
    };
    const ses = m.classSessionId ? sessionMap.get(m.classSessionId) : undefined;
    let key: string;
    let label: string;
    let sortKey: number;
    if (ses) {
      key = `s:${ses.id}`;
      label = `Buổi ${dayFmt.format(ses.date)}${ses.topic ? ` · ${ses.topic}` : ""}`;
      sortKey = ses.date.getTime();
    } else if (m.takenAt) {
      key = `d:${dayKeyFmt.format(m.takenAt)}`;
      label = `Ngày ${shortFmt.format(m.takenAt)} (chưa gắn buổi)`;
      sortKey = m.takenAt.getTime();
    } else {
      key = "class";
      label = "Ảnh mức lớp (chưa gắn buổi)";
      sortKey = Number.NEGATIVE_INFINITY;
    }
    const g = groups.get(key);
    if (g) g.items.push(view);
    else groups.set(key, { key, label, sortKey, items: [view] });
  });
  const ordered = [...groups.values()].sort((a, b) => b.sortKey - a.sortKey);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Ảnh các buổi học của lớp. Bạn đăng ảnh → quản lý duyệt → phụ huynh xem
          ảnh con được gắn thẻ (hoặc ảnh chung lớp).
        </p>
        <UploadPhotoDialog classId={classId} />
      </div>

      {media.length === 0 ? (
        <EmptyState
          icon={Images}
          title="Lớp chưa có ảnh nào — bấm “Đăng ảnh lớp” để tải ảnh buổi học."
        />
      ) : (
        <div className="space-y-6">
          {ordered.map((g) => (
            <section key={g.key}>
              <div className="mb-2 flex items-center gap-2">
                {g.key.startsWith("s:") ? (
                  <Images className="h-4 w-4 text-primary-ink" aria-hidden />
                ) : (
                  <Calendar
                    className="h-4 w-4 text-muted-foreground"
                    aria-hidden
                  />
                )}
                <h3 className="text-sm font-bold capitalize text-foreground">
                  {g.label}
                </h3>
                <Badge variant="outline">{g.items.length} ảnh</Badge>
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {g.items.map((m) => (
                  <figure key={m.id} className="t-card overflow-hidden">
                    {/* Preview thumbnail (R2 / presigned) — <img> như admin media-client */}
                    <img
                      src={m.url}
                      alt={m.caption ?? "Ảnh lớp"}
                      className="aspect-square w-full object-cover"
                    />
                    <figcaption className="space-y-1 p-2">
                      <div className="flex flex-wrap items-center gap-1">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                            MEDIA_STATUS[m.status].cls,
                          )}
                        >
                          {MEDIA_STATUS[m.status].label}
                        </span>
                        {m.isClassWide && (
                          <span className="rounded-full bg-state-info-soft px-2 py-0.5 text-[11px] font-semibold text-state-info-ink">
                            Ảnh chung lớp
                          </span>
                        )}
                      </div>
                      {m.caption && (
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                          {m.caption}
                        </p>
                      )}
                      {m.tagNames.length > 0 && (
                        <p className="truncate text-[11px] text-muted-foreground">
                          Tag: {m.tagNames.join(", ")}
                        </p>
                      )}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
