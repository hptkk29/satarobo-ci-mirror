"use client";

// Bảng chọn "giáo viên nào LUÔN hiện khi xếp buổi học thử, dù hôm đó không có ca".
//
// Khoá cấu hình: `trial.gvMienLocTheoCa` (danh sách mã người dùng).
//
// ── VÌ SAO CÓ MÀN RIÊNG, KHÔNG DÙNG Ô NHẬP CHUNG ────────────────────────────────────────
// Giá trị là một MẢNG, nên khung cấu hình chung sẽ dựng nó thành ô văn bản JSON và bắt người
// vận hành gõ tay mã người dùng dạng `cmf3k9x0a0001…`. Không ai gõ đúng thứ đó, và gõ sai thì
// danh sách trông như đã khai mà thực tế không khớp ai — màn hình nói dối, không lỗi nào được
// ném ra. Nên `page.tsx` LỌC khoá này khỏi danh sách ô nhập và bày bảng TÊN ở đây.
//
// ── HAI THỨ MÀN NÀY PHẢI NÓI THẬT (luật 12) ─────────────────────────────────────────────
// 1. Chọn người ở đây KHÔNG có nghĩa là luật lọc đang chạy. Còn một cổng nữa phía trên:
//    cờ `trial.locGvTheoCaLamViec`. Cờ tắt thì mọi giáo viên vẫn hiện, và danh sách ngoại lệ
//    này không thay đổi điều gì — phải nói ngay, không để người ta chọn xong rồi ngồi đoán.
// 2. Lưu xong KHÔNG có hiệu lực tức thì ở mọi nơi. Cấu hình được nhớ đệm 300 giây
//    (`lib/settings/service.ts`), và các tiến trình khác phải chờ hết hạn. Nói thẳng con số
//    đó ra; im lặng thì người ta thử 30 giây rồi kết luận "chức năng hỏng".

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { TriangleAlert, UserCheck, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { luuGvMienTruAction } from "../actions";

/** Một giáo viên chọn được — dữ liệu THUẦN, dựng ở Server Component rồi truyền xuống. */
export interface GvChon {
  id: string;
  /** Có thể rỗng: tài khoản chưa khai tên. Xem `nhanGv`. */
  ten: string | null;
}

/**
 * Tên bày ra cho một dòng.
 *
 * Tài khoản chưa khai tên vẫn phải chọn được, nhưng "Chưa đặt tên" đứng hai dòng liền nhau
 * thì không phân biệt được ai với ai — nên ca đó (và CHỈ ca đó) mới in thêm mẩu mã cuối.
 */
export function nhanGv(gv: GvChon): string {
  const ten = gv.ten?.trim();
  if (ten) return ten;
  return `Chưa đặt tên · ${gv.id.slice(-6)}`;
}

export function ChonGvMienTru({
  giaoVien,
  dangChon,
  choSua,
  locDangBat,
}: {
  giaoVien: readonly GvChon[];
  /** Danh sách mã đang lưu trong cấu hình. */
  dangChon: readonly string[];
  /** false = chỉ được xem. Công tắc phải KHOÁ, không chỉ ẩn nút Lưu. */
  choSua: boolean;
  /** Giá trị đang lưu của `trial.locGvTheoCaLamViec` — quyết định bảng này có tác dụng không. */
  locDangBat: boolean;
}) {
  // GIAO của "đang lưu" và "còn là giáo viên" — KHÔNG lấy thẳng `dangChon`.
  //
  // Cấu hình có thể còn mã của người đã nghỉ hoặc đã bị gỡ vai giáo viên. Khởi tạo thẳng từ
  // `dangChon` thì những mã đó nằm im trong state và cú bấm Lưu sẽ gửi chúng xuống — nơi
  // đường ghi TỪ CHỐI vì không còn trong danh sách giáo viên, và người dùng nhận một lỗi họ
  // không gây ra. Lọc ở đây thì bấm Lưu một lần là dọn xong, đúng như dòng nhắc bên dưới hứa.
  const banDau = useMemo(() => {
    const co = new Set(giaoVien.map((g) => g.id));
    return new Set(dangChon.filter((id) => co.has(id)));
  }, [dangChon, giaoVien]);

  /** Mã còn trong cấu hình nhưng không còn là giáo viên — phải NÓI RA, không dọn lén. */
  const macKet = useMemo(() => {
    const co = new Set(giaoVien.map((g) => g.id));
    return dangChon.filter((id) => !co.has(id));
  }, [dangChon, giaoVien]);

  const [chon, setChon] = useState<ReadonlySet<string>>(banDau);
  const [lyDo, setLyDo] = useState("");
  const [dangLuu, batDauLuu] = useTransition();

  // So theo NỘI DUNG chứ không theo tham chiếu: bật rồi tắt lại đúng người đó là KHÔNG có
  // thay đổi, và khung lưu không được hiện. Một nút "Lưu" sáng khi chẳng có gì để lưu là một
  // lời hứa suông.
  //
  // ⚠️ Mã mắc kẹt cũng tính là CÓ thay đổi: bấm Lưu lúc đó ghi xuống một danh sách đã sạch,
  // tức là có việc thật để làm dù người dùng chưa gạt công tắc nào.
  const coDoi =
    macKet.length > 0 || chon.size !== banDau.size || [...chon].some((id) => !banDau.has(id));

  const bat = (id: string, moi: boolean) => {
    setChon((truoc) => {
      const s = new Set(truoc);
      if (moi) s.add(id);
      else s.delete(id);
      return s;
    });
  };

  const luu = () => {
    if (!lyDo.trim()) {
      toast.error("Vui lòng nhập lý do thay đổi");
      return;
    }
    batDauLuu(async () => {
      const res = await luuGvMienTruAction({ userIds: [...chon], reason: lyDo });
      if (res.ok) {
        toast.success(
          chon.size === 0
            ? "Đã lưu — hiện KHÔNG ai được miễn"
            : `Đã lưu — ${chon.size} giáo viên luôn hiện`,
        );
        setLyDo("");
      } else {
        toast.error(res.error.message);
      }
    });
  };

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div>
        <h2 className="text-sm font-bold text-foreground">
          Giáo viên luôn hiện khi xếp buổi học thử
        </h2>
        <p className="mt-1 max-w-[72ch] text-sm text-muted-foreground">
          Những người chọn ở đây luôn chọn được khi thêm buổi học thử, kể cả ngày họ không
          đăng ký ca nào. Dùng cho người điều hành đào tạo — người dạy bình thường thì để
          hệ thống lọc theo ca.
        </p>
      </div>

      {/* Lời hứa số 1: bảng này chỉ có tác dụng khi cổng phía trên đang mở. */}
      {!locDangBat && (
        <div className="flex items-start gap-3 rounded-lg border border-state-warning-soft bg-state-warning-soft px-4 py-3 text-sm text-state-warning-ink">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p className="min-w-0 break-words">
            <strong>Việc lọc giáo viên theo ca đang TẮT</strong> — hiện mọi giáo viên đều chọn
            được, nên chọn ai ở bảng này cũng chưa thay đổi điều gì. Bật bằng dòng “Chỉ hiện
            giáo viên có ca làm trùm hết buổi học thử” ở bảng phía trên.
          </p>
        </div>
      )}

      {macKet.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-state-warning-soft bg-state-warning-soft px-4 py-3 text-sm text-state-warning-ink">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p className="min-w-0 break-words">
            Còn <strong>{macKet.length}</strong> người trong cấu hình không còn là giáo viên
            (đã nghỉ hoặc đã đổi vai). Bấm <strong>Lưu</strong> một lần là dọn xong.
          </p>
        </div>
      )}

      {giaoVien.length === 0 ? (
        // Danh sách rỗng là một trạng thái CÓ THẬT (chưa ai được gán vai giáo viên). Để trống
        // trơn thì trông y hệt lỗi tải, và người dùng sẽ tải lại trang mãi.
        <p className="rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
          Chưa có tài khoản nào mang vai giáo viên, nên chưa có ai để chọn. Thêm ở màn Nhân sự
          trước.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted px-4 py-2.5">
            <p className="text-sm text-foreground">
              {chon.size === 0 ? (
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  <UserX className="h-4 w-4" aria-hidden /> Không ai được miễn
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <UserCheck className="h-4 w-4 text-primary" aria-hidden />
                  <strong>{chon.size}</strong>/{giaoVien.length} giáo viên luôn hiện
                </span>
              )}
            </p>
            {coDoi && (
              <span className="text-xs font-semibold text-state-warning-ink">
                Có thay đổi chưa lưu
              </span>
            )}
          </div>

          {/* Nhiều cột từ màn rộng — cùng lý do với bảng loại thông báo: một cột dọc ở 4K là
              cuộn dài trong khi nửa phải bỏ trống. Viền ngăn cách phải đặt từng ô
              (`border-b`/`border-r`), `divide-y` không dùng được trên lưới. */}
          <ul className="grid grid-cols-1 rounded-lg border border-border xl:grid-cols-2 2xl:grid-cols-3">
            {giaoVien.map((gv) => (
              <li
                key={gv.id}
                className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0 xl:border-r xl:[&:nth-child(2n)]:border-r-0 2xl:[&:nth-child(2n)]:border-r 2xl:[&:nth-child(3n)]:border-r-0"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {nhanGv(gv)}
                </span>
                <Switch
                  checked={chon.has(gv.id)}
                  onCheckedChange={(v) => bat(gv.id, v)}
                  disabled={!choSua || dangLuu}
                  aria-label={`Luôn hiện khi xếp buổi học thử: ${nhanGv(gv)}`}
                  /* Nới vùng bấm lên chuẩn 44px mà không phóng to công tắc trên hình —
                     công tắc shadcn cao 20px, bấm bằng ngón tay là chuyện may rủi. */
                  className="relative shrink-0 after:absolute after:-inset-x-3 after:-inset-y-3 after:content-['']"
                />
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Khung lưu chỉ hiện KHI CÓ thay đổi — cùng lý do với bảng loại thông báo: một nút
          "Lưu" mờ sẵn nằm thường trực là một lời hứa suông thường trực. */}
      {choSua && coDoi && (
        <div className="rounded-xl border border-border bg-muted p-3 sm:p-4">
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center">
            <Input
              id="ly-do-doi-gv-mien-tru"
              value={lyDo}
              onChange={(ev) => setLyDo(ev.target.value)}
              placeholder="Vì sao đổi? (bắt buộc)"
              disabled={dangLuu}
              aria-label="Lý do thay đổi danh sách giáo viên luôn hiện"
              className="h-10 pointer-coarse:h-11 lg:flex-1"
            />
            <Button onClick={luu} disabled={dangLuu} className="shrink-0 pointer-coarse:h-11">
              {dangLuu ? "Đang lưu…" : `Lưu ${chon.size} người`}
            </Button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Lưu xong có hiệu lực trong vòng <strong>5 phút</strong> (cấu hình được nhớ đệm),
            không tức thì.
          </p>
        </div>
      )}
    </section>
  );
}
