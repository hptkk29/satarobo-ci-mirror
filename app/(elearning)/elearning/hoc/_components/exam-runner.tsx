"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { batDauThiAction, luuCauTraLoiAction, nopBaiAction } from "../_actions";

/**
 * EL-14d — LÀM MỘT BÀI THI.
 *
 * ⚠️ Câu trả lời LƯU DẦN từng câu ngay khi bấm. Gom lại tới lúc nộp là để mất mạng
 * mười giây trở thành mất cả bài — và người học không làm gì sai.
 *
 * ⚠️ Đồng hồ trên màn hình chỉ để NHÌN. Hết giờ là server phán (`startedAt` +
 * `durationMin` + ân hạn); đồng hồ trình duyệt sửa được bằng một dòng trong bảng
 * điều khiển, và người sửa được thêm bao nhiêu thời gian tuỳ thích.
 *
 * ⚠️ Đáp án đúng KHÔNG có trong dữ liệu trang này. Server chỉ gửi xuống nhãn và mã
 * lựa chọn — bơm cả câu hỏi xuống là gửi kèm đáp án trong thân phản hồi.
 */

export type CauDeThi = {
  examQuestionId: string;
  stem: string;
  type: string;
  points: number;
  luaChon: { ma: string; nhan: string }[];
  /** Lựa chọn đã lưu từ lần trước (tải lại trang thì còn nguyên). */
  daChon: string[];
  textAnswer: string | null;
};

const chonNhieu = (t: string) => t === "MULTIPLE";
const caTuLuan = (t: string) => t === "SHORT_ANSWER" || t === "ESSAY";

