"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { GhiChu, Khoi } from "../../_components/ui/trang";
import { GOI_Y_O, NHAN_O, NUT_CHINH, NUT_PHU, O_NHAP } from "../../_components/ui/dieu-khien";
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
      <div>
        <button type="button" onClick={() => setMo(true)} aria-expanded={false} className={NUT_CHINH}>
          Tạo khung chấm
        </button>
      </div>
    );
  }

  return (
    <Khoi tieuDe="Tạo khung chấm">
      <div className="space-y-4 text-sm">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className={NHAN_O}>Mã khung</span>
            <input
              value={f.code}
              onChange={(e) => setF((s) => ({ ...s, code: e.target.value }))}
              maxLength={40}
              placeholder="TU-VAN-L1"
              className={`mt-1 ${O_NHAP} font-mono`}
            />
            <span className={`block ${GOI_Y_O}`}>Chữ IN HOA, số, gạch ngang.</span>
          </label>

          <label className="block">
            <span className={NHAN_O}>Tên khung</span>
            <input
              value={f.title}
              onChange={(e) => setF((s) => ({ ...s, title: e.target.value }))}
              maxLength={200}
              placeholder="Quy trình tư vấn — bậc 1"
              className={`mt-1 ${O_NHAP}`}
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3 md:max-w-md">
          <label className="block">
            <span className={NHAN_O}>Thang điểm</span>
            <input
              type="number"
              min={1}
              value={f.totalPoints}
              onChange={(e) => setF((s) => ({ ...s, totalPoints: e.target.value }))}
              className={`mt-1 ${O_NHAP}`}
            />
          </label>
          <label className="block">
            <span className={NHAN_O}>Ngưỡng đạt (điểm, không phải %)</span>
            <input
              type="number"
              min={0}
              value={f.passPoints}
              onChange={(e) => setF((s) => ({ ...s, passPoints: e.target.value }))}
              className={`mt-1 ${O_NHAP}`}
            />
          </label>
        </div>

        {nguongVuot ? (
          // Nói TRƯỚC, không đợi server từ chối rồi bắt gõ lại từ đầu.
          <GhiChu sac="danger">
            Ngưỡng đạt đang lớn hơn thang điểm — không ai qua được khung này.
          </GhiChu>
        ) : null}
        {thieuSo ? (
          <GhiChu sac="danger">Thang điểm và ngưỡng đạt phải là số nguyên.</GhiChu>
        ) : null}
        {nguongKhong ? (
          <GhiChu sac="warning">
            Ngưỡng đạt bằng 0 — mọi bài nộp đều sẽ "đạt". Nếu không cố ý thì sửa lại.
          </GhiChu>
        ) : null}

        <p className={GOI_Y_O}>
          Tổng điểm các tiêu chí phải khớp thang điểm — hệ thống kiểm lúc kích hoạt.
        </p>

        <div className="flex flex-wrap gap-2">
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
            className={NUT_CHINH}
          >
            {dangChay ? "Đang tạo…" : "Tạo khung"}
          </button>
          <button type="button" onClick={() => setMo(false)} className={NUT_PHU}>
            Thôi
          </button>
        </div>
      </div>
    </Khoi>
  );
}
