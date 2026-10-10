"use client";

// Ma trận "vai nào xuất được màn nào" — tab Quyền xuất dữ liệu.
//
// ── HAI THỨ MÀN NÀY PHẢI NÓI THẬT (luật 12) ─────────────────────────────────────────────
// 1. **Tích một vai KHÔNG đủ để vai đó xuất được.** Còn cổng thứ hai: họ vẫn phải có quyền
//    ĐỌC dữ liệu ấy (`quyenGoc` của màn). Nên mỗi khối in thẳng quyền đó ra — im lặng thì
//    người phân quyền tích xong, người kia vẫn bị chặn, và cả hai đi tìm bug ở chỗ khác.
// 2. **Bỏ hết tick KHÁC với chưa từng đụng tới.** Bỏ hết = "chỉ mình tôi"; chưa đụng = theo
//    mặc định của màn (những vai đang xuất được hôm nay). Hai trạng thái ấy nhìn phải khác
//    nhau, nên khối nào chưa đụng thì nói rõ "đang theo mặc định", còn khối rỗng nói rõ
//    "chỉ quản trị tối cao". Vẽ giống nhau là mời người ta siết quyền mà tưởng đã siết.
//
// Mật độ theo DESEIGN.md §2: dòng 44px, `whitespace-nowrap` ở nhãn, không thẻ lồng thẻ —
// khung tab đã là một thẻ, nên đây là danh sách phân cách bằng đường kẻ, không phải lưới
// thẻ con.

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { ShieldAlert, TriangleAlert, Lock, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ManXuat, NhomXuat } from "@/lib/export/danh-muc-xuat";
import type { VaiHeThong } from "@/lib/export/vai-he-thong";
import { luuQuyenXuatAction } from "../actions";

export type NhomManXuat = { nhom: NhomXuat; ten: string; man: ManXuat[] };

/** So hai danh sách vai theo NỘI DUNG — thứ tự tick không phải thay đổi. */
function khac(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return true;
  const s = new Set(b);
  return a.some((x) => !s.has(x));
}

