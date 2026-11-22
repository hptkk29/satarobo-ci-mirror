import { requireActiveStudent } from "@/lib/portal/session";
import { portalDb } from "@/lib/portal/db";
import {
  REQUEST_TYPE_LABEL,
  nhanTrangThaiYeuCau,
  REQUEST_STATUS_BADGE,
} from "@/lib/portal/request-labels";
import {
  getStudentUpcomingSessions,
  type UpcomingSessionRow,
} from "@/lib/portal/learning";
import { isPortalV2Enabled } from "@/lib/flags";
import { getStudentMakeup } from "@/lib/portal/makeup";
import { redirect } from "next/navigation";
import { TrungTamYeuCau } from "@/components/portal/yeu-cau/trung-tam-yeu-cau";
import { RequestForm } from "./_components/request-form";
import { CancelButton } from "./_components/cancel-button";
import { formatDateVN } from "@/lib/format/date";
import { nhanGio, nhanMocDeXuat, nhanNgayDayDu } from "@/lib/portal/yeu-cau-hien-thi";
import type { SlugYeuCau } from "@/lib/portal/yeu-cau-loai";
import type { ParentRequestType } from "@prisma/client";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Yêu cầu | Sata Robo",
  robots: { index: false },
};

// Báo vắng: chỉ chọn buổi SẮP TỚI (chưa diễn ra) và CHƯA bị huỷ (R7-06) —
// đã lọc + LIMIT ngay ở query (getStudentUpcomingSessions).
function toUpcomingOptions(sessions: UpcomingSessionRow[]) {
  // Nhãn ngày + nhãn buổi tính sẵn ở server theo lịch VN (`lib/portal/buoi-hoc.ts`).
  // `toLocaleDateString` trần ở đây chạy theo giờ tiến trình — Vercel là UTC.
  return sessions.map((s) => ({
    id: s.id,
    label: `${s.nhanNgay} · ${s.className} — ${s.nhan}`,
  }));
}

// Chỉ select cột portal dùng đến (list "Yêu cầu đã gửi") — không kéo mọi cột.
const REQUEST_SELECT = {
  id: true,
  type: true,
  status: true,
  content: true,
  preferredDate: true,
  // Báo vắng / xin học bù: buổi liên quan — để hiện ngày giờ buổi nghỉ và quyết nút «Rút đơn» (chỉ khi buổi còn ở tương lai).
  sessionId: true,
  response: true,
  // C12: yêu cầu 'Bảo lưu' đã được lập hồ sơ ⇒ nhãn 'Đã xử lý' (id hồ sơ KHÔNG gửi xuống trình duyệt phụ huynh).
  reserveId: true,
  createdAt: true,
} as const;

/** Loại yêu cầu → slug màn gửi (chọn biểu tượng cho thẻ đã gửi). */
const SLUG_THEO_LOAI: Record<ParentRequestType, SlugYeuCau> = {
  MAKEUP: "hoc-bu",
  ABSENCE: "nghi",
  RESERVE: "bao-luu",
  TRANSFER_CLASS: "doi-lop",
  TRANSFER_CENTER: "doi-co-so",
  OTHER: "khac",
  CONSENT_CHANGE: "khac",
};

