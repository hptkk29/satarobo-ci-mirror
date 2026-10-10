// components/admin/nguon-hoa-hong/chi-tiet-nguon/muc-thong-tin.tsx — MỤC 1 «Thông tin» và MỤC 2 «Attribution» của trang chi tiết nguồn.
//
// Server Component thuần: nhận props đã đọc, không gọi DB. «Chọn được ở ô nhập» và «hiệu lực» đi qua CHÍNH `nguonChonDuoc` mà ô chọn + cổng ghi dùng (luật 12b: một định nghĩa) —
// màn này không tự viết lại điều kiện nên không thể nói «chọn được» trong khi ô nhập từ chối.
import { ngayDMYTuMoc } from "@/lib/hoa-hong/dinh-dang";
import { cuaSoHieuLuc } from "@/lib/nguon/cua-so-ghi-cong";
import { DO_DAI_GIAI_TRINH_TOI_THIEU } from "@/lib/nguon/kiem-nguon";
import type { NguonDeSuaView } from "@/lib/nguon/doc-chi-tiet-nguon";
import type { KetQuaMuc } from "@/lib/nguon/doc-trang-chi-tiet";
import { nguonChonDuoc } from "@/lib/nguon/hieu-luc-nguon";
import { NHAN_NGUOI_GIOI_THIEU, yeuCauNhap } from "../nhan-nguon";
import { NguonStatusPill } from "../nguon-status-pill";
import { Hang, MucChiTiet, MucKhongDoc } from "./khung-muc";
import { nhanLoaiNguon } from "./nhan-chi-tiet";

const NGAY_MS = 86_400_000;

/** «01/11/2026 → hết 31/12/2026». `effectiveTo` là biên MỞ nên ngày cuối còn áp dụng là ngày trước đó. */
function moTaHieuLuc(tu: string | null, den: string | null): string {
  if (!tu && !den) return "Không giới hạn thời gian";
  const a = tu ? `từ ${ngayDMYTuMoc(new Date(tu))}` : "từ trước đến nay";
  const b = den ? `đến hết ${ngayDMYTuMoc(new Date(new Date(den).getTime() - NGAY_MS))}` : "chưa kết thúc";
  return `${a} · ${b}`;
}

function laiChonDuoc(g: NguonDeSuaView, now: Date): { chon: boolean; lyDo: string } {
  const chon = nguonChonDuoc(
    { status: g.status, selectable: g.selectable, effectiveFrom: g.effectiveFrom ? new Date(g.effectiveFrom) : null, effectiveTo: g.effectiveTo ? new Date(g.effectiveTo) : null },
    now,
  );
  if (chon) return { chon, lyDo: "lead mới chọn được nguồn này ở ô nhập." };
  if (g.status !== "ACTIVE") return { chon, lyDo: "nguồn chưa ở trạng thái «Đang dùng». Lead cũ mang nguồn này vẫn hiển thị và vẫn được tính." };
  if (!g.selectable) return { chon, lyDo: "ô nhập không cho chọn; hệ thống tự gán khi không xác định được nguồn." };
  return { chon, lyDo: "đang ngoài khoảng hiệu lực của nguồn. Lead cũ mang nguồn này vẫn hiển thị và vẫn được tính." };
}