function dinhDang(giay: number): string {
  const m = Math.max(0, Math.floor(giay / 60));
  const s = Math.max(0, giay % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ExamRunner(props: {
  enrollmentId: string;
  lessonId: string;
  tenDe: string;
  durationMin: number;
  passScore: number;
  maxScore: number;
  soLuotConLai: number;
  /** Có = đang làm dở; không có = chưa bắt đầu. */
  luotDangLam: {
    attemptId: string;
    conLaiGiay: number;
    cacCau: CauDeThi[];
  } | null;
  /** Kết quả lượt gần nhất, nếu đã nộp. */
  ketQuaGanNhat: {
    status: string;
    totalScore: number | null;
    passed: boolean | null;
  } | null;
}) {
  const router = useRouter();
  const [dangChay, batDau] = useTransition();
  const luot = props.luotDangLam;

  const [conLai, setConLai] = useState(luot?.conLaiGiay ?? 0);
  const [traLoi, setTraLoi] = useState<Record<string, string[]>>(
    Object.fromEntries((luot?.cacCau ?? []).map((c) => [c.examQuestionId, c.daChon])),
  );
  const [chuText, setChuText] = useState<Record<string, string>>(
    Object.fromEntries(
      (luot?.cacCau ?? []).map((c) => [c.examQuestionId, c.textAnswer ?? ""]),
    ),
  );
  const dangLuu = useRef(new Set<string>());

  /**
   * ⚠️ ĐỒNG BỘ LẠI CẢ BA state khi lượt thi đổi.
   *
   * `useState` chỉ đọc giá trị khởi tạo ở lượt kết xuất ĐẦU TIÊN — mà lượt đầu tiên
   * là lúc chưa bấm "Bắt đầu", khi `luot` còn `null`. Sau khi bấm,
   * `router.refresh()` đưa props mới xuống nhưng state vẫn giữ giá trị cũ. Hậu quả:
   *
   *  · đồng hồ đứng 0:00 và banner "Hết giờ" hiện ngay giây đầu của bài thi;
   *  · câu ĐÃ LƯU không hiện lại là đã chọn — người học tưởng mình mất bài và làm
   *    lại từ đầu.
   *
   * Cùng một lớp lỗi với `dangHuy` ở trình tải video: state không đổi trong lượt
   * gọi đã đóng gói nó.
   */
  const attemptId = luot?.attemptId ?? null;
  useEffect(() => {
    if (!luot) return;
    setConLai(luot.conLaiGiay);
    setTraLoi(
      Object.fromEntries(luot.cacCau.map((c) => [c.examQuestionId, c.daChon])),
    );
    setChuText(
      Object.fromEntries(
        luot.cacCau.map((c) => [c.examQuestionId, c.textAnswer ?? ""]),
      ),
    );
    // Chỉ chạy khi ĐỔI LƯỢT, không chạy mỗi lần props về: chạy mỗi lần là ghi đè
    // lựa chọn người học vừa bấm bằng bản trên máy chủ, và ô họ vừa tích nhảy về.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId]);

  // ── Đồng hồ đếm ngược ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!luot) return;
    const t = setInterval(() => setConLai((x) => Math.max(0, x - 1)), 1000);
    return () => clearInterval(t);
  }, [luot]);

  const luuCau = (examQuestionId: string, chon: string[], text: string | null) => {
    // Chặn chồng lệnh cho CÙNG một câu: bấm nhanh hai lần thì lệnh sau có thể về
    // trước, và lựa chọn cũ ghi đè lựa chọn mới.
    if (dangLuu.current.has(examQuestionId)) return;
    dangLuu.current.add(examQuestionId);
    void luuCauTraLoiAction({
      attemptId: luot!.attemptId,
      examQuestionId,
      chon: chon.map(Number).filter(Number.isInteger),
      textAnswer: text,
    })
      .then((r) => {
        // ⚠️ Lỗi lưu một câu KHÔNG được làm hỏng cả bài. Báo nhẹ rồi thôi — người
        // học vẫn làm tiếp được, và nút Nộp vẫn còn đó.
        if (!r.ok) toast.error(r.error.message);
      })
      .finally(() => dangLuu.current.delete(examQuestionId));
  };

  const chon = (c: CauDeThi, ma: string) => {
    const cu = traLoi[c.examQuestionId] ?? [];
    const moi = chonNhieu(c.type)
      ? cu.includes(ma)
        ? cu.filter((x) => x !== ma)
        : [...cu, ma].sort()
      : [ma];
    setTraLoi((s) => ({ ...s, [c.examQuestionId]: moi }));
    luuCau(c.examQuestionId, moi, chuText[c.examQuestionId] ?? null);
  };

  const batDauThi = () =>
    batDau(async () => {
      const r = await batDauThiAction({
        enrollmentId: props.enrollmentId,
        lessonId: props.lessonId,
      });
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      router.refresh();
    });

  const nop = () =>
    batDau(async () => {
      const r = await nopBaiAction({ attemptId: luot!.attemptId });
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      toast.success(
        r.data.choChamTay
          ? "Đã nộp — bài có câu tự luận, chờ người chấm"
          : r.data.passed
            ? `Đã nộp — đạt ${r.data.totalScore}/${props.maxScore}`
            : `Đã nộp — chưa đạt (${r.data.totalScore}/${props.maxScore})`,
      );
      router.refresh();
    });

  // ── Chưa bắt đầu ──────────────────────────────────────────────────────────
  if (!luot) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border p-4 text-sm">
          <p className="font-medium">{props.tenDe}</p>
          <p className="mt-1 text-muted-foreground">
            {props.durationMin} phút · đạt từ {props.passScore}/{props.maxScore} điểm ·
            còn {props.soLuotConLai} lượt
          </p>
        </div>

        {props.ketQuaGanNhat ? (
          <div className="rounded-md border p-3 text-sm">
            {props.ketQuaGanNhat.status === "PENDING_GRADE" ? (
              // Nói rõ vì sao chưa có điểm — không để họ tưởng bị chấm 0.
              <p>Lượt gần nhất đã nộp, đang chờ người chấm phần tự luận.</p>
            ) : (
              <p>
                Lượt gần nhất:{" "}
                <strong>
                  {props.ketQuaGanNhat.totalScore}/{props.maxScore}
                </strong>{" "}
                — {props.ketQuaGanNhat.passed ? "đạt" : "chưa đạt"}
              </p>
            )}
          </div>
        ) : null}

        {props.soLuotConLai > 0 ? (
          <button
            type="button"
            disabled={dangChay}
            onClick={batDauThi}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            {dangChay ? "Đang mở…" : "Bắt đầu làm bài"}
          </button>
        ) : (
          <p className="rounded-md bg-muted px-3 py-2 text-sm">
            Đã dùng hết lượt thi. Liên hệ Đào tạo nếu cần mở thêm lượt.
          </p>
        )}
      </div>
    );
  }

  // ── Đang làm bài ──────────────────────────────────────────────────────────
  const soDaLam = luot.cacCau.filter(
    (c) =>
      (traLoi[c.examQuestionId]?.length ?? 0) > 0 ||
      (chuText[c.examQuestionId]?.trim().length ?? 0) > 0,
  ).length;

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 flex items-center justify-between rounded-md border bg-background px-3 py-2 text-sm">
        <span>
          {soDaLam}/{luot.cacCau.length} câu
        </span>
        <span className={conLai <= 60 ? "font-bold text-red-600" : ""}>
          còn {dinhDang(conLai)}
        </span>
      </div>

      {conLai === 0 ? (
        // Đồng hồ về 0 KHÔNG tự nộp: tự nộp là cướp mất giây cuối của người đang
        // gõ dở. Nói rõ và để họ bấm.
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Hết giờ — bấm “Nộp bài” để được chấm phần đã làm.
        </p>
      ) : null}

      <ol className="space-y-3">
        {luot.cacCau.map((c, i) => (
          <li key={c.examQuestionId} className="rounded-md border p-3 text-sm">
            <p>
              <span className="mr-2 text-xs text-muted-foreground">
                Câu {i + 1} ({c.points} điểm)
              </span>
              {c.stem}
            </p>

            {caTuLuan(c.type) ? (
              <textarea
                value={chuText[c.examQuestionId] ?? ""}
                onChange={(e) =>
                  setChuText((s) => ({ ...s, [c.examQuestionId]: e.target.value }))
                }
                onBlur={() =>
                  luuCau(
                    c.examQuestionId,
                    traLoi[c.examQuestionId] ?? [],
                    chuText[c.examQuestionId] ?? "",
                  )
                }
                rows={4}
                placeholder="Trả lời…"
                className="mt-2 w-full rounded-md border px-2 py-1 text-sm"
              />
            ) : (
              <div className="mt-2 space-y-1">
                {c.luaChon.map((lc) => {
                  const dangBat = (traLoi[c.examQuestionId] ?? []).includes(lc.ma);
                  return (
                    <button
                      key={lc.ma}
                      type="button"
                      onClick={() => chon(c, lc.ma)}
                      className={`block w-full rounded-md border px-3 py-2 text-left ${
                        dangBat ? "border-primary bg-primary/10 font-medium" : ""
                      }`}
                    >
                      {lc.nhan}
                    </button>
                  );
                })}
              </div>
            )}
          </li>
        ))}
      </ol>

      <button
        type="button"
        disabled={dangChay}
        onClick={nop}
        className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
      >
        {dangChay ? "Đang nộp…" : "Nộp bài"}
      </button>
      {soDaLam < luot.cacCau.length ? (
        // Cảnh báo, không CHẶN: bỏ trống một câu là quyền của người thi.
        <p className="text-xs text-muted-foreground">
          Còn {luot.cacCau.length - soDaLam} câu chưa làm — nộp bây giờ thì những câu
          đó tính 0 điểm.
        </p>
      ) : null}
    </div>
  );
}
