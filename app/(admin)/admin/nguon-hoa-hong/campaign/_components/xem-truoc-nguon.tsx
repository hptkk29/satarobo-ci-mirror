// app/(admin)/admin/nguon-hoa-hong/campaign/_components/xem-truoc-nguon.tsx — «XEM TRƯỚC NGUỒN»: chọn một đối tác → hiện nguồn khách mà campaign này sẽ gán cho họ và BẬC QUYẾT ĐỊNH.
//
// Đây là bằng chứng cho cấu hình quy nguồn: thiếu cấu hình thì hiện «Cần xem tay» KÈM LÝ DO — không bao giờ rơi về nguồn «không xác định». Kết quả do `giaiNguonCuaDoiTac` (hàm THẬT của lib/affiliate/giai-nguon.ts)
// tính trong `docXemTruocNguon`; màn này chỉ VẼ, không có thứ tự ưu tiên thứ hai.
//
// Server component thuần, KHÔNG JS: form GET đẩy `?xemTruoc=<id>` lên URL (chia sẻ link / F5 / nút Back đều đúng), page đọc rồi dựng lại. Không `useEffect`, không Server Action — xem trước chỉ ĐỌC.
// Ô chọn đối tác chỉ có tên · mã · loại (không SĐT / email).
import { Eye, TriangleAlert } from "lucide-react";
import { BTN_OUTLINE, FIELD, NHAN_O } from "@/components/admin/nguon-hoa-hong/classes";
import { NHAN_TRANG_THAI_MEMBERSHIP } from "@/lib/affiliate/ghi-membership-dau-vao";
import { NHAN_TU_DAU } from "@/lib/affiliate/giai-nguon";
import type { DoiTacChonView, XemTruocView } from "@/lib/affiliate/ghi-campaign-dau-vao";

export function XemTruocNguon({
  action,
  giu,
  doiTac,
  conNua,
  dangChon,
  ketQua,
}: {
  /** Địa chỉ trang chi tiết (form GET gửi về chính nó). */
  action: string;
  /** Tham số URL khác cần giữ khi gửi form (bộ lọc thành viên, trang). */
  giu: Readonly<Record<string, string | null>>;
  doiTac: readonly DoiTacChonView[];
  conNua: boolean;
  /** `?xemTruoc=` hiện tại. */
  dangChon: string | null;
  /** null = chưa chọn / không tìm thấy đối tác. */
  ketQua: XemTruocView | null;
}) {
  return (
    <div>
      <form method="get" action={`${action}#xem-truoc-nguon`} aria-label="Xem trước nguồn của một đối tác" className="flex flex-wrap items-end gap-3">
        {Object.entries(giu).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
        <div className="min-w-0 flex-1 sm:max-w-md">
          <label htmlFor="xem-truoc-doi-tac" className={NHAN_O}>
            Đối tác muốn thử
          </label>
          <select id="xem-truoc-doi-tac" name="xemTruoc" defaultValue={dangChon ?? ""} disabled={doiTac.length === 0} className={FIELD}>
            <option value="">{doiTac.length === 0 ? "— Chưa có đối tác nào đang hoạt động —" : "— Chọn đối tác —"}</option>
            {doiTac.map((d) => (
              <option key={d.id} value={d.id}>
                {d.ten} ({d.code}){d.loai ? ` · ${d.loai}` : ""}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={doiTac.length === 0} className={BTN_OUTLINE}>
          <Eye aria-hidden className="h-4 w-4" />
          Xem trước
        </button>
        {conNua && <p className="basis-full text-sm text-muted-foreground">Danh sách chỉ hiện {doiTac.length} đối tác đầu theo tên.</p>}
      </form>

      {dangChon && !ketQua && (
        <p role="status" className="mt-3 rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
          Không tìm thấy đối tác này (có thể đã bị xoá hoặc không còn hoạt động). Chọn lại ở ô trên.
        </p>
      )}

      {ketQua && (
        <div role="status" aria-label="Kết quả xem trước nguồn" className="mt-3 rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">
            Đối tác <b className="text-foreground">{ketQua.doiTac.ten}</b> ({ketQua.doiTac.code})
            {ketQua.doiTac.loai ? ` · loại ${ketQua.doiTac.loai}` : " · chưa có loại"}
            {ketQua.doiTac.nhan.length > 0 ? ` · nhãn ${ketQua.doiTac.nhan.join(", ")}` : " · chưa có nhãn"}
            {ketQua.doiTac.trongCampaign === null
              ? " · chưa là thành viên campaign này."
              : ` · trong campaign: ${NHAN_TRANG_THAI_MEMBERSHIP[ketQua.doiTac.trongCampaign].toLowerCase()}.`}
          </p>
          {ketQua.ketQua.loai === "NGUON" ? (
            <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
              <dt className="text-muted-foreground">Nguồn sẽ được gán</dt>
              <dd className="font-medium text-foreground">
                {ketQua.ketQua.nguon ? (
                  <>
                    {ketQua.ketQua.nguon.ten} <span className="font-mono text-xs font-normal text-muted-foreground">{ketQua.ketQua.nguon.code}</span>
                  </>
                ) : (
                  "Nguồn không còn tồn tại"
                )}
              </dd>
              <dt className="text-muted-foreground">Quyết định bởi</dt>
              <dd className="text-foreground">{NHAN_TU_DAU[ketQua.ketQua.tu]}</dd>
              {ketQua.ketQua.canhBao && (
                <>
                  <dt className="text-muted-foreground">Cảnh báo</dt>
                  <dd className="flex items-start gap-1.5 text-state-warning-ink">
                    <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{ketQua.ketQua.canhBao}</span>
                  </dd>
                </>
              )}
            </dl>
          ) : (
            <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
              <dt className="text-muted-foreground">Kết quả</dt>
              <dd className="font-medium text-state-warning-ink">Cần xem tay</dd>
              <dt className="text-muted-foreground">Vì sao</dt>
              <dd className="text-foreground">{ketQua.ketQua.lyDo}</dd>
              <dt className="text-muted-foreground">Hệ quả</dt>
              <dd className="text-foreground">Theo luật quy nguồn, trường hợp này không được gán nguồn tự động: khách chờ người có quyền xem tay và chọn nguồn. Thêm quy tắc hoặc nguồn mặc định để hết chờ.</dd>
            </dl>
          )}
        </div>
      )}
    </div>
  );
}
