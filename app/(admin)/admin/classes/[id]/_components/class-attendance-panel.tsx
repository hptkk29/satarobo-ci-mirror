"use client";

import { useState, useTransition } from "react";
import { ClipboardCheck } from "lucide-react";
import { AttendanceGrid } from "../../../attendance/_components/attendance-grid";
import { loadClassSessionRoster } from "../_attendance-actions";
import type { AttendanceRosterRow } from "@/lib/attendance/roster";
import { formatDateDMY } from "@/lib/format/date";
import { nhanSoBuoiVaBai } from "@/lib/lms/session-order";
import type { SessionRow } from "./class-sessions-manage";

function fmt(dateIso: string): string {
  const d = new Date(dateIso);
  const day = formatDateDMY(d);
  const time = d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  return `${day} · ${time}`;
}

/** Nhãn <option>: phải nói được buổi nào ĐÃ điểm danh, nếu không người dùng mò mù. */
function optionLabel(s: SessionRow): string {
  // 21/08 — mở đầu bằng SỐ BUỔI: quản lý và giáo viên nói chuyện với nhau bằng "buổi 7",
  // không bằng ngày. Giữ y hệt ở class-eval-panel để hai dropdown cùng trang không lệch.
  //
  // Đợt 1c — in CẢ HAI số khi chúng lệch (`Buổi 2 · bài 43`). Danh sách này sắp theo NGÀY
  // nên số đứng đầu phải là số theo lịch, kẻo nhảy cóc `1, 43, 2, 44…`; nhưng chỉ có số
  // theo lịch thì giấu mất bài đang dạy. `nhanSoBuoiVaBai` gộp một lần khi hai số trùng.
  const no = `${nhanSoBuoiVaBai({ lich: s.seq, loTrinh: s.soLoTrinh })} · `;
  const base = `${no}${fmt(s.date)}${s.topic ? ` — ${s.topic}` : ""}`;
  if (s.status === "CANCELLED") return `${base} (đã huỷ)`;
  return `${base} · ${s.attendanceCount > 0 ? `đã điểm danh ${s.attendanceCount}` : "chưa điểm danh"}`;
}

/** Roster + buổi đang hiển thị LUÔN đi cùng nhau — xem ghi chú trong component. */
type Loaded = { sessionId: string; rows: AttendanceRosterRow[] };

/**
 * R2-CLASS-1 — Tab "Điểm danh" trong trang chi tiết lớp: chọn buổi (dropdown) →
 * nạp roster qua server action (scope-checked) → AttendanceGrid. Roster buổi mặc
 * định render server-side (RSC, không useEffect-fetch); đổi buổi mới fetch lại.
 *
 * ⚠️ BUG 19/08 ĐÃ VÁ — ĐỌC TRƯỚC KHI SỬA:
 * Bản cũ giữ `selectedId` và `rows` ở HAI state rời, `setSelectedId` chạy NGOÀI
 * transition còn `setRows` chỉ chạy sau `await`. React vì thế commit một nhịp có
 * `selectedId` MỚI + `rows` CŨ; ở nhịp đó `key={selectedId}` đã đổi nên AttendanceGrid
 * remount và lazy-init toàn bộ trạng thái ô từ roster của buổi TRƯỚC. Khi roster đúng
 * về thì key không đổi nữa ⇒ lưới đứng yên với dữ liệu buổi cũ VĨNH VIỄN. Hậu quả thật:
 * quản lý chọn đúng buổi GV đã điểm danh vẫn thấy trắng trơn và kết luận "mất dữ liệu".
 * Cách vá: gộp (sessionId, rows) vào MỘT state `Loaded`, chỉ set cùng lúc sau khi action
 * trả về; trong lúc chờ thì hiện placeholder chứ KHÔNG hiện lưới của buổi cũ.
 * ĐỪNG tách lại thành 2 state.
 */
