// app/(teacher)/teacher/anh-lop/page.tsx — #06 (L6): màn "Ảnh lớp" site GV.
//
// 25/08 — đây là THƯ VIỆN ẢNH CỦA LỚP, phân loại theo BUỔI HỌC. Chủ dự án chốt: giáo
// viên tải toàn bộ ảnh của lớp ở đây, "sau khi up ảnh thì đẩy qua cho QLCS duyệt từng
// ảnh". Khâu "đưa vào kho rồi chọn gửi" biến khỏi đường của giáo viên — ảnh tải lên đi
// thẳng vào hàng chờ duyệt (xem uploadSessionMediaAction).
//
// 2 mức điều hướng qua searchParams (pattern lop/page.tsx, href CHỈ-query):
//   (a) không tham số → grid lớp mình (assignedClassIds) + số ảnh / chờ duyệt.
//   (b) ?classId=…    → album của lớp: ảnh gom theo BUỔI, nhãn buổi đầy đủ
//                       "Buổi 7 - HP1 - Bàn Tay Ma Thuật" (deriveSessionLabel) + badge
//                       trạng thái duyệt (Chờ duyệt / Đã duyệt / Bị từ chối).
//
// KHO (DRAFT) VẪN CÒN nhưng chỉ còn là DI SẢN: ảnh tồn từ luồng cũ, cộng ảnh do
// Marketing / Giáo vụ góp (`media:upload-draft` — chốt 11/08, họ KHÔNG đẩy thẳng vào
// hàng duyệt được). Giáo viên vẫn là người duy nhất chọn ảnh trong kho gửi đi, nên
// DraftStorePanel giữ nguyên; nó tự ẩn khi kho rỗng.
//
// CONSENT (bất biến C6.2/C6.3): trang này KHÔNG viết luật consent mới — mọi thao tác đi
// qua action admin (app/(admin)/admin/media/actions.ts). ⚠️ Ảnh mới tải lên KHÔNG gắn
// thẻ và KHÔNG "chung cả lớp" ⇒ ẩn với phụ huynh cho tới khi giáo viên bấm "Chọn ảnh" ở
// phiếu nhận xét. Thẻ "Chưa gán học viên" dưới mỗi ảnh là chỗ bày việc còn nợ đó ra.
// GV chỉ XEM mọi status (cần biết ảnh nào chưa duyệt) — KHÔNG có nút duyệt/xoá
// (media:approve = QL).
//
// Cách ly cơ sở: ClassSessionMedia ∉ SCOPED_MODELS (relation-scoped qua class.centerId,
// xem app/(admin)/admin/media/actions.ts) → đọc pass-through SAU guard assignedClassIds
// (ranh giới thật). Class/ClassSession đọc qua withMakeupException như lop/page.tsx
// (GV dạy bù liên cơ sở vẫn thấy đúng lớp/buổi mình phụ trách).
// ⚠️ Câu 46: tag chỉ hiện TÊN học viên — KHÔNG SĐT/email/tên phụ huynh trong payload.
import { Calendar, Images } from "lucide-react";
import type { MediaStatus } from "@prisma/client";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { actorGiangDay, withMakeupException } from "@/lib/db-scope";
import { resolveMediaUrls } from "@/lib/storage/signed-url";
import { checkPermission } from "@/lib/auth/check-permission";
import { locAnhTheoNguoiXem } from "@/lib/media/pham-vi-xem";
import { getNonConsentStudents } from "@/lib/lms/media-consent";
import { buildSessionNumberMap } from "@/lib/lms/session-order";
import { deriveSessionLabel } from "@/lib/lms/session-project-name";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";
import { trongLop } from "@/lib/bao-luu/roster";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "../_components/ui/page-header";
import { ClassAlbumGrid } from "./_components/class-album-grid";
import { EmptyState } from "../_components/ui/empty-state";
import { UploadPhotoDialog } from "./_components/upload-photo-dialog";
import {
  DraftStorePanel,
  type DraftItem,
} from "./_components/draft-store-panel";
import { BackLink } from "../_components/ui/back-link";

export const metadata = { title: "Ảnh lớp | Giáo viên Sata Robo" };

