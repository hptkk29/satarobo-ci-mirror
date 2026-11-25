import Link from "next/link";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { formatDayKeyDMY, vnDayKey } from "@/lib/students/birthday-dates";
import { formatVndPlain } from "@/lib/format/money";
import {
  formatDaysToClose,
  formatRevenueShare,
  type ConvertedLeadReport,
} from "@/lib/reports/converted-leads";

/**
 * C-03 — bảng **Lead đã chuyển đổi**, đúng 9 cột spec đòi:
 * tên KH (link) · khoá học · cơ sở · sale · giá trị · % trên tổng doanh thu ·
 * thời điểm vào hệ thống · thời điểm chốt · thời gian chốt.
 *
 * ⚠️ MỘT DÒNG = MỘT HỌC SINH. Một phụ huynh cho hai con vào học ra HAI dòng cùng tên
 * phụ huynh — người quen bảng lead cũ sẽ tưởng dữ liệu trùng, nên câu đó phải nằm ngay
 * trên đầu bảng chứ không giấu trong tài liệu.
 *
 * ⚠️ Khối `<tfoot>` KHÔNG phải trang trí. Bảng lọc dòng theo **ngày chốt** còn tiền lọc
 * theo **ngày tiền về**, nên Σ các dòng KHÔNG bằng doanh thu kỳ. Ba dòng đối soát nói ra
 * đúng phần chênh đó — trong đó dòng *"chưa quy được về học sinh"* là phần bắt buộc phải
 * hiện: bỏ nó là tổng bảng này thấp hơn tab Tài chính trên cùng màn hình mà không ai
 * giải thích được. `PhanTrangBang` chỉ cắt `<tbody>` nên bốn dòng này luôn hiện ở mọi
 * trang, kể cả trang cuối.
 *
 * C-04 — nút xuất Excel (`exportHref`) mang NGUYÊN bộ lọc đang áp dụng sang route xuất,
 * nên tệp tải về đúng bằng thứ đang nhìn. `null` = tài khoản không có quyền xuất
 * (`leads:export`, A-03) ⇒ không dựng nút; quyền che tiền/PII do route tự chấm lại, ở
 * đây không đoán hộ.
 */
