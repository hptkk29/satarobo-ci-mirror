// components/admin/nguon-hoa-hong/campaign/khoi-hieu-qua.tsx — khối «Hiệu quả» của MỘT campaign Affiliate (AFF-P3 H1). Chỉ đọc; server component thuần (lọc ngày là điều hướng GET).
//
// Phễu: lượt bấm → referral (theo trạng thái) → hợp lệ → đã đăng ký → hoa hồng đã ghi sổ (theo trạng thái chi). Rồi bảng «theo đối tác».
// Mỗi con số nói đúng thứ nó đếm, và nói rõ PHẠM VI của nó (luật 12):
//   · lượt bấm = toàn hệ thống; referral / đã đăng ký = phần trong tầm nhìn cơ sở của người xem; hoa hồng = số của màn Sổ cho campaign này (KHÔNG theo khoảng ngày).
//   · tỉ lệ chỉ hiện khi tử và mẫu cùng phạm vi (`tiLe`); không có «0%» của một tập rỗng.
//   · khối nào người xem không có khoá thì NÓI là không có quyền — không để trống như thể bằng 0.
import Link from "next/link";

import { BTN_OUTLINE, BTN_PRIMARY, NHAN_O, O_NHAP, VO_BANG } from "@/components/admin/nguon-hoa-hong/classes";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { tiLe } from "@/lib/affiliate/bao-cao";
import type { BaoCaoHieuQua } from "@/lib/affiliate/doc-bao-cao";
import { NHAN_TRANG_THAI_REFERRAL, TRANG_THAI_REFERRAL } from "@/lib/affiliate/ghi-referral-dau-vao";
import { NHAN_TRANG_THAI_CHI } from "@/lib/hoa-hong/vi-sao-day-du";
import { dinhDangDong, dinhDangSo } from "@/lib/hoa-hong/vi-sao";
import { soVN } from "@/components/admin/nguon-hoa-hong/nhan-nguon";
import { cn } from "@/lib/utils";

// ON_HOLD đứng ĐẦU: dòng của người hưởng TỔ CHỨC đang giữ — thiếu nó, các dòng trạng thái không cộng lại bằng `tong` (luật 12).
const TRANG_THAI_CHI = ["ON_HOLD", "PENDING", "APPROVED", "EXPORTED", "PAID"] as const;
const TH = cn(adminTh, "px-3");
const TD = cn(adminTd, "px-3");
const SO = "text-right tabular-nums";

function Phan({ phan }: { phan: number | null }) {
  return phan === null ? null : <span className="ml-1 text-xs font-normal text-muted-foreground">({dinhDangSo(phan, Number.isInteger(phan) ? 0 : 1)}%)</span>;
}

function Dong({ nhan, children, ghiChu }: { nhan: string; children: React.ReactNode; ghiChu?: React.ReactNode }) {
  return (
    <div className="grid gap-x-6 gap-y-0.5 py-2 sm:grid-cols-[14rem_minmax(0,1fr)]">
      <dt className="text-sm text-muted-foreground">{nhan}</dt>
      <dd className="min-w-0 text-sm text-foreground">
        {children}
        {ghiChu && <div className="mt-0.5 text-xs text-muted-foreground">{ghiChu}</div>}
      </dd>
    </div>
  );
}

function KhongQuyen({ khoi, can }: { khoi: string; can: string }) {
  return (
    // Bọc <div>: <p> không được đứng thẳng dưới <dl> (HTML sai ⇒ trình đọc màn hình đọc lệch nhóm).
    <div>
      <p data-khong-quyen={khoi} className="py-2 text-sm text-muted-foreground">
        {khoi}: bạn chưa có quyền xem phần này ({can}).
      </p>
    </div>
  );
}

