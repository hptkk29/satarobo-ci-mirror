"use client";

// components/admin/nguon-hoa-hong/link/phat-link-sheet.tsx — Sheet «Phát link / QR / mã» (+ nút «Phát link» của đầu trang).
//
// ── Một luật, hai nơi chạy ──────────────────────────────────────────────────────────────────────────────────
// Không có luật nào được viết ở đây. Ô chọn chỉ là BỘ LỌC dễ dùng (đối tác đang hoạt động → chương trình đang chạy của họ → website gắn campaign → trang đích đang bật); cổng thật là
// `kiemPhatLink` ở máy chủ (cùng `kiemLienKet` với lúc khách bấm link) chạy lại trong transaction. Đường dẫn: chọn trang đích khớp CHÍNH XÁC, hoặc — với mẫu tiền tố `/…/*` — nhập đường dẫn
// cụ thể và `khopDuongDan` (CÙNG hàm với máy chủ) báo ngay trong ô nếu không khớp mẫu.
// AFF-L6: một website có NHIỀU tên miền ⇒ ô «Trang đích» liệt kê theo `tên miền + đường dẫn`; thứ gửi lên máy chủ là ID trang đích (KHÔNG gửi tên miền — máy chủ suy từ dòng trang đích).
// Luật "đã chọn đủ chưa" ở `lib/affiliate/chon-dich-link.ts` — dùng chung với biểu mẫu «Tạo link» của cổng đối tác (không hai bản).
//
// ── Nói thật (luật 12) ──────────────────────────────────────────────────────────────────────────────────────
//  · Nơi gọi CHỈ dựng nút này khi `scope.has("affiliate_links:manage")` ∧ cờ Affiliate bật — đúng hai điều kiện của `phatLinkAction`.
//  · Danh sách rỗng KHÔNG im lặng: Sheet nói rõ thiếu gì (đối tác đang hoạt động? chương trình đang chạy? website đã gắn + trang đích bật?) và chỉ sang tab nào để sửa, thay vì một ô chọn trống.
//  · Không ô nào nhận URL tự do; không có ô SĐT/email.
//
// Hàm lưu được TIÊM (`phat`) — mặc định là Server Action; test dựng bằng hàm giả.
import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { phatLinkAction } from "@/app/(admin)/admin/nguon-hoa-hong/link/_actions";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { TuyChonPhatLink } from "@/lib/affiliate/doc-link";
import type { KetQuaPhatLink } from "@/lib/affiliate/ghi-link";
import { kiemLuaChonLink, nhanTrangDichChon, tienToCuaMau } from "@/lib/affiliate/chon-dich-link";
import { DO_DAI_NHAN_LINK_TOI_DA, LOAI_LINK, NHAN_LOAI_LINK, type LoaiLink } from "@/lib/affiliate/ghi-link-dau-vao";
import { cn } from "@/lib/utils";
import { BTN_OUTLINE, BTN_PRIMARY, LOI_O, NHAN_O, NUT_CHAN, NUT_NHO, O_NHAP } from "../classes";

type Phat = (vao: Record<string, unknown>) => Promise<KetQuaPhatLink>;
const PHAT_MAC_DINH: Phat = (vao) => phatLinkAction({ vao });

type Truong = "partyId" | "membershipId" | "siteId" | "landingPath" | "type" | "label";
type Loi = Partial<Record<Truong, string>>;
const THU_TU: Truong[] = ["partyId", "membershipId", "siteId", "landingPath", "type", "label"];
const laTruong = (t: string | undefined): t is Truong => t !== undefined && (THU_TU as string[]).includes(t);

/** Câu nói VÌ SAO danh sách đối tác trống, theo thứ tự điều kiện — để người dùng biết sửa ở đâu. */
export function lyDoRongPhatLink(c: TuyChonPhatLink["chanDoan"]): string {
  if (c.soDoiTacHoatDong === 0) {
    return c.soDoiTac === 0
      ? "Chưa có đối tác nào. Tạo đối tác ở tab Affiliate trước."
      : "Chưa có đối tác nào đang hoạt động. Duyệt hoặc kích hoạt đối tác ở tab Affiliate trước.";
  }
  if (c.soDoiTacCoChuongTrinh === 0) {
    return "Chưa có đối tác đang hoạt động nào tham gia một campaign đang chạy. Thêm đối tác vào campaign (thành viên phải đang hoạt động, campaign phải đang chạy) ở tab Campaign.";
  }
  return "Các campaign đang chạy chưa gắn website nào đang hoạt động, bật theo dõi và có trang đích bật. Gắn website vào campaign ở tab Campaign và bật trang đích ở tab Website.";
}

