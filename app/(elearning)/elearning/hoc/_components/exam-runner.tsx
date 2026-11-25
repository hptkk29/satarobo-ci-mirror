"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { batDauThiAction, luuCauTraLoiAction, nopBaiAction } from "../_actions";
import { datDangMoLuotThi } from "./chuyen-bai";

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

/**
 * Dấu đo "bấm Bắt đầu → màn thi hiện" bằng Performance API (đọc được ở DevTools / Playwright: `performance.getEntriesByType("measure")`).
 *
 * Vì sao có: đo 25–26/10/2026 trên TEST thấy MỘT lần mở bài thi mất ~9 giây (action 127 ms, không long task phía client) rồi KHÔNG tái
 * hiện ở hai lượt đo kế tiếp (277 ms / 257 ms). Không có dấu đo thì lần sau vẫn không biết thời gian mất ở máy chủ, ở mạng hay ở
 * trình duyệt. Ba đoạn: `el-thi:action` (bấm → server action trả), `el-thi:sau-action` (action trả → màn thi hiện, gồm
 * `router.refresh()`), `el-thi:tong`. Không gửi đi đâu, không ghi log: chỉ nằm trong bộ nhớ trình duyệt.
 * Nhờ chính các dấu này mới thấy: sau hotfix #994, 11/14 mẫu trên TEST có `sau-action` ≈ 3,9 s (action chỉ ~95 ms) — màn thi chờ bản cập nhật RSC.
 * Đã sửa bằng cầu nối `luotCauNoi` (mở từ kết quả của action); giữ nguyên các dấu đo để đo lại sau mỗi lần deploy.
 */
/** Sau khi action xong, chờ RSC mới mang lượt về tối đa chừng này rồi trả nút (mạng/máy chủ nghẽn). */
const HAN_CHO_RSC_MS = 20_000;