export function KhoiHieuQua({
  bc,
  action,
  hrefSo,
}: {
  bc: BaoCaoHieuQua;
  /** Địa chỉ của chính trang chi tiết (biểu mẫu chọn ngày GET về đây, kèm neo). */
  action: string;
  /** Liên kết sang tab Sổ lọc đúng campaign — null khi người xem không mở được tab Sổ. */
  hrefSo: string | null;
}) {
  const { khoang, luotBam, referral, hoaHong, doiTac } = bc;
  const hopLe = referral?.theoTrangThai.VALID ?? 0;
  // Referral KHÔNG nhất thiết đi qua một lượt bấm (biểu mẫu đặt trên website đối tác gửi thẳng token; link đã thu hồi vẫn nhận biểu mẫu và ghi «Từ chối»), nên referral có thể NHIỀU HƠN lượt bấm hợp lệ.
  // «200% so với lượt bấm» đọc như lỗi tính toán (luật 12) ⇒ chỉ in tỉ lệ khi tử ≤ mẫu; còn lại in số thật, không in phần trăm.
  const tiLeBamSangRef = luotBam && referral ? tiLe(referral.tong, luotBam.hopLe, referral.phamVi === "TAT_CA" && referral.tong <= luotBam.hopLe) : null;
  const tiLeDangKy = referral ? tiLe(referral.daDangKy, hopLe, true) : null;
  const gioiHanCoSo = referral?.phamVi === "GIOI_HAN";

  return (
    <div className="space-y-4" data-khoi-hieu-qua>
      <form method="get" action={`${action}#hieu-qua`} className="flex flex-wrap items-end gap-3" aria-label="Chọn khoảng ngày của báo cáo hiệu quả">
        <div>
          <label htmlFor="hq-tu" className={NHAN_O}>
            Từ ngày
          </label>
          <input id="hq-tu" name="tu" type="date" defaultValue={khoang.tu} required className={cn(O_NHAP, "w-40")} />
        </div>
        <div>
          <label htmlFor="hq-den" className={NHAN_O}>
            Đến ngày
          </label>
          <input id="hq-den" name="den" type="date" defaultValue={khoang.den} required className={cn(O_NHAP, "w-40")} />
        </div>
        <button type="submit" className={BTN_PRIMARY}>
          Xem
        </button>
        {!khoang.macDinh && (
          <Link href={`${action}#hieu-qua`} className={BTN_OUTLINE}>
            30 ngày gần nhất
          </Link>
        )}
      </form>
      {khoang.canhBao && (
        <p role="status" data-canh-bao className="rounded-lg bg-state-warning-soft px-3 py-2 text-sm text-state-warning-ink">
          {khoang.canhBao}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {khoang.macDinh ? "30 ngày gần nhất" : "Khoảng đã chọn"}: <b className="font-medium text-foreground">{khoang.tu}</b> đến <b className="font-medium text-foreground">{khoang.den}</b>. Khoảng ngày áp cho lượt bấm, referral và đã
        đăng ký (mỗi bước tính theo ngày phát sinh của chính nó, không theo dõi từng khách qua các bước). Hoa hồng không theo khoảng ngày.
      </p>

      <dl className="divide-y divide-border rounded-xl border border-border bg-card px-4">
        {luotBam ? (
          <Dong
            nhan="Lượt bấm vào link"
            ghiChu={
              <>
                Toàn hệ thống, ẩn danh (không lưu IP hay thiết bị). «Link không dùng được» là lượt bấm vào link đã thu hồi hoặc hết hiệu lực.
                {luotBam.theoLyDo.length > 0 && (
                  <ul className="mt-1 list-disc pl-5">
                    {luotBam.theoLyDo.map((l) => (
                      <li key={l.ma}>
                        {l.nhan} <span className="tabular-nums">({soVN(l.n)})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            }
          >
            <b data-so="luot-bam" className="tabular-nums">
              {soVN(luotBam.tong)}
            </b>{" "}
            lượt · <span className="tabular-nums">{soVN(luotBam.hopLe)}</span> vào link dùng được · <span className="tabular-nums">{soVN(luotBam.khongDung)}</span> vào link không dùng được
          </Dong>
        ) : (
          <KhongQuyen khoi="Lượt bấm" can="cần quyền xem đối tác hoặc quản lý link" />
        )}

        {referral ? (
          <>
            <Dong
              nhan="Referral"
              ghiChu={
                <>
                  {gioiHanCoSo ? <span data-pham-vi="gioi-han">Chỉ phần của cơ sở bạn (referral chưa quy được cơ sở chỉ Hội sở thấy). </span> : <span data-pham-vi="tat-ca">Mọi cơ sở. </span>}
                  Đếm theo trạng thái:
                  <ul className="mt-1 list-disc pl-5">
                    {TRANG_THAI_REFERRAL.map((t) => (
                      <li key={t}>
                        {NHAN_TRANG_THAI_REFERRAL[t]} <span className="tabular-nums">({soVN(referral.theoTrangThai[t])})</span>
                      </li>
                    ))}
                  </ul>
                </>
              }
            >
              <b data-so="referral" className="tabular-nums">
                {soVN(referral.tong)}
              </b>{" "}
              lượt gửi biểu mẫu <Phan phan={tiLeBamSangRef} />
              {tiLeBamSangRef !== null && <span className="text-xs text-muted-foreground"> so với lượt bấm hợp lệ</span>}
            </Dong>
            <Dong nhan="Hợp lệ — đã ghi công" ghiChu="Referral «Hợp lệ»: khách đã được ghi người giới thiệu. Không gồm «Cần xem tay».">
              <b data-so="hop-le" className="tabular-nums">
                {soVN(hopLe)}
              </b>
            </Dong>
            <Dong nhan="Đã đăng ký" ghiChu="Trong số referral hợp lệ, phiếu khách đã được chốt (đã chuyển thành học viên).">
              <b data-so="da-dang-ky" className="tabular-nums">
                {soVN(referral.daDangKy)}
              </b>{" "}
              <Phan phan={tiLeDangKy} />
            </Dong>
          </>
        ) : (
          <KhongQuyen khoi="Referral và đã đăng ký" can="cần quyền xem referral" />
        )}

        {hoaHong ? (
          <Dong
            nhan="Hoa hồng đã ghi sổ"
            ghiChu={
              <>
                {hoaHong.phamVi === "GIOI_HAN" ? <span data-pham-vi="gioi-han">Chỉ phần trong tầm nhìn sổ của bạn. </span> : <span data-pham-vi="tat-ca">Mọi cơ sở. </span>}
                Mọi dòng sổ thuộc campaign này (cả phần của nhân sự), từ trước đến nay — đúng số màn Sổ hiện khi lọc campaign.{" "}
                {hrefSo && (
                  <Link href={hrefSo} className="font-medium text-primary-ink hover:underline">
                    Mở Sổ đã lọc campaign
                  </Link>
                )}
                <ul className="mt-1 list-disc pl-5">
                  {TRANG_THAI_CHI.map((t) => (
                    <li key={t}>
                      {NHAN_TRANG_THAI_CHI[t]}: <span className="tabular-nums">{dinhDangDong(hoaHong.theoTrangThai[t].tien)}</span> ({soVN(hoaHong.theoTrangThai[t].soDong)} dòng)
                    </li>
                  ))}
                </ul>
              </>
            }
          >
            <b data-so="hoa-hong" className="tabular-nums">
              {dinhDangDong(hoaHong.tong.tien)}
            </b>{" "}
            · <span className="tabular-nums">{soVN(hoaHong.tong.soDong)}</span> dòng
          </Dong>
        ) : (
          <KhongQuyen khoi="Hoa hồng" can="cần quyền xem sổ hoa hồng của cơ sở và hoa hồng mới đang bật" />
        )}
      </dl>

      <section aria-label="Hiệu quả theo đối tác">
        <h3 className="mb-2 text-sm font-semibold text-foreground">Theo đối tác</h3>
        {doiTac.dong.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có hoạt động nào của đối tác trong khoảng này.</p>
        ) : (
          <div className={VO_BANG}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th scope="col" className={TH}>
                      Đối tác
                    </th>
                    {luotBam && (
                      <th scope="col" className={cn(TH, "text-right")}>
                        Lượt bấm
                      </th>
                    )}
                    {referral && (
                      <>
                        <th scope="col" className={cn(TH, "text-right")}>
                          Hợp lệ
                        </th>
                        <th scope="col" className={cn(TH, "text-right")}>
                          Cần xem tay
                        </th>
                        <th scope="col" className={cn(TH, "text-right")}>
                          Đã đăng ký
                        </th>
                      </>
                    )}
                    {hoaHong && (
                      <th scope="col" className={cn(TH, "text-right")}>
                        Hoa hồng đối tác nhận
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {doiTac.dong.map((d) => (
                    <tr key={d.partyId} className={adminTr} data-doi-tac={d.partyId}>
                      <td className={cn(TD, "font-medium")}>
                        {d.ten}
                        {d.ma && <span className="ml-2 text-xs font-normal text-muted-foreground">{d.ma}</span>}
                      </td>
                      {luotBam && <td className={cn(TD, SO)}>{soVN(d.luotBam)}</td>}
                      {referral && (
                        <>
                          <td className={cn(TD, SO)}>{soVN(d.referral.VALID)}</td>
                          <td className={cn(TD, SO)}>{soVN(d.referral.MANUAL_REVIEW)}</td>
                          <td className={cn(TD, SO)}>{soVN(d.daDangKy)}</td>
                        </>
                      )}
                      {hoaHong && <td className={cn(TD, SO)}>{d.hoaHong ? dinhDangDong(d.hoaHong.tien) : "—"}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {doiTac.biCat > 0 && (
          <p data-bi-cat className="mt-2 text-xs text-muted-foreground">
            Còn {soVN(doiTac.biCat)} đối tác khác có hoạt động nhưng không hiện ở đây (bảng chỉ hiện 50 đối tác đứng đầu).
          </p>
        )}
        {hoaHong && <p className="mt-2 text-xs text-muted-foreground">Cột «Hoa hồng đối tác nhận» là tiền các đối tác này NHẬN (dòng người hưởng là đối tác); phần của nhân sự không nằm trong bảng này.</p>}
      </section>
    </div>
  );
}