export function PhatLinkSheet({ tuyChon, dong, phat = PHAT_MAC_DINH, doiTacMaMacDinh = null }: { tuyChon: TuyChonPhatLink; dong: () => void; phat?: Phat; doiTacMaMacDinh?: string | null }) {
  const router = useRouter();
  const id = useId();
  const idTruong = (t: Truong) => `${id}-${t}`;

  // Chọn SẴN đối tác khi người dùng tới từ nút «Tạo link» ở bảng đối tác (`?doitac=<mã>`); các tầng dưới chỉ tự điền khi có đúng MỘT lựa chọn (cùng luật với `chonDoiTac`). Mã lạ ⇒ như không có.
  const dtMacDinh = doiTacMaMacDinh === null ? null : (tuyChon.doiTac.find((d) => d.ma === doiTacMaMacDinh) ?? null);
  const ctMacDinh = dtMacDinh && dtMacDinh.chuongTrinh.length === 1 ? dtMacDinh.chuongTrinh[0]! : null;
  const wMacDinh = ctMacDinh && ctMacDinh.websites.length === 1 ? ctMacDinh.websites[0]! : null;
  const [doiTacId, setDoiTacId] = useState(dtMacDinh?.id ?? "");
  const [membershipId, setMembershipId] = useState(ctMacDinh?.membershipId ?? "");
  const [siteId, setSiteId] = useState(wMacDinh?.siteId ?? "");
  const [trangId, setTrangId] = useState("");
  const [cuThe, setCuThe] = useState("");
  const [loai, setLoai] = useState<LoaiLink>("LINK");
  const [nhan, setNhan] = useState("");
  const [loi, setLoi] = useState<Loi>({});
  const [banner, setBanner] = useState<{ text: string; vuaDoi: boolean } | null>(null);
  const [dangLuu, setDangLuu] = useState(false);

  const doiTac = tuyChon.doiTac.find((d) => d.id === doiTacId) ?? null;
  const chuongTrinh = doiTac?.chuongTrinh.find((c) => c.membershipId === membershipId) ?? null;
  const website = chuongTrinh?.websites.find((w) => w.siteId === siteId) ?? null;
  const trang = website?.trangDich.find((t) => t.id === trangId) ?? null;

  const duongDan = useMemo(() => (trang === null ? "" : trang.kieu === "CHINH_XAC" ? trang.mau : cuThe.trim()), [trang, cuThe]);

  const xoaLoi = (...ts: Truong[]) => setLoi((cu) => (ts.some((t) => cu[t]) ? { ...cu, ...Object.fromEntries(ts.map((t) => [t, undefined])) } : cu));
  const moTaLoi = (t: Truong) => (loi[t] ? `${idTruong(t)}-loi` : undefined);

  function chonDoiTac(v: string) {
    setDoiTacId(v);
    const dt = tuyChon.doiTac.find((d) => d.id === v);
    const ct = dt && dt.chuongTrinh.length === 1 ? dt.chuongTrinh[0]! : null;
    chonChuongTrinh(ct ? ct.membershipId : "", dt ?? null);
    xoaLoi("partyId", "membershipId", "siteId", "landingPath");
  }
  function chonChuongTrinh(v: string, dt: (typeof tuyChon.doiTac)[number] | null = doiTac) {
    setMembershipId(v);
    const ct = dt?.chuongTrinh.find((c) => c.membershipId === v);
    const w = ct && ct.websites.length === 1 ? ct.websites[0]! : null;
    chonWebsite(w ? w.siteId : "", ct ?? null);
    xoaLoi("membershipId", "siteId", "landingPath");
  }
  function chonWebsite(v: string, ct: typeof chuongTrinh = chuongTrinh) {
    setSiteId(v);
    const w = ct?.websites.find((x) => x.siteId === v);
    const t = w && w.trangDich.length === 1 ? w.trangDich[0]! : null;
    chonTrang(t ? t.id : "", w ?? null);
    xoaLoi("siteId", "landingPath");
  }
  function chonTrang(v: string, w: typeof website = website) {
    setTrangId(v);
    const t = w?.trangDich.find((x) => x.id === v);
    setCuThe(t && t.kieu === "TIEN_TO" ? tienToCuaMau(t.mau) : "");
    xoaLoi("landingPath");
  }

  function focusLoi(l: Loi) {
    const dau = THU_TU.find((t) => l[t]);
    if (dau) queueMicrotask(() => document.getElementById(idTruong(dau))?.focus());
  }

  async function luu() {
    if (dangLuu) return;
    setBanner(null);
    const { loi: l } = kiemLuaChonLink({ daChonDoiTac: doiTac !== null, daChonChuongTrinh: chuongTrinh !== null, daChonWebsite: website !== null, trang, cuThe, nhan });
    setLoi(l);
    if (Object.keys(l).length > 0) {
      focusLoi(l);
      return;
    }

    setDangLuu(true);
    let r: KetQuaPhatLink;
    try {
      r = await phat({ partyId: doiTac!.id, membershipId, siteId, landingPageId: trang!.id, landingPath: duongDan.trim(), type: loai, label: nhan.trim() === "" ? null : nhan.trim() });
    } catch {
      r = { ok: false, loi: "Không lưu được lúc này. Thử lại sau ít giây." };
    }
    setDangLuu(false);
    if (!r.ok) {
      if (laTruong(r.truong)) {
        const gan: Loi = { [r.truong]: r.loi };
        setLoi(gan);
        focusLoi(gan);
      } else {
        setBanner({ text: r.loi, vuaDoi: r.truong === "vuaDoi" });
      }
      return;
    }
    toast.success(`Đã phát ${loai === "QR" ? "QR" : loai === "CODE" ? "mã" : "link"} cho «${doiTac!.ten}».`);
    dong();
    router.refresh();
  }

  const rong = tuyChon.doiTac.length === 0;

  return (
    <Sheet open onOpenChange={(m) => !m && !dangLuu && dong()}>
      <SheetContent className="admin-scope w-full gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border p-5 pr-12">
          <SheetTitle className="text-base font-semibold">Phát link / QR / mã</SheetTitle>
          <SheetDescription>Chọn đối tác, campaign, website và trang đích. Mỗi link mang một mã ngẫu nhiên, không chứa thông tin cá nhân.</SheetDescription>
        </SheetHeader>

        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void luu();
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="space-y-5 p-5">
            {banner && (
              <div role="alert" className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg bg-state-danger-soft px-3 py-2.5 text-sm text-state-danger-ink">
                <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="min-w-0 flex-1">{banner.text}</p>
                {banner.vuaDoi && (
                  <button
                    type="button"
                    onClick={() => {
                      dong();
                      router.refresh();
                    }}
                    className={cn(BTN_OUTLINE, NUT_NHO)}
                  >
                    Tải lại
                  </button>
                )}
              </div>
            )}

            {rong && (
              <div role="status" className="rounded-lg bg-state-warning-soft px-3 py-2.5 text-sm text-state-warning-ink">
                <p className="font-semibold">Chưa phát link được.</p>
                <p>{lyDoRongPhatLink(tuyChon.chanDoan)}</p>
              </div>
            )}

            <div>
              <label htmlFor={idTruong("partyId")} className={NHAN_O}>
                Đối tác
              </label>
              <select
                id={idTruong("partyId")}
                value={doiTacId}
                disabled={dangLuu || rong}
                onChange={(e) => chonDoiTac(e.target.value)}
                aria-invalid={loi.partyId ? true : undefined}
                aria-describedby={moTaLoi("partyId")}
                className={O_NHAP}
              >
                <option value="">{rong ? "Chưa có đối tác đủ điều kiện" : "Chọn đối tác"}</option>
                {tuyChon.doiTac.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.ten} ({d.ma})
                  </option>
                ))}
              </select>
              {!rong && <p className="mt-1 text-xs text-muted-foreground">Chỉ hiện đối tác đang hoạt động có chương trình đang chạy và website dùng được.</p>}
              {loi.partyId && (
                <p id={moTaLoi("partyId")} role="alert" className={LOI_O}>
                  {loi.partyId}
                </p>
              )}
            </div>

            <div>
              <label htmlFor={idTruong("membershipId")} className={NHAN_O}>
                Chương trình (campaign)
              </label>
              <select
                id={idTruong("membershipId")}
                value={membershipId}
                disabled={dangLuu || doiTac === null}
                onChange={(e) => chonChuongTrinh(e.target.value)}
                aria-invalid={loi.membershipId ? true : undefined}
                aria-describedby={moTaLoi("membershipId")}
                className={O_NHAP}
              >
                <option value="">{doiTac === null ? "Chọn đối tác trước" : "Chọn campaign"}</option>
                {(doiTac?.chuongTrinh ?? []).map((c) => (
                  <option key={c.membershipId} value={c.membershipId}>
                    {c.campaignTen} ({c.campaignMa})
                  </option>
                ))}
              </select>
              {loi.membershipId && (
                <p id={moTaLoi("membershipId")} role="alert" className={LOI_O}>
                  {loi.membershipId}
                </p>
              )}
            </div>

            <div>
              <label htmlFor={idTruong("siteId")} className={NHAN_O}>
                Website
              </label>
              <select
                id={idTruong("siteId")}
                value={siteId}
                disabled={dangLuu || chuongTrinh === null}
                onChange={(e) => chonWebsite(e.target.value)}
                aria-invalid={loi.siteId ? true : undefined}
                aria-describedby={moTaLoi("siteId")}
                className={O_NHAP}
              >
                <option value="">{chuongTrinh === null ? "Chọn campaign trước" : "Chọn website"}</option>
                {(chuongTrinh?.websites ?? []).map((w) => (
                  <option key={w.siteId} value={w.siteId}>
                    {w.ten} ({w.host})
                  </option>
                ))}
              </select>
              {loi.siteId && (
                <p id={moTaLoi("siteId")} role="alert" className={LOI_O}>
                  {loi.siteId}
                </p>
              )}
            </div>

            <div>
              <label htmlFor={idTruong("landingPath")} className={NHAN_O}>
                Trang đích
              </label>
              <select
                id={idTruong("landingPath")}
                value={trangId}
                disabled={dangLuu || website === null}
                onChange={(e) => chonTrang(e.target.value)}
                aria-invalid={loi.landingPath && trang === null ? true : undefined}
                aria-describedby={trang === null ? moTaLoi("landingPath") : undefined}
                className={O_NHAP}
              >
                <option value="">{website === null ? "Chọn website trước" : "Chọn trang đích"}</option>
                {(website?.trangDich ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {nhanTrangDichChon(t)}
                  </option>
                ))}
              </select>
              {trang?.kieu === "TIEN_TO" && (
                <div className="mt-2">
                  <label htmlFor={`${id}-cu-the`} className="mb-1 block text-xs font-semibold text-muted-foreground">
                    Đường dẫn cụ thể (phải nằm trong {trang.host}{trang.mau})
                  </label>
                  <input
                    id={`${id}-cu-the`}
                    value={cuThe}
                    disabled={dangLuu}
                    maxLength={300}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) => {
                      setCuThe(e.target.value);
                      xoaLoi("landingPath");
                    }}
                    aria-invalid={loi.landingPath ? true : undefined}
                    aria-describedby={moTaLoi("landingPath")}
                    className={cn(O_NHAP, "font-mono")}
                    placeholder={`${tienToCuaMau(trang.mau)}ten-trang`}
                  />
                </div>
              )}
              {loi.landingPath && (
                <p id={moTaLoi("landingPath")} role="alert" className={LOI_O}>
                  {loi.landingPath}
                </p>
              )}
              {trang !== null && duongDan !== "" && !loi.landingPath && (
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                  {trang.host}
                  {duongDan}
                </p>
              )}
            </div>

            <fieldset>
              <legend className={NHAN_O}>Loại</legend>
              <div className="flex flex-wrap gap-4">
                {LOAI_LINK.map((l) => (
                  <label key={l} className="inline-flex items-center gap-2 text-sm text-foreground">
                    <input type="radio" name={`${id}-loai`} value={l} checked={loai === l} disabled={dangLuu} onChange={() => setLoai(l)} />
                    {NHAN_LOAI_LINK[l]}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Loại chỉ để phân biệt nơi dùng (link bấm, QR in, mã đọc cho khách); cả ba cùng một cơ chế theo dõi.</p>
            </fieldset>

            <div>
              <label htmlFor={idTruong("label")} className={NHAN_O}>
                Nhãn (tuỳ chọn)
              </label>
              <input
                id={idTruong("label")}
                value={nhan}
                disabled={dangLuu}
                maxLength={DO_DAI_NHAN_LINK_TOI_DA}
                onChange={(e) => {
                  setNhan(e.target.value);
                  xoaLoi("label");
                }}
                aria-invalid={loi.label ? true : undefined}
                aria-describedby={moTaLoi("label")}
                className={O_NHAP}
                placeholder="Ví dụ: Poster hội chợ tháng 11"
              />
              {loi.label && (
                <p id={moTaLoi("label")} role="alert" className={LOI_O}>
                  {loi.label}
                </p>
              )}
            </div>
          </div>

          <div className="sticky bottom-0 z-10 mt-auto flex flex-wrap items-center justify-end gap-2 border-t border-border bg-popover p-4">
            <button type="button" onClick={dong} disabled={dangLuu} className={cn(BTN_OUTLINE, NUT_CHAN)}>
              Huỷ
            </button>
            <button type="submit" disabled={dangLuu || rong} className={cn(BTN_PRIMARY, NUT_CHAN)}>
              {dangLuu && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
              Phát link
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/** Nút «Phát link» của đầu trang + Sheet. Nơi gọi CHỈ dựng khi `scope.has("affiliate_links:manage")` ∧ cờ Affiliate bật — đúng hai điều kiện mà `phatLinkAction` kiểm. */
export function NutPhatLink({ tuyChon, phat, doiTacMaMacDinh = null }: { tuyChon: TuyChonPhatLink; phat?: Phat; doiTacMaMacDinh?: string | null }) {
  const [mo, setMo] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setMo(true)} className={BTN_PRIMARY}>
        <Plus aria-hidden className="h-4 w-4" />
        Phát link
      </button>
      {mo && <PhatLinkSheet tuyChon={tuyChon} dong={() => setMo(false)} phat={phat} doiTacMaMacDinh={doiTacMaMacDinh} />}
    </>
  );
}
