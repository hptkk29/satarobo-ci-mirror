"use client";

// Bảng chọn "loại thông báo nào được đẩy Web Push".
//
// ── HAI THỨ MÀN NÀY PHẢI NÓI THẬT (luật 12) ─────────────────────────────────────────────
// 1. Bật một loại ở đây KHÔNG có nghĩa là điện thoại sẽ rung. Còn hai cổng nữa phía trên:
//    công tắc tổng `push.webPushEnabled` và khoá VAPID. Trang cha đo cả hai và truyền xuống
//    `canhBao` — nếu có cái nào hỏng thì bảng này phải nói ngay, không để người ta bấm xong
//    rồi ngồi chờ một thông báo không bao giờ tới.
// 2. Lưu xong KHÔNG có hiệu lực tức thì ở mọi nơi. `getGlobalSetting` cache 300 giây, và cron
//    chạy ở tiến trình khác. Nói thẳng con số đó ra; im lặng thì người ta thử 30 giây rồi kết
//    luận "chức năng hỏng".

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Bell, BellOff, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { NotiCatalogEntry } from "@/lib/notifications/catalog";
import { luuLoaiDuocDayAction } from "../actions";

export interface CanhBaoKenh {
  /** Câu mô tả vì sao kênh chưa chạy. Rỗng = kênh sẵn sàng. */
  cau: string;
  /** Nơi đi sửa, để người đọc không phải đoán. */
  choSua: string;
}

const MUC_NHAN: Readonly<Record<number, string>> = {
  1: "Khẩn",
  2: "Thường",
  3: "Tham khảo",
};