const DAU_DO = ["el-thi:bam", "el-thi:action-xong", "el-thi:man-thi-hien"] as const;
function danhDau(ten: "bam" | "action-xong" | "man-thi-hien"): void {
  try {
    const t = `el-thi:${ten}`;
    if (ten === "bam") for (const d of DAU_DO) performance.clearMarks(d);
    performance.mark(t);
    if (ten !== "bam" && performance.getEntriesByName("el-thi:bam", "mark").length === 0) return;
    if (ten === "action-xong") performance.measure("el-thi:action", "el-thi:bam", t);
    if (ten === "man-thi-hien") {
      performance.measure("el-thi:tong", "el-thi:bam", t);
      if (performance.getEntriesByName("el-thi:action-xong", "mark").length > 0) {
        performance.measure("el-thi:sau-action", "el-thi:action-xong", t);
      }
    }
  } catch {
    /* môi trường không có Performance API: bỏ qua, không ảnh hưởng làm bài */
  }
}

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
  // ⚠️ KHÔNG dùng `useTransition` cho "đang mở / đang nộp". React 19 GỘP các async transition chồng nhau thành MỘT lô: `isPending`
  // của nút này không về false (và bản cập nhật RSC của `router.refresh()` không được commit) chừng nào còn một async transition
  // KHÁC, không liên quan, chưa xong. Đo trên TEST 25–26/10/2026: server action 127 ms, không long task phía client, mà giao diện
  // đứng ở bản cũ ("Đang mở…" + Bài trước/Bài sau) tới ~9 s. Ca `[ER-12]` tái hiện đúng cơ chế đó. Trạng thái cục bộ rõ ràng thì
  // chỉ phụ thuộc vào lời gọi của CHÍNH nút này.
  const [dangMo, setDangMo] = useState(false);
  const [dangNop, setDangNop] = useState(false);
  const [choLau, setChoLau] = useState(false);
  // Đã gọi `router.refresh()` mà RSC mới chưa mang lượt về — có hạn chờ (xem `HAN_CHO_RSC_MS`).
  const [choRsc, setChoRsc] = useState(false);
  // ⚠️ CẦU NỐI: lượt do CHÍNH action `batDauThi` trả về (server dựng, đã lọc đáp án đúng). Màn thi mở NGAY khi action xong, KHÔNG chờ
  // bản cập nhật RSC của `router.refresh()` commit. Đo TEST 26/10/2026 (14 mẫu): action ~95 ms nhưng commit RSC bị giữ ~3,9 s (median
  // `el-thi:tong` 4016 ms) — đổi bộ đếm 4000→9000 ms thì màn thi hiện lúc 9 s, tức commit chỉ tới khi có một lần render khác. Props
  // của server vẫn là NGUỒN SỰ THẬT: có props thì dùng props, cầu nối chỉ lấp khoảng chờ rồi bị xoá khi props xác nhận.
  const [luotCauNoi, setLuotCauNoi] = useState<NonNullable<typeof props.luotDangLam> | null>(null);
  const luot = props.luotDangLam ?? luotCauNoi;

  // Quá 4 giây vẫn "Đang mở…" ⇒ nói thật là đang lâu hơn thường, để người học không bấm lại / tải lại trang mà không hiểu vì sao.
  useEffect(() => {
    if (!dangMo) {
      setChoLau(false);
      return;
    }
    const t = setTimeout(() => setChoLau(true), 4000);
    return () => clearTimeout(t);
  }, [dangMo]);

  // Lối thoát: action đã xong (lượt ĐÃ tạo) mà RSC mới không về sau `HAN_CHO_RSC_MS` ⇒ trả nút bấm lại. Bấm lại AN TOÀN: server trả
  // đúng lượt đang dở thay vì tạo lượt mới (`batDauThi` → nhánh `dangMo`), nên không đốt thêm lượt nào.
  useEffect(() => {
    if (!choRsc) return;
    const t = setTimeout(() => {
      if (luotCauNoi) {
        // Đang thi bằng bản cầu nối (bài thi ĐÃ hiện) mà RSC chưa về: KHÔNG làm phiền người đang thi, KHÔNG trả nút "Bắt đầu".
        // Nút nối trang vẫn ẩn (lượt đang tính giờ). Thử đồng bộ nền lại một lần, im lặng.
        setChoRsc(false);
        router.refresh();
        return;
      }
      setChoRsc(false);
      setDangMo(false);
      datDangMoLuotThi(false);
      toast.message("Chưa tải được bài thi. Bấm “Bắt đầu làm bài” để thử lại — lượt của bạn vẫn được giữ, không bị tính thêm.");
    }, HAN_CHO_RSC_MS);
    return () => clearTimeout(t);
    // `router` cố ý KHÔNG nằm trong deps: bộ đếm chỉ được khởi động lại khi `choRsc`/cầu nối ĐỔI, không phải mỗi lần render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choRsc, luotCauNoi]);

  // Gỡ khỏi trang (rời bài, lỗi dựng lại) ⇒ trả kho "đang mở lượt" về false, kẻo nút nối trang biến mất mãi ở bài khác.
  useEffect(() => () => datDangMoLuotThi(false), []);

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
    if (!luot) {
      setDangNop(false); // nộp xong: trang về bản không có lượt dở
      return;
    }
    // Màn thi đã hiện. Nếu là bản của SERVER (props) thì trang tự ẩn nút nối (`anChuyenBai`) và kho phía client hết việc. Nếu mới là
    // bản CẦU NỐI thì trang vẫn là bản cũ ⇒ GIỮ kho "đang mở lượt" (nút nối tiếp tục ẩn) và GIỮ `choRsc` (đang chờ server xác nhận).
    if (props.luotDangLam) {
      datDangMoLuotThi(false);
      setChoRsc(false);
    }
    setDangMo(false);
    danhDau("man-thi-hien");
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

  // Server đã xác nhận lượt (bản cập nhật RSC về, kể cả chậm): bỏ cầu nối, trả kho "đang mở lượt", hết chờ. Props cùng `attemptId` với
  // cầu nối nên effect ở trên KHÔNG chạy lại ⇒ lựa chọn người học vừa bấm không bị ghi đè.
  const daXacNhan = props.luotDangLam?.attemptId ?? null;
  useEffect(() => {
    if (!daXacNhan) return;
    datDangMoLuotThi(false);
    setChoRsc(false);
    setLuotCauNoi(null);
  }, [daXacNhan]);

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

  const batDauThi = async () => {
    if (dangMo) return; // chặn bấm đúp trong lúc đang mở
    // ⚠️ Ẩn nút "Bài trước/Bài sau" NGAY, trước khi gọi server: lượt thi sắp được tạo và tính giờ, mà trang còn là bản cũ
    // (chưa có lượt) cho tới khi RSC mới về — bấm nối trang lúc đó là rời một lượt người học chưa hề thấy đề.
    setDangMo(true);
    datDangMoLuotThi(true);
    danhDau("bam");
    try {
      const r = await batDauThiAction({
        enrollmentId: props.enrollmentId,
        lessonId: props.lessonId,
      });
      danhDau("action-xong");
      if (!r.ok) {
        toast.error(r.error.message);
        setDangMo(false);
        datDangMoLuotThi(false);
        return;
      }
      // Có `luot` từ server ⇒ mở màn thi NGAY (effect trên `attemptId` đặt lại `dangMo`); `router.refresh()` chỉ đồng bộ nền.
      // Không có (server cũ) ⇒ đường cũ: giữ `dangMo` = true cho tới khi lượt xuất hiện trong props, không trả sớm: trả sớm là
      // nút "Bắt đầu làm bài" bật lại trong lúc lượt đã tạo — bấm lần nữa là gọi action thừa.
      if (r.data.luot) setLuotCauNoi(r.data.luot);
      setChoRsc(true);
      router.refresh();
    } catch {
      // Mất mạng / máy chủ trả lỗi hệ thống: trả nút về và nói rõ, thay vì để "Đang mở…" rồi lặng lẽ không có gì.
      toast.error("Không mở được bài thi — kiểm tra kết nối rồi thử lại");
      setDangMo(false);
      datDangMoLuotThi(false);
    }
  };

  const nop = async () => {
    if (dangNop) return;
    setDangNop(true);
    try {
      const r = await nopBaiAction({ attemptId: luot!.attemptId });
      if (!r.ok) {
        toast.error(r.error.message);
        setDangNop(false);
        return;
      }
      toast.success(
        r.data.choChamTay
          ? "Đã nộp — bài có câu tự luận, chờ người chấm"
          : r.data.passed
            ? `Đã nộp — đạt ${r.data.totalScore}/${props.maxScore}`
            : `Đã nộp — chưa đạt (${r.data.totalScore}/${props.maxScore})`,
      );
      // `dangNop` giữ true tới khi lượt dở biến khỏi props (effect trên `attemptId`).
      // Cầu nối (nếu còn) hết nghĩa: lượt đã nộp. Nếu server CHƯA kịp xác nhận lượt (props vẫn không có) thì phải tự gỡ, kẻo màn
      // thi ở lại mãi; kho "đang mở lượt" cũng trả về để nút nối trang hiện lại.
      if (!props.luotDangLam) {
        setLuotCauNoi(null);
        setChoRsc(false);
        datDangMoLuotThi(false);
      }
      router.refresh();
    } catch {
      toast.error("Không nộp được bài — kiểm tra kết nối rồi bấm Nộp bài lại");
      setDangNop(false);
    }
  };

  // ── Chưa bắt đầu ──────────────────────────────────────────────────────────
  if (!luot) {
    return (
      <div className="space-y-4" data-trang-thai-thi={dangMo ? "dang-mo" : "chua-bat-dau"}>
        <div className="rounded-xl border border-border bg-card p-4 text-sm">
          <p className="text-base font-semibold text-foreground">{props.tenDe}</p>
          <p className="mt-1 text-muted-foreground">
            {props.durationMin} phút · đạt từ {props.passScore}/{props.maxScore} điểm ·
            còn {props.soLuotConLai} lượt
          </p>
        </div>

        {props.ketQuaGanNhat ? (
          <div className="rounded-xl border border-border bg-card p-4 text-sm">
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
            disabled={dangMo}
            onClick={batDauThi}
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground outline-none transition-colors hover:bg-primary-dark focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60"
          >
            {dangMo ? "Đang mở…" : "Bắt đầu làm bài"}
          </button>
        ) : (
          <p className="rounded-xl border border-border bg-muted px-4 py-3 text-sm">
            Đã dùng hết lượt thi. Liên hệ Đào tạo nếu cần mở thêm lượt.
          </p>
        )}
        {dangMo && choLau ? (
          <p role="status" className="text-sm text-muted-foreground">
            Đang mở bài thi, lâu hơn bình thường. Bạn không cần bấm lại hay tải lại trang.
          </p>
        ) : null}
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
    <div className="space-y-4" data-trang-thai-thi="dang-lam">
      {/* `top-16` = dưới thanh trên (cao 64px) của khu — để thanh tiến độ/đồng hồ không chui xuống dưới nó. */}
      <div className="sticky top-16 z-20 flex items-center justify-between rounded-xl border border-border bg-card px-4 py-2.5 text-sm shadow-sm">
        <span className="font-medium">
          {soDaLam}/{luot.cacCau.length} câu
        </span>
        <span
          role="timer"
          className={`tabular-nums ${conLai <= 60 ? "font-bold text-state-danger-ink" : "font-medium"}`}
        >
          còn {dinhDang(conLai)}
          {conLai <= 60 ? " — sắp hết giờ" : ""}
        </span>
      </div>

      {conLai === 0 ? (
        // Đồng hồ về 0 KHÔNG tự nộp: tự nộp là cướp mất giây cuối của người đang
        // gõ dở. Nói rõ và để họ bấm.
        <p role="alert" className="rounded-xl border border-state-warning/40 bg-state-warning-soft px-4 py-3 text-sm font-medium">
          Hết giờ — bấm “Nộp bài” để được chấm phần đã làm.
        </p>
      ) : null}

      <ol className="space-y-3">
        {luot.cacCau.map((c, i) => (
          <li key={c.examQuestionId} className="rounded-xl border border-border bg-card p-4 text-sm">
            <p className="text-xs font-medium text-muted-foreground">
              Câu {i + 1} ({c.points} điểm)
            </p>
            <p className="mt-1 text-base font-medium text-foreground">{c.stem}</p>

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
                aria-label={`Trả lời câu ${i + 1}`}
                className="mt-3 min-h-24 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-ring"
              />
            ) : (
              <div role="group" aria-label={`Lựa chọn của câu ${i + 1}`} className="mt-3 space-y-1.5">
                {c.luaChon.map((lc) => {
                  const dangBat = (traLoi[c.examQuestionId] ?? []).includes(lc.ma);
                  return (
                    <button
                      key={lc.ma}
                      type="button"
                      aria-pressed={dangBat}
                      onClick={() => chon(c, lc.ma)}
                      className={`flex min-h-11 w-full items-start gap-3 rounded-lg border px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
                        dangBat
                          ? "border-primary bg-primary-soft font-medium text-foreground"
                          : "border-border bg-background hover:bg-muted"
                      }`}
                    >
                      {/* Lựa chọn đang chọn: dấu ● + viền — màu không đứng một mình. */}
                      <span
                        aria-hidden
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] ${
                          dangBat ? "border-primary bg-primary text-primary-foreground" : "border-border"
                        }`}
                      >
                        {dangBat ? "✓" : ""}
                      </span>
                      <span className="min-w-0">{lc.nhan}</span>
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
        disabled={dangNop}
        onClick={nop}
        className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground outline-none transition-colors hover:bg-primary-dark focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60"
      >
        {dangNop ? "Đang nộp…" : "Nộp bài"}
      </button>
      {soDaLam < luot.cacCau.length ? (
        // Cảnh báo, không CHẶN: bỏ trống một câu là quyền của người thi.
        <p className="text-sm text-muted-foreground">
          Còn {luot.cacCau.length - soDaLam} câu chưa làm — nộp bây giờ thì những câu
          đó tính 0 điểm.
        </p>
      ) : null}
    </div>
  );
}
