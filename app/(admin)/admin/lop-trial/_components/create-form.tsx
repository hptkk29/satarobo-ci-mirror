"use client";

// app/(admin)/admin/lop-trial/_components/create-form.tsx
//
// Form tạo lớp trải nghiệm — 22/09/2026: CƠ SỞ + NGÀY + KHUNG GIỜ (tên tự đặt được).
//
// ── TÊN LỚP: SỬA ĐƯỢC (đảo chốt 28/08, chủ dự án chốt lại 18/09) ──────────────────────
// Chốt cũ: "Tên lớp KHÔNG có ô nhập… Cho người gõ tên là mời hai lớp trùng tên và mời
// lệch khỏi quy ước — mà tên này đi thẳng vào phiếu gửi phụ huynh."
//
// Nay: "được sửa và tự do điều chỉnh tên lớp". Hai lo ngại cũ được xử lý, không bỏ qua:
//  · LỆCH QUY ƯỚC — ô ĐIỀN SẴN tên theo quy ước và tự cập nhật khi đổi cơ sở/khoá, MIỄN LÀ
//    người dùng chưa tự gõ. Ai không quan tâm thì bấm lưu là ra đúng tên cũ.
//  · TRÙNG TÊN — đã đo: `TrialClassV2.name` KHÔNG `@unique`, chỉ `code` mới unique. Định
//    danh thật của lớp vẫn là `code` do server cấp. Trùng tên là khó nhìn, không phá dữ
//    liệu; chặn cứng sẽ cản đúng thứ vừa được mở ra.
//
// ⚠️ Số thứ tự vẫn do SERVER cấp trong transaction. Ô nhập bày "…" ở chỗ con số để không
// hứa một số mà client không biết — client đoán số là chắc chắn có lúc đoán sai.
//
// ĐÃ GỠ Ô "KHOÁ TRẢI NGHIỆM" (chủ dự án 22/09/2026, vòng 2):
// "qlcs không biết khung giờ đó sẽ có học viên trải nghiệm nào nên cũng không biết khoá
// trải nghiệm nào". Cột `TrialClassV2.courseId` GIỮ NGUYÊN (nullable, dữ liệu cũ còn giá
// trị) — bỏ cột trên bảng có dữ liệu prod là việc của một đợt drop riêng.
//
// Giờ · phòng · giáo viên · sĩ số ĐÃ RỜI khỏi đây: chúng là thuộc tính của TỪNG BUỔI
// (một lớp là slot tái sử dụng, hai buổi khác ngày có thể khác giờ và khác người dạy).
// Chọn ba thứ đó ở khối "Thêm buổi học" trong trang chi tiết lớp.

import type { JSX } from "react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createLopTrialClassAction } from "../_actions";
import { tenLopTrialTheoNgay } from "@/lib/trial/lop-moi";
import {
  khungChoNgay,
  kiemKhungLop,
  TEN_THU,
  THU_KHOA,
  type CauHinhKhung,
} from "@/lib/trial/khung-gio-mo-lop";
import { vnWeekday } from "@/lib/time/vn";
import { CalendarDays } from "lucide-react";
import type { Option } from "../_lib/types";
import { MucForm, OKhungGio, O_NHAP, ngayVn } from "./khung-form-mo-lop";

