"use client";

/**
 * MÀN LEAD NGUỘI — lọc khách lâu ngày không ai chăm rồi phân bổ lại.
 *
 * ── THIẾT KẾ (mode Operate, DESIGN.md) ───────────────────────────────────────────────────
 * Đây là màn PHÂN LOẠI-RỒI-HÀNH-ĐỘNG, không phải màn đọc báo cáo: người dùng đến để chọn một
 * nắm dòng và bấm một nút có hậu quả thật. Nên thứ tự trên màn là thứ tự họ làm việc —
 * đặt ngưỡng → xem ai đang ôm → chọn → phân bổ — và thanh hành động dính đáy để nút quan
 * trọng nhất không bao giờ trôi khỏi tầm mắt dù danh sách dài bao nhiêu.
 *
 * ── RESPONSIVE: DỰNG NGAY TỪ ĐẦU, KHÔNG SỬA SAU ──────────────────────────────────────────
 * Bài học từ màn nhập Excel cùng phiên (15/09): bản đầu không có một điểm ngắt nào và phải
 * đo lại trên bảy bề rộng mới vỡ ra ba lỗi. Lần này:
 *   · dưới `md` — thẻ xếp dọc, không phải bảng 6 cột nhét vào màn 320px;
 *   · từ `md`   — bảng, dòng 44px theo DESIGN.md §2, `whitespace-nowrap` trên `th` và `td`;
 *   · khung nở theo BẬC và CHỈ dùng `min-[...]` — trộn với `2xl:` thì hai biến thể cùng độ
 *     ưu tiên và cái đứng sau trong CSS thắng, làm màn 8K dùng như màn 2K (đã vấp thật).
 *
 * ── PHÂN TRANG Ở URL ─────────────────────────────────────────────────────────────────────
 * Mọi điều kiện nằm trên URL (`?nguong=`, `?cs=`, `?page=`, `?size=`), y như `/leads`. Xem
 * khối chú thích ở `page.tsx` về lý do đảo khỏi bản giữ state trong bộ nhớ.
 */

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw, Users, UserRoundCheck, Shuffle, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatPhoneVN } from "@/lib/phone";
import { leadStatusLabel } from "@/lib/leads/status";
import { NGUONG_NGUOI_TOI_DA, NGUONG_NGUOI_TOI_THIEU, nhanSoNgay } from "@/lib/lead/lead-nguoi";
import { DieuHuongTrang } from "@/components/ui/dieu-huong-trang";
import { ChonSoDong } from "@/components/ui/chon-so-dong";
import { phanBoLeadNguoiAction } from "../_actions";

interface Dong {
  id: string;
  parentName: string;
  phone: string;
  status: string;
  centerId: string | null;
  chuId: string | null;
  chuTen: string | null;
  soNgayIm: number;
}