// Nhãn ngày giờ VN — cùng quy ước các trang GV khác (lop/bang-cong).
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
/** "YYYY-MM-DD" theo giờ VN — khóa gộp nhóm ảnh cũ chỉ có takenAt (không gắn buổi). */
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Asia/Ho_Chi_Minh",
});

// Đồng bộ nhãn/màu trạng thái duyệt với admin media-client (Chờ/Duyệt/Từ chối).
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
    label: "Bị từ chối",
    cls: "bg-state-danger-soft text-state-danger-ink",
  },
  // Kho ảnh — di sản luồng cũ + ảnh Marketing/Giáo vụ góp; không hiện portal.
  DRAFT: {
    label: "Trong kho",
    cls: "bg-state-info-soft text-state-info-ink",
  },
};

// Cover gradient album (port visual mock media/page.tsx `album.cover`) — xoay vòng theo
// lớp. Đây là dải màu PHÂN LOẠI (mỗi lớp một sắc để nhận ra nhanh), cố ý tách khỏi
// token thương hiệu — thêm/bớt ở đây không ảnh hưởng nhận diện.

/** 1 ảnh trong album — payload đã lọc theo câu 46 (tag chỉ TÊN học viên). */
type MediaView = {
  id: string;
  url: string;
  status: MediaStatus;
  caption: string | null;
  isClassWide: boolean;
  tagNames: string[];
};
/** 1 nhóm album: theo buổi (chuẩn) / theo ngày chụp / mức lớp (ảnh cũ chưa gắn buổi). */
type AlbumGroup = {
  key: string;
  label: string;
  sortKey: number;
  items: MediaView[];
};

