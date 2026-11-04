"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { taoKhungAction } from "../_actions";

/**
 * EL-15b — TẠO KHUNG CHẤM.
 *
 * ⚠️ Ngưỡng đạt và thang điểm nhập TUYỆT ĐỐI, không phải phần trăm — và nhãn nói
 * đúng như thế. Ô ghi "%" mà cột lưu số tuyệt đối là cách chắc chắn để một ngày nào
 * đó có người nhập 80 với ý "80%" trên thang 50.
 */
export function NewRubricForm() {
  const router = useRouter();
  const [dangChay, batDau] = useTransition();
  const [mo, setMo] = useState(false);
  const [f, setF] = useState({
    code: "",
    title: "",
    totalPoints: "100",
    passPoints: "80",
  });

  // ⚠️ Ô TRỐNG khác số 0. `Number("")` là `0`, nên xoá trắng ô "Ngưỡng đạt" rồi
  // bấm Tạo sẽ dựng một khung mà MỌI bài đều đạt — hoàn toàn im lặng, vì `0` là
  // giá trị hợp lệ với Zod (`min(0)`). Đọc ô rỗng thành `NaN` để nó rơi vào nhánh
  // "chưa nhập" thay vì nhánh "nhập số không".
  const doSo = (v: string) => (v.trim() === "" ? NaN : Number(v));
  const tong = doSo(f.totalPoints);
  const dat = doSo(f.passPoints);
  const thieuSo = !Number.isInteger(tong) || !Number.isInteger(dat);
  const nguongVuot = !thieuSo && dat > tong;
  // Ngưỡng 0 là hợp lệ về kỹ thuật nhưng gần như luôn là gõ nhầm: nó nghĩa là ai
  // nộp cũng đạt. Cảnh báo, KHÔNG chặn — có thể ai đó thật sự muốn thế.
  const nguongKhong = !thieuSo && dat === 0;

  const tao = () =>
    batDau(async () => {
      const r = await taoKhungAction({
        code: f.code.trim().toUpperCase(),
        title: f.title.trim(),
        totalPoints: tong,
        passPoints: dat,
      });
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      toast.success("Đã tạo khung — thêm tiêu chí rồi kích hoạt");
      setMo(false);
      setF({ code: "", title: "", totalPoints: "100", passPoints: "80" });
      router.push(`/elearning/khung-cham/${r.data.rubricId}`);
      router.refresh();
    });

  if (!mo) {
    return (
      <button
        type="button"
        onClick={() => setMo(true)}
        className="rounded-md border px-3 py-1.5 text-sm"
      >
        Tạo khung chấm
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border p-3 text-sm">
      <label className="block text-xs">
        <span className="text-muted-foreground">
          Mã khung (chữ IN HOA, số, gạch ngang)
        </span>
        <input
          value={f.code}
          onChange={(e) => setF((s) => ({ ...s, code: e.target.value }))}
          maxLength={40}
          placeholder="TU-VAN-L1"
          className="mt-1 w-full rounded-md border px-2 py-1 font-mono text-sm"
        />
      </label>

      <label className="block text-xs">
        <span className="text-muted-foreground">Tên khung</span>
        <input
          value={f.title}
          onChange={(e) => setF((s) => ({ ...s, title: e.target.value }))}
          maxLength={200}
          placeholder="Quy trình tư vấn — bậc 1"
          className="mt-1 w-full rounded-md border px-2 py-1 text-sm"
        />
      </label>

      <div className="flex flex-wrap gap-3">
        <label className="text-xs">
          <span className="text-muted-foreground">Thang điểm</span>
          <input
            type="number"
            min={1}
            value={f.totalPoints}
            onChange={(e) => setF((s) => ({ ...s, totalPoints: e.target.value }))}
            className="mt-1 block w-24 rounded-md border px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs">
          <span className="text-muted-foreground">Ngưỡng đạt (điểm, không phải %)</span>
          <input
            type="number"
            min={0}
            value={f.passPoints}
            onChange={(e) => setF((s) => ({ ...s, passPoints: e.target.value }))}
            className="mt-1 block w-24 rounded-md border px-2 py-1 text-sm"
          />
        </label>
      </div>

      {nguongVuot ? (
        // Nói TRƯỚC, không đợi server từ chối rồi bắt gõ lại từ đầu.
        <p className="text-xs text-red-600">
          Ngưỡng đạt đang lớn hơn thang điểm — không ai qua được khung này.
        </p>
      ) : null}
      {thieuSo ? (
        <p className="text-xs text-red-600">
          Thang điểm và ngưỡng đạt phải là số nguyên.
        </p>
      ) : null}
      {nguongKhong ? (
        <p className="text-xs text-amber-700">
          Ngưỡng đạt bằng 0 — mọi bài nộp đều sẽ "đạt". Nếu không cố ý thì sửa lại.
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Tổng điểm các tiêu chí phải khớp thang điểm — hệ thống kiểm lúc kích hoạt.
      </p>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={
            dangChay ||
            thieuSo ||
            nguongVuot ||
            f.code.trim().length < 3 ||
            f.title.trim().length < 3
          }
          onClick={tao}
          className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
        >
          {dangChay ? "Đang tạo…" : "Tạo khung"}
        </button>
        <button
          type="button"
          onClick={() => setMo(false)}
          className="rounded-md border px-3 py-1.5 text-xs"
        >
          Thôi
        </button>
      </div>
    </div>
  );
}
