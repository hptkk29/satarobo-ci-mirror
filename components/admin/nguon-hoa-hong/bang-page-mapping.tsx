"use client";

// components/admin/nguon-hoa-hong/bang-page-mapping.tsx — bảng SỬA TẠI CHỖ "Page → nhóm nguồn" (06 §5.1 "Page Mapping").
//
// Page chưa map đứng ĐẦU (do `docBangPageMapping` sắp) — đó là việc cần làm trước. Mỗi dòng tự lưu: chọn nguồn (và mã chiến dịch nếu
// cần) rồi bấm Lưu của CHÍNH dòng đó; không có nút "Lưu tất cả" để một dòng sai không kéo theo dòng khác.
//
// Nói thật về những gì bảng này làm (luật 12):
//  · Người KHÔNG có `sources:manage` thấy bảng chỉ-đọc: không select, không nút Lưu — thay bằng dòng nêu tên khoá + hỏi ai.
//  · Nút Lưu chỉ XUẤT HIỆN khi dòng đã đổi so với dữ liệu máy chủ (không vẽ nút xám bấm được).
//  · Cờ `nguon.pageMapping` tắt ⇒ dải thông báo "bảng này CHƯA có tác dụng với lead mới" (chỉnh được, nhưng đừng tưởng đã chạy).
//  · 375px: bảng min-w-820 cuộn ngang, nên ô chứa Lưu/Huỷ DÍNH mép phải (dưới `md`) — người đổi ô nguồn ở bên trái luôn với tới nút Lưu (cùng cách `bang-nguon.tsx`); chỉ dòng
//    ĐÃ ĐỔI mới dính (dòng bình thường dính là che cột Nguồn). Nút cao 44px dưới `md` (`NUT_NHO`).
//  · Chú thích dưới bảng nói theo CỜ: tắt ⇒ «khi bật», không khẳng định lead đã tự nhận nguồn (cùng dải «chưa có tác dụng» ở đầu bảng).
//  · Sau khi Lưu thành công, dòng GIỮ giá trị vừa lưu cho tới khi dữ liệu mới về (không quay về giá trị cũ rồi mới nhảy sang giá trị mới
//    — vài trăm ms màn hình nói sai, và trên mạng chậm người ta tưởng lưu hỏng rồi bấm lại). Bản nháp ghi kèm giá trị máy chủ lúc bắt
//    đầu sửa (`goc`); dữ liệu máy chủ đổi (kể cả do người KHÁC sửa) thì bản nháp cũ tự bị bỏ, không đè lên.
//
// Đổi NGUỒN (không phải chỉ mã chiến dịch) đi qua hộp thoại xác nhận (`HopThoaiDoiNguonPage`): lý do ≥ 10 ký tự + nói trước nếu cần `commission_policies:activate` (W2, res3 R3-M2).
//
// Hàm lưu được TIÊM (`luu`) — mặc định là Server Action; test dựng bằng hàm giả.
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { luuPageMappingAction } from "@/app/(admin)/admin/nguon-hoa-hong/nguon/_actions";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { StatusPill } from "@/components/admin/ui/status-pill";
import type { DongPage } from "@/lib/nguon/bang-nguon-theo-page";
import type { KetQuaLuuPageAction } from "@/lib/nguon/ket-qua-action";
import { cn } from "@/lib/utils";
import { BTN_OUTLINE, BTN_PRIMARY, FIELD, NUT_NHO, VO_BANG } from "./classes";
import { HopThoaiDoiNguonPage } from "./hop-thoai-doi-nguon-page";

type Luu = (input: { pageId: string; groupCode: string | null; campaignCode: string | null; lyDo: string | null }) => Promise<KetQuaLuuPageAction>;
const LUU_MAC_DINH: Luu = (input) => luuPageMappingAction(input);

const TH = cn(adminTh, "px-3");
const TD = cn(adminTd, "px-3");