export default async function YeuCauPage({
  searchParams,
}: {
  searchParams: Promise<{ bu?: string }>;
}) {
  const { ctx, studentId } = await requireActiveStudent();
  const pdb = portalDb({
    parentUserId: ctx.parentUserId,
    childIds: ctx.children.map((c) => c.id),
  });

  // Portal v2 — trang Yêu cầu học bù giống SataUI (per-child) + form gửi/huỷ yêu cầu.
  if (isPortalV2Enabled()) {
    const [data, requests, sp] = await Promise.all([
      getStudentMakeup(studentId),
      pdb.parentRequest.findMany({
        where: { studentId },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: REQUEST_SELECT,
      }),
      searchParams,
    ]);
    // 12/11/2026 — «Gửi yêu cầu đến trung tâm»: màn đầu chỉ CHỌN LOẠI + danh sách đã gửi; mỗi loại một màn riêng
    // (/portal/yeu-cau/<loại>). Liên kết cũ `?bu=<makeupNeedId>` (thông báo học bù) chuyển thẳng sang màn Học bù.
    if (sp.bu) redirect(`/portal/yeu-cau/hoc-bu?bu=${encodeURIComponent(sp.bu)}`);

    // Buổi của các yêu cầu báo vắng / học bù — một câu cho cả danh sách (portalDb: chỉ buổi của lớp con mình).
    const maBuoi = [...new Set(requests.map((x) => x.sessionId).filter((x): x is string => !!x))];
    const buoi = maBuoi.length ? await pdb.classSession.findMany({ where: { id: { in: maBuoi } }, select: { id: true, date: true } }) : [];
    const ngayBuoi = new Map(buoi.map((b) => [b.id, b.date]));
    const bayGio = new Date();
    return (
      <TrungTamYeuCau
        tenCon={ctx.activeStudent?.name ?? ""}
        soBuoiCanBu={data.needList.filter((n) => n.status === "PENDING" && !n.yeuCauMo).length}
        daGui={requests.map((r) => {
          const ngay = r.sessionId ? ngayBuoi.get(r.sessionId) : undefined;
          const chiTiet: { nhan: string; giaTri: string }[] = [];
          if (r.type === "ABSENCE" && ngay) chiTiet.push({ nhan: "Buổi con nghỉ", giaTri: `${nhanNgayDayDu(ngay)} · ${nhanGio(ngay)}` });
          if (r.type === "MAKEUP") {
            if (ngay) chiTiet.push({ nhan: "Buổi con đã vắng", giaTri: nhanNgayDayDu(ngay) });
            const dx = nhanMocDeXuat(r.preferredDate);
            if (dx) chiTiet.push({ nhan: "Ba mẹ đề xuất bù", giaTri: dx });
          }
          // Rút đơn xin nghỉ: đơn đang chờ HOẶC đã được tiếp nhận, và buổi còn ở tương lai (máy chủ kiểm lại khi bấm — đây chỉ quyết có vẽ nút không).
          const conRutDuoc = r.type === "ABSENCE" && (r.status === "PENDING" || r.status === "APPROVED") && !!ngay && ngay.getTime() > bayGio.getTime();
          const hanhDong =
            conRutDuoc && r.status === "APPROVED"
              ? { nhan: "Rút đơn xin nghỉ", nhanXacNhan: "Bấm lần nữa để rút đơn", thanhCong: "Đã rút đơn — buổi học của con trở lại như bình thường" }
              : r.status === "PENDING"
                ? { nhan: r.type === "ABSENCE" ? "Rút đơn" : "Huỷ", nhanXacNhan: r.type === "ABSENCE" ? "Bấm lần nữa để rút đơn" : "Bấm lần nữa để huỷ", thanhCong: r.type === "ABSENCE" ? "Đã rút đơn xin nghỉ" : "Đã huỷ yêu cầu" }
                : null;
          return {
            id: r.id,
            slug: SLUG_THEO_LOAI[r.type],
            status: r.status,
            nhanLoai: REQUEST_TYPE_LABEL[r.type],
            // Với phụ huynh, đơn xin nghỉ được duyệt nghĩa là «trung tâm đã tiếp nhận» (buổi đó được ghi nghỉ có phép).
            nhanTrangThai: r.type === "ABSENCE" && r.status === "APPROVED" ? "Đã tiếp nhận" : nhanTrangThaiYeuCau(r),
            noiDung: r.content,
            response: r.response,
            ngay: formatDateVN(r.createdAt),
            chiTiet,
            hanhDong,
          };
        })}
      />
    );
  }

  const [requests, sessions, makeups] = await Promise.all([
    pdb.parentRequest.findMany({
      where: { studentId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: REQUEST_SELECT,
    }),
    getStudentUpcomingSessions(studentId),
    // B1 — trạng thái học bù của con.
    pdb.makeupNeed.findMany({
      where: { studentId },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, status: true, class: { select: { name: true } } },
    }),
  ]);

  const MAKEUP_LABEL: Record<string, string> = {
    PENDING: "Chờ xếp buổi bù",
    SCHEDULED: "Đã xếp buổi bù",
    COMPLETED: "Đã học bù xong",
    CANCELLED: "Đã huỷ",
  };

  const upcomingSessions = toUpcomingOptions(sessions);

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-neutral-900">Yêu cầu</h1>

      <RequestForm upcomingSessions={upcomingSessions} />

      {makeups.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-neutral-700">
            Trạng thái học bù
          </h2>
          <ul className="space-y-2">
            {makeups.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white p-3 text-sm"
              >
                <span className="text-neutral-700">{m.class.name}</span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    m.status === "COMPLETED"
                      ? "bg-green-100 text-green-700"
                      : m.status === "SCHEDULED"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {MAKEUP_LABEL[m.status] ?? m.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-neutral-700">
          Yêu cầu đã gửi
        </h2>
        {requests.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
            Chưa có yêu cầu nào.
          </p>
        ) : (
          <ul className="space-y-2">
            {requests.map((r) => (
              <li
                key={r.id}
                className="rounded-xl border border-neutral-200 bg-white p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-neutral-900">
                    {REQUEST_TYPE_LABEL[r.type]}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${REQUEST_STATUS_BADGE[r.status]}`}
                  >
                    {nhanTrangThaiYeuCau(r)}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-600">
                  {r.content}
                </p>
                {r.preferredDate && (
                  <p className="mt-1 text-xs text-neutral-600">
                    {/* preferredDate = wall-clock TZ server (sessionDate) → KHÔNG ép VN. */}
                    Ngày: {formatDateVN(r.preferredDate)}
                  </p>
                )}
                {r.response && (
                  <p className="mt-2 rounded-lg bg-neutral-50 p-2 text-sm text-neutral-600">
                    Phản hồi: {r.response}
                  </p>
                )}
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-neutral-600">
                    {/* createdAt là instant thật → ép giờ VN (Vercel = UTC, tránh lùi 1 ngày). */}
                    {r.createdAt.toLocaleDateString("vi-VN", {
                      timeZone: "Asia/Ho_Chi_Minh",
                    })}
                  </span>
                  {r.status === "PENDING" && <CancelButton id={r.id} />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
