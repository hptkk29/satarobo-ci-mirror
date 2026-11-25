// Bảng MÔ PHỎNG "trước / sau" của một phiên bản chính sách (S7). Chỉ TRÌNH BÀY kết quả server đã tính (`KetQuaMoPhongChinhSach`) — không tính thuế ở đây,
// không import `chinh-sach-mo-phong.ts` (có `node:crypto`): chỉ `import type`. Số tiền mẫu là MINH HOẠ, nói thẳng điều đó trên màn.

import { InfoTip } from "@/components/admin/ui/help-hint";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { huongDan } from "@/lib/finance/hoa-don/huong-dan";
import type { KetQuaMoPhongChinhSach, KetQuaMotMau } from "@/lib/finance/hoa-don/chinh-sach-mo-phong";
import { CHU_PILL } from "../../_components/mau-pill";
import { ddmmyyyy } from "./chinh-sach-nhap";

export const tienDong = (n: number): string => `${new Intl.NumberFormat("vi-VN").format(n)}đ`;

/** `SUAT:8` → "8%"; `KCT`/`KKKNT` giữ nguyên (khoá nhóm của engine). */
export const nhanNhomThue = (khoa: string): string => (khoa.startsWith("SUAT:") ? `${khoa.slice(5)}%` : khoa === "" ? "—" : khoa);

const LOI_NGAN: Record<string, string> = {
  KHONG_CO: "Chưa có quy tắc cho loại khoản này",
  CHONG_HIEU_LUC: "Có hai quy tắc chồng nhau",
};

function Cot({ kq }: { kq: KetQuaMotMau }) {
  if (!kq.ok) {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="font-medium text-state-danger-ink">{LOI_NGAN[kq.ma] ?? "Không tính được"}</span>
        <span className="text-xs text-muted-foreground">{kq.thongDiep}</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      <span className="tabular-nums">
        Thuế <b>{tienDong(kq.tienThue)}</b> · mức {nhanNhomThue(kq.nhomThue)}
      </span>
      <span className="text-xs tabular-nums text-muted-foreground">
        Trước thuế {tienDong(kq.thanhTienTruocThue)} · Tổng {tienDong(kq.congTien)}
      </span>
      {kq.canhBao.map((c) => (
        <span key={c} className="text-xs text-state-warning-ink">
          {c}
        </span>
      ))}
    </div>
  );
}

export function MoPhongBang({ ketQua }: { ketQua: KetQuaMoPhongChinhSach }) {
  const chenh = ketQua.chenhLechThue;
  return (
    <section aria-label="Mô phỏng trước và sau" className="flex flex-col gap-2">
      <h4 className="flex items-center gap-1 text-sm font-semibold">
        Mô phỏng trước / sau
        <InfoTip>{huongDan("mo-phong-chinh-sach")}</InfoTip>
      </h4>
      <p className="text-xs text-muted-foreground">
        Tính cho ngày {ddmmyyyy(ketQua.ngay)} (ngày bắt đầu hiệu lực) trên khoản mẫu — <b>không phải hoá đơn thật</b>. “Trước” là chính sách đang hiệu lực, “Sau” là phiên bản này.
      </p>
      <p className="text-sm" role="status">
        {ketQua.soMauDoiKetQua === 0 ? (
          <>Không khoản mẫu nào đổi kết quả.</>
        ) : (
          <>
            <b>{ketQua.soMauDoiKetQua}</b>/{ketQua.soMau} khoản mẫu đổi kết quả
            {chenh === null ? "" : chenh === 0 ? ", tổng thuế không đổi" : `, tổng thuế ${chenh > 0 ? "tăng" : "giảm"} ${tienDong(Math.abs(chenh))}`}.
          </>
        )}{" "}
        {ketQua.soMauSauLoi > 0 ? (
          <span className="text-state-danger-ink">{ketQua.soMauSauLoi} khoản mẫu sẽ KHÔNG còn quy tắc nào áp được — hoá đơn loại này sẽ phải chờ người quyết.</span>
        ) : null}
      </p>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Khoản mẫu
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Trước
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Sau
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Kết quả
              </th>
            </tr>
          </thead>
          <tbody>
            {ketQua.dong.map((d) => (
              <tr key={d.mau.ma} className="border-t border-border align-top">
                <td className="px-3 py-2">
                  <div className="font-medium">{d.mau.loaiKhoan}</div>
                  <div className="text-xs tabular-nums text-muted-foreground">
                    {d.mau.tenGoc} · {tienDong(d.mau.soTien)}
                    {d.mau.soBuoi ? ` · ${d.mau.soBuoi} buổi` : ""}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <Cot kq={d.truoc} />
                </td>
                <td className="px-3 py-2">
                  <Cot kq={d.sau} />
                </td>
                <td className="px-3 py-2">
                  <StatusPill tone={d.doi ? "warning" : "muted"} className={d.doi ? CHU_PILL.warning : undefined}>
                    {d.doi ? "Đổi" : "Giữ nguyên"}
                  </StatusPill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