export function BangLeadNguoi({
  tong,
  dong,
  trang,
  soTrang,
  soDong,
  quetThieu,
  nguong,
  centerId,
  coSo,
  nguoiNhan,
}: {
  tong: number;
  dong: Dong[];
  trang: number;
  soTrang: number;
  soDong: number;
  quetThieu: number;
  nguong: number;
  centerId: string;
  coSo: { id: string; ten: string; ma: string }[];
  nguoiNhan: { id: string; ten: string; centerId: string | null }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [nguongNhap, setNguongNhap] = useState(String(nguong));
  const [csNhap, setCsNhap] = useState(centerId);
  const [chon, setChon] = useState<Set<string>>(new Set());
  const [cach, setCach] = useState<"vong" | "nguoi">("vong");
  const [nhanId, setNhanId] = useState("");
  const [lyDo, setLyDo] = useState("");
  const [dangChay, batDau] = useTransition();

  /**
   * Đổi tham số trên URL.
   *
   * `page` bị xoá khi ĐIỀU KIỆN LỌC đổi: đang ở trang 7 của tập cũ mà đổi ngưỡng thì trang 7
   * của tập mới có thể không tồn tại, và người dùng rơi vào bảng trắng.
   */
  const diToi = (doi: Record<string, string | null>, xoaTrang: boolean) => {
    const p = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(doi)) {
      if (v === null || v === "") p.delete(k);
      else p.set(k, v);
    }
    if (xoaTrang) p.delete("page");
    router.push(`/lead-nguoi?${p.toString()}`, { scroll: false });
  };

  const doiChon = (id: string) =>
    setChon((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const chonHetTrang = () =>
    setChon((p) => {
      const n = new Set(p);
      const duHet = dong.every((d) => n.has(d.id));
      for (const d of dong) {
        if (duHet) n.delete(d.id);
        else n.add(d.id);
      }
      return n;
    });

  /**
   * Người có thể nhận, LỌC theo cơ sở của những lead đang chọn.
   *
   * Chốt 16/09/2026: "lead nằm ở cs nào thì chia đều lại cs đó, chứ không được chia qua cs
   * khác". Server vẫn gác lại (`canManualAssign` trong `nguoi-service.ts`) — danh sách ở đây
   * chỉ để người dùng không chọn được một lựa chọn chắc chắn bị từ chối.
   *
   * Chọn lead của NHIỀU cơ sở cùng lúc thì không ai giao đích danh được cho tất cả. Lúc đó ô
   * chọn người biến mất và màn hình nói thẳng lý do, thay vì bày ra một cái tên rồi báo lỗi
   * sau khi bấm.
   */
  const csDangChon = new Set(dong.filter((d) => chon.has(d.id)).map((d) => d.centerId ?? ""));
  const nhieuCoSo = csDangChon.size > 1;
  const nguoiNhanHopLe =
    csDangChon.size === 1
      ? nguoiNhan.filter((u) => u.centerId && u.centerId === [...csDangChon][0])
      : [];

  const phanBo = () =>
    batDau(async () => {
      const r = await phanBoLeadNguoiAction({
        leadIds: [...chon],
        cach: cach === "vong" ? { kieu: "vong" } : { kieu: "nguoi", nhanId },
        nguongNgay: nguongNhap,
        centerId: csNhap,
        lyDo,
      });
      if (!r.ok) {
        toast.error(r.error ?? "Không phân bổ được");
        return;
      }
      const boQua = r.boQua ?? [];
      toast.success(
        `Đã phân bổ ${r.daChia} lead` + (boQua.length > 0 ? ` · bỏ qua ${boQua.length}` : ""),
      );
      // Bỏ qua KHÔNG được im lặng: nói rõ từng lý do, nếu không người dùng đếm lại thấy
      // thiếu và không biết thiếu vì sao.
      for (const b of boQua.slice(0, 5)) toast.warning(b.lyDo);
      setChon(new Set());
      setLyDo("");
      setNhanId("");
      router.refresh();
    });

  const sanSang =
    chon.size > 0 && lyDo.trim().length >= 3 && (cach === "vong" || (!!nhanId && !nhieuCoSo));

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-6 px-4 py-6 sm:px-6 min-[1536px]:max-w-[1440px] min-[2200px]:max-w-[1920px]">
      <header className="space-y-2">
        <h1 className="text-xl font-bold sm:text-2xl">Lead lâu ngày chưa chăm</h1>
        <p className="max-w-[78ch] text-sm text-muted-foreground">
          Khách <b className="text-foreground">chưa đăng ký, chưa ghi danh</b> mà đã lâu không
          ai đụng tới. Chọn dòng rồi phân bổ lại để người khác tiếp cận —{" "}
          <b className="text-foreground">vẫn trong cùng cơ sở của lead</b>.
        </p>
        {/* Giới hạn thật của phép đếm — nói ra, không giấu. Người bấm nút phải biết con số
            này dựa trên cái gì thì mới tin hay không tin nó một cách có cơ sở. */}
        <p className="max-w-[78ch] rounded-xl border border-state-warning/40 bg-state-warning-soft px-4 py-3 text-xs text-state-warning-ink">
          Số ngày đếm từ lần gần nhất có người <b>ghi gì đó vào lead</b>: ghi chú, đổi trạng
          thái, thêm hoạt động, tạo hoặc đóng việc cần làm. Tư vấn viên nhắn Zalo/Messenger với
          khách mà không ghi lại thì hệ thống không thấy — hãy xem qua vài dòng trước khi phân
          bổ hàng loạt.
        </p>
      </header>

      {/* Thanh điều kiện. `flex-wrap` + `basis` để ở 320px mỗi ô chiếm trọn một dòng thay vì
          bị bóp còn vài chục pixel. */}
      <section className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-muted/40 p-4">
        <label className="min-w-0 basis-full space-y-1 sm:basis-auto">
          <span className="block text-xs font-medium text-muted-foreground">
            Không ai chăm từ (ngày)
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={NGUONG_NGUOI_TOI_THIEU}
            max={NGUONG_NGUOI_TOI_DA}
            value={nguongNhap}
            onChange={(e) => setNguongNhap(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setChon(new Set());
                diToi({ nguong: nguongNhap, cs: csNhap }, true);
              }
            }}
            className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm tabular-nums focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-32"
          />
        </label>

        <label className="min-w-0 basis-full space-y-1 sm:basis-auto">
          <span className="block text-xs font-medium text-muted-foreground">Cơ sở</span>
          <select
            value={csNhap}
            onChange={(e) => {
              setCsNhap(e.target.value);
              setChon(new Set());
              diToi({ nguong: nguongNhap, cs: e.target.value }, true);
            }}
            className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-56"
          >
            <option value="">Tất cả cơ sở trong tầm nhìn</option>
            {coSo.map((c) => (
              <option key={c.id} value={c.id}>
                {c.ma} — {c.ten}
              </option>
            ))}
          </select>
        </label>

        <Button
          onClick={() => {
            setChon(new Set());
            diToi({ nguong: nguongNhap, cs: csNhap }, true);
          }}
          disabled={dangChay}
          variant="outline"
          className="min-h-11"
        >
          <RefreshCw className={cn("mr-1.5 h-4 w-4", dangChay && "animate-spin")} />
          Lọc lại
        </Button>

        <p className="basis-full text-sm text-muted-foreground sm:ml-auto sm:basis-auto">
          Tìm thấy <b className="tabular-nums text-foreground">{tong}</b> lead
        </p>

        {quetThieu > 0 && (
          <p className="basis-full text-xs text-state-warning-ink">
            Quá nhiều lead khớp: {quetThieu} dòng chưa được xếp hạng &quot;im lâu nhất&quot;.
            Lọc theo cơ sở hoặc nâng số ngày để thu hẹp lại.
          </p>
        )}
      </section>

      {dong.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
          <Inbox className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">Không có lead nào nguội quá {nguong} ngày</p>
          <p className="mx-auto mt-1 max-w-[52ch] text-sm text-muted-foreground">
            Với ngưỡng này thì mọi lead chưa chốt đều đã được chăm gần đây. Hạ số ngày xuống
            nếu bạn muốn soát kỹ hơn.
          </p>
        </div>
      ) : (
        <>
          {/* Nền đục của riêng thẻ — xem chú thích cùng nội dung ở
              `components/admin/ExcelImporter.tsx`. */}
          <div className="hidden overflow-hidden rounded-xl border border-border bg-background md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted">
                    <th scope="col" className="w-10 px-4 py-2.5">
                      <input
                        type="checkbox"
                        aria-label="Chọn hết các dòng của trang này"
                        checked={dong.length > 0 && dong.every((d) => chon.has(d.id))}
                        onChange={chonHetTrang}
                        className="h-4 w-4 cursor-pointer accent-primary"
                      />
                    </th>
                    {["Phụ huynh", "Số điện thoại", "Trạng thái", "Đang giữ", "Im bao lâu"].map(
                      (h) => (
                        <th
                          key={h}
                          scope="col"
                          className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {dong.map((d) => (
                    <tr
                      key={d.id}
                      className={cn(
                        "border-t border-border transition-colors",
                        chon.has(d.id) && "bg-primary-soft",
                      )}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          aria-label={`Chọn lead ${d.parentName}`}
                          checked={chon.has(d.id)}
                          onChange={() => doiChon(d.id)}
                          className="h-4 w-4 cursor-pointer accent-primary"
                        />
                      </td>
                      <td
                        className="max-w-[26ch] truncate whitespace-nowrap px-4 py-3 font-medium"
                        title={d.parentName}
                      >
                        {d.parentName}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                        {formatPhoneVN(d.phone)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="inline-flex whitespace-nowrap rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
                          {leadStatusLabel(d.status)}
                        </span>
                      </td>
                      <td
                        className="max-w-[22ch] truncate whitespace-nowrap px-4 py-3"
                        title={d.chuTen ?? ""}
                      >
                        {d.chuTen ?? (
                          <span className="text-state-warning-ink">Chưa chia cho ai</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-state-danger-ink">
                        {nhanSoNgay(d.soNgayIm)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Dưới `md`: thẻ. Bảng 6 cột trên màn 320px là không đọc được, mà đây lại là màn
              người ta phải ĐỌC từng dòng trước khi quyết định giật lead của ai. */}
          <ul className="space-y-3 md:hidden">
            {dong.map((d) => (
              <li key={d.id}>
                <label
                  className={cn(
                    "flex cursor-pointer gap-3 rounded-xl border border-border bg-background p-4 transition-colors",
                    chon.has(d.id) && "border-primary bg-primary-soft",
                  )}
                >
                  <input
                    type="checkbox"
                    aria-label={`Chọn lead ${d.parentName}`}
                    checked={chon.has(d.id)}
                    onChange={() => doiChon(d.id)}
                    className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-primary"
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="break-words font-medium">{d.parentName}</p>
                    <p className="tabular-nums text-sm text-muted-foreground">
                      {formatPhoneVN(d.phone)}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <span className="inline-flex whitespace-nowrap rounded-md bg-muted px-2 py-0.5 font-medium">
                        {leadStatusLabel(d.status)}
                      </span>
                      <span className="text-muted-foreground">
                        {d.chuTen ? `Đang giữ: ${d.chuTen}` : "Chưa chia cho ai"}
                      </span>
                    </div>
                    <p className="text-xs font-semibold tabular-nums text-state-danger-ink">
                      Im {nhanSoNgay(d.soNgayIm)}
                    </p>
                  </div>
                </label>
              </li>
            ))}
          </ul>

          {/* Đúng bộ phân trang `/leads` đang dùng — `ChonSoDong` cho 4 mức [10,20,50,100] và
              `DieuHuongTrang` cho dãy số trang. Dựng một bộ riêng ở đây là để hai màn cùng một
              việc mà bấm khác nhau. */}
          {tong > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <ChonSoDong soDong={soDong} tong={tong} tenDonVi="lead" />
                <span className="whitespace-nowrap text-xs text-muted-foreground">
                  Trang {trang}/{soTrang}
                </span>
              </div>
              <DieuHuongTrang
                trang={trang}
                soTrang={soTrang}
                onDoi={(t) => diToi({ page: String(t) }, false)}
              />
            </div>
          )}
        </>
      )}

      {/* Thanh hành động dính đáy. `z-20` — xem chú thích cùng nội dung ở
          `components/admin/ExcelImporter.tsx` về việc ô ghim của bảng mang `z-10`.
          Chưa chọn gì thì thu về một dòng: mọi điều khiển trong nó đều chưa dùng được, mà nó
          lại đang che mất đúng thứ người dùng cần đọc để quyết định chọn dòng nào. */}
      <div className="sticky bottom-0 z-20 -mx-4 space-y-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:mx-0 sm:rounded-xl sm:border sm:px-4">
        {chon.size === 0 ? (
          <p className="text-sm text-muted-foreground">
            Tick chọn những lead muốn chuyển đi, rồi chọn cách phân bổ. Tick vẫn giữ khi bạn
            sang trang khác.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold tabular-nums">Đã chọn {chon.size} lead</span>
              <button
                type="button"
                onClick={() => setChon(new Set())}
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                Bỏ chọn hết
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              {/* Hai cách chia — chủ dự án chốt có cả hai. Bày ra cùng lúc để quản lý thấy
                  được lựa chọn thứ hai tồn tại, thay vì giấu sau một menu. */}
              {(
                [
                  { k: "vong" as const, nhan: "Chia vòng trong cơ sở", Icon: Shuffle },
                  { k: "nguoi" as const, nhan: "Giao đích danh", Icon: UserRoundCheck },
                ]
              ).map(({ k, nhan, Icon }) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setCach(k)}
                  aria-pressed={cach === k}
                  className={cn(
                    "inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors sm:flex-none",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    cach === k
                      ? "border-primary bg-primary-soft text-primary"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="whitespace-nowrap">{nhan}</span>
                </button>
              ))}

              {cach === "nguoi" && !nhieuCoSo && (
                <select
                  value={nhanId}
                  onChange={(e) => setNhanId(e.target.value)}
                  aria-label="Chọn tư vấn viên nhận"
                  className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-64"
                >
                  <option value="">— Chọn người nhận —</option>
                  {nguoiNhanHopLe.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.ten}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Lý do BẮT BUỘC: đây là thao tác giật lead khỏi tay người khác. Ba tháng sau
                  người bị giật hỏi "vì sao" thì phải có câu trả lời. */}
              <input
                value={lyDo}
                onChange={(e) => setLyDo(e.target.value)}
                placeholder="Lý do phân bổ lại (bắt buộc)"
                aria-label="Lý do phân bổ lại"
                className="min-h-11 w-full min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
              />
              <Button
                onClick={phanBo}
                disabled={!sanSang || dangChay}
                className="min-h-11 w-full sm:w-auto"
              >
                <Users className="mr-1.5 h-4 w-4" />
                {dangChay ? "Đang phân bổ…" : `Phân bổ ${chon.size} lead`}
              </Button>
            </div>

            {!sanSang && (
              <p className="text-xs text-state-warning-ink">
                {cach === "nguoi" && nhieuCoSo
                  ? "Bạn đang chọn lead của nhiều cơ sở. Lead chỉ được chia lại trong cơ sở của chính nó — dùng “Chia vòng trong cơ sở”, hoặc lọc theo một cơ sở rồi giao đích danh."
                  : lyDo.trim().length < 3
                    ? "Nhập lý do trước khi phân bổ."
                    : "Chọn tư vấn viên sẽ nhận."}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
