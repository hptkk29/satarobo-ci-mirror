"use client";

// app/(admin)/admin/lop-trial/_components/attendance-board.tsx — GĐ2.
//
// Lưới điểm danh của một lớp trải nghiệm: chọn buổi bằng dãy chip, đánh dấu từng em,
// lưu một lần cho cả buổi.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Lock, Pencil } from "lucide-react";
import {
  markLopTrialAttendanceAction,
  completeLopTrialSessionAction,
  updateLopTrialSessionAction,
  cancelLopTrialSessionAction,
} from "../_actions";
import {
  CanhBaoGiaoVien,
  GiaiThichLuatGv,
  OChonGiaoVien,
  useGvChoBuoi,
  type NguonGvBuoi,
} from "./chon-gv-buoi";
import type { CheDoChonGv } from "../_lib/che-do-gv";
import type {
  EnrollmentRow,
  Option,
  RoomOption,
  SessionRow,
  TrialAttendanceMark,
} from "../_lib/types";

/**
 * Một dòng nháp. `status: null` = CHƯA điểm danh — KHÁC hẳn "vắng".
 * Xem comment ở `duNgChoBuoi` để biết vì sao null phải là giá trị hạng nhất.
 */
type DraftRow = { status: TrialAttendanceMark | null; note: string };

// Hàm đếm nằm ở ../_lib/attendance để test được mà không phải nạp cả cây next-auth
// (component này kéo theo ../_actions → @/lib/auth, vitest không nạp nổi).
import { demSoEmChuaDanhDau } from "../_lib/attendance";
import { thuocCase } from "@/lib/trial/nghia-null";
import {
  duongDanPdfPhieu,
  nhanNutPhieu,
  LOI_CHUA_DANH_GIA,
} from "../_lib/phieu-danh-gia";