export function MaTranQuyenXuat({
  nhomMan,
  vai,
  banDau,
  suaDuoc,
}: {
  nhomMan: readonly NhomManXuat[];
  vai: readonly VaiHeThong[];
  /** Giá trị đang lưu trong cấu hình. Màn VẮNG MẶT ở đây = chưa ai đụng tới. */
  banDau: Record<string, string[]>;
  /** false = chỉ được xem. Ô tích phải KHOÁ, không chỉ ẩn nút Lưu. */
  suaDuoc: boolean;
}) {
  // Vai đăng nhập được, bỏ PARENT: phụ huynh không vào admin nên một dòng PARENT trong ma
  // trận là một dòng không bao giờ khớp ai — đúng loại affordance nói dối.
  const vaiChon = useMemo(() => vai.filter((v) => v.ma !== "PARENT"), [vai]);
  const tenVai = useMemo(
    () => new Map(vai.map((v) => [v.ma, v.ten] as const)),
    [vai],
  );

  const [bang, setBang] = useState<Record<string, string[]>>(banDau);
  const [lyDo, setLyDo] = useState("");
  const [dangLuu, batDauLuu] = useTransition();

  const moiMan = useMemo(() => nhomMan.flatMap((g) => g.man), [nhomMan]);

  const soDoi = moiMan.filter((m) => {
    const truoc = banDau[m.ma];
    const nay = bang[m.ma];
    if (!truoc && !nay) return false;
    if (!truoc || !nay) return true; // một bên vắng mặt = đã đổi trạng thái
    return khac(truoc, nay);
  }).length;

  /** Vai đang hiệu lực cho một màn — CÙNG luật với `vaiDuocXuat()` ở máy chủ. */
  const dangHieuLuc = (m: ManXuat): readonly string[] => bang[m.ma] ?? m.vaiMacDinh;
  const daDungTay = (m: ManXuat): boolean => Array.isArray(bang[m.ma]);

  const bat = (m: ManXuat, maVai: string, tick: boolean) => {
    setBang((truoc) => {
      // Lần đầu đụng tới một màn: khởi tạo từ MẶC ĐỊNH của nó, không phải từ mảng rỗng.
      // Khởi tạo rỗng là cú tick đầu tiên lặng lẽ gỡ hết vai đang xuất được hôm nay.
      const hienTai = truoc[m.ma] ?? m.vaiMacDinh;
      const s = new Set(hienTai);
      if (tick) s.add(maVai);
      else s.delete(maVai);
      return { ...truoc, [m.ma]: [...s] };
    });
  };

  const veMacDinh = (m: ManXuat) => {
    setBang((truoc) => {
      const { [m.ma]: _bo, ...conLai } = truoc;
      return conLai;
    });
  };

  const luu = () => {
    if (!lyDo.trim()) {
      toast.error("Vui lòng nhập lý do thay đổi");
      return;
    }
    batDauLuu(async () => {
      const res = await luuQuyenXuatAction({ bang, lyDo });
      if (res.ok) {
        toast.success(`Đã lưu quyền xuất cho ${soDoi} màn`);
        setLyDo("");
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    // Giới hạn bề ngang: trên màn rất lớn (4k/8k) một hàng kéo dài 7000px là không đọc nổi
    // — mắt mất dấu dòng giữa nhãn bên trái và ô tích bên phải. Khoá ở 110rem rồi căn giữa.
    <div className="mx-auto max-w-[110rem] space-y-5">
      <div className="flex items-start gap-3 rounded-lg border border-border bg-muted px-4 py-3">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <p className="min-w-0 text-sm leading-relaxed text-foreground">
          Vai được tích ở đây <strong>vẫn phải có quyền đọc dữ liệu đó</strong> — hai cổng
          cộng dồn, nên tích thêm vai không mở được dữ liệu của cơ sở khác. Quản trị tối cao
          luôn xuất được mọi màn và không nằm trong danh sách.
        </p>
      </div>

      {vaiChon.length === 0 && (
        <p className="rounded-lg border border-state-warning-soft bg-state-warning-soft px-4 py-3 text-sm text-state-warning-ink">
          Không đọc được danh mục vai. Chưa phân quyền được — hỏi bên kỹ thuật.
        </p>
      )}

      {nhomMan.map((g) => (
        <section key={g.nhom} className="rounded-xl border border-border bg-card">
          <h2 className="border-b border-border px-4 py-2.5 text-sm font-bold text-foreground">
            {g.ten}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {g.man.length} mục
            </span>
          </h2>

          <ul>
            {g.man.map((m) => {
              const hieuLuc = dangHieuLuc(m);
              const tuTay = daDungTay(m);
              const rong = hieuLuc.length === 0;
              return (
                <li
                  key={m.ma}
                  className="border-b border-border px-4 py-4 last:border-b-0"
                >
                  {/* Hai cột từ 1024px: mô tả bên trái, ô tích bên phải. Dưới mốc đó xếp
                      dọc — ở 320px một lưới hai cột là hai cột vỡ chữ. */}
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-6 2xl:grid-cols-[minmax(0,1fr)_minmax(0,32rem)]">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <h3 className="text-sm font-semibold text-foreground">{m.ten}</h3>
                        <code className="break-all text-[11px] text-muted-foreground/80">
                          {m.man}
                        </code>
                      </div>

                      {m.nhayCam.length > 0 && (
                        <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <TriangleAlert
                            className="h-3.5 w-3.5 shrink-0 text-state-warning-ink"
                            aria-hidden
                          />
                          {m.nhayCam.map((n) => (
                            <span
                              key={n}
                              className="inline-flex whitespace-nowrap rounded-full border border-state-warning-soft bg-state-warning-soft px-2 py-0.5 text-[11px] font-semibold text-state-warning-ink"
                            >
                              {n}
                            </span>
                          ))}
                        </p>
                      )}

                      {/* Đo measure: khoá 70ch để trên màn rộng dòng không dài quá tầm mắt. */}
                      <ul className="mt-2 max-w-[70ch] space-y-1">
                        {m.noiDung.map((d) => (
                          <li
                            key={d}
                            className="pl-3 text-xs leading-relaxed text-muted-foreground before:mr-1.5 before:-ml-3 before:inline-block before:align-middle before:text-muted-foreground/60 before:content-['•']"
                          >
                            {d}
                          </li>
                        ))}
                      </ul>

                      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground/80">
                        {m.quyenGoc ? (
                          <>
                            Ngoài ô tích, người xuất còn phải có quyền{" "}
                            <code className="text-muted-foreground">{m.quyenGoc}</code>.
                          </>
                        ) : m.quyenGocGhiChu ? (
                          <>Ngoài ô tích: {m.quyenGocGhiChu}</>
                        ) : (
                          <>Màn này không có quyền đọc riêng — ô tích là cổng duy nhất.</>
                        )}
                      </p>
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                          <Users className="h-3.5 w-3.5" aria-hidden />
                          Vai xuất được
                        </span>
                        {tuTay && suaDuoc && (
                          <button
                            type="button"
                            onClick={() => veMacDinh(m)}
                            className="rounded text-[11px] font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--primary)]"
                          >
                            Về mặc định
                          </button>
                        )}
                      </div>

                      {/* Ô tích: vùng bấm nới bằng `after:-inset-*` (luật 12) và cao tối
                          thiểu 44px trên thiết bị cảm ứng. */}
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                        {vaiChon.map((v) => {
                          const tick = hieuLuc.includes(v.ma);
                          return (
                            <label
                              key={v.ma}
                              className={`inline-flex max-w-full items-center gap-2 text-xs pointer-coarse:min-h-11 ${
                                suaDuoc ? "cursor-pointer" : "cursor-default"
                              } ${tick ? "text-foreground" : "text-muted-foreground"}`}
                            >
                              <input
                                type="checkbox"
                                checked={tick}
                                disabled={!suaDuoc || dangLuu}
                                onChange={(ev) => bat(m, v.ma, ev.target.checked)}
                                className="relative h-4 w-4 shrink-0 accent-[color:var(--primary)] after:absolute after:-inset-x-2.5 after:-inset-y-3 after:content-['']"
                              />
                              <span className="min-w-0 truncate">{v.ten}</span>
                            </label>
                          );
                        })}
                      </div>

                      <p className="mt-2.5 flex items-start gap-1.5 text-[11px] leading-relaxed">
                        {rong ? (
                          <>
                            <Lock
                              className="mt-px h-3.5 w-3.5 shrink-0 text-state-warning-ink"
                              aria-hidden
                            />
                            <span className="text-state-warning-ink">
                              Chưa giao vai nào — <strong>chỉ quản trị tối cao</strong> tải
                              được màn này.
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">
                            {tuTay ? "Đã phân quyền riêng" : "Đang theo mặc định"}:{" "}
                            {hieuLuc.map((x) => tenVai.get(x) ?? x).join(" · ")}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {/* Thanh lưu chỉ hiện khi CÓ việc để lưu — một nút mờ thường trực là lời hứa suông. */}
      {suaDuoc && soDoi > 0 && (
        <div className="sticky bottom-0 -mx-1 rounded-xl border border-border bg-card p-3 shadow-lg sm:p-4">
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center">
            <Input
              id="ly-do-quyen-xuat"
              value={lyDo}
              onChange={(ev) => setLyDo(ev.target.value)}
              placeholder="Vì sao đổi? (bắt buộc)"
              disabled={dangLuu}
              autoFocus
              aria-label="Lý do thay đổi quyền xuất dữ liệu"
              className="h-10 pointer-coarse:h-11 lg:flex-1"
            />
            <Button onClick={luu} disabled={dangLuu} className="shrink-0 pointer-coarse:h-11">
              {dangLuu ? "Đang lưu…" : `Lưu ${soDoi} màn`}
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
