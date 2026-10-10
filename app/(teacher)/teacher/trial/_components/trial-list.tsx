"use client";

// Bảng Trial site GV — 25/08 (chủ dự án): thay lưới thẻ theo ngày bằng HAI BẢNG PHẲNG.
//
//   • "Các suất sắp Trial" — hôm nay → hết 7 ngày tới, xếp theo ngày tăng dần.
//     Không có suất nào trong cửa sổ đó thì KHÔNG hiện bảng (yêu cầu: "không có thì
//     không hiển thị") — chứ không hiện bảng rỗng.
//   • "Đã Trial" — nằm dưới cùng, cùng bộ cột, mới nhất lên trước.
//
// Cột: Buổi · Học viên · Phụ huynh · Khoá học · Đánh giá · Trạng thái.
// Cột "Buổi" là thứ chủ dự án không liệt kê nhưng bảng xếp theo ngày mà không in ngày
// thì giáo viên không dùng được — giữ lại, để đầu bảng.
//
// "Đánh giá" chỉ còn nút Nhập/Xem phiếu; nút "Xuất PDF" đã gỡ theo yêu cầu (route
// /teacher/trial/pdf/[enrollmentId] vẫn còn cho ai có link cũ).
//
// ⚠️ Không có `new Date()` ở file này: mọi nhãn ngày đã được server format sẵn. Máy
// giáo viên không chắc chạy +07, và render server ↔ hydrate client lệch là vỡ trang.

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, ClipboardList } from "lucide-react";
import type { TrialRowStatus } from "@/lib/lms/teacher-schedule";
import { EmptyState } from "../../_components/ui/empty-state";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { ListToolbar, type SelectFilter } from "../../_components/ui/list-toolbar";
import { khopBatKy } from "@/lib/ui/tim-kiem";

/** 1 dòng bảng — server đã format sẵn ngày giờ. */
export type TrialRowView = {
  enrollmentId: string;
  /**
   * Buổi dòng này trỏ tới. BẮT BUỘC có trên link mở phiếu: thiếu nó thì cổng sở hữu
   * của phiếu mất hai nhánh cuối và giáo viên bấm vào ra "Buổi Trial không thuộc bạn
   * phụ trách" — kể cả khi qua được thì lúc LƯU vẫn bị chặn vì chưa chọn buổi.
   */
  sessionId: string;
  /** Em học CẢ LỚP (không chốt riêng buổi nào) — ngày dưới đây là buổi GẦN NHẤT. */
  hocCaLop: boolean;
  /** "CN, 05/07". Luôn có: dòng không suy được buổi thì server đã bỏ. */
  dateLabel: string;
  /** "09:00–10:30" | "". */
  timeLabel: string;
  trialClassName: string;
  /** "Hoàng Gia Bảo - 2016" — server ghép sẵn cả năm sinh. */
  studentLabel: string;
  parentName: string | null;
  courseName: string | null;
  /** Sale phụ trách lead — giáo viên cần trao đổi về bé thì biết hỏi ai. */
  saleName: string | null;
  status: TrialRowStatus;
  evaluated: boolean;
};

const ALL = "ALL";

const STATUS_LABEL: Record<TrialRowStatus, string> = {
  upcoming: "Sắp tới",
  rescheduled: "Bị dời lịch",
  "awaiting-eval": "Chờ đánh giá",
  evaluated: "Đã đánh giá",
  enrolled: "Đã nhập học · +1% HH",
  lost: "Bị rớt",
  withdrawn: "Đã rút",
};

const STATUS_CLASS: Record<TrialRowStatus, string> = {
  upcoming: "bg-state-info-soft text-state-info-ink",
  rescheduled: "bg-state-warning-soft text-state-warning-ink",
  "awaiting-eval": "bg-state-warning-soft text-state-warning-ink",
  evaluated: "bg-muted text-muted-foreground",
  enrolled: "bg-state-success-soft text-state-success-ink",
  lost: "bg-state-danger-soft text-state-danger-ink",
  withdrawn: "bg-muted text-muted-foreground",
};

