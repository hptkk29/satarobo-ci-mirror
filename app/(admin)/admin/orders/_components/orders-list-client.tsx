"use client";

import { useState, useTransition, useEffect, useCallback } from "react";
import Link from "next/link";
import { ChevronRight, ClipboardCheck, Info, SlidersHorizontal, X } from "lucide-react";
import { nationalPhone } from "@/lib/phone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { queryOrders, type OrderFilters, type OrderRow } from "../_actions";
import { ORDER_STATUS_LABEL, ORDER_TYPE_LABEL, deriveInstallmentBadge } from "@/lib/orders/status";
import type { SacThaiTrangThai } from "@/lib/orders/trang-thai-don";
import type { OrderStatus, OrderType } from "@prisma/client";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { adminTd, adminTh } from "@/components/admin/ui/table";
import { nhanChoDuyet } from "@/lib/orders/cho-duyet";
import { oLocPhamVi, type CoSoCoKhuVuc, type TuyChonPhamVi } from "@/lib/orders/loc-pham-vi";
import {
  giaTriOLocTrangThai,
  docOLocTrangThai,
  MOI_TRANG_THAI,
  CHO_DUYET,
} from "@/lib/orders/loc-trang-thai";

const ALL_STATUSES: OrderStatus[] = [
  "DRAFT",
  "PENDING_PAYMENT",
  "CONFIRMED",
  "COMPLETED",
  "CANCELLED",
  "REFUNDED",
];
const ALL_TYPES: OrderType[] = ["COURSE", "PACKAGE", "EXAM", "PRODUCT", "COMBO"];

/** Một bộ lọc chi tiết đang bật, vẽ thành chip gỡ-được-từng-cái. */
type ChipBat = { khoa: keyof OrderFilters; nhan: string };

/**
 * Lớp badge theo SẮC THÁI của nhãn suy từ tiền. Bản sao có chủ đích của bảng cùng tên ở
 * `order-detail-client.tsx`: cả hai đều là tầng hiển thị của CÙNG một khoá ngữ nghĩa do
 * `lib/orders/trang-thai-don.ts` trả về, và tệp thuần đó cố ý không giữ tên lớp Tailwind.
 */
const SAC_THAI_CLASS: Record<SacThaiTrangThai, string> = {
  "trung-tinh": "bg-muted text-foreground hover:bg-muted",
  "dang-cho":
    "bg-state-warning-soft text-state-warning-ink hover:bg-state-warning-soft",
  "thanh-cong":
    "bg-state-success-soft text-state-success-ink hover:bg-state-success-soft",
  "canh-bao":
    "bg-state-danger-soft text-state-danger-ink hover:bg-state-danger-soft",
};

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** Ngày ngắn cho ô hẹp — năm bỏ đi khi cùng năm hiện tại thì mất ngữ cảnh, nên GIỮ. */
function formatNgay(date: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(date);
}

/**
 * ⚠️ MỘT MARKUP CHO MỌI CỠ MÀN — bảng dưới `sm` tự thành danh sách thẻ.
 *
 * Kỹ thuật lấy từ playbook `adapt.md`: *"Tables: transform to cards on mobile using
 * `display: block` and `data-label` attributes"*. Mỗi `<td>` mang `data-nhan`, và dưới
 * `sm` thì `before:content-[attr(data-nhan)]` in nhãn cột ra trước giá trị.
 *
 * ⚠️ VÌ SAO KHÔNG dựng hai cây DOM (`hidden sm:block` + `sm:hidden`): hai cây là hai chỗ
 * phải sửa cho mỗi lần đổi cột, và chúng sẽ lệch — đúng lớp lỗi "hai nguồn cho một sự
 * thật" mà repo này đã trả giá ở nội dung CK và ở nhãn trạng thái đơn.
 */
const O_THE =
  "max-sm:flex max-sm:items-baseline max-sm:justify-between max-sm:gap-3 " +
  "max-sm:border-0 max-sm:px-4 max-sm:py-1.5 " +
  "max-sm:before:shrink-0 max-sm:before:text-xs max-sm:before:font-medium " +
  "max-sm:before:uppercase max-sm:before:tracking-wide max-sm:before:text-muted-foreground " +
  "max-sm:before:content-[attr(data-nhan)]";

