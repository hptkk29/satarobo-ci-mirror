"use client";

// Trình sửa tham số vận hành — bản TAB NGANG (13/09/2026).
//
// ── BẢN CŨ SAI Ở ĐÂU ─────────────────────────────────────────────────────────────────────
// Một danh sách dọc 86 ô, gom theo `group` của mã nguồn, mỗi ô là một `<textarea>` JSON kèm
// tên khoá kiểu `cron.renewalReminderMinDays`. Người dùng trang này là quản trị hệ thống của
// trung tâm — họ không biết "cron" là gì, không biết `5` phải gõ trần còn `"616899"` phải có
// nháy kép, và phải cuộn qua 80 dòng không liên quan để tới thứ mình cần.
//
// Hệ quả không phải "xấu": tham số mà người có quyền đổi không hiểu nghĩa thì hoặc không ai
// đụng tới, hoặc bị đổi sai. Một trang cấu hình không dùng được cũng bằng không có.
//
// ── BẢN NÀY ──────────────────────────────────────────────────────────────────────────────
// · Chia tab theo CÔNG VIỆC (`lib/settings/nhan-van-hanh.ts`), không theo module mã nguồn.
// · Mỗi dòng: tên viết như một câu nói + một câu "đổi cái này thì chuyện gì xảy ra" + đơn vị.
// · Ô nhập theo ĐÚNG KIỂU giá trị: bật/tắt ra công tắc, số ra ô số, chữ ra ô chữ. Chỉ những
//   giá trị thật sự phức tạp (danh sách, bảng) mới còn ô JSON — và có dòng nhắc riêng.
// · Tên khoá kỹ thuật KHÔNG hiện mặc định; nằm trong mục "Chi tiết kỹ thuật" gấp lại, vì khi
//   có sự cố thì đó là thứ duy nhất tra được trong nhật ký kiểm toán.
//
// ── MỘT THỨ CỐ Ý GIỮ ─────────────────────────────────────────────────────────────────────
// Lưu TỪNG Ô một, mỗi lần một lý do — không gom "Lưu tất cả". Mỗi dòng nhật ký kiểm toán phải
// trả lời được "ai đổi cái gì, vì sao"; gom 20 ô vào một lý do là mất hẳn câu trả lời đó.
//
// ── ĐỢT RÀ BỐ CỤC 13/09 (đo thật trên Chromium, 14 bề ngang 320→7680) ────────────────────
// Ba lỗi đo được, không phải cảm giác:
//  1. Khối nội dung `max-w-4xl` KHÔNG căn giữa ⇒ ở 4K bỏ trống 2688px bên phải, ở 8K là
//     6528px. Trang thành một dải hẹp dính mép trái.
//  2. Thanh tab kiểu gạch chân cuộn ngang: 11 nhãn đầy đủ cần ~1553px nên bị cắt ngay từ
//     896px — kể cả trên màn 1440 tab đầu vẫn cụt giữa chữ, và không có dấu hiệu nào cho biết
//     còn tab bên trái.
//  3. 86 ô "Lý do thay đổi" hiện thường trực dù chưa ai đổi gì — 86 hộp chữ chết chiếm chỗ.
// Vá: khối căn giữa + nới trần theo bậc màn · tab đổi sang dạng viên thuốc TỰ XUỐNG HÀNG
// (thấy đủ 11 tab, không cuộn ngầm) · ô lý do chỉ hiện khi dòng đó THẬT SỰ có thay đổi.

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { NhanVanHanh } from "@/lib/settings/nhan-van-hanh";
import { saveGlobalSettingAction } from "../actions";
import { CaiRiengTheoCoSo, type CoSoCauHinh } from "./cai-rieng-theo-co-so";

export type SettingRowView = {
  key: string;
  value: unknown;
  nhan: NhanVanHanh;
  /**
   * PHIÊN H — danh sách cơ sở kèm giá trị cài riêng, CHỈ có ở khoá `centerOverridable`.
   *
   * Bỏ trống ⇒ khoá này chỉ cấu hình ở cấp toàn hệ, và khối cài riêng không được vẽ. Đó
   * không phải chuyện gọn mắt: `setCenterSetting` từ chối thẳng khoá không cho cài riêng,
   * nên một khối hiện ra ở đó là một khối mà mọi lần bấm đều báo lỗi (luật 12).
   */
  coSo?: readonly CoSoCauHinh[];
};