/** Ngày buổi học lưu ở cột `@db.Date` = UTC-midnight của ngày VN. */
function ngayVn(iso: string): string {
  return new Date(iso).toLocaleDateString("vi-VN", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/**
 * Nút lấy phiếu đánh giá của MỘT em ở MỘT buổi — đặt ngay trước ô ghi chú.
 *
 * Thay cho khối "Phiếu đánh giá buổi học" (hệ SESSION_EVAL) đã gỡ khỏi màn này: khối
 * đó đọc một kho KHÁC với kho giáo viên thật sự chấm (`TrialRubricEval` từ site giáo
 * viên), nên Sale mở ra luôn thấy trống dù đã có phiếu.
 *
 * Đã chấm thì là thẻ <a> mở file thật, KHÔNG phải nút bấm rồi mới điều hướng: người
 * dùng bấm giữa chừng vẫn mở được tab mới, và không tốn một vòng gọi server chỉ để
 * biết một điều màn hình đã biết sẵn.
 */
function NutPhieu({
  enrollmentId,
  sessionId,
  daDanhGia,
}: {
  enrollmentId: string;
  sessionId: string;
  daDanhGia: boolean;
}) {
  const nhan = nhanNutPhieu(daDanhGia);
  const lop =
    "rounded-md px-2.5 py-1 text-xs font-semibold ring-1 ring-border whitespace-nowrap";
  if (!daDanhGia) {
    return (
      <button
        type="button"
        onClick={() => toast.error(LOI_CHUA_DANH_GIA)}
        className={`${lop} bg-card text-muted-foreground hover:bg-muted`}
      >
        {nhan}
      </button>
    );
  }
  return (
    <a
      href={duongDanPdfPhieu(enrollmentId, sessionId)}
      target="_blank"
      rel="noopener noreferrer"
      className={`${lop} bg-card text-primary hover:bg-primary-soft`}
    >
      {nhan}
    </a>
  );
}

/**
 * Sửa hoặc huỷ MỘT buổi. Cả hai đường đều BẮT BUỘC ghi lý do, và chính lý do đó là nội
 * dung thông báo đẩy sang giáo viên (chốt 28/08). Không có ô lý do thì giáo viên nhận
 * một tin "buổi đã đổi" trống rỗng rồi phải đi hỏi lại từng người.
 */
function SuaBuoiForm({
  session,
  ngayLop,
  khungLop,
  teachers,
  rooms,
  nguonGv,
  cheDoChonGv,
  locGvTheoCa,
  soGvMienLoc,
  onXong,
}: {
  session: SessionRow;
  /** Ngày của lớp ("YYYY-MM-DD") — `null` với lớp cũ, khi đó ô ngày để tự do. */
  ngayLop: string | null;
  /** Khung giờ của lớp — `null` với lớp cũ. Dùng để đặt min/max cho ô giờ. */
  khungLop: { startTime: string; endTime: string } | null;
  teachers: Option[];
  rooms: RoomOption[];
  /**
   * Nguồn danh sách giáo viên — hook nằm ở COMPONENT CHA, không ở đây.
   *
   * Vì sao: form này phải có danh sách NGAY KHI MỞ (người dùng hoàn toàn có thể chỉ đổi
   * mỗi GIÁO VIÊN, không đụng ngày/giờ — và đó vẫn là một đường tạo trùng lịch). Nạp
   * lúc mở mà đặt hook ở đây thì phải `useEffect`, thứ repo cấm cho việc lấy dữ liệu.
   * Đặt ở cha thì lượt nạp treo vào ĐÚNG cú bấm "Sửa buổi học" — một sự kiện thật.
   */
  nguonGv: NguonGvBuoi & {
    tai: (date: string, startTime: string, endTime: string) => void;
  };
  cheDoChonGv: CheDoChonGv;
  locGvTheoCa: boolean;
  soGvMienLoc: number;
  onXong: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // `date` của buổi là UTC-midnight của NGÀY VN → cắt 10 ký tự đầu ra đúng giá trị mà
  // `<input type="date">` cần. Đừng đổi múi giờ ở đây, sẽ lùi một ngày.
  const [date, setDate] = useState(session.date.slice(0, 10));
  const [startTime, setStartTime] = useState(session.startTime);
  const [endTime, setEndTime] = useState(session.endTime);
  const [roomId, setRoomId] = useState(session.roomId ?? "");
  const [teacherId, setTeacherId] = useState(session.teacherId ?? "");
  const [lyDo, setLyDo] = useState("");
  const [choHuy, setChoHuy] = useState(false);

  // 17/09 — CỬA THỨ HAI của cùng một việc. Nó đổi được cả NGÀY, GIỜ lẫn GIÁO VIÊN nên là
  // đường DỄ tạo trùng lịch nhất, mà tới hôm nay nó không có một cảnh báo nào. Dùng
  // CHUNG hook + CHUNG markup với khối "Thêm buổi học".

  /** Đổi một trong ba ô ngày/giờ ⇒ hỏi lại danh sách. Truyền giá trị MỚI (setState chưa kịp). */
  function doiKhung(d: string, s: string, e: string) {
    setDate(d);
    setStartTime(s);
    setEndTime(e);
    nguonGv.tai(d, s, e);
  }

  function luu() {
    startTransition(async () => {
      const res = await updateLopTrialSessionAction({
        sessionId: session.id,
        date,
        startTime,
        endTime,
        roomId: roomId || null,
        teacherId: teacherId || null,
        reason: lyDo.trim(),
      });
      if (res.ok) {
        toast.success("Đã lưu buổi học và báo giáo viên");
        onXong();
        router.refresh();
        return;
      }
      toast.error(res.error);
    });
  }

  function huy() {
    startTransition(async () => {
      const res = await cancelLopTrialSessionAction({
        sessionId: session.id,
        reason: lyDo.trim(),
      });
      if (res.ok) {
        toast.success("Đã huỷ buổi và báo giáo viên");
        onXong();
        router.refresh();
        return;
      }
      toast.error(res.error);
    });
  }

  return (
    <div className="mb-3 rounded-lg border border-border bg-muted/40 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Ngày
          {/* 23/09 — lớp theo khung mang MỘT ngày; case phải đúng ngày đó (server gác ở
              `kiemCaseThuocLop`). Để ô ngày mở là mời người dùng gõ ngày khác rồi mới bị
              từ chối. Muốn dời bé sang ngày khác thì chuyển bé sang case của lớp ngày đó. */}
          <input
            type="date"
            value={date}
            onChange={(e) => doiKhung(e.target.value, startTime, endTime)}
            disabled={pending || Boolean(ngayLop) || !session.quyenDoiGio.duoc}
            title={ngayLop ? `Lớp này mở ngày ${ngayLop} — case phải cùng ngày` : undefined}
            className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground disabled:opacity-50"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Giờ bắt đầu
          <input
            type="time"
            value={startTime}
            min={khungLop?.startTime}
            max={khungLop?.endTime}
            onChange={(e) => doiKhung(date, e.target.value, endTime)}
            disabled={pending || !session.quyenDoiGio.duoc}
            className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground disabled:opacity-50"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Giờ kết thúc
          <input
            type="time"
            value={endTime}
            min={khungLop?.startTime}
            max={khungLop?.endTime}
            onChange={(e) => doiKhung(date, startTime, e.target.value)}
            disabled={pending || !session.quyenDoiGio.duoc}
            className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground disabled:opacity-50"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Phòng
          <select
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            disabled={pending}
            className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground disabled:opacity-50"
          >
            <option value="">— chưa xếp phòng —</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <OChonGiaoVien
          teachers={teachers}
          nguon={nguonGv}
          value={teacherId}
          onChange={setTeacherId}
          disabled={pending}
          // Chỉ để biết CÓ bộ lọc nào đang chạy hay không (vẽ công tắc "Hiện tất cả" hay
          // không) — không gác gì. Quyền hỏi ở server, mỗi lượt.
          cheDo={cheDoChonGv}
          batLoc={locGvTheoCa}
          nho
        />
      </div>
      {!session.quyenDoiGio.duoc && (
        <p role="note" className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{session.quyenDoiGio.lyDo}</span>
        </p>
      )}
      {khungLop && session.quyenDoiGio.duoc && (
        <p className="mt-2 text-xs text-muted-foreground">
          Giờ phải nằm trong khung lớp{" "}
          <strong className="tabular-nums text-foreground">
            {khungLop.startTime}–{khungLop.endTime}
          </strong>
          .
        </p>
      )}

      <CanhBaoGiaoVien nguon={nguonGv} value={teacherId} />
      <GiaiThichLuatGv
        batLoc={locGvTheoCa}
        cheDo={cheDoChonGv}
        soGvMien={soGvMienLoc}
        hienTatCa={nguonGv.hienTatCa}
        // Cửa này mở là `tai()` bắn ngay, nhưng `ds` chỉ có sau khi server trả lời —
        // trong khoảng đó câu luật phải nói "chưa lọc", không được hứa đã lọc.
        daLoc={nguonGv.ds !== null}
      />

      <label className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
        Lý do dời / huỷ *
        <input
          type="text"
          value={lyDo}
          onChange={(e) => setLyDo(e.target.value)}
          disabled={pending}
          placeholder="Vd: phụ huynh báo bận, xin dời sang thứ 5…"
          className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground disabled:opacity-50"
        />
        <span>Nội dung này được gửi thẳng cho giáo viên.</span>
      </label>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={luu}
          disabled={pending}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
        >
          {pending ? "Đang lưu…" : "Lưu & báo giáo viên"}
        </button>
        {/* Huỷ đi hai nhịp: một cú bấm nhầm là buổi biến khỏi lịch giáo viên.

            23/09 — nút đọc `quyenXoa` server đã quy sẵn. Cổng này CHẶT HƠN cổng sửa:
            chủ case sửa được giờ, nhưng không huỷ được case đang giữ khách của Sale
            khác (`quyenXoaCase`). Khi bị chặn thì nút VẪN HIỆN, khoá lại, và `title`
            là đúng câu server sẽ trả — không để người dùng bấm hai nhịp rồi mới biết
            (luật 12). */}
        {session.quyenXoa.duoc ? (
          <button
            type="button"
            onClick={() => (choHuy ? huy() : setChoHuy(true))}
            disabled={pending}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
              choHuy
                ? "border-state-danger bg-state-danger-soft text-state-danger-ink"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            {choHuy ? "Bấm lần nữa để huỷ buổi" : "Huỷ buổi"}
          </button>
        ) : (
          <span
            role="note"
            title={session.quyenXoa.lyDo}
            className="inline-flex max-w-full items-start gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground"
          >
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>Không huỷ được case: {session.quyenXoa.lyDo}</span>
          </span>
        )}
        <button
          type="button"
          onClick={onXong}
          disabled={pending}
          className="text-xs text-muted-foreground hover:underline disabled:opacity-50"
        >
          Đóng
        </button>
      </div>
    </div>
  );
}

export function AttendanceBoard({
  trialClassId,
  sessions,
  enrollments,
  canMark,
  canManage,
  teachers,
  rooms,
  cheDoChonGv,
  locGvTheoCa,
  soGvMienLoc,
  goiTat = false,
  lopTheoKhung,
  ngayLop,
  khungLop,
}: {
  /** Cần cho khối "Sửa buổi": Server Action lọc giáo viên gác theo cơ sở CỦA LỚP. */
  trialClassId: string;
  sessions: SessionRow[];
  enrollments: EnrollmentRow[];
  canMark: boolean;
  /** Sửa / huỷ buổi là việc quản lý, KHÁC quyền điểm danh (GĐ4 tách hai cổng). */
  canManage: boolean;
  teachers: Option[];
  rooms: RoomOption[];
  /** Ba prop dưới chỉ để NÓI RA luật đang chạy ở ô Giáo viên — không dùng để gác. */
  cheDoChonGv: CheDoChonGv;
  locGvTheoCa: boolean;
  soGvMienLoc: number;
  /**
   * 23/09/2026 — bảng này nay nằm BÊN TRONG một case ở `bang-case.tsx`, và case đó
   * đã có vỏ thẻ, tiêu đề và dòng giờ/GV của riêng nó. Bật cờ để bỏ ba thứ đó đi,
   * thay vì vẽ thẻ lồng thẻ và in giờ hai lần cách nhau 40px.
   *
   * Dãy chip chọn buổi cũng tắt theo: khi mỗi case tự mở ra thì một dãy chip chọn
   * buổi nằm trong một case là hai bộ điều khiển cho cùng một việc.
   */
  goiTat?: boolean;
  /**
   * Lớp theo khung (mô hình case) hay lớp slot cũ — quyết định bé `scheduledSessionId =
   * NULL` có hiện ở buổi này không (`lib/trial/nghia-null.ts`). BẮT BUỘC, không mặc
   * định (luật 7): mặc định sai về phía nào cũng là giấu bé hoặc điểm danh bé hai lần.
   */
  lopTheoKhung: boolean;
  ngayLop: string | null;
  khungLop: { startTime: string; endTime: string } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Buổi mở sẵn = buổi SCHEDULED đầu tiên: người dùng vào đây gần như luôn để điểm danh
  // buổi sắp/đang diễn ra, không phải để xem lại buổi đã đóng.
  const [selectedSessionId, setSelectedSessionId] = useState(
    () => (sessions.find((s) => s.status === "SCHEDULED") ?? sessions[0])?.id ?? "",
  );
  const selectedSession = sessions.find((s) => s.id === selectedSessionId) ?? null;

  // Học viên tham gia điểm danh của BUỔI ĐANG CHỌN.
  //
  // Hai điều kiện, đừng bỏ điều kiện thứ hai:
  //   1. Ca còn sống (loại ca đã rút, đã huỷ).
  //   2. Ca ĐANG được xếp vào ĐÚNG buổi này.
  //
  // ⚠️ Không lọc theo buổi thì sau khi dời lịch, bé vẫn đứng ở buổi cũ — mà nút Lưu
  // bị chặn tới khi đủ sĩ số, nên Sale buộc phải đánh có mặt (thổi số buổi đã dự, tự
  // đẩy trạng thái lead) hoặc đánh vắng khống.
  //
  // ~~Ca chưa xếp buổi nào (dữ liệu cũ) vẫn hiện ở mọi buổi để không ai bị bỏ quên.~~
  // **[ĐẢO 23/09/2026]** Nay bé chưa xếp case có CHỖ RIÊNG trên màn (khối "Chưa xếp
  // case" ở `bang-case.tsx`) nên không còn ai bị bỏ quên, và để bé hiện ở mọi case là
  // TỆ HƠN: điểm danh bé đó ở hai case sinh hai dòng `TrialAttendance` (khoá là cặp
  // buổi × ca, không chặn) ⇒ thổi số buổi đã dự lên gấp đôi, và chính con số đó tự
  // đẩy trạng thái lead trên Kanban.
  //
  // **[SỬA 23/09/2026, cùng ngày]** Đảo ở trên áp cho MỌI lớp là quá tay: ở lớp slot CŨ,
  // NULL vẫn là "học cả lớp" (chốt 28/08) và là gần như MỌI ghi danh trên prod. Luật
  // nay theo loại lớp, ở MỘT chỗ: `thuocCase` (lib/trial/nghia-null.ts) — cùng hàm mà
  // server dùng để từ chối điểm danh bé không thuộc case.
  const markable = useMemo(
    () =>
      enrollments.filter(
        (e) =>
          // Case ĐÃ HUỶ: bé còn học đã sang khối "Chưa xếp case" — chỉ còn bé đã học xong
          // làm lịch sử. Liệt kê bé ACTIVE ở đây là một bé hai chỗ (đo được 23/09).
          (e.status === "COMPLETED" ||
            (e.status === "ACTIVE" && selectedSession?.status !== "CANCELLED")) &&
          thuocCase(e, selectedSessionId, lopTheoKhung),
      ),
    [enrollments, selectedSessionId, lopTheoKhung, selectedSession?.status],
  );

  // Nháp lưu theo khoá "sessionId:enrollmentId" để đổi chip qua lại không mất thao tác
  // đang dở ở buổi kia.
  const [draft, setDraft] = useState<Record<string, DraftRow>>({});
  const sessionKey = selectedSessionId;
  const [moSuaBuoi, setMoSuaBuoi] = useState(false);

  // Hook đặt Ở ĐÂY (không ở `SuaBuoiForm`) để lượt nạp treo vào đúng cú bấm "Sửa buổi
  // học" — xem chú thích prop `nguonGv`.
  //
  // `excludeSessionId` phải là buổi ĐANG CHỌN: không loại chính nó thì mở form ra chỉ để
  // sửa ô lý do cũng thấy note đỏ "trùng lịch" với chính mình, và người dùng học cách bỏ
  // qua note đỏ — hỏng đúng thứ vừa dựng lên.
  const nguonGv = useGvChoBuoi({
    trialClassId,
    excludeSessionId: selectedSessionId || null,
  });

  const tenGv = useMemo(
    () => new Map(teachers.map((t) => [t.id, t.name])),
    [teachers],
  );
  /** Tên GV của một buổi. GV đã rời danh sách vẫn phải hiện là "có người", không im
   *  lặng thành "chưa có giáo viên" — xem cùng lý do ở `includeIds` của trang. */
  function tenGvBuoi(id: string | null): string | null {
    if (!id) return null;
    return tenGv.get(id) ?? "(không rõ)";
  }

  /** Bản đồ hiển thị của buổi đang chọn: nháp đè lên giá trị đã lưu ở DB. */
  const duNgChoBuoi = useMemo(() => {
    const base: Record<string, DraftRow> = {};
    if (!selectedSession) return base;
    for (const e of markable) {
      const saved = selectedSession.attendance[e.id];
      base[e.id] = draft[`${sessionKey}:${e.id}`] ?? {
        // ⚠️ Vá 07/08/2026 — KHÔNG fallback "PRESENT". Trước đây mở buổi chưa điểm danh
        // lên là cả lớp đã sáng "Có mặt", bấm Lưu (hoặc lỡ tay) là ghi có mặt khống.
        // Ở lớp trải nghiệm cái giá đắt hơn lớp chính: tiến độ trải nghiệm đếm số buổi
        // PRESENT để tự đẩy trạng thái lead trên Kanban, nên điểm danh khống là đẩy
        // nhầm lead luôn.
        status: saved?.status ?? null,
        note: saved?.note ?? "",
      };
    }
    return base;
  }, [selectedSession, markable, draft, sessionKey]);

  const chuaDanhDau = demSoEmChuaDanhDau(markable, duNgChoBuoi);

  function setRow(enrollmentId: string, patch: Partial<DraftRow>) {
    setDraft((prev) => ({
      ...prev,
      [`${sessionKey}:${enrollmentId}`]: {
        ...(duNgChoBuoi[enrollmentId] ?? { status: null, note: "" }),
        ...patch,
      },
    }));
  }

  /**
   * Bấm lại đúng nhãn đang chọn = bỏ chọn, để lỡ tay còn gỡ được. CHỈ cho em CHƯA có
   * bản ghi trong DB: action chỉ upsert chứ không xoá, nên bỏ chọn một em đã lưu rồi
   * bấm Lưu sẽ chẳng xoá được gì — màn hình sẽ nói dối người dùng.
   */
  function toggleStatus(enrollmentId: string, status: TrialAttendanceMark) {
    const daLuu = Boolean(selectedSession?.attendance[enrollmentId]);
    const hienTai = duNgChoBuoi[enrollmentId]?.status ?? null;
    setRow(enrollmentId, { status: hienTai === status && !daLuu ? null : status });
  }

  function onSave() {
    if (!selectedSession) return;
    // Phải đủ cả lớp mới cho lưu: lưu dở dang thì buổi trông như "đã điểm danh" trong
    // khi vài em không có bản ghi nào, mà tiến độ lead lại tính theo số bản ghi PRESENT.
    if (chuaDanhDau > 0) {
      toast.error(`Còn ${chuaDanhDau} em chưa đánh dấu`);
      return;
    }
    const records = markable.flatMap((e) => {
      const row = duNgChoBuoi[e.id];
      if (!row?.status) return [];
      return [
        {
          trialEnrollmentId: e.id,
          status: row.status,
          note: row.note.trim() || null,
        },
      ];
    });
    if (records.length === 0) return;

    const sessionId = selectedSession.id;
    startTransition(async () => {
      const res = await markLopTrialAttendanceAction({
        trialSessionId: sessionId,
        records,
      });
      if (res.ok) {
        toast.success("Đã lưu điểm danh");
        // Xoá nháp của buổi vừa lưu để lần render sau đọc thẳng từ DB — giữ nháp lại
        // là màn hình tiếp tục hiện giá trị client kể cả khi server sửa khác đi.
        setDraft((prev) =>
          Object.fromEntries(
            Object.entries(prev).filter(([k]) => !k.startsWith(`${sessionId}:`)),
          ),
        );
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function onCompleteSession() {
    if (!selectedSession) return;
    const sessionId = selectedSession.id;
    startTransition(async () => {
      const res = await completeLopTrialSessionAction(sessionId);
      if (res.ok) {
        toast.success("Đã hoàn tất buổi");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  if (sessions.length === 0) {
    if (goiTat) return null;
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold text-foreground">Buổi học &amp; điểm danh</h2>
        <p className="text-sm text-muted-foreground">
          Lớp chưa có buổi nào. Thêm buổi trước khi điểm danh.
        </p>
      </div>
    );
  }

  return (
    <div className={goiTat ? "" : "rounded-xl border border-border bg-card p-4"}>
      {!goiTat && (
        <h2 className="mb-3 text-sm font-semibold text-foreground">Buổi học &amp; điểm danh</h2>
      )}

      <div className={goiTat ? "hidden" : "mb-4 flex flex-wrap gap-2"}>
        {sessions.map((s) => {
          const active = s.id === selectedSessionId;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setSelectedSessionId(s.id);
                // Đổi buổi ⇒ ĐÓNG khối sửa. Giữ nó mở thì danh sách giáo viên đang hiện
                // là của buổi TRƯỚC (khác ngày, khác `excludeSessionId`) — một cái note
                // đỏ đúng cho buổi khác còn tệ hơn không có note nào.
                setMoSuaBuoi(false);
                // ⚠️ CỐ Ý KHÔNG gọi `nguonGv.xoa()` ở đây, dù đọc thì thấy nó "thuộc về"
                // chỗ này. Bấm chip là ĐÓNG khối sửa, và khi khối đóng thì KHÔNG GÌ đọc
                // `ds` (hook chỉ được truyền vào `SuaBuoiForm`); mọi đường MỞ LẠI đều đi
                // qua nút "Sửa buổi học", nơi `xoa()` chạy TRƯỚC `tai()`.
                //
                // Đo bằng cách cấy lỗi (17/09/2026) — HAI cấu hình, đừng đọc nhầm số:
                //   · Cấu hình BA chỗ gọi (chip + nút bật/tắt + `onXong`), tức bản nháp
                //     đầu: gỡ `xoa()` khỏi ĐÂY → **0 ĐỎ / 7**; gỡ khỏi `onXong` →
                //     **0 ĐỎ / 7** — không ca nào chạm tới hai chỗ đó. Gỡ khỏi nút bật/
                //     tắt khi ấy chỉ **1 ĐỎ / 7**, vì hai dòng kia còn đang đỡ cho nó.
                //   · Cấu hình HIỆN TẠI (một chỗ gọi duy nhất, sau khi gỡ hai dòng chết):
                //     gỡ `xoa()` khỏi nút bật/tắt → **3 ĐỎ / 7**; để nó chạy SAU `tai()`
                //     thay vì TRƯỚC → **5 ĐỎ / 7**. ⭐ Đây mới là số của mã đang đọc.
                //
                // Con số 1 ĐỎ ở trên chính là bằng chứng cho luận điểm: khi ba chỗ cùng
                // làm một việc, gỡ một chỗ gần như không ai thấy. Hai cơ chế cho một luật
                // là hai chỗ để chúng trôi lệch, và cái không ai kiểm được sẽ là cái trôi.
              }}
              aria-pressed={active}
              className={`rounded-lg border px-3 py-1.5 text-xs ${
                active
                  ? "border-primary bg-primary-soft font-bold text-primary"
                  : "border-border font-medium text-muted-foreground hover:bg-muted"
              }`}
            >
              Buổi {s.seq} · {ngayVn(s.date)}
              {s.status === "COMPLETED" && (
                <span className="ml-1 text-state-success-ink">✓</span>
              )}
              {s.status === "CANCELLED" && (
                <span className="ml-1 text-state-danger-ink">đã huỷ</span>
              )}
              {/* Giáo viên hiện NGAY trên chip: người xếp lịch nhìn một lượt là biết
                  buổi nào chưa có ai dạy, không phải bấm từng buổi để dò. */}
              <span className="ml-1 font-normal opacity-70">
                · {tenGvBuoi(s.teacherId) ?? "chưa có GV"}
              </span>
            </button>
          );
        })}
      </div>

      {selectedSession && (
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            {/* Vỏ ngoài (`bang-case.tsx`) đã in giờ + phòng + GV ngay trên đầu case.
                In lại ở đây là nói hai lần cùng một điều cách nhau 40px — và khi hai
                bản trôi lệch thì không ai biết bản nào đúng. Giữ `<span/>` rỗng để
                `justify-between` vẫn đẩy nhóm nút sang phải. */}
            {goiTat ? (
              <span />
            ) : (
              <span>
                Buổi {selectedSession.seq} · {ngayVn(selectedSession.date)} ·{" "}
                {selectedSession.startTime}–{selectedSession.endTime}
                {" · "}
                <span className="font-medium text-foreground">
                  GV: {tenGvBuoi(selectedSession.teacherId) ?? "chưa có"}
                </span>
              </span>
            )}
            {/* Hai nút thao tác của buổi đứng CẠNH NHAU ở mép phải. `justify-between`
                của hàng cha đẩy mỗi con ra một góc, nên phải bọc chúng lại — nếu không
                "Sửa buổi học" bị hất vào giữa, đọc như một phần của dòng thông tin. */}
            <div className="flex flex-wrap items-center gap-2">
              {/* 23/09 — `canManage` (mọi Sale) chỉ quyết định CÓ VẼ khu vực này không;
                  còn SỬA ĐƯỢC case này không là `quyenSua` server đã quy sẵn từ người
                  tạo case. Trước bản vá nút sáng với mọi Sale trên mọi case, bấm vào
                  mới bị server từ chối — cửa ghi đúng mà nút nói dối. */}
              {canManage && selectedSession.status === "SCHEDULED" && !selectedSession.quyenSua.duoc && (
                <span
                  role="note"
                  title={selectedSession.quyenSua.lyDo}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground"
                >
                  <Lock className="h-3.5 w-3.5" /> Không sửa giờ / phòng / GV
                </span>
              )}
              {canManage && selectedSession.status === "SCHEDULED" && selectedSession.quyenSua.duoc && (
                <button
                  type="button"
                  onClick={() => {
                    const mo = !moSuaBuoi;
                    setMoSuaBuoi(mo);
                    // ⭐ CHỖ DUY NHẤT quên kết quả cũ (vá 17/09/2026) — và nó phải chạy
                    // TRƯỚC `tai()`, không phải sau.
                    //
                    // Hook sống ở component NÀY (xem prop `nguonGv` của `SuaBuoiForm`), nên
                    // `ds` sống sót qua mọi lần đóng/mở và mọi lần đổi buổi. Bấm "Sửa buổi
                    // học" cho một buổi KHÁC thì `tai()` bắn đi, nhưng tới lúc server trả
                    // lời — vài trăm ms tới hơn một giây — màn hình vẫn vẽ kết quả buổi CŨ:
                    // note ĐỎ `role="alert"` kèm khung giờ của buổi khác, ngay cạnh ô ngày
                    // ghi ngày mới. Không ném, không đỏ test nào, console sạch (luật 12).
                    //
                    // ⚠️ KHÔNG che bằng cờ `dangTai`: cờ đó chỉ nói "đang có lượt bay", nó
                    // không làm dữ liệu cũ biến đi, và mọi khối chữ bên dưới vẫn đọc `ds`.
                    // Chạy vô điều kiện (cả lượt MỞ lẫn lượt ĐÓNG) để không phải nhớ nhánh.
                    nguonGv.xoa();
                    // Nạp NGAY khi mở: người dùng có thể chỉ đổi mỗi giáo viên, không
                    // đụng ngày/giờ — mà đó vẫn là một đường tạo trùng lịch. Đợi họ chạm
                    // vào ô ngày mới lọc là để ngỏ đúng ca hay gặp nhất.
                    if (mo) {
                      nguonGv.tai(
                        // `date` là UTC-midnight của ngày VN → 10 ký tự đầu là "YYYY-MM-DD".
                        selectedSession.date.slice(0, 10),
                        selectedSession.startTime,
                        selectedSession.endTime,
                      );
                    }
                  }}
                  disabled={pending}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  {moSuaBuoi ? "Đóng" : "Sửa buổi học"}
                </button>
              )}
              {/* 23/09 — CHỈ case SCHEDULED. Bản cũ vẽ nút cả trên case ĐÃ HUỶ (điều kiện
                  là `!== "COMPLETED"`), và bấm vào là hồi sinh case đó thành COMPLETED.
                  Server nay cũng từ chối (`completeTrialSession`). */}
              {/* 23/09 — chủ dự án: Sale KHÔNG hoàn tất case của Sale khác (`quyenDiemDanh`). */}
              {canMark && selectedSession.status === "SCHEDULED" && selectedSession.quyenDiemDanh.duoc && (
                <button
                  type="button"
                  onClick={onCompleteSession}
                  disabled={pending}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-state-success px-3 py-1.5 text-xs font-semibold text-state-success-ink hover:bg-state-success-soft disabled:opacity-50"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Hoàn tất buổi
                </button>
              )}
            </div>
          </div>

          {moSuaBuoi && selectedSession.status === "SCHEDULED" && (
            <SuaBuoiForm
              key={selectedSession.id}
              session={selectedSession}
              ngayLop={ngayLop}
              khungLop={khungLop}
              teachers={teachers}
              rooms={rooms}
              nguonGv={nguonGv}
              cheDoChonGv={cheDoChonGv}
              locGvTheoCa={locGvTheoCa}
              soGvMienLoc={soGvMienLoc}
              // Đóng bằng nút "Đóng" / sau khi Lưu / sau khi Huỷ buổi: chỉ đóng, KHÔNG
              // tự xoá — cùng lý do với chip đổi buổi ở trên; phép đo (0 ĐỎ / 7, ở cấu
              // hình ba chỗ gọi) ghi đầy đủ trong khối chú thích của chip.
              onXong={() => setMoSuaBuoi(false)}
            />
          )}

          {canMark && !selectedSession.quyenDiemDanh.duoc && markable.length > 0 && (
            <p role="note" className="mb-2 flex items-start gap-1.5 text-xs text-muted-foreground">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{selectedSession.quyenDiemDanh.lyDo}</span>
            </p>
          )}
          {markable.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có học viên để điểm danh.</p>
          ) : !canMark ||
            selectedSession.status === "CANCELLED" ||
            // 23/09 — case của Sale khác: CHỈ ĐỌC (chủ dự án: Sale không điểm danh thay).
            !selectedSession.quyenDiemDanh.duoc ? (
            // Case ĐÃ HUỶ: chỉ đọc. Điểm danh vào buổi không diễn ra là ghi có mặt khống,
            // và server cũng đã từ chối (`markAttendance`).
            <ul className="divide-y divide-border text-sm">
              {markable.map((e) => {
                const a = selectedSession.attendance[e.id];
                return (
                  <li
                    key={e.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <span className="text-foreground">{e.childName}</span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        {a ? (a.status === "PRESENT" ? "Có mặt" : "Vắng") : "Chưa điểm danh"}
                        {a?.note ? ` · ${a.note}` : ""}
                      </span>
                      <NutPhieu
                        enrollmentId={e.id}
                        sessionId={selectedSession.id}
                        daDanhGia={Boolean(selectedSession.danhGia[e.id])}
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="space-y-2">
              {markable.map((e) => {
                const row = duNgChoBuoi[e.id] ?? { status: null, note: "" };
                return (
                  <div
                    key={e.id}
                    className="flex flex-wrap items-center gap-2 rounded-lg bg-muted px-3 py-2"
                  >
                    <span className="min-w-[8rem] flex-1 text-sm font-medium text-foreground">
                      {e.childName}
                    </span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => toggleStatus(e.id, "PRESENT")}
                        disabled={pending}
                        aria-pressed={row.status === "PRESENT"}
                        className={`rounded-md px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${
                          row.status === "PRESENT"
                            ? "bg-state-success text-white"
                            : "bg-card text-muted-foreground ring-1 ring-border"
                        }`}
                      >
                        Có mặt
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleStatus(e.id, "ABSENT")}
                        disabled={pending}
                        aria-pressed={row.status === "ABSENT"}
                        className={`rounded-md px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${
                          row.status === "ABSENT"
                            ? "bg-state-danger text-white"
                            : "bg-card text-muted-foreground ring-1 ring-border"
                        }`}
                      >
                        Vắng
                      </button>
                    </div>
                    <NutPhieu
                      enrollmentId={e.id}
                      sessionId={selectedSession.id}
                      daDanhGia={Boolean(selectedSession.danhGia[e.id])}
                    />
                    <input
                      type="text"
                      value={row.note}
                      onChange={(ev) => setRow(e.id, { note: ev.target.value })}
                      disabled={pending}
                      placeholder="Ghi chú…"
                      aria-label={`Ghi chú điểm danh cho ${e.childName}`}
                      className="min-w-[10rem] flex-1 rounded-md border border-border px-2 py-1 text-xs disabled:opacity-50"
                    />
                  </div>
                );
              })}

              <div className="mt-1 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={onSave}
                  disabled={pending}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
                >
                  {pending ? "Đang lưu…" : "Lưu điểm danh"}
                </button>
                {chuaDanhDau > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Còn <span className="font-semibold text-foreground">{chuaDanhDau}</span> em
                    chưa đánh dấu
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