export function BangLeadChuyenDoi({
  bc,
  centerNameById,
  dateFromStr,
  dateToStr,
  exportHref,
}: {
  bc: ConvertedLeadReport;
  centerNameById: Map<string, string>;
  dateFromStr: string;
  dateToStr: string;
  exportHref: string | null;
}) {
  const coTien = bc.revenue !== null;
  // 9 cột spec; bỏ 2 cột tiền khi người xem không có `payments:view`.
  const soCot = coTien ? 9 : 7;

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Lead đã chuyển đổi</h2>
        <div className="flex items-center gap-2">
          {exportHref && bc.rows.length > 0 ? (
            // <a> thuần, KHÔNG <Link>: đích là một tệp đính kèm chứ không phải một
            // trang — cho router của Next đi trước rồi mới nhận Content-Disposition là
            // thêm một lần chuyển trang thừa.
            <a
              href={exportHref}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
              title="Tải bảng này về dạng .xlsx, đúng bộ lọc đang áp dụng. Lượt tải được ghi nhật ký."
            >
              Xuất Excel
            </a>
          ) : null}
          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            C-03
          </span>
        </div>
      </div>

      {/* Ba câu bắt buộc nói ra, vì không nói thì người xem sẽ tự suy ra điều sai:
          (1) một dòng là một HỌC SINH; (2) khoảng ngày lọc theo NGÀY CHỐT (khác bảng
          lead rớt ngay dưới, vốn lọc theo ngày vào hệ thống); (3) cột giá trị là TIỀN
          ĐÃ THU trong kỳ, không phải giá trị hợp đồng đã ký. */}
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Mỗi dòng là <strong>một học sinh</strong> đã chốt (ghi danh thành học viên), không
        phải một phiếu phụ huynh — một phụ huynh cho hai con đi học sẽ ra hai dòng cùng
        tên. Lọc theo <strong>thời điểm chốt</strong> ({formatDayKeyDMY(dateFromStr)} –{" "}
        {formatDayKeyDMY(dateToStr)}).{" "}
        {coTien ? (
          <>
            Cột <strong>giá trị</strong> là <strong>tiền đã thực thu</strong> trong cùng kỳ
            (đã trừ hoàn tiền và điều chỉnh) — <em>không</em> phải giá trị hợp đồng đã ký,
            nên em vừa chốt cuối kỳ mà tiền về kỳ sau sẽ hiện <code>—</code>.
          </>
        ) : (
          <>
            Hai cột tiền đang ẩn: tài khoản của bạn không có quyền xem thanh toán.
          </>
        )}
      </p>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <Chip nhan="Học sinh đã chốt" so={String(bc.rows.length)} />
        {bc.revenue ? (
          <>
            <Chip nhan="Thực thu của các dòng trên" so={formatVndPlain(bc.revenue.rowsRevenue)} />
            <Chip
              nhan="Chưa quy được về học sinh"
              so={formatVndPlain(bc.revenue.unassignedRevenue)}
              canhBao={bc.revenue.unassignedRevenue > 0}
            />
          </>
        ) : null}
      </div>

      {bc.truncated ? (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Khoảng đang xem có nhiều học sinh chốt hơn mức bảng này đọc về, nên danh sách
          dưới đây <strong>chưa đủ</strong> và khối đối soát cuối bảng sẽ dồn phần thiếu
          vào dòng &quot;chốt ở kỳ khác&quot;. Thu hẹp khoảng ngày hoặc chọn ít cơ sở hơn
          rồi xem lại.
        </p>
      ) : null}

      {bc.revenue?.truncated ? (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Số bút toán trong khoảng này vượt mức quét, nên <strong>cột giá trị của từng
          dòng có thể thiếu</strong>. Dòng &quot;Tổng thực thu của kỳ&quot; ở cuối bảng
          vẫn đúng (nó đi đường cộng ở cơ sở dữ liệu) — hãy tin dòng đó, đừng cộng nhẩm
          các dòng trên.
        </p>
      ) : null}

      {bc.invalidDurationCount > 0 ? (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Có <strong>{bc.invalidDurationCount}</strong> học sinh có thời điểm chốt{" "}
          <strong>trước</strong> thời điểm vào hệ thống. Cột &quot;thời gian chốt&quot; của
          những dòng đó để trống thay vì hiện số âm — dữ liệu chuyển đổi cũ, không phải lỗi
          tính toán.
        </p>
      ) : null}

      {bc.rows.length === 0 ? (
        <p className="mt-3 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          Không có học sinh nào chốt trong khoảng đang xem. Lưu ý: mốc chốt theo từng con
          chỉ được ghi từ 26/08/2026 — học sinh ghi danh trước ngày đó không có mốc nào để
          rơi vào bảng này, dù tiền của họ vẫn nằm trong tổng thực thu của kỳ.
        </p>
      ) : (
        <div className="mt-3 overflow-hidden rounded-lg border border-border">
          <PhanTrangBang cuonNgang tenDonVi="học sinh" khoaGhiNho="qlcs-lead-chuyen-doi">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium text-muted-foreground">
                    Học sinh / phụ huynh
                  </th>
                  <th className="px-3 py-2 font-medium text-muted-foreground">Khoá học</th>
                  <th className="px-3 py-2 font-medium text-muted-foreground">Cơ sở</th>
                  <th className="px-3 py-2 font-medium text-muted-foreground">Sale</th>
                  {coTien ? (
                    <>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                        Giá trị (thực thu)
                      </th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                        % tổng doanh thu
                      </th>
                    </>
                  ) : null}
                  <th className="px-3 py-2 font-medium text-muted-foreground">Vào hệ thống</th>
                  <th className="px-3 py-2 font-medium text-muted-foreground">Chốt</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                    Thời gian chốt
                  </th>
                </tr>
              </thead>
              {/* Dòng dựng THẲNG trong `map`, không tách thành component con: phân trang
                  của `PhanTrangBang` cắt danh sách con của `<tbody>` ở phía client, và
                  fail-safe của nó bỏ phân trang khi gặp hình dạng lạ. */}
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
                    </td>

                    <td className="px-3 py-2 text-muted-foreground">{r.courseName ?? "—"}</td>

                    <td className="px-3 py-2 text-muted-foreground">
                      {r.centerId ? (centerNameById.get(r.centerId) ?? "—") : "Chưa gán cơ sở"}
                    </td>

                    <td className="px-3 py-2 text-muted-foreground">
                      {r.assignedToName ?? "Chưa phân công"}
                    </td>

                    {coTien ? (
                      <>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.revenue === null || r.revenue === 0 ? (
                            // KHÔNG hiện "0 đ": đọc thành "đã thu 0 đồng", trong khi sự
                            // thật thường là "tiền của em này rơi ngoài kỳ đang xem".
                            <span
                              className="text-muted-foreground"
                              title="Chưa có khoản thực thu nào của học sinh này rơi vào khoảng ngày đang xem"
                            >
                              —
                            </span>
                          ) : (
                            <span className="text-foreground">{formatVndPlain(r.revenue)}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {formatRevenueShare(r.revenueShare)}
                        </td>
                      </>
                    ) : null}

                    <td className="px-3 py-2 text-muted-foreground">
                      {formatDayKeyDMY(vnDayKey(r.enteredAt))}
                    </td>

                    <td className="px-3 py-2 text-muted-foreground">
                      {formatDayKeyDMY(vnDayKey(r.closedAt))}
                    </td>

                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {formatDaysToClose(r.daysToClose)}
                    </td>
                  </tr>
                ))}
              </tbody>

              {bc.revenue ? (
                <tfoot className="border-t-2 border-border bg-muted/40 text-xs">
                  <DongDoiSoat
                    soCot={soCot}
                    nhan="Thực thu của các học sinh trong bảng"
                    giaiThich="Cộng đúng những dòng ở trên."
                    tien={bc.revenue.rowsRevenue}
                    tong={bc.revenue.totalRevenue}
                  />
                  <DongDoiSoat
                    soCot={soCot}
                    nhan="Học sinh chốt ở kỳ khác / chưa đánh dấu chốt"
                    giaiThich="Tiền về trong kỳ này nhưng em đó chốt ở kỳ trước (trả góp, đóng theo đợt) hoặc chưa có mốc chốt."
                    tien={bc.revenue.otherChildRevenue}
                    tong={bc.revenue.totalRevenue}
                  />
                  {/* Dòng BẮT BUỘC. Đơn cũ và đơn không quy được về một đứa trẻ nào
                      (đơn combo, đơn bán học cụ) nằm ở đây. Bỏ dòng này là tổng bảng
                      thấp hơn tab Tài chính mà không ai giải thích được. */}
                  <DongDoiSoat
                    soCot={soCot}
                    nhan="Chưa quy được về học sinh"
                    giaiThich="Đơn chưa nối được về một đứa trẻ cụ thể (đơn tạo trước 24/08/2026, đơn chung nhiều con, đơn bán học cụ). Tiền là thật, chỉ chưa biết ghi cho ai."
                    tien={bc.revenue.unassignedRevenue}
                    tong={bc.revenue.totalRevenue}
                    canhBao={bc.revenue.unassignedRevenue > 0}
                  />
                  <tr className="border-t border-border font-semibold text-foreground">
                    <td className="px-3 py-2" colSpan={soCot - 2}>
                      Tổng thực thu của kỳ
                      <span className="ml-1 font-normal text-muted-foreground">
                        (phải khớp ô &quot;Doanh thu&quot; của tab Tài chính)
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatVndPlain(bc.revenue.totalRevenue)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {bc.revenue.totalRevenue > 0 ? "100,0%" : "—"}
                    </td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </PhanTrangBang>
        </div>
      )}
    </section>
  );
}

/** Một dòng của khối đối soát — nhãn + giải thích chiếm phần đầu, tiền và % ở hai ô cuối. */
function DongDoiSoat({
  soCot,
  nhan,
  giaiThich,
  tien,
  tong,
  canhBao,
}: {
  soCot: number;
  nhan: string;
  giaiThich: string;
  tien: number;
  tong: number;
  canhBao?: boolean;
}) {
  return (
    <tr className="border-t border-border align-top">
      <td className="px-3 py-2" colSpan={soCot - 2}>
        <span className={canhBao ? "font-medium text-amber-700 dark:text-amber-300" : "text-foreground"}>
          {nhan}
        </span>
        <p className="text-[11px] leading-relaxed text-muted-foreground">{giaiThich}</p>
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-foreground">
        {formatVndPlain(tien)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
        {formatRevenueShare(tong > 0 ? tien / tong : null)}
      </td>
    </tr>
  );
}

function Chip({ nhan, so, canhBao }: { nhan: string; so: string; canhBao?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${
        canhBao
          ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
          : "bg-muted text-muted-foreground"
      }`}
    >
      <span>{nhan}</span>
      <strong className="tabular-nums">{so}</strong>
    </span>
  );
}