type Nhap = { groupCode: string; campaign: string };
/** Bản nháp + giá trị máy chủ lúc bắt đầu sửa. Máy chủ đổi khác `goc` ⇒ bản nháp mồ côi, bỏ. */
type BanNhap = Nhap & { goc: Nhap };
const cungNhap = (a: Nhap, b: Nhap): boolean => a.groupCode === b.groupCode && a.campaign === b.campaign;

export function BangPageMapping({
  dong,
  nhom,
  coTheSua,
  coQuyenKichHoat,
  dinhTienTheoMa,
  runtimeBat,
  luu = LUU_MAC_DINH,
}: {
  dong: DongPage[];
  nhom: { code: string; name: string }[];
  /** Có `sources:manage` không — page tính, bảng không đoán (luật 7: bắt buộc). */
  coTheSua: boolean;
  /** Người xem CÓ `commission_policies:activate` không (`coQuyenKichHoatChinhSach`) — hộp thoại nói trước nếu đổi nguồn dính tiền mà thiếu quyền. Page đọc; bắt buộc (luật 7). */
  coQuyenKichHoat: boolean;
  /** Nguồn (theo mã) nào đang dính tiền theo rule — `docBangPageMapping`. */
  dinhTienTheoMa: Record<string, boolean>;
  /** Cờ `nguon.pageMapping` ∧ master. */
  runtimeBat: boolean;
  luu?: Luu;
}) {
  const router = useRouter();
  const [nhap, setNhap] = useState<Record<string, BanNhap>>({});
  const [vuaLuu, setVuaLuu] = useState<Record<string, true>>({});
  const [dangLamMoi, batDauLamMoi] = useTransition();
  const heo = useRef<HTMLDivElement>(null);
  const [loi, setLoi] = useState<Record<string, string>>({});
  const [dangLuu, setDangLuu] = useState<string | null>(null);
  /** Dòng đang chờ xác nhận ĐỔI NGUỒN (hộp thoại mở). */
  const [hoi, setHoi] = useState<string | null>(null);
  const [, batDau] = useTransition();

  const gocCua = (d: DongPage): Nhap => ({ groupCode: d.map?.groupCode ?? "", campaign: d.map?.campaignCode ?? "" });
  const hienTai = (d: DongPage): Nhap => {
    const b = nhap[d.pageId];
    return b && cungNhap(b.goc, gocCua(d)) ? b : gocCua(d);
  };
  const daDoi = (d: DongPage): boolean => {
    const a = hienTai(d);
    const g = gocCua(d);
    return a.groupCode !== g.groupCode || a.campaign.trim() !== g.campaign;
  };
  const sua = (d: DongPage, p: Partial<Nhap>) => {
    const nen = hienTai(d);
    setNhap((n) => ({ ...n, [d.pageId]: { groupCode: nen.groupCode, campaign: nen.campaign, ...p, goc: gocCua(d) } }));
    setVuaLuu((v) => {
      const { [d.pageId]: _bo, ...conLai } = v;
      void _bo;
      return conLai;
    });
    setLoi((l) => {
      const { [d.pageId]: _bo, ...conLai } = l;
      void _bo;
      return conLai;
    });
  };
  const hoanTac = (d: DongPage) =>
    setNhap((n) => {
      const { [d.pageId]: _bo, ...conLai } = n;
      void _bo;
      return conLai;
    });

  /** Đổi NGUỒN (gán · dời · gỡ) — khác đổi riêng mã chiến dịch, vốn không đổi người nhận tiền. */
  const doiNguon = (d: DongPage): boolean => hienTai(d).groupCode !== gocCua(d).groupCode;
  const tenNguon = (ma: string): string => nhom.find((n) => n.code === ma)?.name ?? ma;
  // Dòng đang hỏi + nguồn mới + «đụng tiền» (nguồn CŨ hoặc MỚI đang dính tiền theo rule): tính một lần cho hộp thoại.
  const hoiD = hoi === null ? undefined : dong.find((x) => x.pageId === hoi);
  const hoiDong = hoiD
    ? (() => {
        const den = hienTai(hoiD).groupCode;
        return { d: hoiD, den, dinhTien: (hoiD.map ? dinhTienTheoMa[hoiD.map.groupCode] === true : false) || (den !== "" && dinhTienTheoMa[den] === true) };
      })()
    : null;

  const boLoi = (pageId: string) =>
    setLoi((l) => {
      const { [pageId]: _bo, ...conLai } = l;
      void _bo;
      return conLai;
    });
  /** Mở hộp thoại xác nhận: lỗi máy chủ của lượt TRƯỚC (đã huỷ hộp thoại rồi mới mở lại) không được hiện sẵn như lỗi của lượt này. */
  function moHopThoai(d: DongPage) {
    boLoi(d.pageId);
    setHoi(d.pageId);
  }

  function luuDong(d: DongPage, lyDo: string | null) {
    const a = hienTai(d);
    setDangLuu(d.pageId);
    // Bấm lại sau một lần bị từ chối: lỗi cũ của dòng không được treo cạnh lượt mới (thành công mà lỗi cũ còn là nói dối).
    boLoi(d.pageId);
    batDau(async () => {
      let r: KetQuaLuuPageAction;
      try {
        // Gỡ nguồn (groupCode rỗng) ⇒ mã chiến dịch cũng bỏ: chiến dịch không đứng một mình.
        const gon = a.groupCode === "" ? null : a.groupCode;
        const cd = gon === null || a.campaign.trim() === "" ? null : a.campaign.trim();
        r = await luu({ pageId: d.pageId, groupCode: gon, campaignCode: cd, lyDo });
      } catch {
        r = { ok: false, error: "Không lưu được lúc này. Thử lại sau ít giây." };
      }
      setDangLuu(null);
      const trVeODong = () =>
        requestAnimationFrame(() =>
          Array.from(heo.current?.querySelectorAll<HTMLElement>("[data-page-nguon]") ?? [])
            .find((el) => el.dataset.pageNguon === d.pageId)
            ?.focus(),
        );
      if (!r.ok) {
        setLoi((l) => ({ ...l, [d.pageId]: r.error }));
        // Hộp thoại xác nhận (lyDo !== null) GIỮ MỞ cùng lý do người ta đã gõ, lỗi hiện NGAY trong hộp thoại: đóng nó trước khi biết kết quả thì
        // lý do mất sạch, lỗi chỉ hiện ở dòng bảng phía sau, và thử lại phải gõ lại từ đầu. Không hộp thoại (chỉ đổi mã chiến dịch) ⇒ trả focus về ô như cũ.
        if (lyDo === null) trVeODong();
        return;
      }
      setHoi(null);
      // Nút vừa bấm bị gỡ/khoá khỏi cây ⇒ trả focus về ô nguồn của CHÍNH dòng này (không để rơi về <body>).
      trVeODong();
      toast.success(a.groupCode === "" ? "Đã gỡ nguồn của Page." : "Đã lưu nguồn của Page.");
      // KHÔNG bỏ bản nháp ở đây: dòng giữ giá trị vừa lưu tới khi dữ liệu mới về (bản nháp tự mồ côi khi `goc` đổi).
      setVuaLuu((v) => ({ ...v, [d.pageId]: true }));
      batDauLamMoi(() => {
        router.refresh();
      });
    });
  }

  return (
    <div className="space-y-3" ref={heo}>
      {!runtimeBat && (
        <div role="status" className="flex items-start gap-2 rounded-lg bg-state-warning-soft px-3 py-2.5 text-sm text-state-warning-ink">
          <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Bảng này <b>chưa có tác dụng</b> với lead mới: tính năng tự gán nguồn theo Page đang tắt. Bạn vẫn sửa được bảng; nguồn sẽ được áp khi
            tính năng được bật.
          </p>
        </div>
      )}
      {!coTheSua && (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Lock aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Bạn chỉ xem được bảng này. Muốn gán nguồn cho Page cần quyền{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">sources:manage</code> — hỏi quản trị viên hệ thống.
          </span>
        </p>
      )}

      {dong.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-6 py-10 text-center">
          <p className="text-sm font-semibold text-foreground">Chưa có Page nào trong danh mục</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Page Facebook được thêm vào danh mục khi kết nối hộp thư Messenger. Khi có Page, bạn gán nguồn cho nó ở đây.
          </p>
        </div>
      ) : (
        <div className={VO_BANG}>
          {/* `relative`: nhãn `sr-only` trong ô là `position:absolute`; thiếu khối bao có định vị thì chúng thoát khỏi vùng cuộn và đẩy cả TRANG rộng hơn khung nhìn (đo 375px: 523px). */}
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th scope="col" className={TH}>
                    Page
                  </th>
                  <th scope="col" className={TH}>
                    Cơ sở
                  </th>
                  <th scope="col" className={TH}>
                    Nguồn
                  </th>
                  <th scope="col" className={TH}>
                    Mã chiến dịch
                  </th>
                  <th scope="col" className={cn(TH, "text-right")}>
                    Trạng thái
                  </th>
                </tr>
              </thead>
              <tbody>
                {dong.map((d) => {
                  const a = hienTai(d);
                  const doi = daDoi(d);
                  const ten = d.tenPage?.trim() || d.pageId;
                  const idNguon = `pm-${d.pageId}-nguon`;
                  const idCd = `pm-${d.pageId}-cd`;
                  const bangLoi = loi[d.pageId];
                  return (
                    <tr key={d.pageId} className={adminTr}>
                      <td className={cn(TD, "max-w-[16rem]")}>
                        <span className="block truncate font-medium" title={ten}>
                          {ten}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">Mã {d.pageId}</span>
                      </td>
                      <td className={cn(TD, "max-w-[9rem] truncate")} title={d.coSo?.name}>
                        {d.coSo ? (d.coSo.code ?? d.coSo.name) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className={TD}>
                        {coTheSua ? (
                          <>
                            <label htmlFor={idNguon} className="sr-only">
                              Nguồn của Page {ten}
                            </label>
                            <select
                              id={idNguon}
                              data-page-nguon={d.pageId}
                              value={a.groupCode}
                              disabled={dangLuu === d.pageId}
                              onChange={(e) => sua(d, { groupCode: e.target.value })}
                              aria-invalid={bangLoi ? true : undefined}
                              className={cn(FIELD, "w-60")}
                            >
                              <option value="">— Chưa gán nguồn —</option>
                              {nhom.map((n) => (
                                <option key={n.code} value={n.code}>
                                  {n.name}
                                </option>
                              ))}
                              {/* Nhóm đã ngừng nhưng Page còn trỏ vào: vẫn hiện đúng giá trị đang lưu, không giả vờ là "chưa gán". */}
                              {d.map && !nhom.some((n) => n.code === d.map!.groupCode) && (
                                <option value={d.map.groupCode}>{d.map.groupCode} (không còn dùng)</option>
                              )}
                            </select>
                          </>
                        ) : (
                          <span>{d.map ? (nhom.find((n) => n.code === d.map!.groupCode)?.name ?? d.map.groupCode) : <span className="text-muted-foreground">Chưa gán</span>}</span>
                        )}
                      </td>
                      <td className={TD}>
                        {coTheSua ? (
                          <>
                            <label htmlFor={idCd} className="sr-only">
                              Mã chiến dịch của Page {ten}
                            </label>
                            <input
                              id={idCd}
                              type="text"
                              value={a.campaign}
                              maxLength={64}
                              disabled={dangLuu === d.pageId || a.groupCode === ""}
                              onChange={(e) => sua(d, { campaign: e.target.value })}
                              placeholder={a.groupCode === "" ? "Gán nguồn trước" : "Tuỳ chọn"}
                              className={cn(FIELD, "w-40")}
                            />
                          </>
                        ) : (
                          <span className="text-muted-foreground">{d.map?.campaignCode ?? "—"}</span>
                        )}
                      </td>
                      <td className={cn(TD, "text-right", coTheSua && doi && "sticky right-0 z-10 bg-card md:relative md:bg-transparent")}>
                        {coTheSua && doi && vuaLuu[d.pageId] && dangLamMoi ? (
                          <span role="status" className="inline-flex items-center justify-end gap-2 text-xs text-muted-foreground">
                            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
                            Đang cập nhật…
                          </span>
                        ) : coTheSua && doi ? (
                          <span className="inline-flex items-center justify-end gap-2">
                            {/* Mỗi nút mang TÊN PAGE: N dòng có N nút "Lưu" y hệt nhau thì người đọc màn hình không phân biệt được. Nhãn bắt đầu bằng chữ hiển thị. */}
                            <button
                              type="button"
                              onClick={() => hoanTac(d)}
                              disabled={dangLuu === d.pageId}
                              aria-label={`Huỷ thay đổi của Page ${ten}`}
                              className={cn(BTN_OUTLINE, NUT_NHO)}
                            >
                              Huỷ
                            </button>
                            <button
                              type="button"
                              onClick={() => (doiNguon(d) ? moHopThoai(d) : luuDong(d, null))}
                              disabled={dangLuu === d.pageId}
                              aria-label={a.groupCode === "" ? `Gỡ nguồn của Page ${ten}` : `Lưu nguồn của Page ${ten}`}
                              className={cn(BTN_PRIMARY, NUT_NHO)}
                            >
                              {dangLuu === d.pageId && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
                              {a.groupCode === "" ? "Gỡ nguồn" : "Lưu"}
                            </button>
                          </span>
                        ) : (
                          <TrangThaiPage d={d} />
                        )}
                        {bangLoi && (
                          <span role="alert" className="mt-1 block whitespace-normal text-right text-xs text-state-danger-ink">
                            {bangLoi}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {dong.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {runtimeBat
            ? "Page chưa gán nguồn đứng đầu. Lead vào từ một Page đã gán sẽ tự nhận đúng nguồn đó và bị khoá — muốn đổi phải có quyền quản lý nguồn."
            : "Page chưa gán nguồn đứng đầu. Khi tính năng tự gán nguồn theo Page được bật, lead vào từ một Page đã gán sẽ tự nhận đúng nguồn đó và bị khoá — muốn đổi phải có quyền quản lý nguồn."}
        </p>
      )}

      {hoiDong && (
        <HopThoaiDoiNguonPage
          tenPage={hoiDong.d.tenPage?.trim() || hoiDong.d.pageId}
          tu={hoiDong.d.map ? tenNguon(hoiDong.d.map.groupCode) : null}
          den={hoiDong.den === "" ? null : tenNguon(hoiDong.den)}
          dinhTien={hoiDong.dinhTien}
          coQuyenKichHoat={coQuyenKichHoat}
          dangLuu={dangLuu === hoiDong.d.pageId}
          loiMayChu={loi[hoiDong.d.pageId] ?? null}
          xacNhan={(lyDo) => luuDong(hoiDong.d, lyDo)}
          dong={() => setHoi(null)}
        />
      )}
    </div>
  );
}

/** Chỉ nói điều ĐÁNG chú ý; dòng bình thường để trống (ô nguồn đã tự nói). */
function TrangThaiPage({ d }: { d: DongPage }) {
  if (!d.trongDanhMuc) {
    return (
      <StatusPill tone="danger" className="text-state-danger-ink">
        Không còn trong danh mục
      </StatusPill>
    );
  }
  if (d.dangTat) return <StatusPill tone="muted">Page đang tắt</StatusPill>;
  if (!d.map) {
    return (
      <StatusPill tone="warning" className="text-state-warning-ink">
        Chưa gán nguồn
      </StatusPill>
    );
  }
  return <span className="text-xs text-muted-foreground">Đã gán</span>;
}
