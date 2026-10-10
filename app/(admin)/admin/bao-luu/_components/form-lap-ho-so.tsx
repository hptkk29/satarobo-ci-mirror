"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NHAN_LY_DO, type LyDoBaoLuu } from "@/lib/bao-luu/hoso";
import { TRAN_SO_MINH_CHUNG } from "@/lib/bao-luu/tep";
import { ngayQuayLaiVuotTran } from "@/lib/bao-luu/tran-bao-luu";
import { lapBaoLuuAction } from "../_actions";
import { TaiTepBaoLuu, type TepDaTai } from "./tai-tep-bao-luu";

// Form lập hồ sơ bảo lưu. Mọi luật (BR-xx) do SERVER kiểm và trả lại TẤT CẢ lỗi một lượt; form chỉ hiện nguyên văn.
// Khối "Sau khi duyệt" là bản xem trước THẬT: số liệu do trang server tính (hạn tối đa, lớp bị rời), không đoán ở client.

export type GhiDanhChon = { id: string; ten: string };

const LY_DO = Object.keys(NHAN_LY_DO) as LyDoBaoLuu[];

export function FormLapHoSo({
  studentId,
  tenHocVien,
  ghiDanh,
  hanToiDa,
  soThangToiDa,
  homNay,
  hanToiDaYmd,
  choPhepVuotTran,
}: {
  studentId: string;
  tenHocVien: string;
  ghiDanh: GhiDanhChon[];
  /** `dd/MM/yyyy` — ngày bắt đầu hôm nay + số tháng tối đa của cơ sở. */
  hanToiDa: string;
  soThangToiDa: number;
  /** `yyyy-MM-dd` giờ VN — chặn chọn "buổi nghỉ đầu tiên" ở tương lai ngay trên ô nhập. */
  homNay: string;
  /** `yyyy-MM-dd` — cùng hạn với `hanToiDa`, để so với ngày quay lại dự kiến. */
  hanToiDaYmd: string;
  /** Người lập có `bao-luu:exception` (Quản trị tối cao) — chỉ họ mới được vượt trần. Action kiểm lại. */
  choPhepVuotTran: boolean;
}) {
  const router = useRouter();
  const [dang, bat] = useTransition();
  const [chon, setChon] = useState<string[]>(ghiDanh.length === 1 ? [ghiDanh[0]!.id] : []);
  const [lyDo, setLyDo] = useState<LyDoBaoLuu | "">("");
  const [ghiChu, setGhiChu] = useState("");
  const [quayLai, setQuayLai] = useState("");
  const [nghiDau, setNghiDau] = useState("");
  const [vuotTranLyDo, setVuotTranLyDo] = useState("");
  const [don, setDon] = useState<TepDaTai | null>(null);
  const [minhChung, setMinhChung] = useState<TepDaTai[]>([]);
  const [loi, setLoi] = useState<string | null>(null);

  const doi = (id: string) => setChon((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  // Ngày quay lại dự kiến vượt hạn tối đa ⇒ cần đường ngoại lệ (BR-10/11). Chuỗi yyyy-MM-dd so sánh đúng theo thứ tự chữ.
  const vuotTran = ngayQuayLaiVuotTran(quayLai, hanToiDaYmd);
  const thieuLyDoVuotTran = vuotTran && choPhepVuotTran && vuotTranLyDo.trim().length < 10;

  function gui(e: React.FormEvent) {
    e.preventDefault();
    setLoi(null);
    bat(async () => {
      const r = await lapBaoLuuAction({
        studentId,
        enrollmentIds: chon,
        reasonCode: lyDo || null,
        reasonNote: ghiChu,
        expectedReturnDate: quayLai || null,
        firstAbsentDate: nghiDau || null,
        applicationFileKey: don?.key ?? null,
        evidenceFileKeys: minhChung.map((m) => m.key),
        vuotTranLyDo: vuotTran && choPhepVuotTran ? vuotTranLyDo.trim() : null,
      });
      if (!r.ok) {
        setLoi(r.error);
        return;
      }
      if (r.canhBao?.length) toast.warning(r.canhBao.join("\n"));
      toast.success("Đã lập hồ sơ — chờ Quản lý cơ sở duyệt");
      router.push(r.ids?.length === 1 ? `/bao-luu/${r.ids[0]}` : "/bao-luu?tab=cho-duyet");
    });
  }

  return (
    <form onSubmit={gui} className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Khoá bảo lưu *</legend>
        {ghiDanh.map((g) => (
          <label key={g.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
            <input type="checkbox" checked={chon.includes(g.id)} onChange={() => doi(g.id)} />
            <span>{g.ten}</span>
          </label>
        ))}
        <p className="text-xs text-muted-foreground">Mỗi khoá là MỘT hồ sơ. Chọn nhiều khoá thì lập cùng lúc — một khoá không đủ điều kiện thì không khoá nào được lập.</p>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="bl-ly-do">Lý do *</Label>
          <select
            id="bl-ly-do"
            value={lyDo}
            onChange={(e) => setLyDo(e.target.value as LyDoBaoLuu | "")}
            className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
            required
          >
            <option value="">Chọn lý do…</option>
            {LY_DO.map((k) => (
              <option key={k} value={k}>
                {NHAN_LY_DO[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bl-quay-lai">Dự kiến quay lại</Label>
          <Input id="bl-quay-lai" type="date" value={quayLai} onChange={(e) => setQuayLai(e.target.value)} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="bl-ghi-chu">Ghi chú</Label>
        <Textarea id="bl-ghi-chu" rows={3} maxLength={1000} value={ghiChu} onChange={(e) => setGhiChu(e.target.value)} placeholder="Bối cảnh cụ thể của phụ huynh…" />
      </div>

      {vuotTran && (
        <div className="space-y-1.5 rounded-lg border border-state-warning-soft bg-state-warning-soft px-3 py-2 text-sm text-state-warning-ink">
          <p>
            Ngày quay lại dự kiến vượt hạn bảo lưu tối đa (<strong className="tabular-nums">{hanToiDa}</strong>).
            {choPhepVuotTran ? " Ghi lý do ngoại lệ để vượt trần." : " Chỉ Quản trị tối cao được cho phép vượt trần — hãy chọn ngày sớm hơn hoặc nhờ họ lập hồ sơ."}
          </p>
          {choPhepVuotTran && (
            <>
              <Label htmlFor="bl-vuot-tran">Lý do vượt trần *</Label>
              <Textarea id="bl-vuot-tran" rows={2} maxLength={500} value={vuotTranLyDo} onChange={(e) => setVuotTranLyDo(e.target.value)} />
            </>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="bl-nghi-dau">Buổi nghỉ đầu tiên (nếu học viên đã nghỉ trước khi nộp đơn)</Label>
        <Input id="bl-nghi-dau" type="date" max={homNay} value={nghiDau} onChange={(e) => setNghiDau(e.target.value)} className="sm:max-w-xs" />
        <p className="text-xs text-muted-foreground">Chỉ để Quản lý cân nhắc lùi ngày bắt đầu khi duyệt; không tự lùi.</p>
      </div>

      <div className="space-y-4">
        <TaiTepBaoLuu nhan="Đơn bảo lưu đã ký" batBuoc giaTri={don} onChange={setDon} hoTro="Bắt buộc — không có đơn thì hệ thống không nhận hồ sơ." />
        <div className="space-y-2">
          {minhChung.map((m, i) => (
            <TaiTepBaoLuu key={m.key} nhan={`Minh chứng ${i + 1}`} giaTri={m} onChange={(t) => setMinhChung((a) => (t ? a.map((x, j) => (j === i ? t : x)) : a.filter((_, j) => j !== i)))} />
          ))}
          {minhChung.length < TRAN_SO_MINH_CHUNG && (
            <TaiTepBaoLuu
              key={`them-${minhChung.length}`}
              nhan={minhChung.length === 0 ? "Minh chứng (giấy khám bệnh, quyết định chuyển công tác… — tuỳ lý do)" : "Thêm minh chứng"}
              giaTri={null}
              onChange={(t) => t && setMinhChung((a) => [...a, t])}
            />
          )}
        </div>
      </div>

      <section className="rounded-xl border border-border bg-muted/40 p-4 text-sm">
        <h2 className="mb-1 font-semibold">Sau khi Quản lý duyệt</h2>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>{tenHocVien} chuyển sang <strong className="text-foreground">Tạm dừng</strong> ở khoá đã chọn và không còn trong danh sách lớp.</li>
          <li>Hạn bảo lưu tối đa <strong className="text-foreground tabular-nums">{hanToiDa}</strong> ({soThangToiDa} tháng kể từ hôm nay).</li>
          <li>Hồ sơ chưa duyệt thì học viên <strong className="text-foreground">vẫn học bình thường</strong>.</li>
        </ul>
      </section>

      {loi && (
        <p role="alert" className="whitespace-pre-line rounded-lg border border-state-danger-soft bg-state-danger-soft px-3 py-2 text-sm text-state-danger-ink">
          {loi}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={dang}>
          Quay lại
        </Button>
        <Button type="submit" disabled={dang || chon.length === 0 || !lyDo || !don || (vuotTran && (!choPhepVuotTran || thieuLyDoVuotTran))}>
          {dang && <Loader2 className="h-4 w-4 animate-spin" />}
          {dang ? "Đang lưu..." : "Lập hồ sơ"}
        </Button>
      </div>
    </form>
  );
}