export function MucThongTin({ nguon, tenDonVi, now }: { nguon: KetQuaMuc<NguonDeSuaView>; tenDonVi: string | null; now: Date }) {
  return (
    <MucChiTiet id="thong-tin" tieuDe="Thông tin">
      {!nguon.ok ? (
        <MucKhongDoc loai={nguon.loai} />
      ) : (
        (() => {
          const g = nguon.du;
          const khoaMa = g.khoa.find((k) => k.truong === "code");
          const chon = laiChonDuoc(g, now);
          return (
            <dl>
              <Hang nhan="Mã">
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{g.code}</code>
                {khoaMa && <span className="mt-1 block text-xs text-muted-foreground">Không đổi được mã: {khoaMa.lyDo}</span>}
              </Hang>
              <Hang nhan="Trạng thái">
                <NguonStatusPill status={g.status} />
                {g.isSystem && <span className="ml-2 text-xs text-muted-foreground">Nguồn hệ thống — không lưu trữ, không đổi mã</span>}
              </Hang>
              <Hang nhan="Nhóm nguồn">{nhanLoaiNguon(g.sourceType)}</Hang>
              {g.description && <Hang nhan="Mô tả">{g.description}</Hang>}
              <Hang nhan="Phạm vi đơn vị">{g.ownerOrgUnitId === null ? <span className="text-muted-foreground">Không giới hạn đơn vị</span> : (tenDonVi ?? <span className="text-muted-foreground">Đã gán một đơn vị (không đọc được tên)</span>)}</Hang>
              <Hang nhan="Người phụ trách">
                {g.ownerEmployee ? (
                  <>
                    {g.ownerEmployee.ten}
                    {g.ownerEmployee.maNv && <span className="text-muted-foreground"> ({g.ownerEmployee.maNv})</span>}
                    {!g.ownerEmployee.coTaiKhoan && <span className="mt-1 block text-xs text-state-warning-ink">Nhân sự này chưa có tài khoản — phần hoa hồng giao cho người phụ trách nguồn sẽ treo ở hàng chờ.</span>}
                  </>
                ) : (
                  <span className="text-muted-foreground">Chưa khai người phụ trách</span>
                )}
              </Hang>
              <Hang nhan="Hiệu lực">{moTaHieuLuc(g.effectiveFrom, g.effectiveTo)}</Hang>
              <Hang nhan="Chọn được ở ô nhập">
                <span className="font-medium">{chon.chon ? "Có" : "Không"}</span> — {chon.lyDo}
              </Hang>
              <Hang nhan="Thứ tự hiển thị">
                <span className="tabular-nums">{g.sortOrder}</span>
              </Hang>
            </dl>
          );
        })()
      )}
    </MucChiTiet>
  );
}

export function MucAttribution({
  nguon,
  cuaSoMacDinh,
}: {
  nguon: KetQuaMuc<NguonDeSuaView>;
  /** Cửa sổ mặc định toàn hệ (ngày); `null` = không đọc được. */
  cuaSoMacDinh: number | null;
}) {
  return (
    <MucChiTiet id="attribution" tieuDe="Attribution" ghiChu="Cách hệ thống xác định lead thuộc nguồn này, và lead được tính hoa hồng nguồn trong bao lâu.">
      {!nguon.ok ? (
        <MucKhongDoc loai={nguon.loai} />
      ) : (
        (() => {
          const g = nguon.du;
          const rieng = g.attributionWindowDays;
          return (
            <dl>
              <Hang nhan="Cửa sổ ghi công">
                {rieng !== null ? (
                  <>
                    <span className="tabular-nums">{rieng} ngày</span> kể từ lúc lead vào <span className="text-muted-foreground">(cửa sổ riêng của nguồn này)</span>
                  </>
                ) : cuaSoMacDinh !== null ? (
                  <>
                    <span className="tabular-nums">{cuaSoHieuLuc(null, cuaSoMacDinh)} ngày</span> kể từ lúc lead vào <span className="text-muted-foreground">(mặc định chung của hệ thống)</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">Dùng mặc định chung của hệ thống (không đọc được số ngày lúc này)</span>
                )}
                <span className="mt-1 block text-xs text-muted-foreground">Quá cửa sổ: lead vẫn giữ nguồn này nhưng không sinh hoa hồng nguồn.</span>
              </Hang>
              <Hang nhan="Cách xác định">
                {g.referrerRequirement === "NONE" ? "Không cần chọn người giới thiệu" : `Người nhập phải chọn: ${NHAN_NGUOI_GIOI_THIEU[g.referrerRequirement as keyof typeof NHAN_NGUOI_GIOI_THIEU].toLowerCase()}`}
              </Hang>
              <Hang nhan="Ô nhập yêu cầu">{yeuCauNhap({ referrerRequirement: g.referrerRequirement as keyof typeof NHAN_NGUOI_GIOI_THIEU, requiresNote: g.requiresNote, selectable: g.selectable })}</Hang>
              <Hang nhan="Giải trình">{g.requiresNote ? `Bắt buộc (từ ${DO_DAI_GIAI_TRINH_TOI_THIEU} ký tự) khi chọn nguồn này` : "Không bắt buộc"}</Hang>
            </dl>
          );
        })()
      )}
    </MucChiTiet>
  );
}
