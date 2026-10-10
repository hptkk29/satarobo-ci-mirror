"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { chamLuotThiAction } from "../_actions";
import type { CauDeCham } from "@/lib/elearning/exam-grading-queue";

/**
 * EL-14e — CHẤM MỘT LƯỢT THI.
 *
 * ⚠️ Chấm TRỌN một lượt trong MỘT lần. Không có nút "lưu nháp": chấm dở rồi để đó
 * là đẻ ra một trạng thái thứ ba ("đã chấm một nửa") mà không cột nào mô tả được, và
 * không ai biết lượt đó còn chờ ai. Server cũng chặn — màn này chỉ nói trước.
 *
 * ⚠️ Ô điểm bỏ TRỐNG khác ô điểm ghi `0`. Trống = chưa đọc; `0` = đã đọc và không
 * cho điểm. Gộp hai thứ đó là chốt trượt cho người chưa được ai đọc bài.
 */
export function GradingForm(props: {
  attemptId: string;
  passScore: number;
  maxScore: number;
  cacCau: CauDeCham[];
}) {
  const router = useRouter();
  const [dangChay, batDau] = useTransition();
  // ⚠️ Cần chấm = câu CHƯA CÓ ĐIỂM, không phải câu thuộc loại tự luận. Câu trắc
  // nghiệm mà hệ thống không đọc nổi nội dung cũng chưa có điểm, và nếu lọc theo loại
  // thì nó không có ô nhập nào — màn chấm rỗng, nút vẫn bật, bấm ra lỗi Zod tiếng
  // Anh, và lượt thi kẹt vĩnh viễn.
  const canCham = props.cacCau.filter((c) => !c.daCoDiem);

  const [diem, setDiem] = useState<Record<string, string>>(
    Object.fromEntries(canCham.map((c) => [c.examQuestionId, ""])),
  );
  const [ghiChu, setGhiChu] = useState<Record<string, string>>(
    Object.fromEntries(canCham.map((c) => [c.examQuestionId, ""])),
  );
  const [nhanXet, setNhanXet] = useState("");

  const soTrong = canCham.filter(
    (c) => (diem[c.examQuestionId] ?? "").trim() === "",
  ).length;
  const soDaNhap = canCham.length - soTrong;

  // Điểm câu ĐÃ chấm cộng sẵn, để người chấm THẤY tổng đang đi về đâu trước khi
  // bấm, thay vì biết kết quả sau khi con số đã vào hồ sơ.
  const diemDaCo = props.cacCau
    .filter((c) => c.daCoDiem)
    .reduce((s, c) => s + (c.score ?? 0), 0);
  const diemTay = canCham.reduce((s, c) => {
    const n = Number(diem[c.examQuestionId]);
    return s + (Number.isFinite(n) ? n : 0);
  }, 0);
  const tongTam = diemDaCo + diemTay;

  // Ô sai chia làm HAI nhóm, vì hai nhóm cần hai câu nói khác nhau: gõ chữ hoặc số
  // lẻ là "không nhận được", còn gõ số nguyên quá thang là "vượt thang". Gộp lại
  // thành một câu "ngoài thang" là báo sai lý do cho người gõ 2.5.
  const doSai = canCham
    .map((c) => {
      const v = (diem[c.examQuestionId] ?? "").trim();
      if (v === "") return null;
      const n = Number(v);
      if (!Number.isFinite(n) || !Number.isInteger(n)) return "soLe";
      if (n < 0 || n > c.points) return "vuot";
      return null;
    })
    .filter(Boolean);
  const soLe = doSai.filter((x) => x === "soLe").length;
  const vuotThang = doSai.filter((x) => x === "vuot").length;

  const chot = () =>
    batDau(async () => {
      const r = await chamLuotThiAction({
        attemptId: props.attemptId,
        diem: canCham.map((c) => ({
          examQuestionId: c.examQuestionId,
          score: Number(diem[c.examQuestionId]),
          note: (ghiChu[c.examQuestionId] ?? "").trim() || null,
        })),
        feedback: nhanXet.trim() || null,
      });
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      toast.success(
        r.data.passed
          ? `Đã chốt — đạt ${r.data.totalScore}/${props.maxScore}`
          : `Đã chốt — chưa đạt (${r.data.totalScore}/${props.maxScore})`,
      );
      // Điểm đã vào sổ nhưng bài học chưa lên xong: nói ra, đừng để người chấm tưởng
      // mọi thứ trọn vẹn rồi người học đi hỏi vì sao bài vẫn chưa xong.
      if (r.data.ghiTienDoLoi) {
        toast.error(
          "Điểm đã chốt, nhưng chưa đánh dấu được bài học là xong — báo kỹ thuật.",
        );
      }
      router.push("/elearning/cham-bai");
      router.refresh();
    });

  return (
    <div className="space-y-4">
      <ol className="space-y-3">
        {props.cacCau.map((c, i) => (
          <li key={c.examQuestionId} className="rounded-md border p-3 text-sm">
            <p>
              <span className="mr-2 text-xs text-muted-foreground">
                Câu {i + 1} ({c.points} điểm)
                {c.daCoDiem
                  ? " · đã chấm"
                  : c.mayKhongDocDuoc
                    ? " · hệ thống không đọc được câu này"
                    : " · chấm tay"}
              </span>
              {c.stem}
            </p>

            <p className="mt-2 whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-sm">
              {c.baiLam}
            </p>

            {c.daCoDiem ? (
              // Câu ĐÃ CÓ ĐIỂM chỉ ĐỌC. Cho sửa ở đây là mở một đường ghi đè im lặng
              // lên một con số đã chốt, và hai lượt cùng đề sẽ được chấm bằng hai thang.
              <p className="mt-2 text-xs text-muted-foreground">
                {c.score}/{c.points} điểm
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                {c.mayKhongDocDuoc ? (
                  // Nói VÌ SAO một câu trắc nghiệm lại phải chấm tay. Không nói thì
                  // người chấm tưởng màn hình hỏng, đi hỏi, và lượt đứng lại.
                  <p className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900">
                    Hệ thống không đọc được nội dung câu này nên không tự chấm được.
                    Đối chiếu với câu gốc trong kho rồi cho điểm tay.
                  </p>
                ) : null}
                <label className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Điểm (0–{c.points})</span>
                  <input
                    type="number"
                    min={0}
                    max={c.points}
                    step={1}
                    value={diem[c.examQuestionId] ?? ""}
                    onChange={(e) =>
                      setDiem((s) => ({ ...s, [c.examQuestionId]: e.target.value }))
                    }
                    className="w-24 rounded-md border px-2 py-1 text-sm"
                  />
                </label>
                <input
                  value={ghiChu[c.examQuestionId] ?? ""}
                  onChange={(e) =>
                    setGhiChu((s) => ({ ...s, [c.examQuestionId]: e.target.value }))
                  }
                  maxLength={2000}
                  placeholder="Ghi chú cho câu này (không bắt buộc)"
                  className="w-full rounded-md border px-2 py-1 text-sm"
                />
              </div>
            )}
          </li>
        ))}
      </ol>

      <div className="space-y-2 rounded-md border p-3">
        <textarea
          value={nhanXet}
          onChange={(e) => setNhanXet(e.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="Nhận xét chung cho cả bài (không bắt buộc)"
          className="w-full rounded-md border px-2 py-1 text-sm"
        />
        <p className="text-xs text-muted-foreground">
          {/* Chưa nhập ô nào mà đã hiện một con số trông như tổng thật là mời người
              chấm đọc nhầm nó thành kết quả. Nói rõ đây mới là phần đã chấm. */}
          {soDaNhap === 0
            ? `Đã chấm sẵn ${diemDaCo}/${props.maxScore} điểm — chưa nhập câu nào.`
            : `Tổng tạm tính: ${tongTam}/${props.maxScore} — đạt từ ${props.passScore}.`}
        </p>
        {vuotThang > 0 ? (
          <p className="text-xs text-red-600">
            Có {vuotThang} câu điểm vượt thang của câu.
          </p>
        ) : null}
        {soLe > 0 ? (
          // Báo ĐÚNG lý do: người gõ 2.5 cần biết thang là số nguyên, không phải
          // nghe "ngoài thang" rồi loay hoay giảm số.
          <p className="text-xs text-red-600">
            Điểm phải là số nguyên — hệ thống không nhận điểm lẻ.
          </p>
        ) : null}
        {canCham.length === 0 ? (
          // ⚠️ Không có ô nào để nhập mà nút vẫn bật là dẫn người chấm vào ngõ cụt:
          // bấm xong nhận một lỗi Zod tiếng Anh, và lượt thi không thoát được.
          <p className="text-xs text-red-600">
            Bài này không còn câu nào chờ chấm nhưng vẫn nằm trong hàng chờ — báo kỹ
            thuật, đừng chấm lại.
          </p>
        ) : null}
        {soTrong > 0 ? (
          // Nói TRƯỚC, không để họ bấm rồi mới biết: chấm dở dang không chốt được.
          <p className="text-xs text-amber-700">
            Còn {soTrong} câu chưa cho điểm — chấm đủ rồi mới chốt được.
          </p>
        ) : null}
        <button
          type="button"
          disabled={
            dangChay ||
            canCham.length === 0 ||
            soTrong > 0 ||
            vuotThang > 0 ||
            soLe > 0
          }
          onClick={chot}
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
        >
          {dangChay ? "Đang chốt…" : "Chốt điểm"}
        </button>
        <p className="text-xs text-muted-foreground">
          Chốt xong là điểm vào hồ sơ. Sửa lại cần một đường riêng có lý do — chưa mở.
        </p>
      </div>
    </div>
  );
}