export function CreateForm({
  centers,
  coSoCuaToi = null,
  cauHinhKhung,
  homNay,
}: {
  /** `code` để xem trước tên lớp sẽ sinh ra; thiếu thì rơi về `name`. */
  centers: (Option & { code?: string | null })[];
  /**
   * Cơ sở của CHÍNH người đang mở màn — dùng làm mặc định.
   *
   * ⚠️ Chỉ dùng khi nó CÓ trong `centers`. Người Hội sở có `centerId` trỏ tới bản ghi
   * `Center("hoi-so")` vốn là bản ghi MỒ CÔI (xem CLAUDE.md), và `getCenterOptions` cố ý
   * không bày nó ra — đặt mặc định bằng một id không có trong danh sách thì ô select rơi
   * về rỗng và người dùng thấy "Cơ sở *" trống trơn.
   */
  coSoCuaToi?: string | null;
  /**
   * Bảy khoá `trial.khungGio.<thu>` đã đọc sẵn ở server.
   *
   * Truyền xuống thay vì đóng cứng trong client: ô chọn khung phải bày ĐÚNG thứ server
   * sẽ nhận, nếu không thì người dùng chọn xong mới bị từ chối — ô chọn hứa một việc
   * không làm được (luật 12).
   */
  cauHinhKhung: CauHinhKhung;
  /** Hôm nay theo lịch VN, dạng "YYYY-MM-DD" — server tính, client không đọc đồng hồ máy. */
  homNay: string;
}): JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [centerId, setCenterId] = useState(
    () =>
      (coSoCuaToi && centers.some((c) => c.id === coSoCuaToi) ? coSoCuaToi : centers[0]?.id) ?? "",
  );
  /**
   * Tên lớp người dùng tự gõ. `null` = CHƯA gõ ⇒ ô hiện tên theo quy ước và tự đổi theo
   * cơ sở. Vừa gõ một chữ là chuyển sang "của người dùng" và thôi tự đổi — nếu không
   * thì đổi cơ sở sẽ xoá mất tên họ vừa đặt.
   */
  const [tenTuGo, setTenTuGo] = useState<string | null>(null);

  // ── NGÀY + KHUNG GIỜ (22/09/2026) ──────────────────────────────────────────────────
  const [ngay, setNgay] = useState(homNay);

  // `new Date("YYYY-MM-DD")` ra nửa đêm UTC; `vnWeekday` cộng +7 rồi đọc ngày ⇒ vẫn đúng
  // thứ VN. Đừng đổi sang `getDay()`: hàm đó đọc múi giờ MÁY NGƯỜI DÙNG.
  const mocNgay = ngay ? new Date(`${ngay}T00:00:00.000Z`) : null;
  const docKhung = mocNgay ? khungChoNgay(mocNgay, cauHinhKhung) : null;
  const khungHopLe = docKhung?.ok ? docKhung.giaTri : [];
  const tenThu = mocNgay ? (TEN_THU[THU_KHOA[vnWeekday(mocNgay)]!] ?? "") : "";

  // Khung đang chọn — mặc định khung cấu hình ĐẦU TIÊN của ngày đó, gõ tự do được
  // (chủ dự án 23/09: "khung giờ làm tuỳ chọn linh hoạt"). `gio = null` = chưa sửa.
  //
  // ⚠️ Bản trước lặng lẽ THAY giờ không hợp lệ bằng khung đầu tiên: người dùng gõ một đằng,
  // lớp tạo ra một nẻo. Nay giữ nguyên giờ đã gõ và NÓI lý do (`loiGio`), nút tạo khoá.
  const [gio, setGio] = useState<{ startTime: string; endTime: string } | null>(null);
  const gioChon = gio ?? khungHopLe[0] ?? { startTime: "", endTime: "" };
  const kiemGio =
    khungHopLe.length > 0 && gioChon.startTime && gioChon.endTime
      ? kiemKhungLop({
          khungHopLe,
          startTime: gioChon.startTime,
          endTime: gioChon.endTime,
          tenThu: tenThu || "Ngày này",
        })
      : null;
  const khungDung = kiemGio?.ok ? gioChon : null;
  const loiGio =
    khungHopLe.length === 0
      ? null
      : !gioChon.startTime || !gioChon.endTime
        ? "Nhập đủ giờ bắt đầu và giờ kết thúc."
        : kiemGio && !kiemGio.ok
          ? kiemGio.loi
          : null;

  const center = centers.find((c) => c.id === centerId);
  // Chỉ XEM TRƯỚC phần mã cơ sở: số thứ tự do server cấp trong transaction
  // (cùng bộ đếm với mã lớp), client đoán số là chắc chắn có lúc đoán sai.
  // Tên xem trước KHÔNG còn mang mã khoá (`CS1-Lớp trial …` thay vì `CS1-sata4-Lớp trial …`):
  // ô chọn khoá đã gỡ theo chốt 22/09 vòng 2 — xem lý do ở khối chú thích đầu tệp.
  // 23/09 — tên theo NGÀY ("CS1-Lớp trial 23/09/2026"), đúng chuỗi server sẽ sinh
  // (`createTrialClass` → `tenLopTrialTheoNgay`). Chưa chọn ngày thì chưa có tên.
  const xemTruocTen = center && ngay ? tenLopTrialTheoNgay(center.code ?? center.name, null, ngay) : "";

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!centerId) {
      toast.error("Chọn cơ sở");
      return;
    }
    if (!ngay) {
      toast.error("Chọn ngày mở lớp");
      return;
    }
    if (!khungDung) {
      toast.error(
        loiGio ??
          (docKhung && !docKhung.ok
            ? docKhung.loi
            : `${tenThu} không mở lớp trải nghiệm — chọn ngày khác hoặc sửa ở Cấu hình vận hành`),
      );
      return;
    }
    startTransition(async () => {
      const res = await createLopTrialClassAction({
        centerId,
        // Chỉ gửi khi người dùng THỰC SỰ gõ. Gửi cả tên xem-trước là gửi lên một chuỗi
        // có dấu "…" ở chỗ con số — server sẽ lưu nguyên cái dấu đó vào tên lớp.
        name: tenTuGo?.trim() ? tenTuGo.trim() : undefined,
        date: ngay,
        startTime: khungDung.startTime,
        endTime: khungDung.endTime,
      });
      if (res.ok) {
        toast.success("Đã tạo lớp trải nghiệm");
        router.push(res.id ? `/lop-trial/${res.id}` : "/lop-trial");
        router.refresh();
        return;
      }
      toast.error(res.error);
    });
  }

  const coSoDangChon = centers.find((c) => c.id === centerId);

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start 2xl:grid-cols-[minmax(0,1fr)_24rem]"
    >
      <div className="min-w-0 divide-y divide-border rounded-xl border border-border bg-card">
        <MucForm tieuDe="Cơ sở" moTa="Lớp thuộc cơ sở nào — Sale của cơ sở đó sẽ thấy lớp.">
          <select
            value={centerId}
            onChange={(e) => setCenterId(e.target.value)}
            disabled={pending}
            required
            aria-label="Cơ sở"
            className={`${O_NHAP} w-full max-w-sm`}
          >
            {centers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </MucForm>

        {/* ── NGÀY + KHUNG GIỜ (22/09/2026) ────────────────────────────────────────────
            Chủ dự án: "Tạo lớp Trial theo ngày, thứ, và khung thời gian có GV đi làm".
            Các khung dựng từ CHÍNH cấu hình mà server sẽ kiểm, nên không bao giờ bày ra
            một khung rồi bị server từ chối. */}
        <MucForm
          tieuDe="Ngày & khung giờ"
          moTa="Gõ giờ tuỳ ý trong giờ mở của thứ đó, hoặc bấm một khung gợi ý. Sale thêm case chỉ chọn được giờ nằm trong khung lớp."
        >
          <label className="flex max-w-xs flex-col gap-1 text-xs text-muted-foreground">
            <span>
              Ngày mở lớp{tenThu ? <span className="text-foreground"> · {tenThu}</span> : null}
            </span>
            <input
              type="date"
              value={ngay}
              onChange={(e) => {
                setNgay(e.target.value);
                // Đổi ngày ⇒ bỏ khung đã chọn: khung của thứ 3 không có nghĩa gì ở thứ 7, và
                // giữ lại là để người dùng lưu một khung mà server sẽ từ chối.
                setGio(null);
              }}
              disabled={pending}
              required
              aria-label="Ngày mở lớp"
              className={O_NHAP}
            />
          </label>

          {khungHopLe.length > 0 ? (
            <OKhungGio
              startTime={gioChon.startTime}
              endTime={gioChon.endTime}
              goiY={khungHopLe}
              onDoi={setGio}
              disabled={pending}
              loi={loiGio}
              nhan="của lớp"
            />
          ) : (
            <p
              role="alert"
              className="rounded-lg bg-state-warning-soft px-3 py-2 text-xs text-state-warning-ink"
            >
              {docKhung && !docKhung.ok
                ? docKhung.loi
                : `${tenThu || "Ngày này"} không mở lớp trải nghiệm. Chọn ngày khác, hoặc sửa khung giờ của thứ này ở Cấu hình vận hành → tab "Lớp & giáo viên".`}
            </p>
          )}
        </MucForm>

        <MucForm
          tieuDe="Tên lớp"
          moTa="Không bắt buộc. Để nguyên là hệ thống đặt theo cơ sở + ngày lớp."
        >
          <input
            type="text"
            value={tenTuGo ?? xemTruocTen}
            onChange={(e) => setTenTuGo(e.target.value)}
            maxLength={120}
            disabled={pending}
            placeholder="Để trống để hệ thống tự đặt theo quy ước"
            aria-label="Tên lớp"
            className={`${O_NHAP} w-full max-w-md`}
          />
          <p className="text-xs text-muted-foreground">
            {tenTuGo === null ? (
              <>
                Đang theo quy ước <strong className="font-semibold">Cơ sở-Lớp trial ngày</strong>.
              </>
            ) : (
              <>
                Bạn đang tự đặt tên.{" "}
                <button
                  type="button"
                  onClick={() => setTenTuGo(null)}
                  className="font-medium text-primary underline underline-offset-2 hover:no-underline"
                >
                  Dùng lại tên theo quy ước
                </button>
              </>
            )}
          </p>
        </MucForm>
      </div>

      {/* ── Xem trước + nút tạo. Đứng yên khi cuộn ở màn rộng: đây là chỗ quyết định. */}
      <aside className="space-y-4 rounded-xl border border-border bg-card p-5 lg:sticky lg:top-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden />
          Sẽ tạo
        </div>
        <dl aria-live="polite" className="space-y-2.5 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Lớp</dt>
            <dd className="break-words font-medium text-foreground">
              {tenTuGo?.trim() || (xemTruocTen || "—")}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Ngày</dt>
            <dd className="font-medium text-foreground tabular-nums">
              {ngay ? `${tenThu ? `${tenThu}, ` : ""}${ngayVn(ngay)}` : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Khung giờ</dt>
            <dd className="font-medium text-foreground tabular-nums">
              {khungDung
                ? `${khungDung.startTime}–${khungDung.endTime}`
                : khungHopLe.length === 0
                  ? "Ngày này không mở lớp"
                  : "Giờ chưa hợp lệ"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Cơ sở</dt>
            <dd className="break-words font-medium text-foreground">{coSoDangChon?.name ?? "—"}</dd>
          </div>
        </dl>

        <button
          type="submit"
          disabled={pending || !khungDung}
          className="h-10 w-full rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors duration-150 hover:bg-primary-dark pointer-coarse:h-11 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Đang tạo…" : "Tạo lớp"}
        </button>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Tạo xong, Sale vào lớp để thêm <strong className="font-semibold">case</strong> (giờ,
          phòng, giáo viên) trong khung giờ này.
        </p>
      </aside>
    </form>
  );
}