/**
 * Nới vùng bấm của công tắc lên chuẩn 44px mà KHÔNG phóng to nó trên hình.
 *
 * Công tắc shadcn cao 20px — bấm trúng bằng ngón tay là chuyện may rủi, và PRODUCT.md đặt sàn
 * 44px. Phóng to thật thì phá mật độ của cả trang; nới bằng lớp phủ trong suốt thì vùng bấm
 * đúng chuẩn còn hình thì giữ nguyên. Đây là đúng cách repo đã dùng cho hàng bảng (luật 12).
 */
const VUNG_BAM_RONG =
  "relative after:absolute after:-inset-x-3 after:-inset-y-3 after:content-['']";

/** Kiểu ô nhập suy từ GIÁ TRỊ, không cần đưa schema Zod qua ranh giới client. */
type KieuO = "batTat" | "so" | "chu" | "chon" | "phucTap";

/**
 * Kiểu ô của một dòng.
 *
 * ⚠️ `chon` suy từ NHÃN, không từ giá trị — và đó là điểm cốt yếu. Giá trị của
 * `billing.siblingTarget` là một chuỗi, nên `kieuCuaGiaTri` xếp nó vào `chu` và vẽ ô chữ
 * TRẮNG: quản lý phải tự gõ `HOC_PHI_THAP_HON`, gõ sai thì máy chủ trả một câu lỗi kỹ
 * thuật. Chỉ có tầng nhãn (`lib/settings/nhan-van-hanh.ts`) biết danh sách hợp lệ, vì
 * schema Zod là thứ của máy chủ và không nên kéo qua ranh giới client (F3 · 22/09/2026).
 */
function kieuCuaDong(row: SettingRowView): KieuO {
  if (row.nhan.chon && row.nhan.chon.length > 0) return "chon";
  return kieuCuaGiaTri(row.value);
}

function kieuCuaGiaTri(v: unknown): KieuO {
  if (typeof v === "boolean") return "batTat";
  if (typeof v === "number") return "so";
  if (typeof v === "string") return "chu";
  return "phucTap";
}

