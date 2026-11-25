"use client";

// Mục "ZaloCRM" của màn Tích hợp (S7 / lô L9).
//
// Đây là chỗ DUY NHẤT người vận hành nhìn thấy sức khoẻ của trục Zalo mà không phải
// vào máy chủ. Ba thứ trên màn, xếp theo mức độ cấp bách chứ không theo thứ tự đẹp:
//   1. CẢNH BÁO nick "báo connected mà im lặng" — ca hỏng câm: khách vẫn nhắn, không
//      ai nhận, Sale kết luận là dạo này vắng khách. Đặt trên cùng, không giấu trong bảng.
//   2. Bảng nick — nick nào của cơ sở nào, ai giữ, lần cuối có tin là khi nào.
//   3. Nhật ký — câu trả lời cho "vì sao hộp thư trống" (404/401 của webhook).
//
// ⚠️ Mọi dữ liệu vào đây ĐÃ được lọc theo tầm nhìn của actor ở phía máy chủ
// (`lib/integrations/zalocrm/nick-admin.ts`). Component này KHÔNG được tự lọc thêm và
// cũng đừng tin là "vì đã lọc rồi nên hiển thị gì cũng được" — nó chỉ vẽ.

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { dongBoNickZalocrm } from "../_actions";

/**
 * Một dòng nick. `lastEventAt` là CHUỖI đã định dạng ở máy chủ — cố ý không truyền
 * `Date` xuống client để khỏi phụ thuộc múi giờ của máy người xem (mọi bảng khác trên
 * màn này cũng in bằng `toISOString`).
 */
export type ZalocrmNickRow = {
  zcrmAccountId: string;
  orgCode: string;
  /** `null` = orgCode chưa ánh xạ cơ sở nào (thiếu mục trong `zalocrm.orgCodes`). */
  centerName: string | null;
  displayName: string | null;
  /**
   * Câu tóm tắt "đang giao cho ai" — dựng ở máy chủ bằng `tomTatGiao`.
   * "Cả cơ sở dùng chung" là trạng thái BÌNH THƯỜNG, không phải lỗi.
   */
  daGiaoCho: string;
  status: string;
  lastEventAt: string | null;
};

export type ZalocrmCanhBaoRow = {
  zcrmAccountId: string;
  orgCode: string;
  displayName: string | null;
  /** `null` = CHƯA TỪNG có sự kiện nào (thường là webhook chưa cắm). */
  gioImLang: number | null;
};

export type ZalocrmLogRow = {
  id: string;
  provider: string;
  action: string;
  status: string;
  errorMessage: string | null;
  createdAt: string;
};

/**
 * Màu theo trạng thái.
 *
 * ⚠️ CHỈ 4 giá trị của enum `IntegrationStatus`. Bảng `STATUS_CLS` ở `page.tsx` còn có
 * `SENT` vì nó dùng chung cho `ZaloMessageLog` — model KHÁC. Đừng chép `SENT` sang đây
 * rồi suy ngược ra là ghi được `status: "SENT"` vào `IntegrationLog`: đó là lỗi Prisma
 * lúc CHẠY, không phải lúc build.
 */
const MAU_TRANG_THAI: Record<string, string> = {
  SUCCESS: "bg-state-success-soft text-state-success-ink",
  SKIPPED: "bg-state-warning-soft text-state-warning-ink",
  FAILED: "bg-state-danger-soft text-state-danger-ink",
  PENDING: "bg-state-info-soft text-state-info-ink",
};

const MAU_NICK: Record<string, string> = {
  CONNECTED: "bg-state-success-soft text-state-success-ink",
  DISCONNECTED: "bg-state-danger-soft text-state-danger-ink",
  UNKNOWN: "bg-muted text-muted-foreground",
};

const NHAN_NICK: Record<string, string> = {
  CONNECTED: "Đang nối",
  DISCONNECTED: "Mất kết nối",
  UNKNOWN: "Chưa rõ",
};