export function ChonLoaiThongBao({
  danhMuc,
  dangBat,
  choSua,
  canhBao,
}: {
  danhMuc: readonly NotiCatalogEntry[];
  dangBat: readonly string[];
  /** false = chỉ được xem (không phải SUPER_ADMIN). Công tắc phải khoá, không chỉ ẩn nút Lưu. */
  choSua: boolean;
  canhBao: readonly CanhBaoKenh[];
}) {
  // GIAO của "đang lưu" và "còn trong danh mục" — KHÔNG lấy thẳng `dangBat`.
  //
  // Cấu hình trên prod có thể còn khoá của loại đã bị gỡ (13/09 có thật: 4 loại của luồng học
  // thử cũ). Nếu khởi tạo thẳng từ `dangBat` thì những khoá đó nằm im trong `chon`, và cú bấm
  // Lưu sẽ gửi chúng xuống — nơi đường ghi TỪ CHỐI vì không còn trong danh mục. Tức dòng cảnh
  // báo "bấm Lưu một lần là dọn xong" ngay phía trên sẽ là một lời hứa suông.
  const banDau = useMemo(() => {
    const co = new Set(danhMuc.map((e) => e.prefix));
    return new Set(dangBat.filter((t) => co.has(t)));
  }, [dangBat, danhMuc]);
  const [chon, setChon] = useState<ReadonlySet<string>>(banDau);
  const [lyDo, setLyDo] = useState("");
  /** Mã thô `lead.moi:` — TẮT sẵn. Xem khối chú thích ở chỗ hiển thị. */
  const [hienMa, setHienMa] = useState(false);
  const [dangLuu, batDauLuu] = useTransition();

  // So theo NỘI DUNG chứ không theo tham chiếu: bật rồi tắt lại đúng mục đó là KHÔNG có thay
  // đổi, và nút Lưu phải mờ đi. Nút sáng khi chẳng có gì để lưu là một lời hứa suông.
  const coDoi =
    chon.size !== banDau.size || [...chon].some((t) => !banDau.has(t));

  const bat = (prefix: string, moi: boolean) => {
    setChon((truoc) => {
      const s = new Set(truoc);
      if (moi) s.add(prefix);
      else s.delete(prefix);
      return s;
    });
  };

  const luu = () => {
    if (!lyDo.trim()) {
      toast.error("Vui lòng nhập lý do thay đổi");
      return;
    }
    batDauLuu(async () => {
      const res = await luuLoaiDuocDayAction({ tienTo: [...chon], reason: lyDo });
      if (res.ok) {
        toast.success(
          chon.size === 0
            ? "Đã lưu — hiện KHÔNG loại nào được đẩy"
            : `Đã lưu — ${chon.size} loại được đẩy`,
        );
        setLyDo("");
      } else {
        toast.error(res.error.message);
      }
    });
  };

  // Gom theo nhóm, giữ nguyên thứ tự `danhMuc` đã sắp ở server.
  const theoNhom = useMemo(() => {
    const m = new Map<string, NotiCatalogEntry[]>();
    for (const e of danhMuc) {
      const ds = m.get(e.groupLabel);
      if (ds) ds.push(e);
      else m.set(e.groupLabel, [e]);
    }
    return [...m.entries()];
  }, [danhMuc]);

  return (
    <div className="space-y-5">
      {canhBao.map((c) => (
        <div
          key={c.cau}
          className="flex items-start gap-3 rounded-lg border border-state-warning-soft bg-state-warning-soft px-4 py-3 text-sm text-state-warning-ink"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {/* `break-words`: một chuỗi dài không dấu cách lọt vào đây là tràn khung ở 320px. */}
          <p className="min-w-0 break-words">
            <strong>{c.cau}</strong> — chọn gì ở bảng dưới cũng chưa ai nhận được. {c.choSua}
          </p>
        </div>
      ))}

      {/* Số đang bật để ngay trên đầu: đây là câu trả lời cho "hiện đang đẩy những gì", và nó
          phải đọc được mà không cần cuộn qua 51 dòng. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted px-4 py-3">
        <p className="text-sm text-foreground">
          {chon.size === 0 ? (
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <BellOff className="h-4 w-4" aria-hidden /> Không loại nào được đẩy
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <Bell className="h-4 w-4 text-primary" aria-hidden />
              <strong>{chon.size}</strong>/{danhMuc.length} loại được đẩy
            </span>
          )}
        </p>
        <div className="flex items-center gap-4">
          {coDoi && (
            <span className="text-xs font-semibold text-state-warning-ink">
              Có thay đổi chưa lưu
            </span>
          )}
          {/* Mã thô của từng loại (`lead.moi:`) TẮT sẵn.
              Người dùng trang này không đọc được nó, và in sẵn 51 dòng mã là 51 dòng nhiễu.
              Nhưng khi có người báo "tôi không nhận được thông báo X" thì đó lại là thứ DUY
              NHẤT tra được trong sổ gửi — nên giấu đi, không xoá. */}
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground pointer-coarse:min-h-11">
            <input
              type="checkbox"
              checked={hienMa}
              onChange={(e) => setHienMa(e.target.checked)}
              /* Nới vùng bấm lên 44px bằng lớp phủ trong suốt — ô tick chỉ 16×16, chính
                 phép đo cảm ứng vừa bắt được nó ngay sau khi tôi thêm vào. */
              className="relative h-4 w-4 accent-[color:var(--primary)] after:absolute after:-inset-x-3.5 after:-inset-y-3.5 after:content-['']"
            />
            Hiện mã kỹ thuật
          </label>
        </div>
      </div>

      {theoNhom.map(([nhom, ds]) => (
        <section key={nhom} className="rounded-xl border border-border bg-card">
          <h2 className="border-b border-border px-4 py-2.5 text-sm font-bold text-foreground">
            {nhom}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {ds.filter((e) => chon.has(e.prefix)).length}/{ds.length} bật
            </span>
          </h2>
          {/* Nhiều cột từ màn rộng: 51 dòng một cột là cuộn 6 màn hình ở 4K trong khi bên
              phải bỏ trống. Chia cột giữ được mật độ — nguyên tắc số 1 của DESIGN.md. Viền
              ngăn cách chuyển sang lưới nên phải dùng `border-b` từng ô, không `divide-y`. */}
          <ul className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3">
            {ds.map((e) => (
              <li
                key={e.prefix}
                className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0 xl:border-r xl:[&:nth-child(2n)]:border-r-0 2xl:[&:nth-child(2n)]:border-r 2xl:[&:nth-child(3n)]:border-r-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">{e.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {MUC_NHAN[e.priority] ?? `Mức ${e.priority}`} · {e.recipients}
                  </p>
                  {hienMa && (
                    <code className="mt-0.5 block break-all text-[11px] text-muted-foreground/70">
                      {e.prefix}
                    </code>
                  )}
                </div>
                <Switch
                  checked={chon.has(e.prefix)}
                  onCheckedChange={(v) => bat(e.prefix, v)}
                  disabled={!choSua || dangLuu}
                  aria-label={`Đẩy Web Push cho: ${e.label}`}
                  /* Nới vùng bấm lên chuẩn 44px mà không phóng to công tắc trên hình —
                     công tắc shadcn cao 20px, bấm bằng ngón tay là chuyện may rủi. */
                  className="relative mt-0.5 shrink-0 after:absolute after:-inset-x-3 after:-inset-y-3 after:content-['']"
                />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {/* Khung lưu chỉ hiện KHI CÓ thay đổi.
          Bản đầu ghim nó ở đáy màn vĩnh viễn: ba dòng giao diện che mất nội dung suốt thời
          gian người ta chỉ đang đọc, và một nút "Lưu thay đổi" mờ sẵn là một lời hứa suông
          thường trực. Hiện đúng lúc có việc để lưu thì nó vừa là chỗ lưu vừa là câu trả lời
          cho "tôi vừa đổi gì đó, xong rồi làm sao". */}
      {choSua && coDoi && (
        <div className="sticky bottom-0 -mx-1 rounded-xl border border-border bg-card p-3 shadow-lg sm:p-4">
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center">
            <Input
              id="ly-do-doi-loai-push"
              value={lyDo}
              onChange={(ev) => setLyDo(ev.target.value)}
              placeholder="Vì sao đổi? (bắt buộc)"
              disabled={dangLuu}
              autoFocus
              aria-label="Lý do thay đổi danh sách loại thông báo"
              className="h-10 pointer-coarse:h-11 lg:flex-1"
            />
            <Button onClick={luu} disabled={dangLuu} className="shrink-0 pointer-coarse:h-11">
              {dangLuu ? "Đang lưu…" : `Lưu ${chon.size} loại`}
            </Button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Lưu xong có hiệu lực trong vòng <strong>5 phút</strong> (cấu hình được nhớ đệm),
            không tức thì.
          </p>
        </div>
      )}
    </div>
  );
}
