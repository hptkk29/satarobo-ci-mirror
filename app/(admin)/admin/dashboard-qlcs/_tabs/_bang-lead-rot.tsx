import Link from "next/link";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { formatDayKeyDMY, vnDayKey } from "@/lib/students/birthday-dates";
import { LEAD_CHILD_STATUS_BADGE, LEAD_CHILD_STATUS_LABEL } from "@/lib/lead/lost-status-labels";
import {
  STALE_LEVEL_BADGE,
  STALE_LEVEL_LABEL,
  type StaleLeadThresholds,
} from "@/lib/lead/stale-lead";
import type { LostLeadReport } from "@/lib/reports/lost-leads";

/**
 * C-05 — bảng **Lead rớt** + hai cột cốt lõi: *lần tiếp cận gần nhất* và *số ngày chưa
 * tiếp cận lại*.
 *
 * ⚠️ Một dòng = MỘT ĐỨA CON bị đánh dấu rớt, không phải một phiếu. Từ C-06, "rớt" là
 * trạng thái của từng con; gộp lại thành "phiếu rớt" là khai tử nhầm đứa còn đang học —
 * nên mỗi dòng còn phải hiện trạng thái của các anh chị em cùng phiếu.
 *
 * ⚠️ Không có số nào của ngưỡng cảnh báo nằm trong file này. Hai ngưỡng (vàng 2 / đỏ 7,
 * quyết định 12(a) 24/08/2026) đã thành `crm.staleLeadWarnDays` / `crm.staleLeadDangerDays`
 * trong Cấu hình vận hành, và mức của từng dòng do `lib/lead/stale-lead.ts` quyết. Ở đây
 * chỉ nhận `thresholds` để **viết ra bằng chữ** ngưỡng đang áp dụng — người xem một bảng
 * đầy chip màu mà không biết mốc là bao nhiêu thì màu chỉ là trang trí.
 */