function StatusPill({ status }: { status: TrialRowStatus }) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASS[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function TrialTable({ rows }: { rows: TrialRowView[] }) {
  return (
    <div className="t-card overflow-hidden">
      {/* Thanh phân trang nằm NGOÀI vùng cuộn ngang: để trong thì cuộn sang phải là
          nút chuyển trang trôi mất khỏi màn. */}
      <PhanTrangBang cuonNgang tenDonVi="suất Trial"
          khoaGhiNho="gv-trial">
        <table className="w-full min-w-[940px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              <th scope="col" className="px-5 py-3">
                Buổi
              </th>
              <th scope="col" className="px-5 py-3">
                Học viên
              </th>
              <th scope="col" className="px-5 py-3">
                Phụ huynh
              </th>
              <th scope="col" className="px-5 py-3">
                Khoá học
              </th>
              <th scope="col" className="px-5 py-3">
                Sale
              </th>
              <th scope="col" className="px-5 py-3">
                Đánh giá
              </th>
              <th scope="col" className="px-5 py-3">
                Trạng thái
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.enrollmentId}
                className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50"
              >
                {/* nowrap chỉ cho DÒNG NGÀY (chuỗi ngắn, cố định). Dòng dưới ghép tên
                    lớp trải nghiệm — text tự do — nên để nguyên nowrap ở <td> làm cột
                    này nở tới 426px, đẩy cột Học viên xuống 74px khiến "Tô Duy Trí -
                    2019" xuống 3 dòng, và bảng tràn 962px trong khung 883px
                    (QA vòng 1, BUG-036). */}
                <td className="min-w-[11rem] px-5 py-3.5">
                  <p className="font-semibold whitespace-nowrap text-foreground">
                    {r.dateLabel || "Chưa xếp buổi"}
                    {/* Nói rõ đây là em học CẢ LỚP, không phải cam kết đúng một buổi —
                        thiếu chú thích này giáo viên đọc một ngày duy nhất như lịch chốt. */}
                    {r.hocCaLop && (
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                        · học cả lớp
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[r.timeLabel, r.trialClassName].filter(Boolean).join(" · ")}
                  </p>
                </td>
                <td className="min-w-[9rem] px-5 py-3.5 font-medium text-foreground">
                  {r.studentLabel}
                </td>
                <td className="min-w-[8rem] px-5 py-3.5 text-foreground">
                  {r.parentName ?? "—"}
                </td>
                <td className="px-5 py-3.5 text-foreground">
                  {r.courseName ?? "—"}
                </td>
                {/* Nói THẬT khi lead chưa ai phụ trách — "—" đọc như "không cần hỏi ai". */}
                <td className="min-w-[8rem] px-5 py-3.5 text-foreground">
                  {r.saleName ?? (
                    <span className="text-xs text-muted-foreground">Chưa có Sale</span>
                  )}
                </td>
                <td className="px-5 py-3.5">
                  <Link
                    href={`?enrollmentId=${r.enrollmentId}&sessionId=${r.sessionId}`}
                    className={
                      r.evaluated
                        ? "inline-flex whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
                        : "inline-flex whitespace-nowrap rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
                    }
                  >
                    {r.evaluated ? "Xem phiếu" : "Nhập phiếu"}
                  </Link>
                </td>
                <td className="px-5 py-3.5">
                  <StatusPill status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </PhanTrangBang>
    </div>
  );
}

export function TrialList({
  upcoming,
  done,
  windowDays,
}: {
  upcoming: TrialRowView[];
  done: TrialRowView[];
  windowDays: number;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(ALL);

  // Ô lọc trạng thái suy từ DỮ LIỆU ĐANG CÓ, không liệt kê cứng cả 7 nhãn: giáo viên
  // mới nhận lớp chỉ có "Sắp tới" mà thấy 7 lựa chọn thì 6 cái bấm vào là bảng trắng.
  const statusOptions = useMemo<SelectFilter["options"]>(() => {
    const present = new Set([...upcoming, ...done].map((r) => r.status));
    const ordered = (Object.keys(STATUS_LABEL) as TrialRowStatus[]).filter((s) =>
      present.has(s),
    );
    return [
      { value: ALL, label: "Mọi trạng thái" },
      ...ordered.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
    ];
  }, [upcoming, done]);

  const lọc = useMemo(() => {
    const apply = (rows: TrialRowView[]) =>
      rows.filter((r) => {
        if (status !== ALL && r.status !== status) return false;
        // Bỏ dấu khi so (lib/ui/tim-kiem) — gõ "hoang gia bao" phải ra "Hoàng Gia Bảo".
        return khopBatKy(
          [r.studentLabel, r.parentName, r.courseName, r.saleName, r.trialClassName, r.dateLabel],
          query,
        );
      });
    return { up: apply(upcoming), dn: apply(done) };
  }, [upcoming, done, query, status]);

  if (upcoming.length === 0 && done.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="Chưa có suất Trial nào"
        description="Buổi trải nghiệm bạn phụ trách sẽ hiện ở đây ngay khi quản lý xếp lịch."
      />
    );
  }

  const đangLọc = query.trim().length > 0 || status !== ALL;

  return (
    <div className="space-y-6">
      <ListToolbar
        query={query}
        onQuery={setQuery}
        placeholder="Tìm theo tên học viên, phụ huynh, khoá học..."
        filters={[{ value: status, onChange: setStatus, options: statusOptions }]}
      />

      {/* Rỗng thì KHÔNG dựng bảng — yêu cầu 25/08: "không có thì không hiển thị". */}
      {lọc.up.length > 0 && (
        <section>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-bold text-foreground">
              Các suất sắp Trial ({lọc.up.length})
            </h2>
            <p className="text-xs text-muted-foreground">
              Từ hôm nay đến hết {windowDays} ngày tới
            </p>
          </div>
          <TrialTable rows={lọc.up} />
        </section>
      )}

      {lọc.dn.length > 0 && (
        <section>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-bold text-foreground">
              Đã Trial ({lọc.dn.length})
            </h2>
            <p className="text-xs text-muted-foreground">
              Buổi đã diễn ra và các suất đã có kết quả
            </p>
          </div>
          <TrialTable rows={lọc.dn} />
        </section>
      )}

      {/* Lọc ra 0 dòng KHÁC với "chưa tới suất nào" — nói đúng cái đang xảy ra, kẻo
          giáo viên tưởng mất dữ liệu. */}
      {đangLọc && lọc.up.length === 0 && lọc.dn.length === 0 && (
        <EmptyState
          icon={ClipboardList}
          title="Không có suất nào khớp"
          description="Thử đổi từ khoá hoặc bỏ bộ lọc trạng thái."
        />
      )}

      {!đangLọc && lọc.up.length === 0 && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <ClipboardList className="h-3.5 w-3.5" aria-hidden />
          Không có suất Trial nào trong {windowDays} ngày tới.
        </p>
      )}
    </div>
  );
}