export function ClassAttendancePanel({
  sessions,
  initialSessionId,
  initialRows,
}: {
  sessions: SessionRow[];
  initialSessionId: string | null;
  initialRows: AttendanceRosterRow[];
}) {
  // Bản của SERVER (đổi mỗi lần trang render lại). Khi người dùng CHƯA tự chọn buổi nào,
  // panel bám thẳng vào nó ⇒ router.refresh() / RSC payload mới là màn hình cập nhật theo,
  // không còn đóng băng bản chụp lúc mount. Khi người dùng ĐÃ chọn thì lựa chọn của họ
  // thắng — không được phép cuốn trôi thao tác đang dở.
  // ĐÁNH ĐỔI đã cân nhắc: khi người dùng CHƯA tự chọn buổi, panel bám theo bản server, nên
  // một `router.refresh()` (vd huỷ/điều chỉnh buổi ở khối "Buổi học" ngay trên) mà làm ĐỔI
  // buổi mặc định sẽ remount lưới và mất các ô vừa bấm chưa lưu. Đổi lại, đó chính là thứ
  // làm panel hết đóng băng ở ảnh chụp lúc mở trang. Đã chọn buổi rồi thì lựa chọn của
  // người dùng thắng và không có gì bị cuốn trôi.
  const server: Loaded = { sessionId: initialSessionId ?? "", rows: initialRows };
  const [picked, setPicked] = useState<Loaded | null>(null);
  /** Buổi vừa bấm nhưng roster chưa về — chỉ để <select> phản hồi ngay. */
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Lựa chọn của người dùng THẮNG bản server.
  //
  // ⚠️ ĐỪNG "tối ưu" thành `picked.sessionId === server.sessionId ? server : picked` —
  // đã thử và đó là hồi quy: chọn LẠI đúng buổi mặc định (thao tác tự nhiên nhất để làm
  // tươi dữ liệu) sẽ vứt roster vừa nạp và quay về ảnh chụp RSC lúc mở trang, tức tái
  // hiện đúng triệu chứng gốc "GV điểm danh rồi mà admin không thấy".
  const loaded = picked ?? server;
  const selectedId = pendingId ?? loaded.sessionId;
  const loading = pendingId !== null && pendingId !== loaded.sessionId;

  function onSelect(id: string) {
    setError(null);
    if (!id) {
      setPendingId(null);
      setPicked({ sessionId: "", rows: [] });
      return;
    }
    setPendingId(id);
    startTransition(async () => {
      const res = await loadClassSessionRoster(id);
      setPendingId(null);
      if (res.ok) {
        setPicked({ sessionId: id, rows: res.rows });
      } else {
        setPicked({ sessionId: id, rows: [] });
        setError(res.error);
      }
    });
  }

  if (sessions.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed border-border bg-muted p-8 text-center text-sm text-muted-foreground">
        <ClipboardCheck className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
        Lớp chưa có buổi học để điểm danh. Sinh buổi ở tab “Buổi học”.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <label className="block max-w-md">
        <span className="mb-1 block text-sm font-semibold text-foreground">Chọn buổi điểm danh</span>
        <select
          value={selectedId}
          onChange={(e) => onSelect(e.target.value)}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
        >
          <option value="">— Chọn buổi học —</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {optionLabel(s)}
            </option>
          ))}
        </select>
      </label>

      {error && (
        <div className="rounded-lg border border-state-danger-soft bg-state-danger-soft px-4 py-3 text-sm text-state-danger-ink">
          {error}
        </div>
      )}

      {loading ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Đang tải danh sách điểm danh của buổi…
        </p>
      ) : loaded.sessionId && !error ? (
        // key = buổi ĐANG hiển thị (đi cùng rows): state trong AttendanceGrid chỉ khởi tạo
        // 1 lần, không có key thì đổi buổi xong lưới vẫn giữ trạng thái buổi TRƯỚC (cùng lớp
        // nên phần lớn HV trùng) — màn hình nói dối, và với luật "phải đủ cả lớp" thì đếm sai.
        <AttendanceGrid
          key={loaded.sessionId}
          sessionId={loaded.sessionId}
          rows={loaded.rows}
        />
      ) : !error ? (
        <p className="text-sm text-muted-foreground">Chọn một buổi học để điểm danh.</p>
      ) : null}
    </div>
  );
}
