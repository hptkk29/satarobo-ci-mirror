import Link from "next/link";
import { ExternalLink, MessageSquareText } from "lucide-react";
import { formatDateDMY } from "@/lib/format/date";
import { nhanSoBuoi } from "@/lib/lms/session-order";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { SessionEvalCard } from "@/components/admin/session-eval-card";
import type { ClassSessionFeedbackData } from "@/lib/classes/session-feedback-data";

// Nhận xét buổi học của CẢ LỚP cho quản lý / đào tạo: bảng phủ theo buổi + toàn bộ
// phiếu của từng học viên qua từng buổi.
//
// Server component có chủ đích: dùng <details> gập sẵn thay vì state client, nên lớp
// 20 HV × 30 buổi chỉ render 20 dòng tiêu đề, không hydrate gì, chạy được ở 375px.

function statusNote(s: ClassSessionFeedbackData["sessions"][number]): {
  text: string;
  cls: string;
} {
  if (s.status === "CANCELLED") return { text: "Đã huỷ", cls: "text-muted-foreground" };
  if (!s.attendanceTaken) return { text: "Chưa điểm danh", cls: "text-muted-foreground" };
  if (s.complete) return { text: `${s.reviewed}/${s.attended}`, cls: "text-state-success-ink" };
  return { text: `${s.reviewed}/${s.attended}`, cls: "text-state-warning-ink" };
}

export function ClassFeedbackPanel({ data }: { data: ClassSessionFeedbackData }) {
  const { sessions, students, entries, totalSessions } = data;

  if (sessions.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed border-border bg-muted p-8 text-center text-sm text-muted-foreground">
        <MessageSquareText className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
        Lớp chưa có buổi học nào.
      </div>
    );
  }

  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const bySession = new Map(sessions.map((s) => [s.id, s.dateISO]));
  const entriesByStudent = new Map<string, typeof entries>();
  for (const e of entries) {
    const arr = entriesByStudent.get(e.studentId) ?? [];
    arr.push(e);
    entriesByStudent.set(e.studentId, arr);
  }
  // Mới nhất lên trước.
  // ⚠️ 21/08 — KHÁC chiều với bảng "Tổng quan theo buổi" phía trên: bảng đó nay xếp theo
  // việc-còn-nợ rồi tới số buổi (lib/lms/session-order), còn khối này là lịch sử của MỘT
  // học viên nên đọc ngược thời gian vẫn tự nhiên hơn. Chủ ý, đừng "đồng bộ" lại.
  for (const arr of entriesByStudent.values()) {
    arr.sort((a, b) => (bySession.get(b.sessionId) ?? "").localeCompare(bySession.get(a.sessionId) ?? ""));
  }

  const totalEntries = entries.length;

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Tổng quan theo buổi
        </h3>
        <p className="mb-3 text-sm text-muted-foreground">
          Cột &quot;Đã nhận xét&quot; đếm học viên ĐI HỌC đã có phiếu — khớp với tiến độ
          hiện trên site giáo viên.
          {totalSessions > sessions.length && (
            <>
              {" "}
              Đang hiện {sessions.length} buổi đã diễn ra gần nhất trong tổng số{" "}
              {totalSessions} buổi của lớp (buổi chưa dạy không có gì để nhận xét nên
              không liệt kê).
            </>
          )}
        </p>
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <PhanTrangBang cuonNgang tenDonVi="buổi" khoaGhiNho="lop-nhan-xet-buoi" className="p-3">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                {/* Đợt 1c — cột này là số THEO LỊCH, và tiêu đề phải nói ra. Cột
                    "Bài / chủ đề" ngay bên phải mang số LỘ TRÌNH (`Bài {order}: {title}`);
                    hai cột trả lời hai câu khác nhau — "đã học tới buổi thứ mấy" vs
                    "buổi này dạy bài nào" — nên KHÔNG gộp. Trước đợt này cột trái in
                    "Buổi 2" cạnh cột phải "Bài 43: …" mà không nói vì sao lệch. */}
                <th className="px-4 py-2 font-semibold">Buổi (lịch)</th>
                <th className="px-4 py-2 font-semibold">Ngày</th>
                <th className="px-4 py-2 font-semibold">Bài / chủ đề</th>
                <th className="px-4 py-2 font-semibold">Đã nhận xét</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sessions.map((s) => {
                const note = statusNote(s);
                return (
                  <tr key={s.id}>
                    {/* Ô riêng, không ghép vào text node của nhãn bài — test hồi quy dò
                        nhãn bằng getByText khớp chính xác. */}
                    <td className="whitespace-nowrap px-4 py-2 font-semibold tabular-nums text-foreground">
                      {nhanSoBuoi({ lich: s.seq, loTrinh: null })}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 font-medium tabular-nums text-foreground">
                      {formatDateDMY(s.dateISO)}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{s.label}</td>
                    <td className={`whitespace-nowrap px-4 py-2 font-semibold tabular-nums ${note.cls}`}>
                      {note.text}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      <Link
                        href={`/sessions/${s.id}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                      >
                        Mở buổi <ExternalLink className="h-3 w-3" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </PhanTrangBang>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Nhận xét từng học viên
        </h3>
        {totalEntries === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Chưa có phiếu nhận xét nào cho các buổi đang hiện. Giáo viên viết phiếu ở site
            giáo viên (Nhận xét buổi học) hoặc ở trang chi tiết buổi.
          </p>
        ) : (
          <ul className="space-y-2">
            {students.map((st) => {
              const items = entriesByStudent.get(st.id) ?? [];
              return (
                <li key={st.id} className="rounded-xl border border-border bg-card">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3">
                      <span className="font-semibold text-foreground">
                        {st.name}
                        {st.studentCode && (
                          <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                            {st.studentCode}
                          </span>
                        )}
                        {st.isGuest && (
                          <span className="ml-2 rounded-full bg-state-info-soft px-2 py-0.5 text-xs font-semibold text-state-info-ink">
                            Ngoài sĩ số
                          </span>
                        )}
                      </span>
                      <span
                        className={`text-xs font-semibold tabular-nums ${
                          items.length === 0 ? "text-muted-foreground" : "text-primary"
                        }`}
                      >
                        {items.length}/{sessions.length} buổi có phiếu
                      </span>
                    </summary>
                    <div className="space-y-3 border-t border-border px-4 py-3">
                      {items.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Chưa có nhận xét nào cho học viên này.
                        </p>
                      ) : (
                        items.map((e) => {
                          const s = sessionById.get(e.sessionId);
                          return (
                            <SessionEvalCard
                              key={`${e.sessionId}-${e.studentId}`}
                              title={s ? s.label : "Buổi học"}
                              subtitle={
                                s
                                  ? `${nhanSoBuoi({ lich: s.seq, loTrinh: null })} · ${formatDateDMY(s.dateISO)}`
                                  : null
                              }
                              data={e}
                            />
                          );
                        })
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