export default async function TeacherClassPhotosPage({
  searchParams,
}: {
  // `q` / `loc`: bộ lọc lưới album, đọc Ở SERVER (xem use-loc-tren-url.ts).
  searchParams: Promise<{ classId?: string; q?: string; loc?: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null; // layout đã gate — guard cho type-narrow

  const { classId, q: spQ, loc: spLoc } = await searchParams;
  const actor = await resolveActor(session.user.id);
  const xdb = withMakeupException(actorGiangDay(actor));
  const classIds = [...actor.assignedClassIds];
  // 01/10/2026 — GV chỉ thấy ảnh CHÍNH MÌNH tải lên; người duyệt (QLCS) thấy cả lớp
  // (lib/media/pham-vi-xem.ts). Trải vào MỌI câu đọc ảnh bên dưới: album, thống kê, ảnh bìa.
  const locAnh = locAnhTheoNguoiXem({
    xemTatCa: await checkPermission("media:approve"),
    userId: session.user.id,
  });

  // ── (b) Album 1 lớp: ảnh gom theo buổi ───────────────────────────────────────
  if (classId) {
    // Guard assigned (chống IDOR): lớp không phải của mình → không xem, không lộ tên lớp.
    if (!actor.assignedClassIds.has(classId)) return <NotYours />;

    const [cls, media, allSessions] = await Promise.all([
      xdb.class.findUnique({ where: { id: classId }, select: { name: true } }),
      // ClassSessionMedia ∉ SCOPED_MODELS → pass-through sau guard assigned ở trên.
      // GV thấy MỌI status (kể cả PENDING/REJECTED của lớp mình) — khác portal PH
      // (chỉ APPROVED + consent, lo ở isMediaVisibleForStudent).
      xdb.classSessionMedia.findMany({
        where: {
          ...locAnh,
          classId,
        },
        select: {
          id: true,
          fileUrl: true,
          caption: true,
          status: true,
          isClassWide: true,
          classSessionId: true,
          takenAt: true,
          createdAt: true,
          // Kho có ảnh của nhiều vai (GV/Marketing/Giáo vụ — chốt 11/08) → hiện tên
          // người tải lên trên thẻ ảnh trong kho. Chỉ TÊN NHÂN SỰ, không PII PH.
          uploadedByName: true,
          tags: { select: { studentId: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 400,
      }),
      // TOÀN BỘ buổi của lớp (ClassSession ∈ MAKEUP_EXCEPTION_MODELS). ⚠️ KHÔNG cắt
      // `take`: số buổi là HẠNG theo ngày tính trên cả lớp (lib/lms/session-order) —
      // dựng bảng tra từ cửa sổ đã lọc là ra số sai cho mọi buổi còn lại. Đây cũng là
      // nguồn danh sách buổi cho panel kho, nên chỉ đọc một lần.
      xdb.classSession.findMany({
        where: { classId },
        select: {
          id: true,
          date: true,
          topic: true,
          status: true,
          plan: { select: { customTitle: true, order: true } },
          lesson: { select: { order: true, title: true, moduleCode: true } },
        },
        orderBy: { date: "desc" },
      }),
    ]);

    const sessionNo = buildSessionNumberMap(allSessions);
    const sessionMap = new Map(allSessions.map((s) => [s.id, s]));
    /** Nhãn nhóm của một buổi: "Buổi 7 - HP1 - Bàn Tay Ma Thuật · T3, 12/08/2026". */
    const labelOf = (s: (typeof allSessions)[number]) =>
      `${
        deriveSessionLabel({
          sessionNumber: sessionNo.get(s.id) ?? null,
          planTitle: s.plan?.customTitle,
          planOrder: s.plan?.order,
          lessonTitle: s.lesson?.title,
          lessonOrder: s.lesson?.order,
          moduleCode: s.lesson?.moduleCode,
          topic: s.topic,
        }) || "Buổi học"
      } · ${dayFmt.format(s.date)}`;

    // Tên HS được tag — câu 46: CHỈ name. Student vẫn scoped (không nới) → ngoài
    // tầm nhìn (hiếm, ảnh cũ HV chuyển cơ sở) hiện "?" như admin media page.
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

    // Signed URL khi bật flag MEDIA_SIGNED_URL (OFF → fileUrl trần) — như admin.
    const displayUrls = await resolveMediaUrls(media.map((m) => m.fileUrl));

    // Gom nhóm: buổi (chuẩn từ 25/08) → ngày chụp → mức lớp; nhóm mới nhất lên đầu.
    // Hai nhánh sau chỉ còn phục vụ ẢNH CŨ: đường tải lên hiện tại bắt buộc chọn buổi.
    // Ảnh DRAFT (kho) TÁCH RIÊNG khỏi album, render ở DraftStorePanel.
    const groups = new Map<string, AlbumGroup>();
    const draftItems: DraftItem[] = [];
    media.forEach((m, i) => {
      const ses = m.classSessionId
        ? sessionMap.get(m.classSessionId)
        : undefined;
      let key: string;
      let label: string;
      let sortKey: number;
      if (ses) {
        key = `s:${ses.id}`;
        label = labelOf(ses);
        sortKey = ses.date.getTime();
      } else if (m.takenAt) {
        key = `d:${dayKeyFmt.format(m.takenAt)}`;
        label = `Ngày ${shortFmt.format(m.takenAt)} (chưa gắn buổi)`;
        sortKey = m.takenAt.getTime();
      } else {
        key = "class";
        label = "Ảnh mức lớp (chưa gắn buổi)";
        sortKey = Number.NEGATIVE_INFINITY; // luôn xếp cuối
      }
      if (m.status === "DRAFT") {
        draftItems.push({
          id: m.id,
          url: displayUrls[i] ?? m.fileUrl,
          label,
          uploader: m.uploadedByName,
        });
        return;
      }
      const view: MediaView = {
        id: m.id,
        url: displayUrls[i] ?? m.fileUrl,
        status: m.status,
        caption: m.caption,
        isClassWide: m.isClassWide,
        tagNames: m.tags.map((t) => nameMap.get(t.studentId) ?? "?"),
      };
      const g = groups.get(key);
      if (g) g.items.push(view);
      else groups.set(key, { key, label, sortKey, items: [view] });
    });
    const ordered = [...groups.values()].sort((a, b) => b.sortKey - a.sortKey);

    // Roster cho panel kho (chip chọn HS + disable chưa consent) — CÙNG nguồn dữ liệu
    // getClassUploadContext của dialog upload. Câu 46: chỉ id + TÊN học viên.
    // Chỉ đọc khi kho CÒN ảnh: với lớp đã dùng luồng mới, đây là 2 query thừa.
    let rosterStudents: { id: string; name: string }[] = [];
    let nonConsentIds: string[] = [];
    let sessionOptions: { id: string; label: string }[] = [];
    let defaultSessionId = "";
    if (draftItems.length > 0) {
      const [enrRows, nonConsent] = await Promise.all([
        xdb.enrollment.findMany({
          where: trongLop({ classId, status: { in: ENROLLMENT_ACTIVE_STATUS_LIST } }, new Date()),
          select: { student: { select: { id: true, name: true } } },
          orderBy: { createdAt: "asc" },
        }),
        getNonConsentStudents(classId),
      ]);
      rosterStudents = enrRows.map((e) => e.student);
      nonConsentIds = nonConsent.map((s) => s.id);
      const usable = allSessions.filter((s) => s.status !== "CANCELLED");
      sessionOptions = usable.map((s) => ({ id: s.id, label: labelOf(s) }));
      const now = new Date();
      defaultSessionId = usable.find((s) => s.date <= now)?.id ?? "";
    }

    return (
      <div className="space-y-6">
        <BackLink href="?" label="Ảnh lớp" />
        <PageHeader
          title={`Ảnh lớp — ${cls?.name ?? "Lớp"}`}
          subtitle="Tải toàn bộ ảnh của lớp tại đây, phân loại theo buổi. Ảnh chuyển thẳng cho quản lý cơ sở duyệt từng tấm; duyệt xong bạn vào phiếu nhận xét bấm “Chọn ảnh” để gán ảnh cho từng học viên."
          actions={<UploadPhotoDialog classId={classId} />}
        />

        {/* Kho ảnh — DI SẢN: ảnh tồn từ luồng cũ + ảnh marketing/giáo vụ góp. Tự ẩn khi rỗng. */}
        {draftItems.length > 0 && (
          <DraftStorePanel
            drafts={draftItems}
            students={rosterStudents}
            nonConsentIds={nonConsentIds}
            sessions={sessionOptions}
            defaultSessionId={defaultSessionId}
          />
        )}

        {media.length === 0 ? (
          <EmptyBox text="Lớp chưa có ảnh nào — bấm “Đăng ảnh lớp” để tải ảnh buổi học." />
        ) : ordered.length === 0 ? null : (
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
                  <h2 className="text-sm font-bold capitalize text-foreground">
                    {g.label}
                  </h2>
                  <Badge variant="outline">{g.items.length} ảnh</Badge>
                </div>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                  {g.items.map((m) => (
                    <PhotoCard key={m.id} media={m} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── (a) Grid album theo lớp mình (port visual mock media/page.tsx) ────────────
  const classes = classIds.length
    ? await xdb.class.findMany({
        where: { id: { in: classIds } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : [];
  // Thống kê ảnh theo lớp (1 query): tổng + số chờ duyệt + ảnh mới nhất.
  const stats = classIds.length
    ? await xdb.classSessionMedia.groupBy({
        by: ["classId", "status"],
        where: {
          ...locAnh,
          classId: { in: classIds },
        },
        _count: { _all: true },
        _max: { createdAt: true },
      })
    : [];
  const statByClass = new Map<
    string,
    { total: number; pending: number; draft: number; latest: Date | null }
  >();
  for (const s of stats) {
    const cur = statByClass.get(s.classId) ?? {
      total: 0,
      pending: 0,
      draft: 0,
      latest: null,
    };
    cur.total += s._count._all;
    if (s.status === "PENDING") cur.pending += s._count._all;
    if (s.status === "DRAFT") cur.draft += s._count._all;
    const max = s._max.createdAt;
    if (max && (!cur.latest || max > cur.latest)) cur.latest = max;
    statByClass.set(s.classId, cur);
  }

  // ẢNH BÌA: một ảnh ĐÃ DUYỆT mới nhất cho mỗi lớp.
  //
  // Chỉ lấy APPROVED — thẻ ngoài cùng là nơi ai đi ngang cũng thấy, không phải chỗ bày
  // ảnh còn chờ quản lý cơ sở duyệt. Một truy vấn cho mọi lớp rồi ký URL theo LÔ
  // (`resolveMediaUrls` gọi song song), nên không phải N+1.
  const coverRows = classIds.length
    ? await xdb.classSessionMedia.findMany({
        where: {
          ...locAnh,
          classId: { in: classIds },
          status: "APPROVED",
        },
        select: { classId: true, fileUrl: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const coverByClass = new Map<string, string>();
  for (const r of coverRows) {
    if (!coverByClass.has(r.classId)) coverByClass.set(r.classId, r.fileUrl);
  }
  const coverIds = [...coverByClass.keys()];
  const coverSigned = await resolveMediaUrls(
    coverIds.map((id) => coverByClass.get(id)!),
  );
  const coverUrlByClass = new Map(
    coverIds.map((id, i) => [id, coverSigned[i] ?? null]),
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Ảnh lớp"
        subtitle="Ảnh các buổi học ở những lớp bạn phụ trách — chọn lớp để xem album theo buổi và đăng ảnh mới."
      />
      {classes.length === 0 ? (
        <EmptyBox text="Bạn chưa được phân công lớp nào." />
      ) : (
        <ClassAlbumGrid
          banDauLoc={{ q: spQ, loc: spLoc }}
          rows={classes.map((c) => {
            const st = statByClass.get(c.id) ?? {
              total: 0,
              pending: 0,
              draft: 0,
              latest: null,
            };
            return {
              id: c.id,
              name: c.name,
              total: st.total,
              pending: st.pending,
              draft: st.draft,
              latestLabel: st.latest ? shortFmt.format(st.latest) : null,
              coverUrl: coverUrlByClass.get(c.id) ?? null,
            };
          })}
        />
      )}
    </div>
  );
}

/**
 * Thẻ 1 ảnh. Trạng thái duyệt phải đọc được ngay: giáo viên cần biết VÌ SAO một tấm
 * chưa tới phụ huynh. Ảnh BỊ TỪ CHỐI làm mờ + viền đỏ (khác hẳn phần còn lại) vì nó là
 * ảnh sẽ không bao giờ đi tiếp, không phải ảnh đang chờ.
 */
function PhotoCard({ media }: { media: MediaView }) {
  const rejected = media.status === "REJECTED";
  // Ảnh đã duyệt nhưng chưa gắn em nào và không phải "chung cả lớp" thì ẩn với MỌI phụ
  // huynh (bất biến C6.2). Từ 25/08 đây là trạng thái BÌNH THƯỜNG sau khi tải lên, nên
  // phải nói ra chỗ làm tiếp thay vì để giáo viên tưởng đã xong.
  const unassigned =
    media.status === "APPROVED" &&
    !media.isClassWide &&
    media.tagNames.length === 0;

  return (
    <figure
      className={cn(
        "t-card overflow-hidden",
        rejected && "border-state-danger-soft dark:border-state-danger",
      )}
    >
      {/* Preview thumbnail (R2 / presigned) — <img> như admin media-client */}
      <img
        src={media.url}
        alt={media.caption ?? "Ảnh lớp"}
        className={cn(
          "aspect-square w-full object-cover",
          rejected && "opacity-50 grayscale",
        )}
      />
      <figcaption className="space-y-1 p-2">
        <div className="flex flex-wrap items-center gap-1">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-semibold",
              MEDIA_STATUS[media.status].cls,
            )}
          >
            {MEDIA_STATUS[media.status].label}
          </span>
          {media.isClassWide && (
            <span className="rounded-full bg-state-info-soft px-2 py-0.5 text-[11px] font-semibold text-state-info-ink">
              Ảnh chung lớp
            </span>
          )}
        </div>
        {rejected && (
          <p className="text-[11px] font-medium text-state-danger-ink">
            Quản lý cơ sở đã từ chối — ảnh này không gửi tới phụ huynh.
          </p>
        )}
        {unassigned && (
          <p className="text-[11px] text-muted-foreground">
            Chưa gán học viên — vào phiếu nhận xét bấm “Chọn ảnh”.
          </p>
        )}
        {media.caption && (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {media.caption}
          </p>
        )}
        {media.tagNames.length > 0 && (
          <p className="truncate text-[11px] text-muted-foreground">
            Tag: {media.tagNames.join(", ")}
          </p>
        )}
      </figcaption>
    </figure>
  );
}

function EmptyBox({ text }: { text: string }) {
  return <EmptyState icon={Images} title={text} />;
}

function NotYours() {
  return (
    <div className="space-y-4">
      <BackLink href="?" label="Ảnh lớp" />
      <EmptyBox text="Lớp không thuộc danh sách bạn phụ trách." />
    </div>
  );
}