export function ZalocrmSection({
  enabled,
  canEdit,
  rows,
  canhBao,
  nguongGio,
  orgCodes,
  logs,
}: {
  /** Cờ `ZALOCRM_ENABLED`. Tắt ⇒ không có dữ liệu nào được nạp, chỉ hiện trạng thái. */
  enabled: boolean;
  canEdit: boolean;
  rows: ZalocrmNickRow[];
  canhBao: ZalocrmCanhBaoRow[];
  nguongGio: number;
  /** Org trong tầm của người đang xem — hiện ra để họ biết mình đang nhìn phạm vi nào. */
  orgCodes: string[];
  logs: ZalocrmLogRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function dongBo() {
    start(async () => {
      const res = await dongBoNickZalocrm({});
      if (!res.ok) {
        toast.error(res.error ?? "Lỗi");
        return;
      }
      // Có org hỏng vẫn là "đã chạy": báo bằng toast cảnh báo chứ không nuốt, vì
      // "đồng bộ xong" mà thật ra không kéo được gì là đúng kiểu hỏng câm màn này sinh ra để chặn.
      if (res.coLoi) toast.warning(res.tomTat ?? "Đồng bộ xong nhưng có cơ sở lỗi");
      else toast.success(res.tomTat ?? "Đã đồng bộ nick");
      router.refresh();
    });
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-foreground">ZaloCRM (nick Zalo cá nhân)</h2>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ enabled ? "bg-state-success-soft text-state-success-ink" : "bg-muted text-muted-foreground" }`}
          >
            {enabled ? "Đang bật" : "Đang tắt (ZALOCRM_ENABLED)"}
          </span>
          {canEdit && enabled && (
            <button
              onClick={dongBo}
              disabled={pending}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground disabled:opacity-50"
            >
              {pending ? "Đang đồng bộ…" : "Đồng bộ nick"}
            </button>
          )}
        </div>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        {enabled ? (
          <>
            Mỗi nick Zalo của nhân viên là một tài khoản bên máy chủ ZaloCRM. Bảng này chỉ là
            CẤU HÌNH — không có số điện thoại, không có nội dung tin. Bạn đang xem phạm vi:{" "}
            <b>{orgCodes.length > 0 ? orgCodes.join(", ") : "chưa có cơ sở nào được ánh xạ"}</b>.
            Ánh xạ mã cơ sở ↔ orgCode sửa ở màn <b>Cấu hình vận hành</b> (khoá{" "}
            <code>zalocrm.orgCodes</code>).
          </>
        ) : (
          <>
            Cờ <code>ZALOCRM_ENABLED</code> chưa bật ở môi trường này: trang Zalo CRM ẩn, webhook
            trả 404, và mục này không nạp dữ liệu. Bật/tắt bằng biến môi trường rồi triển khai
            lại — không sửa code.
          </>
        )}
      </p>

      {enabled && (
        <>
          {/* 1. CẢNH BÁO — đặt trên cùng, không nhét vào bảng. */}
          {canhBao.length > 0 && (
            <div className="mt-3 rounded-lg border border-state-danger-soft bg-state-danger-soft p-3">
              <p className="text-xs font-bold text-state-danger-ink">
                {canhBao.length} nick báo ĐANG NỐI nhưng không có sự kiện nào quá {nguongGio} giờ
              </p>
              <p className="mt-1 text-xs text-state-danger-ink">
                Đây là ca hỏng câm: máy chủ nói nick còn sống nên không đèn nào đỏ, nhưng tin của
                khách không về tới đây. Kiểm <code>webhook_url</code> của org bên ZaloCRM và bí mật
                HMAC trước khi kết luận là vắng khách.
              </p>
              <ul className="mt-2 space-y-1">
                {canhBao.map((c) => (
                  <li key={c.zcrmAccountId} className="text-xs text-state-danger-ink">
                    <b>{c.displayName ?? c.zcrmAccountId}</b> ({c.orgCode}) —{" "}
                    {c.gioImLang === null
                      ? "CHƯA TỪNG nhận được sự kiện nào"
                      : `im lặng ~${c.gioImLang} giờ`}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 2. BẢNG NICK */}
          <div className="mt-3 overflow-x-auto">
            <PhanTrangBang>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">orgCode</th>
                    <th className="px-3 py-2">Cơ sở</th>
                    <th className="px-3 py-2">Nick (tên hiển thị)</th>
                    <th className="px-3 py-2">Đang giao cho</th>
                    <th className="px-3 py-2">Trạng thái</th>
                    <th className="px-3 py-2">Sự kiện gần nhất</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                        Chưa có nick nào. Bấm “Đồng bộ nick” sau khi đã khai{" "}
                        <code>zalocrm.orgCodes</code> và <code>ZALOCRM_API_KEYS</code>.
                      </td>
                    </tr>
                  ) : (
                    rows.map((n) => (
                      <tr key={n.zcrmAccountId} className="border-t">
                        <td className="px-3 py-2 text-muted-foreground">{n.orgCode}</td>
                        <td className="px-3 py-2">
                          {n.centerName ?? (
                            <span className="text-state-warning-ink">chưa ánh xạ cơ sở</span>
                          )}
                        </td>
                        <td className="px-3 py-2">{n.displayName ?? "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {/* Chưa giao ai là trạng thái BÌNH THƯỜNG (nick mới) và có
                              nghĩa "cả cơ sở dùng chung" — đừng vẽ nó thành lỗi đỏ.
                              Sửa danh sách ở Cấu hình vận hành → tab Nick Zalo CRM. */}
                          {n.daGiaoCho}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs ${MAU_NICK[n.status] ?? ""}`}
                          >
                            {NHAN_NICK[n.status] ?? n.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {n.lastEventAt ?? "chưa có"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </PhanTrangBang>
          </div>

          {/* 3. NHẬT KÝ */}
          <h3 className="mt-4 text-xs font-bold text-foreground">Nhật ký gần đây</h3>
          <div className="mt-2 overflow-x-auto">
            <PhanTrangBang>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Tổ chức</th>
                    <th className="px-3 py-2">Hành động</th>
                    <th className="px-3 py-2">Trạng thái</th>
                    <th className="px-3 py-2">Ghi chú</th>
                    <th className="px-3 py-2">Thời gian</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                        Chưa có log.
                      </td>
                    </tr>
                  ) : (
                    logs.map((l) => (
                      <tr key={l.id} className="border-t">
                        <td className="px-3 py-2 text-muted-foreground">
                          {l.provider.replace(/^ZALOCRM:?/, "") || "—"}
                        </td>
                        <td className="px-3 py-2">{l.action}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs ${MAU_TRANG_THAI[l.status] ?? ""}`}
                          >
                            {l.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {l.errorMessage ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{l.createdAt}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </PhanTrangBang>
          </div>
        </>
      )}
    </section>
  );
}
