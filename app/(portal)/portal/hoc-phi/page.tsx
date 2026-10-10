import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getParentBilling, getPaymentMethodLabels } from "@/lib/portal/billing";
import { soTienCoDau, tongPhieuThuHienThi } from "@/lib/portal/phieu-thu";
import { SATA_ROBO_PHONE } from "@/lib/locations";
import { isPortalV2Enabled } from "@/lib/flags";
import { requireActiveStudent } from "@/lib/portal/session";
import { getStudentBilling } from "@/lib/portal/billing-student";
import { HocPhiPageV2 } from "@/components/portal/hoc-phi-page";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Học phí | Sata Robo",
  robots: { index: false },
};

// Trạng thái ghi danh (Enrollment) — nguồn R7-04, KHÔNG còn đọc Order cũ.
const ENROLLMENT_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Chờ xác nhận", cls: "bg-amber-100 text-amber-700" },
  CONFIRMED: { label: "Đã xác nhận", cls: "bg-sky-100 text-sky-700" },
  STUDYING: { label: "Đang học", cls: "bg-emerald-100 text-emerald-700" },
  ACTIVE: { label: "Đang học", cls: "bg-emerald-100 text-emerald-700" },
  PAUSED: { label: "Tạm ngưng", cls: "bg-orange-100 text-orange-700" },
  COMPLETED: { label: "Hoàn tất", cls: "bg-neutral-100 text-neutral-600" },
  WITHDREW: { label: "Đã nghỉ", cls: "bg-neutral-100 text-neutral-500" },
  TRANSFERRED: {
    label: "Đã chuyển lớp",
    cls: "bg-neutral-100 text-neutral-500",
  },
  CANCELLED: { label: "Đã huỷ", cls: "bg-neutral-100 text-neutral-500" },
};

function vnd(n: number): string {
  return n.toLocaleString("vi-VN") + "đ";
}

function fmtDate(iso: string): string {
  // Server Vercel chạy UTC → phải ép timezone VN, tránh lùi 1 ngày khung 00:00–07:00 giờ VN.
  return new Date(iso).toLocaleDateString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
  });
}