export function OrdersListClient({
  coSo,
  khuVuc,
}: {
  /**
   * Cơ sở người này được lọc theo, KÈM khu vực cha. Dựng ở server bằng
   * `tuyChonPhamViDon(actor)` — xem tệp đó để biết vì sao không tra `Center` tại chỗ.
   *
   * ⚠️ BẮT BUỘC, không cho mặc định `[]` (luật 7 + luật 11). Mặc định rỗng là lỗi CÂM
   * hoàn hảo: ô lọc Cơ sở biến mất với MỌI người, không lỗi biên dịch, không ca nào đỏ,
   * và Hội sở mất đúng công cụ họ cần nhất.
   */
  coSo: CoSoCoKhuVuc[];
  khuVuc: TuyChonPhamVi[];
}) {
  const [filters, setFilters] = useState<OrderFilters>({});
  const [pendingFilters, setPendingFilters] = useState<OrderFilters>({});
  const [items, setItems] = useState<OrderRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isPending, startTransition] = useTransition();
  /** Trạng thái LỖI hạng nhất — xem chú thích ở khối render. */
  const [loi, datLoi] = useState<string | null>(null);
  const [daTai, datDaTai] = useState(false);
  /** Câu "bạn đang xem đơn của khách do bạn phụ trách" — `null` với người thấy tất cả. */
  const [moTaPhamVi, setMoTaPhamVi] = useState<string | null>(null);
  /** Tổng đơn chờ duyệt trong tầm nhìn — đếm ở server, KHÔNG đếm trên trang hiện tại. */
  const [soChoDuyet, setSoChoDuyet] = useState(0);
  /**
   * Bảng lọc chi tiết đang mở hay không.
   *
   * ⚠️ DÙNG STATE, KHÔNG dùng `<details>` — và đây là một bản vá, không phải sở thích.
   * Bản trước đặt `<details>` NGAY TRONG hàng công cụ (flex). Mở ra là chính phần tử ấy
   * phình lên ⇒ cả hàng dàn lại: ô tìm kiếm rơi xuống dòng, các nút nhảy chỗ. Chủ dự án
   * chụp ảnh: *"tôi không muốn khi bấm vào nó bị thay đổi thiết kế của cái khác"*.
   *
   * Nay nút bật/tắt ở trong hàng, còn BẢNG LỌC là một khối RIÊNG bên dưới hàng — mở hay
   * đóng thì hàng công cụ không đổi một pixel nào.
   *
   * Đánh đổi đã cân: `<details>` chạy được khi không có JS, nhưng cả danh sách này nạp
   * bằng server action nên không có JS thì màn vốn đã trống. Lập luận ấy không còn giá.
   */
  const [moBoLoc, datMoBoLoc] = useState(false);

  const oLoc = oLocPhamVi({ khuVuc, coSo });

  const load = useCallback(
    (reset: boolean, cursorOverride?: string | null) => {
      const useCursor = reset ? null : (cursorOverride ?? cursor);
      startTransition(async () => {
        try {
          const result = await queryOrders(filters, useCursor);
          setItems((prev) => (reset ? result.items : [...prev, ...result.items]));
          setCursor(result.nextCursor);
          setHasMore(!!result.nextCursor);
          setMoTaPhamVi(result.moTaPhamVi);
          setSoChoDuyet(result.soChoDuyet);
          datLoi(null);
        } catch {
          // ⚠️ TRẠNG THÁI LỖI DỰNG TẠI CHỖ, không chỉ một toast (DESIGN.md §5).
          // Toast biến mất sau 4 giây và để lại một cái bảng rỗng — người dùng đọc nó
          // thành "không có đơn nào", đúng lúc sự thật là "chưa hỏi được".
          datLoi("Không tải được danh sách đơn.");
        } finally {
          datDaTai(true);
        }
      });
    },
    [filters, cursor],
  );

  useEffect(() => {
    setCursor(null);
    setItems([]);
    setHasMore(false);
    datDaTai(false);
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  function apDung() {
    setFilters(pendingFilters);
  }
  function xoaHet() {
    setPendingFilters({});
    setFilters({});
  }
  /** Gỡ ĐÚNG MỘT bộ lọc — đường thoát nhanh của các chip đang bật. */
  function go(khoa: keyof OrderFilters) {
    const moi = { ...filters, [khoa]: undefined };
    setPendingFilters(moi);
    setFilters(moi);
  }
  /** Đổi một ô rồi áp dụng NGAY — dùng cho ô chọn phạm vi và chip lọc nhanh. */
  function datNgay(patch: Partial<OrderFilters>) {
    const moi = { ...filters, ...patch };
    setPendingFilters({ ...pendingFilters, ...patch });
    setFilters(moi);
  }

  const dangLocChoDuyet = filters.choDuyet === true;
  const coSoDangChon = coSo.filter((c) => filters.coSoIds?.includes(c.id));
  const khuVucDangChon = khuVuc.find((k) => k.id === filters.khuVucId);

  /** Các bộ lọc CHI TIẾT đang bật (không tính phạm vi — phạm vi có ô riêng luôn hiện). */
  const chipDangBat: ChipBat[] = [];
  // "Chờ duyệt" nay là MỘT MỤC của ô Trạng thái (chốt 25/09), nên nó phải có chip như mọi
  // bộ lọc khác. Thiếu chip là người dùng bật nó từ ô chọn rồi không có đường gỡ nào
  // ngoài việc mở lại đúng ô ấy — trong khi các bộ lọc anh em đều gỡ được bằng một dấu ×.
  if (filters.choDuyet) chipDangBat.push({ khoa: "choDuyet", nhan: "Chờ duyệt" });
  if (filters.search) chipDangBat.push({ khoa: "search", nhan: `Tìm: ${filters.search}` });
  if (filters.status) {
    chipDangBat.push({ khoa: "status", nhan: ORDER_STATUS_LABEL[filters.status] });
  }
  if (filters.type) chipDangBat.push({ khoa: "type", nhan: ORDER_TYPE_LABEL[filters.type] });
  if (filters.dateFrom) chipDangBat.push({ khoa: "dateFrom", nhan: `Từ ${filters.dateFrom}` });
  if (filters.dateTo) chipDangBat.push({ khoa: "dateTo", nhan: `Đến ${filters.dateTo}` });

  return (
    <div className="space-y-4">
      {/* ── THANH CÔNG CỤ ────────────────────────────────────────────────────────
          Một hàng ở màn rộng, xếp dọc ở màn hẹp. Ô tìm kiếm giãn; mọi thứ khác giữ
          nguyên bề rộng nội dung — ô lọc nhảy kích thước khi đổi giá trị là thứ làm
          thanh công cụ "nhấp nháy" mỗi lần lọc. */}
      <div
        role="group"
        aria-label="Thanh công cụ đơn hàng"
        className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
      >
        <form
          className="flex min-w-0 flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            apDung();
          }}
        >
          <Input
            className="min-w-0 flex-1"
            placeholder="Mã đơn / SĐT / Tên khách"
            aria-label="Tìm đơn hàng theo mã, số điện thoại hoặc tên khách"
            value={pendingFilters.search ?? ""}
            onChange={(e) =>
              setPendingFilters({ ...pendingFilters, search: e.target.value || undefined })
            }
          />
          <Button type="submit" variant="outline" disabled={isPending}>
            Tìm
          </Button>
        </form>

        {/* ⚠️ Ô PHẠM VI CHỈ HIỆN KHI CHO ≥2 LỰA CHỌN — `oLocPhamVi`, bộ ca [LPV-*].
            Đây là câu trả lời cho "sale thì không có phần lọc cơ sở, qlcs thì không có
            phần lọc của khu vực": luật suy từ DỮ LIỆU, không từ danh sách vai. */}
        {oLoc.hienKhuVuc && (
          <Select
            value={filters.khuVucId ?? "ALL"}
            onValueChange={(v) => datNgay({ khuVucId: !v || v === "ALL" ? undefined : v })}
          >
            <SelectTrigger className="sm:w-44" aria-label="Lọc theo khu vực">
              {/* ⚠️ `<SelectValue>` của base-ui in GIÁ TRỊ THÔ, không tra nhãn từ danh
                  sách mục — bẫy này đã ghi sẵn ở `order-detail-client.tsx:317`. Không
                  truyền hàm dựng nhãn thì ô hiện đúng chữ "ALL" trên màn, đúng lỗi chủ
                  dự án chụp ảnh ngày 25/09. Bốn ô của thanh lọc này đều phải có. */}
              <SelectValue>
                {(v: string | null) =>
                  khuVuc.find((k) => k.id === v)?.ten ?? "Mọi khu vực"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Mọi khu vực</SelectItem>
              {khuVuc.map((k) => (
                <SelectItem key={k.id} value={k.id}>
                  {k.ten}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {oLoc.hienCoSo && (
          <Select
            value={filters.coSoIds?.[0] ?? "ALL"}
            onValueChange={(v) => datNgay({ coSoIds: !v || v === "ALL" ? undefined : [v] })}
          >
            <SelectTrigger className="sm:w-52" aria-label="Lọc theo cơ sở">
              <SelectValue>
                {(v: string | null) => coSo.find((c) => c.id === v)?.ten ?? "Mọi cơ sở"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Mọi cơ sở</SelectItem>
              {coSo.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.ten}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Lọc nhanh "chờ duyệt" — chỉ vẽ khi có việc thật. Một chip "(0)" đứng vĩnh viễn
            là thứ người ta học cách không nhìn nữa (luật 12). */}
        {soChoDuyet > 0 && (
          <Button
            variant={dangLocChoDuyet ? "default" : "outline"}
            aria-pressed={dangLocChoDuyet}
            onClick={() => datNgay({ choDuyet: dangLocChoDuyet ? undefined : true })}
          >
            <ClipboardCheck className="h-4 w-4" />
            Chờ duyệt ({soChoDuyet})
          </Button>
        )}

        {/* ⚠️ NÚT BẬT/TẮT nằm TRONG hàng; BẢNG LỌC nằm NGOÀI hàng (ngay dưới).
            Đó là cả bản vá — xem chú thích ở state `moBoLoc`. Đặt cả hai vào cùng một
            phần tử trong hàng flex là mở ra thì cả hàng dàn lại. */}
        <Button
          variant="outline"
          aria-expanded={moBoLoc}
          aria-controls="bang-loc-don"
          onClick={() => datMoBoLoc((v) => !v)}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden />
          Bộ lọc
          {chipDangBat.length > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
              {chipDangBat.length}
            </span>
          )}
        </Button>
      </div>

      {/* ⚠️ BẢNG LỌC ĐẨY NỘI DUNG XUỐNG, KHÔNG NỔI ĐÈ [vá 25/09/2026].
      Bản đầu dựng `sm:absolute sm:w-[28rem] sm:grid-cols-2` — một tấm nổi hẹp.
      Chủ dự án chụp ảnh: *"bị đè lên nhau rồi"*. Danh sách xổ của ô chọn bên
      trong tấm ấy tràn ra ngoài mép và chồng lên chính các ô còn lại; cả hai đều
      nền trắng nên đọc ra như giao diện vỡ.

      `operate.md` cảnh báo đúng lớp này — *"Overlays escape their container"* —
      và cũng nói *"Modal as first thought. Exhaust inline alternatives first"*.
      Bảng lọc không phải việc cần chặn luồng, nên cách chắc chắn nhất là **không
      nổi**: nó là một khối trong dòng chảy, đẩy bảng xuống. Hết sạch một lớp lỗi
      z-index, và chạy giống hệt nhau ở mọi cỡ màn.

      Rộng cả hàng ⇒ chia được 4 cột ở màn lớn, nên các ô thôi chật. */}
      {moBoLoc && (
            <div
              id="bang-loc-don"
              role="group"
              aria-label="Bộ lọc chi tiết"
              className="mb-4 grid gap-3 rounded-xl border border-border bg-card p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4"
            >
              <label className="grid gap-1 text-sm">
                <span className="text-xs text-muted-foreground">Trạng thái đơn</span>
                <Select
                  value={giaTriOLocTrangThai(pendingFilters)}
                  onValueChange={(v) =>
                    setPendingFilters({ ...pendingFilters, ...docOLocTrangThai(v) })
                  }
                >
                  <SelectTrigger aria-label="Trạng thái đơn">
                    <SelectValue>
                      {(v: string | null) =>
                        v === CHO_DUYET
                          ? "Chờ duyệt"
                          : v && v !== MOI_TRANG_THAI
                            ? (ORDER_STATUS_LABEL[v as OrderStatus] ?? "Mọi trạng thái")
                            : "Mọi trạng thái"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={MOI_TRANG_THAI}>Mọi trạng thái</SelectItem>
                    {/* ⚠️ "Chờ duyệt" KHÔNG phải một giá trị của `OrderStatus` — nó nằm ở
                        hai cột duyệt khác. Nhưng với người dùng nó LÀ một trạng thái của
                        đơn, nên nó thuộc về đúng ô này (chủ dự án chốt 25/09). Phép ánh xạ
                        hai chiều ở `lib/orders/loc-trang-thai.ts`, bộ ca `[LTT-*]` — đừng
                        viết lại tại chỗ, vế "chọn cái này thì xoá cái kia" là chỗ đẻ bug
                        câm. */}
                    <SelectItem value={CHO_DUYET}>Chờ duyệt</SelectItem>
                    {ALL_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {ORDER_STATUS_LABEL[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              <label className="grid gap-1 text-sm">
                <span className="text-xs text-muted-foreground">Loại đơn</span>
                <Select
                  value={pendingFilters.type ?? "ALL"}
                  onValueChange={(v) =>
                    setPendingFilters({
                      ...pendingFilters,
                      type: v === "ALL" ? undefined : (v as OrderType),
                    })
                  }
                >
                  <SelectTrigger aria-label="Loại đơn">
                    <SelectValue>
                      {(v: string | null) =>
                        v && v !== "ALL"
                          ? (ORDER_TYPE_LABEL[v as OrderType] ?? "Mọi loại đơn")
                          : "Mọi loại đơn"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Mọi loại đơn</SelectItem>
                    {ALL_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {ORDER_TYPE_LABEL[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              <label className="grid gap-1 text-sm">
                <span className="text-xs text-muted-foreground">Tạo từ ngày</span>
                <Input
                  type="date"
                  value={pendingFilters.dateFrom ?? ""}
                  onChange={(e) =>
                    setPendingFilters({ ...pendingFilters, dateFrom: e.target.value || undefined })
                  }
                />
              </label>

              <label className="grid gap-1 text-sm">
                <span className="text-xs text-muted-foreground">Đến ngày</span>
                <Input
                  type="date"
                  value={pendingFilters.dateTo ?? ""}
                  onChange={(e) =>
                    setPendingFilters({ ...pendingFilters, dateTo: e.target.value || undefined })
                  }
                />
              </label>

              <div className="flex justify-end gap-2 sm:col-span-2">
                <Button variant="outline" onClick={xoaHet} disabled={isPending}>
                  Xoá hết
                </Button>
                <Button
                  onClick={() => {
                    apDung();
                    // Đóng lại sau khi áp dụng: để mở là bảng lọc che mất chính kết quả vừa
                    // lọc, và người dùng phải tự nghĩ ra việc bấm đóng. Hàng chip bên dưới
                    // mới là thứ nói "đang lọc gì" sau đó.
                    datMoBoLoc(false);
                  }}
                  disabled={isPending}
                >
                  Áp dụng
                </Button>
              </div>
            </div>
      )}

      {/* ── CHIP ĐANG BẬT ────────────────────────────────────────────────────────
          Sau khi bấm "Áp dụng", bảng lọc đóng lại và người dùng KHÔNG còn thấy mình
          đang lọc gì — rồi họ đọc một danh sách ngắn thành "hệ thống mất đơn". Chip
          nói ra, và mỗi chip gỡ được riêng. */}
      {(chipDangBat.length > 0 || khuVucDangChon || coSoDangChon.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {khuVucDangChon && (
            <ChipLocBat nhan={khuVucDangChon.ten} onGo={() => datNgay({ khuVucId: undefined })} />
          )}
          {coSoDangChon.map((c) => (
            <ChipLocBat key={c.id} nhan={c.ten} onGo={() => datNgay({ coSoIds: undefined })} />
          ))}
          {chipDangBat.map((c) => (
            <ChipLocBat key={c.khoa} nhan={c.nhan} onGo={() => go(c.khoa)} />
          ))}
          <button
            type="button"
            onClick={xoaHet}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Xoá hết
          </button>
        </div>
      )}

      {/* Câu phạm vi — chỉ hiện với người đang bị thu hẹp tầm nhìn (Sale). */}
      {moTaPhamVi && (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {moTaPhamVi}
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {loi ? (
          <TrangThaiLoi loi={loi} dangTai={isPending} thuLai={() => load(true)} />
        ) : (
          <PhanTrangBang cuonNgang>
            <table className="w-full">
              {/* Dưới `sm` header biến mất — nhãn cột đi theo từng ô bằng `data-nhan`. */}
              <thead className="border-b border-border bg-muted/40 max-sm:hidden">
                <tr>
                  <th scope="col" className={adminTh}>Mã đơn</th>
                  <th scope="col" className={adminTh}>Khách hàng</th>
                  <th scope="col" className={`${adminTh} text-right`}>Số tiền (VND)</th>
                  <th scope="col" className={adminTh}>Trạng thái</th>
                  {/* Hai cột phụ nhường chỗ trước ở màn hẹp — chúng là ngữ cảnh, không
                      phải thứ người ta quét tìm. */}
                  <th scope="col" className={`${adminTh} max-lg:hidden`}>Phương thức</th>
                  <th scope="col" className={`${adminTh} max-md:hidden`}>Người tạo</th>
                  <th scope="col" className={`${adminTh} max-sm:hidden`} aria-label="Mở chi tiết" />
                </tr>
              </thead>
              <tbody className="max-sm:grid max-sm:gap-3 max-sm:p-3">
                {!daTai ? (
                  <KhungXuongDangTai />
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center max-sm:block">
                      <TrangThaiRong
                        dangLocChoDuyet={dangLocChoDuyet}
                        coLoc={chipDangBat.length > 0}
                        theoLead={moTaPhamVi !== null}
                        xoaHet={xoaHet}
                      />
                    </td>
                  </tr>
                ) : (
                  items.map((o) => {
                    const nhanDuyet = nhanChoDuyet(o.choDuyet);
                    const badgeDot = deriveInstallmentBadge(o.installments);
                    return (
                      <tr
                        key={o.id}
                        className={[
                          "relative transition-colors",
                          // Dòng chờ duyệt nhận NỀN TÔ, không phải vạch màu bên trái:
                          // craft-floor xếp `border-left` màu dày hơn 1px vào nhóm
                          // refuse-default. Nền + chip nói đủ, và nền còn đọc được ở
                          // chế độ thẻ (màn hẹp) nơi "bên trái" không còn nghĩa gì.
                          o.choDuyet.co ? "bg-state-warning-soft/30" : "",
                          // `hover` là TRANG TRÍ, không phải chức năng: màn cảm ứng
                          // không có hover (adapt.md), nên mọi thông tin vẫn hiện sẵn.
                          "hover:bg-muted/50 has-[a:focus-visible]:bg-muted/50",
                          "cursor-pointer max-sm:block max-sm:rounded-lg max-sm:border max-sm:border-border max-sm:py-2",
                          o.choDuyet.co ? "max-sm:border-state-warning-ink/40" : "",
                          "border-b border-border/60 last:border-0 sm:last:border-0",
                        ].join(" ")}
                      >
                        <td data-nhan="Mã đơn" className={`${adminTd} font-mono ${O_THE}`}>
                          <Link
                            href={`/orders/${o.id}`}
                            className="rounded after:absolute after:inset-0 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {o.code}
                          </Link>
                          <span className="ml-2 font-sans text-xs font-normal text-muted-foreground">
                            {ORDER_TYPE_LABEL[o.type]}
                          </span>
                        </td>

                        <td data-nhan="Khách" className={`${adminTd} sm:max-w-[16rem] ${O_THE}`}>
                          <span className="min-w-0 sm:block">
                            <span className="block truncate font-medium" title={o.customerName}>
                              {o.customerName}
                            </span>
                            {/* Dạng nội địa — xem chú thích cùng nội dung ở trang chi tiết đơn. */}
                            <span className="block text-xs text-muted-foreground">
                              {nationalPhone(o.customerPhone) ?? o.customerPhone}
                            </span>
                          </span>
                        </td>

                        <td
                          data-nhan="Số tiền"
                          className={`${adminTd} font-medium tabular-nums sm:text-right ${O_THE}`}
                        >
                          <span className="sm:block">
                            <span className="block">{o.totalAmount.toLocaleString("vi-VN")}</span>
                            {/* Số tiền phụ ĐỨNG CẠNH số tiền chính, không nhét vào cột
                                trạng thái: chúng là sự thật về TIỀN. Nhờ vậy mọi ô giữ
                                được `whitespace-nowrap` và chiều cao dòng không nhảy
                                (DESIGN.md §2 — luật cứng, không phải tuỳ chọn). */}
                            {o.trangThai.conThieu > 0 && (
                              <span className="block text-xs font-normal text-muted-foreground">
                                còn {o.trangThai.conThieu.toLocaleString("vi-VN")}
                              </span>
                            )}
                            {o.trangThai.choDoiSoat > 0 && (
                              <span className="block text-xs font-normal text-state-warning-ink">
                                chờ đối soát {o.trangThai.choDoiSoat.toLocaleString("vi-VN")}
                              </span>
                            )}
                          </span>
                        </td>

                        <td data-nhan="Trạng thái" className={`${adminTd} ${O_THE}`}>
                          <span className="flex items-center gap-1 max-sm:justify-end max-sm:flex-wrap">
                            {/* CHỜ DUYỆT đứng TRƯỚC nhãn tiền: đơn chờ duyệt là đơn không
                                xuất được mã QR, tức việc gấp hơn con số nợ. */}
                            {nhanDuyet && (
                              <Badge className="bg-state-warning-soft text-state-warning-ink hover:bg-state-warning-soft">
                                {nhanDuyet}
                              </Badge>
                            )}
                            {/* Nhãn SUY TỪ TIỀN, cùng nguồn với trang chi tiết [16/09/2026].
                                Server tính sẵn (`queryOrders`) — ở đây chỉ in, KHÔNG suy lại. */}
                            <Badge className={SAC_THAI_CLASS[o.trangThai.sacThai]}>
                              {o.trangThai.nhan}
                            </Badge>
                            {badgeDot && (
                              <Badge
                                className={
                                  badgeDot.color === "emerald"
                                    ? "bg-state-success-soft text-state-success-ink hover:bg-state-success-soft"
                                    : "bg-state-warning-soft text-state-warning-ink hover:bg-state-warning-soft"
                                }
                              >
                                {badgeDot.label}
                              </Badge>
                            )}
                          </span>
                        </td>

                        <td
                          data-nhan="Phương thức"
                          className={`${adminTd} text-muted-foreground max-lg:hidden ${O_THE}`}
                        >
                          {o.paymentMethod?.name ?? "—"}
                        </td>

                        <td data-nhan="Phụ trách" className={`${adminTd} max-md:hidden ${O_THE}`}>
                          <span className="sm:block">
                            {/* DÒNG CHÍNH = SALE PHỤ TRÁCH LEAD, không phải người bấm tạo đơn
                                [02/10/2026]. 119 đơn nhập từ file Excel đều mang `createdById` của
                                NGƯỜI NHẬP, nên cột cũ in CÙNG MỘT TÊN cho cả trang và không ai
                                biết khách đó của sale nào.
                            
                                Rơi về người tạo khi đơn không gắn lead (đơn thủ công) hoặc lead
                                chưa phân sale — KHÔNG in "—": với đơn thủ công thì người tạo
                                CHÍNH LÀ người phụ trách.
                            
                                "—" = đơn tạo TRƯỚC 31/08/2026 (chưa có cột `createdById`),
                                hoặc người tạo đã bị xoá. Cố ý không đoán từ nguồn khác. */}
                            {o.salePhuTrachName ?? o.createdByName ?? (
                              <span className="text-muted-foreground">—</span>
                            )}
                            {/* Chỉ hiện khi KHÁC người — in "tạo bởi X" ngay dưới chữ "X" là
                                nhiễu. Đây đúng là ca đợt nhập liệu: phụ trách là sale, người
                                tạo là người nhập. */}
                            {o.salePhuTrachName &&
                              o.createdByName &&
                              o.salePhuTrachName !== o.createdByName && (
                                <span className="block text-xs text-muted-foreground">
                                  tạo bởi {o.createdByName}
                                </span>
                              )}
                            <span className="block text-xs tabular-nums text-muted-foreground">
                              <span className="lg:hidden">{formatNgay(o.createdAt)}</span>
                              <span className="max-lg:hidden">{formatDateTime(o.createdAt)}</span>
                            </span>
                          </span>
                        </td>

                        <td className={`${adminTd} w-8 text-right text-muted-foreground max-sm:hidden`}>
                          {/* Mũi tên GIỮ LẠI: nó là dấu hiệu nhìn thấy được của "cả dòng
                              bấm được", và màn cảm ứng không có hover để thay nó. */}
                          <ChevronRight className="inline h-4 w-4" aria-hidden />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </PhanTrangBang>
        )}

        {!loi && (hasMore || (isPending && daTai)) && (
          <div className="flex justify-center border-t border-border p-3">
            <Button variant="outline" onClick={() => load(false)} disabled={isPending}>
              {isPending ? "Đang tải…" : "Tải thêm"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ChipLocBat({ nhan, onGo }: { nhan: string; onGo: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full border border-border bg-muted py-1 pl-3 pr-1 text-xs">
      <span className="truncate">{nhan}</span>
      {/* 24×24 là mức nhỏ nhất còn bấm trúng bằng ngón tay khi nó nằm trong một hàng
          chip dày; vùng bấm nới thêm bằng `p-1` của chính nút. */}
      <button
        type="button"
        onClick={onGo}
        aria-label={`Bỏ lọc ${nhan}`}
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full hover:bg-background"
      >
        <X className="h-3 w-3" aria-hidden />
      </button>
    </span>
  );
}

/**
 * Khung xương, KHÔNG phải spinner — DESIGN.md §5: *"Skeleton đúng hình dạng nội dung
 * thật, không phải spinner giữa màn"*.
 *
 * Vì sao quan trọng ở đúng màn này: bảng đơn là thứ người ta mở hàng chục lần một ngày.
 * Một spinner giữa khung trắng xoá mất cấu trúc, nên mỗi lượt tải mắt phải tìm lại vị trí
 * cột. Khung xương giữ nguyên lưới, nội dung chỉ việc "hiện ra".
 */
function KhungXuongDangTai() {
  return (
    <>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <tr key={i} className="border-b border-border/60 last:border-0 max-sm:block max-sm:rounded-lg max-sm:border">
          {[0, 1, 2, 3].map((j) => (
            <td key={j} className={`${adminTd} max-sm:block`}>
              <span
                className="block h-3 animate-pulse rounded bg-muted"
                style={{ width: `${[6, 9, 7, 8][j]}rem` }}
              />
            </td>
          ))}
          <td className={`${adminTd} max-lg:hidden`}>
            <span className="block h-3 w-20 animate-pulse rounded bg-muted" />
          </td>
          <td className={`${adminTd} max-md:hidden`}>
            <span className="block h-3 w-24 animate-pulse rounded bg-muted" />
          </td>
          <td className={`${adminTd} max-sm:hidden`} />
        </tr>
      ))}
    </>
  );
}

/**
 * Trạng thái RỖNG nói VÌ SAO rỗng và LÀM GÌ TIẾP (DESIGN.md §5).
 *
 * Bốn câu khác nhau cho bốn nguyên nhân khác nhau. Một câu chung ("Chưa có đơn hàng")
 * đúng về mặt chữ nghĩa trong cả bốn ca, và vô dụng trong ba ca.
 */
function TrangThaiRong({
  dangLocChoDuyet,
  coLoc,
  theoLead,
  xoaHet,
}: {
  dangLocChoDuyet: boolean;
  coLoc: boolean;
  theoLead: boolean;
  xoaHet: () => void;
}) {
  if (dangLocChoDuyet) {
    return <p className="text-sm text-muted-foreground">Không còn đơn nào chờ duyệt.</p>;
  }
  if (coLoc) {
    return (
      <div className="grid justify-items-center gap-3">
        <p className="text-sm text-muted-foreground">
          Không có đơn nào khớp bộ lọc đang bật.
        </p>
        <Button variant="outline" onClick={xoaHet}>
          Xoá bộ lọc
        </Button>
      </div>
    );
  }
  if (theoLead) {
    return (
      <div className="grid justify-items-center gap-3">
        <p className="text-sm text-muted-foreground">
          Chưa có đơn nào gắn với khách do bạn phụ trách.
        </p>
        <Link href="/leads">
          <Button variant="outline">Mở danh sách khách của tôi</Button>
        </Link>
      </div>
    );
  }
  return <p className="text-sm text-muted-foreground">Chưa có đơn hàng nào.</p>;
}

/** Lỗi: câu tiếng Việt đọc được + đường thử lại (DESIGN.md §5). */
function TrangThaiLoi({
  loi,
  dangTai,
  thuLai,
}: {
  loi: string;
  dangTai: boolean;
  thuLai: () => void;
}) {
  return (
    <div className="grid justify-items-center gap-3 px-5 py-12 text-center">
      <p className="text-sm font-medium text-foreground">{loi}</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Mạng hoặc máy chủ vừa không trả lời. Dữ liệu chưa mất gì — bấm thử lại.
      </p>
      <Button variant="outline" onClick={thuLai} disabled={dangTai}>
        {dangTai ? "Đang thử lại…" : "Thử lại"}
      </Button>
    </div>
  );
}
