"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { kiemTraNhapCauHoiAction, nhapCauHoiAction } from "../_actions";
import { GOI_Y_O, LIEN_KET_CHU, NHAN_O, NUT_CHINH, NUT_PHU, O_CHON } from "../../_components/ui/dieu-khien";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { MAU_THEO_LOAI, NHAN_LOAI_NHAP, TOI_DA_BYTE, TOI_DA_DONG, type LoaiNhap } from "@/lib/elearning-online/nhap-cau-hoi";
import type { XemTruocNhap } from "@/lib/elearning-online/actions";

/** Mã hoá tệp thành base64 ở trình duyệt (không thư viện): tệp ≤ ~700 KB nên cắt khúc để không tràn đối số `apply`. */
async function docBase64(f: File): Promise<string> {
  const buf = new Uint8Array(await f.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

const BUOC = ["Tải mẫu", "Tải file lên", "Kiểm tra", "Nhập vào"] as const;

/**
 * QoImport — 4 bước: tải mẫu → chọn tệp → xem kết quả kiểm theo từng dòng → nhập. Máy chủ KIỂM LẠI từ chính tệp khi nhập (không tin bản xem trước).
 * Câu hỏi không có cột nhãn đợt nên "nhãn đợt nhập" chỉ nằm ở nhật ký hệ thống (hiển thị sau khi nhập xong).
 * "Đích" (thiết kế QoImport): chọn một đề của khoá để gắn luôn các câu vừa nhập; trống = chỉ vào ngân hàng câu hỏi.
 */
export type DichNhap = { id: string; ten: string };

export function NhapCauHoiForm({ courseId, dich = [] }: { courseId: string; dich?: DichNhap[] }) {
  const router = useRouter();
  const [dangLam, chuyen] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const [tep, setTep] = useState<{ ten: string; b64: string } | null>(null);
  const [kq, setKq] = useState<XemTruocNhap | null>(null);
  const [boQuaLoi, setBoQuaLoi] = useState(true);
  const [deThiId, setDeThiId] = useState("");
  const [ganNhan, setGanNhan] = useState(true);
  const [xong, setXong] = useState<{ soDaNhap: number; soBoQua: number; soGanVaoDe: number; nhan: string | null; tenDe: string | null } | null>(null);
  const buoc = xong ? 4 : kq ? 3 : tep ? 2 : 1;

  const chonTep = async (f: File | undefined) => {
    setKq(null);
    setXong(null);
    if (!f) return setTep(null);
    if (f.size > TOI_DA_BYTE) {
      setTep(null);
      return void toast.error(`Tệp quá lớn (tối đa ${Math.round(TOI_DA_BYTE / 1000)} KB). Chia nhỏ rồi nhập lại.`);
    }
    const b64 = await docBase64(f);
    setTep({ ten: f.name, b64 });
    chuyen(async () => {
      const r = await kiemTraNhapCauHoiAction({ courseId, tepBase64: b64 });
      if (!r.ok) return void toast.error(r.error.message);
      setKq(r.data);
    });
  };

  const nhap = () => {
    if (!tep) return;
    chuyen(async () => {
      const r = await nhapCauHoiAction({ courseId, tepBase64: tep.b64, boQuaLoi, deThiId: deThiId || null, ganNhan });
      if (!r.ok) return void toast.error(r.error.message);
      setXong({ ...r.data, tenDe: dich.find((d) => d.id === deThiId)?.ten ?? null });
      toast.success(`Đã nhập ${r.data.soDaNhap} câu hỏi`);
      router.refresh();
    });
  };

  const choNhap = !!kq && !kq.loiChung && kq.hopLe > 0 && (kq.loi === 0 || boQuaLoi);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <a className={NUT_PHU} href="/api/elearning/online/mau-nhap-cau-hoi" download><Download className="size-4" aria-hidden />Tải bộ mẫu đầy đủ ({MAU_THEO_LOAI.length} dạng)</a>
        <button type="button" className={NUT_CHINH} disabled={!choNhap || dangLam || !!xong} onClick={nhap}>
          {kq ? `Nhập ${kq.hopLe} câu hợp lệ` : "Nhập câu hợp lệ"}
        </button>
      </div>

      <ol aria-label="Các bước" className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {BUOC.map((t, i) => (
          <li key={t} aria-current={buoc === i + 1 ? "step" : undefined} className={`flex items-center gap-2 ${buoc === i + 1 ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
            <span className={`grid size-6 place-items-center rounded-full border text-xs ${buoc === i + 1 ? "border-primary bg-primary text-primary-foreground" : buoc > i + 1 ? "border-primary text-primary-ink" : "border-border"}`}>{i + 1}</span>
            {t}
          </li>
        ))}
      </ol>

      <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
        <section aria-label="Nhập vào đâu" className="flex flex-col gap-4">
          <h2 className="text-base font-semibold">Nhập vào đâu</h2>
        <div>
          <label htmlFor="nch-tep" className={NHAN_O}>Tệp Excel (.xlsx)</label>
          <input
            ref={input}
            id="nch-tep"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="mt-1 block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-input file:bg-card file:px-3 file:py-2 file:text-sm"
            disabled={dangLam}
            onChange={(e) => void chonTep(e.target.files?.[0])}
          />
          <p className={GOI_Y_O}>{tep ? `Đã chọn ${tep.ten}` : "Dùng bộ mẫu ở trên; mỗi dạng một sheet."}</p>
        </div>
        <div>
          <label htmlFor="nch-dich" className={NHAN_O}>Đích</label>
          <select id="nch-dich" className={`${O_CHON} mt-1`} value={deThiId} onChange={(e) => setDeThiId(e.target.value)} disabled={dangLam || !!xong}>
            <option value="">Chỉ vào ngân hàng câu hỏi của khoá</option>
            {dich.map((d) => (
              <option key={d.id} value={d.id}>{d.ten}</option>
            ))}
          </select>
          <p className={GOI_Y_O}>Chọn một đề để gắn luôn các câu vừa nhập vào cuối đề đó.</p>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 size-4" checked={boQuaLoi} onChange={(e) => setBoQuaLoi(e.target.checked)} disabled={dangLam || !!xong} />
          <span>Bỏ qua dòng lỗi, nhập phần hợp lệ<span className={`block ${GOI_Y_O}`}>Bỏ chọn: chỉ nhập khi MỌI dòng hợp lệ.</span></span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 size-4" checked={ganNhan} onChange={(e) => setGanNhan(e.target.checked)} disabled={dangLam || !!xong} />
          <span>Gắn nhãn đợt nhập<span className={`block ${GOI_Y_O}`}>Nhãn dạng IMP-… ghi trong nhật ký hệ thống (câu hỏi không có cột nhãn).</span></span>
        </label>
        </section>
        <section aria-label="Quy tắc file" className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">Quy tắc file</h2>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-[color:var(--el-text2)]">
            <li>Mỗi dạng một sheet, dòng 1 là tiêu đề cột của mẫu.</li>
            <li>Sheet HUONG-DAN trong mẫu giải thích từng dạng; dòng 2 là ví dụ — xoá hoặc thay bằng câu của bạn.</li>
            <li>Chỉ nhận tệp .xlsx (chưa nhận .zip kèm ảnh/.sb3; ảnh của câu "chọn trên hình" ghi bằng đường dẫn https hoặc nội bộ).</li>
            <li>Tối đa {TOI_DA_DONG} câu mỗi lần; câu trùng đề bài với câu đã có trong khoá bị báo lỗi, không nhập.</li>
          </ul>
        </section>
      </div>

      {dangLam && !kq ? <p role="status" className="text-sm text-muted-foreground">Đang kiểm tra tệp…</p> : null}

      {kq?.loiChung ? <p role="alert" className="rounded-lg border border-state-danger/40 bg-state-danger-soft p-3 text-sm text-state-danger-ink">{kq.loiChung}</p> : null}

      {kq && !kq.loiChung ? (
        <section aria-label="Kết quả kiểm tra" className="rounded-xl border border-border bg-card">
          <header className="border-b border-border px-4 py-3">
            <h2 className="text-base font-semibold">Kết quả kiểm tra{tep ? ` · ${tep.ten}` : ""}</h2>
          </header>
          <dl className="grid grid-cols-3 divide-x divide-border border-b border-border text-sm">
            <div className="px-4 py-3"><dt className="text-muted-foreground">Tổng dòng</dt><dd className="text-2xl font-semibold" data-testid="nch-tong">{kq.tongDong}</dd><dd className="text-xs text-muted-foreground">{kq.sheetDaDoc.length} sheet đã đọc</dd></div>
            <div className="px-4 py-3"><dt className="text-muted-foreground">Hợp lệ</dt><dd className="text-2xl font-semibold text-state-success-ink" data-testid="nch-hop-le">{kq.hopLe}</dd></div>
            <div className="px-4 py-3"><dt className="text-muted-foreground">Lỗi</dt><dd className="text-2xl font-semibold text-state-danger-ink" data-testid="nch-loi">{kq.loi}</dd><dd className="text-xs text-muted-foreground">sửa trong file rồi tải lại, hoặc bỏ qua</dd></div>
          </dl>
          {kq.sheetRong.length > 0 ? (
            <p className="border-b border-border px-4 py-3 text-sm text-muted-foreground" role="note">Sheet không có dòng dữ liệu: {kq.sheetRong.join(" · ")}.</p>
          ) : null}
          {kq.tongDong === 0 ? (
            <p className="border-b border-border px-4 py-3 text-sm text-state-warning-ink" role="note">Tệp không có câu hỏi nào để nhập — điền từ dòng 2 của các sheet theo bộ mẫu.</p>
          ) : null}
          {kq.sheetBoQua.length > 0 ? (
            <p className="border-b border-border px-4 py-3 text-sm text-muted-foreground" role="note">Sheet không đúng tên dạng nào (bỏ qua, không nhập): {kq.sheetBoQua.join(" · ")}.</p>
          ) : null}
          {/* ≥ sm: bảng. Dưới sm: danh sách thẻ — cột "Kết quả" là thứ người dùng cần thấy nhất, không được nằm ngoài khung nhìn. */}
          <div className="hidden sm:block">
            <PhanTrangBang cuonNgang tenDonVi="dòng" soDongMacDinh={50}>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th scope="col" className="px-4 py-2 font-medium">Dòng</th>
                  <th scope="col" className="px-4 py-2 font-medium">Dạng</th>
                  <th scope="col" className="px-4 py-2 font-medium">Đề bài</th>
                  <th scope="col" className="px-4 py-2 font-medium">Kết quả</th>
                </tr>
              </thead>
              <tbody>
                {kq.chiTiet.map((d) => (
                  <tr key={`${d.sheet}-${d.dong}`} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 tabular-nums">{d.dong}</td>
                    <td className="px-4 py-2.5">{NHAN_LOAI_NHAP[d.loai as LoaiNhap] ?? d.loai}</td>
                    <td className="max-w-[28ch] truncate px-4 py-2.5">{d.deBai || "—"}</td>
                    <td className={`px-4 py-2.5 ${d.loi ? "text-state-danger-ink" : "text-state-success-ink"}`}>{d.loi ? `● ${d.loi}` : "● Hợp lệ"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </PhanTrangBang>
          </div>
          <ul aria-label="Kết quả theo dòng" className="divide-y divide-border sm:hidden">
            {kq.chiTiet.map((d) => (
              <li key={`m-${d.sheet}-${d.dong}`} className="px-4 py-3 text-sm">
                <p className="text-xs text-muted-foreground">Dòng {d.dong} · {NHAN_LOAI_NHAP[d.loai as LoaiNhap] ?? d.loai}</p>
                <p className="mt-0.5 break-words">{d.deBai || "—"}</p>
                <p className={`mt-1 ${d.loi ? "text-state-danger-ink" : "text-state-success-ink"}`}>{d.loi ? `● ${d.loi}` : "● Hợp lệ"}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {xong ? (
        <p role="status" className="rounded-lg border border-state-success/40 bg-state-success-soft p-3 text-sm text-state-success-ink">
          Đã nhập {xong.soDaNhap} câu{xong.soBoQua > 0 ? `, bỏ qua ${xong.soBoQua} dòng lỗi` : ""}.{xong.soGanVaoDe > 0 ? ` Đã gắn ${xong.soGanVaoDe} câu vào đề "${xong.tenDe ?? ""}".` : ""}{xong.nhan ? <> Nhãn đợt nhập (trong nhật ký): <code>{xong.nhan}</code>.</> : null}{" "}
          <a className={LIEN_KET_CHU} href={`/elearning/online/khoa/${courseId}?tab=kiem-tra`}>Xem ngân hàng câu hỏi</a>
        </p>
      ) : null}
    </div>
  );
}