export default async function HocPhiPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "PARENT") redirect("/login");

  // Bảng nhãn phương thức: danh mục DB đè bảng cứng. Cần cho CẢ HAI đường vẽ (v1 và
  // v2).
  // ⚠️ ĐÍNH CHÍNH 06/09: ghi chú cũ viết "cờ PORTAL_V2_ENABLED mặc định OFF nên v1 vẫn là
  // thứ phụ huynh đang thấy". Mặc định trong `lib/flags.ts` đúng là OFF, nhưng Vercel
  // **Production đặt `PORTAL_V2_ENABLED="true"`** ⇒ khách hàng thật đang xem BẢN V2.
  const methodLabels = await getPaymentMethodLabels();

  // Portal v2 — trang Học phí & công nợ giống SataUI (per-child).
  if (isPortalV2Enabled()) {
    const { ctx, studentId } = await requireActiveStudent();
    const data = await getStudentBilling(studentId);
    return (
      <HocPhiPageV2
        kids={ctx.children.map((c) => ({ id: c.id, name: c.name }))}
        activeId={ctx.activeStudent?.id ?? null}
        studentName={ctx.activeStudent?.name ?? "con"}
        data={data}
        methodLabels={methodLabels}
      />
    );
  }

  const { enrollments, receipts, totals, flags } = await getParentBilling(
    session.user.id,
  );

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-neutral-900">Học phí</h1>

      {/* Tổng quan: tổng học phí / đã thanh toán / còn nợ */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-xs text-neutral-600">Tổng học phí</p>
          <p className="mt-1 text-lg font-bold text-neutral-900">
            {vnd(totals.tuition)}
          </p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-xs text-emerald-700">Đã thanh toán</p>
          <p className="mt-1 text-lg font-bold text-emerald-800">
            {vnd(totals.paid)}
          </p>
        </div>
        <div
          className={`rounded-xl border p-4 ${
            totals.outstanding > 0
              ? "border-amber-200 bg-amber-50"
              : "border-neutral-200 bg-white"
          }`}
        >
          <p
            className={`text-xs ${totals.outstanding > 0 ? "text-amber-700" : "text-neutral-500"}`}
          >
            Còn nợ
          </p>
          <p
            className={`mt-1 text-lg font-bold ${
              totals.outstanding > 0 ? "text-amber-800" : "text-neutral-900"
            }`}
          >
            {vnd(totals.outstanding)}
          </p>
        </div>
      </div>

      {totals.outstanding > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Vui lòng liên hệ trung tâm ({SATA_ROBO_PHONE.hien}) để được hướng dẫn
          thanh toán khoản còn lại.
        </div>
      )}

      {/* D5/G.6 — chỉ dấu trạng thái (KHÔNG hiển thị số tiền khoản chưa xác nhận — giữ AC1) */}
      {(flags.pendingCount > 0 || flags.rejectedCount > 0) && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800">
          {flags.pendingCount > 0 && (
            <p>
              Có <b>{flags.pendingCount}</b> khoản đang chờ kế toán xác nhận. Số
              tiền sẽ được cập nhật vào mục “Đã thanh toán” sau khi được xác
              nhận.
            </p>
          )}
          {flags.rejectedCount > 0 && (
            <p className="mt-1">
              Có <b>{flags.rejectedCount}</b> khoản bị từ chối — vui lòng liên
              hệ trung tâm ({SATA_ROBO_PHONE.hien}) để được hỗ trợ.
            </p>
          )}
        </div>
      )}

      {/* Học phí theo ghi danh */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-neutral-700">
          Theo lớp / ghi danh
        </h2>
        {enrollments.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
            Chưa có ghi danh nào.
          </p>
        ) : (
          <ul className="space-y-2">
            {enrollments.map((e) => {
              const st = ENROLLMENT_STATUS[e.status] ?? {
                label: e.status,
                cls: "bg-neutral-100 text-neutral-600",
              };
              return (
                <li
                  key={e.enrollmentId}
                  className="rounded-xl border border-neutral-200 bg-white p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-neutral-900">
                        {e.className ?? "Lớp"}
                      </p>
                      <p className="text-xs text-neutral-600">
                        {e.studentName ? `${e.studentName} · ` : ""}
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${st.cls}`}
                        >
                          {st.label}
                        </span>
                      </p>
                    </div>
                    <div className="text-right text-sm">
                      <p className="font-bold text-neutral-900">
                        {vnd(e.finalPrice)}
                      </p>
                      <p className="text-xs text-emerald-700">
                        Đã trả {vnd(e.confirmedPaid)}
                      </p>
                      {e.outstanding > 0 && (
                        <p className="text-xs font-semibold text-amber-700">
                          Còn {vnd(e.outstanding)}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Biên lai đã xác nhận */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-neutral-700">
          Biên lai đã xác nhận
        </h2>
        {receipts.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
            Chưa có biên lai nào được xác nhận.
          </p>
        ) : (
          <ul className="space-y-2">
            {receipts.map((r) =>
              r.paymentType === "ADJUSTMENT" ? (
                // Bút toán ĐIỀU CHỈNH — dòng riêng, in phần chênh lệch kèm dấu + lý do.
                <li
                  key={r.id}
                  className="ml-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-neutral-900">
                      Điều chỉnh phiếu thu
                    </p>
                    {r.lyDoDieuChinh && (
                      <p className="text-xs text-neutral-600">
                        Lý do: {r.lyDoDieuChinh}
                      </p>
                    )}
                    <p className="text-xs text-neutral-600">
                      {fmtDate(r.confirmedAt ?? r.paidDate)}
                    </p>
                  </div>
                  <p
                    className={`font-bold ${
                      r.amount < 0 ? "text-red-700" : "text-emerald-700"
                    }`}
                  >
                    {soTienCoDau(r.amount)}
                  </p>
                </li>
              ) : (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white p-4 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-neutral-900">
                      {r.receiptCode ?? "Biên lai"}
                      {r.daBiDieuChinh && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                          Đã điều chỉnh
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-neutral-600">
                      {r.studentName ? `${r.studentName} · ` : ""}
                      {methodLabels[r.method] ?? r.method} ·{" "}
                      {r.confirmedAt
                        ? fmtDate(r.confirmedAt)
                        : fmtDate(r.paidDate)}
                    </p>
                  </div>
                  {/* Số của phiếu gốc GIỮ NGUYÊN — khớp biên lai phụ huynh đang cầm. */}
                  <p className="font-bold text-emerald-700">{vnd(r.amount)}</p>
                </li>
              ),
            )}
            {/* Tổng ở CUỐI: cộng cả dòng gốc lẫn dòng điều chỉnh mới ra số đúng. */}
            <li className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-300 bg-neutral-100 p-4 text-sm">
              <p className="font-semibold text-neutral-900">Tổng đã xác nhận</p>
              <p className="font-bold text-neutral-900">
                {vnd(tongPhieuThuHienThi(receipts))}
              </p>
            </li>
          </ul>
        )}
      </section>
    </div>
  );
}