export function BangLeadRot({
  bc,
  centerNameById,
  hienCotCoSo,
  thresholds,
  dateFromStr,
  dateToStr,
}: {
  bc: LostLeadReport;
  centerNameById: Map<string, string>;
  /** Chỉ hiện cột Cơ sở khi đang xem nhiều hơn một cơ sở. */
  hienCotCoSo: boolean;
  /** Ngưỡng ĐANG áp dụng ở phạm vi chung (để nói bằng chữ, không để tính). */
  thresholds: StaleLeadThresholds;
  dateFromStr: string;
  dateToStr: string;
}) {
  const soDo = bc.rows.filter((r) => r.clock.level === "DANGER").length;
  const soVang = bc.rows.filter((r) => r.clock.level === "WARN").length;
  const soChuaChamLanNao = bc.rows.filter((r) => r.clock.fromCreatedAt).length;

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Lead rớt</h2>
        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          C-05
        </span>
      </div>

      {/* Ba câu bắt buộc nói ra, vì không nói thì người xem sẽ tự suy ra điều sai:
          (1) một dòng là một ĐỨA CON, không phải một phiếu;
          (2) khoảng ngày lọc theo NGÀY VÀO HỆ THỐNG, không phải ngày bị đánh dấu rớt;
          (3) mốc vàng/đỏ đang là bao nhiêu. */}
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Mỗi dòng là <strong>một học sinh</strong> đã bị đánh dấu rớt (trạng thái đặt theo
        từng con), không phải một phiếu phụ huynh — phiếu có thể còn đứa khác đang học.
        Lọc theo <strong>ngày phiếu vào hệ thống</strong> ({formatDayKeyDMY(dateFromStr)} –{" "}
        {formatDayKeyDMY(dateToStr)}), cùng mẫu số với tổng lead của kỳ. Cảnh báo:{" "}
        <strong>vàng từ {thresholds.warnDays} ngày</strong> ·{" "}
        <strong>đỏ từ {thresholds.dangerDays} ngày</strong> chưa tiếp cận lại (đổi được ở
        Cấu hình vận hành, theo từng cơ sở).
      </p>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <ChipTong nhan="Học sinh rớt" so={bc.rows.length} />
        <ChipTong nhan={`Chưa tiếp cận ≥ ${thresholds.dangerDays} ngày`} so={soDo} mau="DANGER" />
        <ChipTong nhan={`Chưa tiếp cận ≥ ${thresholds.warnDays} ngày`} so={soVang} mau="WARN" />
        <ChipTong nhan="Chưa tiếp cận lần nào" so={soChuaChamLanNao} />
      </div>

      {bc.truncated ? (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Khoảng đang xem có nhiều phiếu hơn mức bảng này đọc về, nên danh sách dưới đây
          <strong> chưa đủ</strong>. Thu hẹp khoảng ngày hoặc chọn ít cơ sở hơn rồi xem
          lại — đừng dùng bảng này để kết luận &quot;đã soi hết lead rớt&quot;.
        </p>
      ) : null}

      {bc.clockTruncated ? (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Số lượt chăm sóc trong khoảng này vượt mức quét, nên một vài dòng có thể hiện
          &quot;chưa tiếp cận lần nào&quot; dù thực tế đã có. Sai lệch nghiêng về phía
          <strong> báo treo nặng hơn thực tế</strong>, không phải nhẹ hơn.
        </p>
      ) : null}

      {bc.rows.length === 0 ? (
        <p className="mt-3 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          Không có học sinh nào bị đánh dấu rớt trong khoảng đang xem. Lưu ý: rớt là trạng
          thái do người chăm <strong>tự đánh dấu</strong> (chốt spec), nên bảng trống chưa
          chắc là không có ai bỏ cuộc — có thể chỉ là chưa ai đánh dấu.
        </p>
      ) : (
        <div className="mt-3 overflow-hidden rounded-lg border border-border">
          <PhanTrangBang cuonNgang tenDonVi="học sinh" khoaGhiNho="qlcs-lead-rot">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium text-muted-foreground">
                    Học sinh rớt / phụ huynh
                  </th>
                  <th className="px-3 py-2 font-medium text-muted-foreground">Khoá quan tâm</th>
                  {hienCotCoSo ? (
                    <th className="px-3 py-2 font-medium text-muted-foreground">Cơ sở</th>
                  ) : null}
                  <th className="px-3 py-2 font-medium text-muted-foreground">Sale phụ trách</th>
                  <th className="px-3 py-2 font-medium text-muted-foreground">Vào hệ thống</th>
                  <th className="px-3 py-2 font-medium text-muted-foreground">
                    Lần tiếp cận gần nhất
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                    Chưa tiếp cận
                  </th>
                  <th className="px-3 py-2 font-medium text-muted-foreground">Lý do rớt</th>
                </tr>
              </thead>
              {/* Dòng dựng THẲNG trong `map`, không tách thành component con: phân trang
                  của `PhanTrangBang` cắt danh sách con của `<tbody>` ở phía client, và
                  fail-safe của nó bỏ phân trang khi gặp hình dạng lạ. Mọi bảng khác trong
                  repo cũng map thẳng — đi đúng đường đã chạy được thì không phải đoán. */}
              <tbody>
                {bc.rows.map((r) => (
                  <tr key={r.leadChildId} className="border-t border-border align-top">
                    <td className="px-3 py-2">
                      <Link
                        href={`/leads/${r.leadId}`}
                        className="font-medium text-foreground underline-offset-2 hover:underline"
                      >
                        {r.childName || "(chưa có tên)"}
                      </Link>
                      <p className="text-xs text-muted-foreground">PH: {r.parentName || "—"}</p>

                      {/* C-06 — trạng thái của các con CÒN LẠI. Đây là phần chống đọc
                          nhầm "cả phiếu đã rớt": phiếu còn một đứa đang học thử thì
                          phải nhìn thấy ngay ở dòng này. */}
                      {r.siblings.length > 0 ? (
                        <p className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                          <span>Cùng phiếu:</span>
                          {r.siblings.map((s) => (
                            <span key={s.leadChildId} className="inline-flex items-center gap-1">
                              <span>{s.childName || "(chưa có tên)"}</span>
                              <span
                                className={`rounded-full px-1.5 py-0.5 font-medium ${
                                  s.status
                                    ? LEAD_CHILD_STATUS_BADGE[s.status]
                                    : "bg-muted text-muted-foreground"
                                }`}
                              >
                                {s.status ? LEAD_CHILD_STATUS_LABEL[s.status] : "Chưa phân loại"}
                              </span>
                            </span>
                          ))}
                        </p>
                      ) : null}
                    </td>

                    <td className="px-3 py-2 text-muted-foreground">{r.courseName ?? "—"}</td>

                    {hienCotCoSo ? (
                      <td className="px-3 py-2 text-muted-foreground">
                        {r.centerId
                          ? (centerNameById.get(r.centerId) ?? "—")
                          : "Chưa gán cơ sở"}
                      </td>
                    ) : null}

                    <td className="px-3 py-2 text-muted-foreground">
                      {r.assignedToName ?? "Chưa phân công"}
                    </td>

                    <td className="px-3 py-2 text-muted-foreground">
                      {formatDayKeyDMY(vnDayKey(r.createdAt))}
                    </td>

                    <td className="px-3 py-2">
                      {r.clock.lastOutreachAt ? (
                        <span className="text-foreground">
                          {formatDayKeyDMY(vnDayKey(r.clock.lastOutreachAt))}
                        </span>
                      ) : (
                        // KHÔNG hiện "—" trơ: ô trống đọc thành "không có dữ liệu",
                        // trong khi sự thật là một khẳng định mạnh hơn nhiều — chưa ai
                        // chạm vào nhà này lần nào.
                        <span className="text-muted-foreground">Chưa tiếp cận lần nào</span>
                      )}
                    </td>

                    <td className="px-3 py-2 text-right">
                      <span
                        title={STALE_LEVEL_LABEL[r.clock.level]}
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          STALE_LEVEL_BADGE[r.clock.level]
                        }`}
                      >
                        {r.clock.days} ngày
                      </span>
                      {r.clock.fromCreatedAt ? (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          tính từ ngày vào hệ thống
                        </p>
                      ) : null}
                    </td>

                    <td className="max-w-[22rem] px-3 py-2 text-muted-foreground">
                      {r.lostNote ? (
                        <span className="whitespace-pre-wrap break-words">{r.lostNote}</span>
                      ) : (
                        // Lý do là ô BẮT BUỘC khi đánh dấu rớt (C-06), nên trống ở đây
                        // gần như chỉ có một nguyên nhân: con này bị đánh dấu trước khi
                        // ô đó tồn tại. Nói ra thay vì để người đọc tưởng người chăm
                        // lười ghi.
                        <span className="text-xs italic">
                          Không có (đánh dấu trước khi bắt buộc nhập lý do)
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        </div>
      )}
    </section>
  );
}

function ChipTong({
  nhan,
  so,
  mau,
}: {
  nhan: string;
  so: number;
  mau?: "WARN" | "DANGER";
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${
        mau && so > 0 ? STALE_LEVEL_BADGE[mau] : "bg-muted text-muted-foreground"
      }`}
    >
      <span>{nhan}</span>
      <strong className="tabular-nums">{so}</strong>
    </span>
  );
}
