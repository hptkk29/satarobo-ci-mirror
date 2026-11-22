// Báo cáo TUÂN THỦ BUỔI DẠY theo người (QLCS · tuần / tháng): điểm danh học viên đầy đủ, nhận xét học viên đầy đủ / quá hạn / trễ,
// thiếu chấm ra. Số đến từ MỘT hàm (`tuanThuTheoNguoi` → `tiLeTuanThu`) — màn không tự đếm. KHÔNG có tiền / phạt: tỉ lệ này không dùng
// để trừ lương tự động (Q15 mở). Mẫu số ghi ngay dưới bảng để người đọc không hiểu nhầm.
import type { TuanThuTheoNguoi } from "@/lib/parttime/tuan-thu-buoi";

const pt = (x: number | null) => (x == null ? "—" : `${x}%`);

export function BangTuanThu({ ds, ten, tieuDe }: { ds: readonly TuanThuTheoNguoi[]; ten: Record<string, string>; tieuDe: string }) {
  if (ds.length === 0) return null;
  const hang = [...ds].sort((a, b) => (ten[a.userId] ?? a.userId).localeCompare(ten[b.userId] ?? b.userId, "vi"));
  return (
    <section aria-labelledby="tuan-thu" className="mb-4 rounded-xl border border-border bg-card">
      <div className="px-4 pt-3">
        <h2 id="tuan-thu" className="text-sm font-semibold text-foreground">
          {tieuDe}
        </h2>
        <p className="text-xs text-muted-foreground">Hồ sơ buổi của giáo viên đứng chính: điểm danh học viên và nhận xét học viên. Không phải căn cứ trừ tiền.</p>
      </div>
      <div className="overflow-x-auto px-4 pb-3 pt-2">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="py-1.5 pr-3 font-medium">Giáo viên</th>
              <th scope="col" className="py-1.5 pr-3 text-right font-medium">Buổi đã dạy</th>
              <th scope="col" className="py-1.5 pr-3 text-right font-medium">Điểm danh đủ</th>
              <th scope="col" className="py-1.5 pr-3 text-right font-medium">Nhận xét đủ, đúng hạn</th>
              <th scope="col" className="py-1.5 pr-3 text-right font-medium">Quá hạn</th>
              <th scope="col" className="py-1.5 pr-3 text-right font-medium">Trễ</th>
              <th scope="col" className="py-1.5 text-right font-medium">Thiếu chấm ra</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border tabular-nums">
            {hang.map((r) => (
              <tr key={r.userId}>
                <th scope="row" className="py-1.5 pr-3 text-left font-medium text-foreground">{ten[r.userId] ?? "—"}</th>
                <td className="py-1.5 pr-3 text-right">{r.buoi}</td>
                <td className={`py-1.5 pr-3 text-right ${r.diemDanh.thieu ? "text-state-warning-ink" : ""}`}>
                  {r.diemDanh.du}/{r.diemDanh.mau} · {pt(r.diemDanh.tiLe)}
                </td>
                <td className={`py-1.5 pr-3 text-right ${r.nhanXet.thieu ? "text-state-warning-ink" : ""}`}>
                  {r.nhanXet.du}/{r.nhanXet.mau} · {pt(r.nhanXet.tiLe)}
                </td>
                <td className={`py-1.5 pr-3 text-right ${r.nhanXet.quaHan ? "font-semibold text-state-danger-ink" : ""}`}>{r.nhanXet.quaHan}</td>
                <td className="py-1.5 pr-3 text-right">{r.nhanXet.tre}</td>
                <td className={`py-1.5 text-right ${r.thieuChamRa ? "text-state-warning-ink" : ""}`}>{r.thieuChamRa}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted-foreground">
          Mẫu số điểm danh: buổi đã dạy xong giờ, không huỷ, giáo viên đứng chính. Mẫu số nhận xét: những buổi đó đã tới hạn 10:00 hôm
          sau hoặc đã nhận xét xong — buổi còn trong hạn chưa tính là thiếu. Vắng / vắng có phép đã ghi vẫn là đã điểm danh.
        </p>
      </div>
    </section>
  );
}