function HangCauHinh({
  row,
  choSua,
  choSuaCoSo,
}: {
  row: SettingRowView;
  choSua: boolean;
  choSuaCoSo: boolean;
}) {
  const kieu = kieuCuaDong(row);
  const [thoNhap, setThoNhap] = useState(() =>
    kieu === "phucTap" ? JSON.stringify(row.value, null, 2) : String(row.value ?? ""),
  );
  const [bat, setBat] = useState(() => row.value === true);
  const [lyDo, setLyDo] = useState("");
  const [dangLuu, batDauLuu] = useTransition();

  const giaTriMoi = (): { ok: true; v: unknown } | { ok: false; loi: string } => {
    if (kieu === "batTat") return { ok: true, v: bat };
    if (kieu === "so") {
      const n = Number(thoNhap.trim().replace(/\s/g, ""));
      if (thoNhap.trim() === "" || Number.isNaN(n)) {
        return { ok: false, loi: "Hãy nhập một con số" };
      }
      return { ok: true, v: n };
    }
    if (kieu === "chu" || kieu === "chon") return { ok: true, v: thoNhap };
    try {
      return { ok: true, v: JSON.parse(thoNhap) };
    } catch {
      return {
        ok: false,
        loi: "Nội dung chưa đúng định dạng — kiểm lại dấu phẩy và dấu ngoặc",
      };
    }
  };

  // So với giá trị ĐANG LƯU để biết có gì để lưu không. Đây cũng là công tắc hiện khung nhập
  // lý do: chưa đổi gì thì không có gì để giải thích, và 86 hộp chữ chết là thứ làm trang
  // nhìn như một biểu mẫu khai thuế chứ không phải một trang cấu hình.
  const coDoi = useMemo(() => {
    const g = giaTriMoi();
    if (!g.ok) return true; // đang nhập dở ⇒ vẫn cho bấm để hiện thông báo lỗi
    return JSON.stringify(g.v) !== JSON.stringify(row.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thoNhap, bat, row.value]);

  const luu = () => {
    const g = giaTriMoi();
    if (!g.ok) {
      toast.error(g.loi);
      return;
    }
    if (!lyDo.trim()) {
      toast.error("Vui lòng nhập lý do thay đổi");
      return;
    }
    batDauLuu(async () => {
      const res = await saveGlobalSettingAction({ key: row.key, value: g.v, reason: lyDo });
      if (res.ok) {
        toast.success(`Đã lưu: ${row.nhan.ten}`);
        setLyDo("");
      } else {
        toast.error(res.error.message);
      }
    });
  };

  const idO = `o-${row.key.replace(/\./g, "-")}`;

  return (
    <div
      className={cn(
        "border-b border-border px-4 py-4 transition-colors last:border-b-0 sm:px-5",
        coDoi && choSua && "bg-primary/[0.03]",
      )}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-8">
        <div className="min-w-0 flex-1">
          <label
            htmlFor={idO}
            className="inline-flex items-start gap-1.5 text-sm font-semibold leading-snug text-foreground"
          >
            <span>{row.nhan.ten}</span>
            {row.nhan.canThan && (
              <TriangleAlert
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-state-warning-ink"
                aria-label="Cần cân nhắc: đổi sai ảnh hưởng rộng hoặc phát sinh chi phí"
              />
            )}
          </label>
          {/* Trần đo chữ: câu giải thích không được dài quá ~72 ký tự một dòng, nếu không thì
              trên màn rộng mắt phải quét ngang cả nghìn pixel để về đầu dòng sau. */}
          <p className="mt-1 max-w-[72ch] text-xs leading-relaxed text-muted-foreground">
            {row.nhan.giaiThich}
          </p>
        </div>

        {kieu !== "phucTap" && kieu !== "chon" && (
          <div className="flex shrink-0 items-center gap-2.5 lg:w-72 lg:justify-end">
            {kieu === "batTat" ? (
              <>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {bat ? "Đang bật" : "Đang tắt"}
                </span>
                <Switch
                  id={idO}
                  checked={bat}
                  onCheckedChange={setBat}
                  disabled={!choSua || dangLuu}
                  aria-label={row.nhan.ten}
                  className={VUNG_BAM_RONG}
                />
              </>
            ) : (
              <>
                <Input
                  id={idO}
                  value={thoNhap}
                  inputMode={kieu === "so" ? "decimal" : "text"}
                  onChange={(e) => setThoNhap(e.target.value)}
                  disabled={!choSua || dangLuu}
                  className={cn(
                    // Cao theo loại con trỏ: chuột thì 40px cho đúng mật độ admin, ngón tay
                    // thì 44px theo sàn tiếp cận của PRODUCT.md — kể cả trên iPad rộng.
                    "h-10 w-full pointer-coarse:h-11",
                    kieu === "so" ? "sm:w-36 lg:text-right" : "sm:w-56",
                  )}
                />
                {row.nhan.donVi && (
                  <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                    {row.nhan.donVi}
                  </span>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* F3 — DANH SÁCH CHỌN. Vẽ nguyên khối dưới tên thay vì nhét vào cột phải: mỗi lựa
          chọn còn kéo theo một câu HỆ QUẢ, và một câu hai dòng nhồi vào cột 288px thì
          không đọc được. Dùng `<select>` gốc, KHÔNG dùng `Select` của shadcn: bản đó là
          base-ui và `SelectValue` in ra GIÁ TRỊ THÔ chứ không tra nhãn (ghi chép dự án),
          nên nó sẽ hiện đúng cái mã kỹ thuật mà khối này sinh ra để giấu đi. */}
      {kieu === "chon" && (
        <div className="mt-3 max-w-2xl">
          <select
            id={idO}
            value={thoNhap}
            onChange={(e) => setThoNhap(e.target.value)}
            disabled={!choSua || dangLuu}
            className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm pointer-coarse:h-11 sm:w-96"
            aria-label={row.nhan.ten}
          >
            {row.nhan.chon!.map((c) => (
              <option key={c.giaTri} value={c.giaTri}>
                {c.nhan}
              </option>
            ))}
          </select>
          {/* Hệ quả của ĐÚNG mục đang chọn. Liệt kê hệ quả của mọi mục cùng lúc là bắt
              người đọc tự đối chiếu; hiện một câu theo lựa chọn hiện tại thì họ thấy ngay
              cái giá mình vừa chọn, kể cả khi chỉ đang thử đổi qua đổi lại. */}
          {row.nhan.chon!.find((c) => c.giaTri === thoNhap)?.hauQua && (
            <p className="mt-1.5 max-w-[72ch] text-xs leading-relaxed text-muted-foreground">
              <b className="text-foreground">Chọn mục này nghĩa là: </b>
              {row.nhan.chon!.find((c) => c.giaTri === thoNhap)!.hauQua}
            </p>
          )}
          {/* Giá trị đang lưu KHÔNG nằm trong danh sách ⇒ nói ra. Ca thật: ai đó ghi tay
              một giá trị cũ vào cơ sở dữ liệu, hoặc lựa chọn bị gỡ khỏi danh sách. Im lặng
              thì ô hiện mục ĐẦU TIÊN và người đọc tin rằng đó là giá trị đang chạy. */}
          {!row.nhan.chon!.some((c) => c.giaTri === row.value) && (
            <p className="mt-1.5 text-xs text-state-warning-ink">
              Giá trị đang lưu ({String(row.value)}) không còn trong danh sách — chọn lại một
              mục rồi lưu.
            </p>
          )}
        </div>
      )}

      {kieu === "phucTap" && (
        // Trần bề ngang cho ô nhiều dòng: ở 4K khung nội dung rộng 1360px, mà nội dung thật
        // của nó là một danh sách ngắn — kéo dài hết khung thì ba dòng JSON nằm lọt thỏm
        // trong một hộp rỗng mênh mông.
        <div className="mt-3 max-w-2xl">
          <Textarea
            id={idO}
            value={thoNhap}
            onChange={(e) => setThoNhap(e.target.value)}
            disabled={!choSua || dangLuu}
            rows={Math.min(14, thoNhap.split("\n").length + 1)}
            className="font-mono text-xs"
          />
          <p className="mt-1 max-w-[72ch] text-xs text-muted-foreground">
            Đây là một danh sách nhiều mục. Giữ nguyên dấu ngoặc và dấu phẩy như mẫu sẵn có —
            chỉ sửa phần chữ bên trong dấu nháy.
          </p>
        </div>
      )}

      {/* Khung lưu chỉ hiện khi dòng này THẬT SỰ đổi. Trước đó nó nằm thường trực ở cả 86
          dòng — 86 hộp chữ không ai điền, và một nút Lưu mờ ở mỗi dòng là 86 lời hứa suông. */}
      {choSua && coDoi && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            value={lyDo}
            onChange={(e) => setLyDo(e.target.value)}
            placeholder="Vì sao đổi? (bắt buộc)"
            disabled={dangLuu}
            autoFocus
            aria-label={`Lý do thay đổi: ${row.nhan.ten}`}
            className="h-10 pointer-coarse:h-11 sm:flex-1"
          />
          <Button
            onClick={luu}
            disabled={dangLuu}
            className="shrink-0 pointer-coarse:h-11"
          >
            {dangLuu ? "Đang lưu…" : "Lưu"}
          </Button>
        </div>
      )}

      {/* PHIÊN H — cài riêng cho từng cơ sở. Đặt SAU khung lưu toàn hệ và TRƯỚC mục kỹ
          thuật: thứ tự đọc là "mức chung trước, ngoại lệ sau". Khối tự gấp lại, nên 47 khoá
          cho cài riêng không biến trang thành một bảng tính. */}
      {row.coSo && row.coSo.length > 0 && (
        <CaiRiengTheoCoSo
          settingKey={row.key}
          nhan={row.nhan}
          giaTriToanHe={row.value}
          coSo={row.coSo}
          // ⚠️ `choSuaCoSo`, KHÔNG phải `choSua`. Khối này ghi qua `setCenterSetting`, vốn
          // chỉ đòi vai quản lý tại ĐÚNG `orgUnitId` đang sửa — nó KHÔNG đòi `settings:edit`.
          // Nối nhầm vào `choSua` là khoá Quản lý cơ sở khỏi đúng thứ quyền mới sinh ra để
          // mở, trong khi server vẫn cho họ ghi.
          choSua={choSuaCoSo}
        />
      )}

      <details className="mt-2">
        {/* Vùng bấm 44px cho ngón tay: `py-1` cho ra 25px, đo được ở 390px. */}
        <summary className="inline-flex cursor-pointer items-center py-1 text-[11px] text-muted-foreground/70 hover:text-muted-foreground pointer-coarse:min-h-11">
          Chi tiết kỹ thuật
        </summary>
        {/* Tên khoá là thứ DUY NHẤT tra được trong nhật ký kiểm toán và khi hỏi bên kỹ thuật —
            nên phải có, nhưng gấp lại để nó không chen vào giữa người dùng và việc của họ. */}
        <code className="mt-1 block text-[11px] text-muted-foreground">{row.key}</code>
      </details>
    </div>
  );
}

export function BangCauHinhTab({
  rows,
  choSua,
  choSuaCoSo,
}: {
  rows: readonly SettingRowView[];
  /** Sửa được giá trị toàn hệ thống. */
  choSua: boolean;
  /** Sửa được phần của cơ sở mình. Không mặc định — xem chú thích ở `KhungCauHinh`. */
  choSuaCoSo: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {rows.map((r) => (
        <HangCauHinh key={r.key} row={r} choSua={choSua} choSuaCoSo={choSuaCoSo} />
      ))}
    </div>
  );
}

/**
 * Bộ chọn tab — HAI hình thức, chọn theo bề ngang.
 *
 * ── Vì sao không phải thanh gạch chân cuộn ngang (bản đầu) ──────────────────────────────
 * Đo 13/09: 11 tab cần ~1553px với nhãn đầy đủ, ~1050px sau khi rút gọn — vẫn rộng hơn khung
 * nội dung ở laptop 1440. Thanh cuộn ngang nằm trong một trang vốn đã cuộn dọc là thứ người
 * dùng KHÔNG phát hiện ra: họ thấy tab đầu cụt giữa chữ và kết luận trang lỗi, chứ không nghĩ
 * tới chuyện kéo ngang.
 *
 * ── Vì sao hai hình thức, không phải một ────────────────────────────────────────────────
 * Viên thuốc tự xuống hàng giải được chuyện bị cắt, nhưng đo lại ở 320px thì 11 viên xếp
 * thành **6 hàng** — khoảng 290px, gần nửa màn hình, và thanh này lại còn dính đỉnh. Chữa một
 * lỗi bằng cách đẻ ra lỗi nặng hơn.
 *
 * Nên: dưới 640px dùng một ô chọn của hệ điều hành — một hàng 44px, bấm vào ra danh sách đủ
 * 11 mục, đúng thứ người dùng điện thoại đã quen. Từ 640px trở lên là viên thuốc, tối đa 3
 * hàng và 1 hàng từ Full HD.
 *
 * Cả hai luôn nằm trong DOM và ẩn/hiện bằng `display` — trình đọc màn hình bỏ qua nhánh đang
 * `display:none`, nên không có chuyện đọc hai lần.
 */
export function ThanhTab({
  tabs,
  dangChon,
  onChon,
}: {
  tabs: readonly { id: string; ten: string }[];
  dangChon: string;
  onChon: (id: string) => void;
}) {
  return (
    <>
      {/* Điện thoại — ô chọn của hệ điều hành. */}
      <div className="sm:hidden">
        <label htmlFor="chon-nhom-cau-hinh" className="sr-only">
          Nhóm cấu hình
        </label>
        <select
          id="chon-nhom-cau-hinh"
          value={dangChon}
          onChange={(e) => onChon(e.target.value)}
          className="h-12 w-full rounded-xl border border-border bg-card px-3 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {tabs.map((t) => (
            <option key={t.id} value={t.id}>
              {t.ten}
            </option>
          ))}
        </select>
      </div>

      {/* Từ tablet trở lên — viên thuốc tự xuống hàng, không bao giờ bị cắt. */}
      <div
        role="tablist"
        aria-label="Nhóm cấu hình"
        className="hidden flex-wrap gap-1.5 rounded-xl border border-border bg-card p-1.5 sm:flex"
      >
        {tabs.map((t) => {
          const chon = t.id === dangChon;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={chon}
              onClick={() => onChon(t.id)}
              className={cn(
                // Cao theo LOẠI CON TRỎ, không theo bề ngang: một chiếc iPad rộng 1024px vẫn
                // là ngón tay, mà bậc `lg:` thì lại coi nó như có chuột.
                "inline-flex min-h-9 items-center rounded-lg px-3.5 text-sm font-semibold transition-colors pointer-coarse:min-h-11",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                chon
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {t.ten}
            </button>
          );
        })}
      </div>
    </>
  );
}
