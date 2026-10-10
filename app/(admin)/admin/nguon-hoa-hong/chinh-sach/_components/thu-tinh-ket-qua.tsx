// Kết quả THỬ TÍNH trên dữ liệu thật (04 §14, 06 §5.2). Chỉ VẼ — mọi con số đã tính ở máy chủ (`lib/hoa-hong/mo-phong-db.ts`), mọi luật hiển thị ở
// `lib/hoa-hong/mo-phong-ui.ts`. Không tiền nào được cộng/nhân ở đây.
//
// Thứ tự đọc (người duyệt chính sách cần biết "có đáng tin không" TRƯỚC khi đọc số):
//   1. nhãn "ước tính · không ghi sổ" + khoảng + dữ liệu của hôm nay
//   2. kết quả cũ / cắt / vượt trần / chưa thể tính (mỗi cái một dòng, cái nặng đứng trước)
//   3. bảng Hiện tại | Đề xuất | Chênh   4. bốn bảng phân rã (vai · nguồn · cơ sở · loại)   5. danh sách khoản vượt trần, chưa thể tính, thiếu người
// Bảng KHÔNG bọc thêm khung bo góc (không card-trong-card): chỉ kẻ trên-dưới; vùng cuộn ngang là div con.
import { TriangleAlert } from "lucide-react";

import { LienKetNangTran } from "@/components/admin/nguon-hoa-hong/khoi-vuot-tran";
import { adminTh } from "@/components/admin/ui/table";
import type { CanhBaoTran, DongPhanRa, KetQuaMoPhong } from "@/lib/hoa-hong/mo-phong";
import {
  canhBaoCuaKetQua,
  dinhDangChenh,
  dinhDangChenhTiLe,
  dinhDangTiLe,
  dinhDangTranPhanTram,
  nhanGioChay,
  nhanKhoang,
} from "@/lib/hoa-hong/mo-phong-ui";
import { dinhDangPhanTram } from "@/lib/hoa-hong/phan-tram";
import { dinhDangDong, dinhDangSo } from "@/lib/hoa-hong/vi-sao";
import { cn } from "@/lib/utils";

const TH = cn(adminTh, "px-3 py-2.5");
const TD = "whitespace-nowrap px-3 py-2.5 text-sm";
const SO = "tabular-nums text-right";
const BANG = "w-full border-collapse text-left";

/** Vùng cuộn ngang của bảng; `relative` để `sr-only` (position:absolute) không lọt ra ngoài và kéo cả trang tràn ngang. */
function VungBang({ children, tenBang }: { children: React.ReactNode; tenBang: string }) {
  return (
    <div className="relative overflow-x-auto border-y border-border" role="region" aria-label={tenBang} tabIndex={0}>
      {children}
    </div>
  );
}

function OChenh({ n }: { n: number }) {
  return <td className={cn(TD, SO, "font-medium", n === 0 ? "text-muted-foreground" : "text-foreground")}>{dinhDangChenh(n)}</td>;
}

function BangPhanRa({ tieuDe, cotDau, dong, coCoSo }: { tieuDe: string; cotDau: string; dong: DongPhanRa[]; coCoSo: boolean }) {
  return (
    <div>
      <h4 className="mb-2 text-sm font-semibold text-foreground">{tieuDe}</h4>
      <VungBang tenBang={tieuDe}>
        <table className={BANG} style={{ minWidth: coCoSo ? "33rem" : "28rem" }}>
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th scope="col" className={TH}>
                {cotDau}
              </th>
              <th scope="col" className={cn(TH, SO)}>
                Số khoản
              </th>
              {coCoSo && (
                <th scope="col" className={cn(TH, SO)}>
                  Thực thu
                </th>
              )}
              <th scope="col" className={cn(TH, SO)}>
                Hiện tại
              </th>
              <th scope="col" className={cn(TH, SO)}>
                Đề xuất
              </th>
              <th scope="col" className={cn(TH, SO)}>
                Chênh
              </th>
            </tr>
          </thead>
          <tbody>
            {dong.length === 0 ? (
              <tr>
                <td colSpan={coCoSo ? 6 : 5} className={cn(TD, "text-muted-foreground")}>
                  Không có khoản nào.
                </td>
              </tr>
            ) : (
              dong.map((d) => (
                <tr key={d.khoa} className="h-11 border-b border-border/60 last:border-0">
                  <th scope="row" className={cn(TD, "max-w-[16rem] truncate font-medium text-foreground")} title={d.nhan}>
                    {d.nhan}
                  </th>
                  <td className={cn(TD, SO)}>{dinhDangSo(d.soKhoan)}</td>
                  {coCoSo && <td className={cn(TD, SO)}>{dinhDangDong(d.coSo)}</td>}
                  <td className={cn(TD, SO)}>{dinhDangDong(d.hienTai)}</td>
                  <td className={cn(TD, SO)}>{dinhDangDong(d.deXuat)}</td>
                  <OChenh n={d.chenh} />
                </tr>
              ))
            )}
          </tbody>
        </table>
      </VungBang>
    </div>
  );
}

function giaTriVai(v: CanhBaoTran["vai"][number]): string {
  return v.kieuTinh === "PERCENT" ? `${dinhDangPhanTram(v.giaTri)}%` : v.kieuTinh === "FIXED_PER_PURCHASE" ? dinhDangDong(Number(v.giaTri)) : v.kieuTinh;
}

function DanhSachVuotTran({ k }: { k: KetQuaMoPhong }) {
  const ds = k.tran.deXuat.danhSach;
  if (ds.length === 0) return null;
  const them = k.tran.deXuat.soKhoan - ds.length;
  return (
    <div>
      <h4 className="mb-2 text-sm font-semibold text-foreground">Khoản vượt trần {dinhDangTranPhanTram(k.tran.gioiHan)} dưới chính sách đề xuất</h4>
      <VungBang tenBang="Khoản vượt trần dưới chính sách đề xuất">
        <table className={BANG} style={{ minWidth: "44rem" }}>
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th scope="col" className={TH}>
                Ngày thu
              </th>
              <th scope="col" className={TH}>
                Cơ sở
              </th>
              <th scope="col" className={TH}>
                Loại
              </th>
              <th scope="col" className={cn(TH, SO)}>
                Thực thu
              </th>
              <th scope="col" className={cn(TH, SO)}>
                Tổng tỉ lệ
              </th>
              <th scope="col" className={TH}>
                Các vai
              </th>
            </tr>
          </thead>
          <tbody>
            {ds.map((c) => (
              <tr key={c.paymentId} className="h-11 border-b border-border/60 last:border-0">
                <td className={cn(TD, "tabular-nums")}>{c.ngayThu.split("-").reverse().join("/")}</td>
                <td className={cn(TD, "max-w-[12rem] truncate")} title={c.donVi}>
                  {c.donVi}
                </td>
                <td className={TD}>{c.loai === "NEW" ? "Mới" : "Tái tục"}</td>
                <td className={cn(TD, SO)}>{dinhDangDong(c.coSo)}</td>
                <td className={cn(TD, SO, "font-semibold text-state-danger-ink")}>{dinhDangTiLe(c.tiLe)}</td>
                <td className={cn(TD, "max-w-[20rem] truncate text-muted-foreground")} title={c.vai.map((v) => `${v.vai} ${giaTriVai(v)}`).join(" · ")}>
                  {c.vai.map((v) => `${v.vai} ${giaTriVai(v)}`).join(" · ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </VungBang>
      {them > 0 && <p className="mt-2 text-sm text-muted-foreground">và {dinhDangSo(them)} khoản khác cùng lỗi (chỉ liệt kê {ds.length} khoản đầu).</p>}
    </div>
  );
}

function BangLyDo({ tieuDe, moTa, cot, dong }: { tieuDe: string; moTa: string; cot: [string, string, string]; dong: { ma: string; nhan: string; a: number; b: number }[] }) {
  if (dong.length === 0) return null;
  return (
    <div>
      <h4 className="text-sm font-semibold text-foreground">{tieuDe}</h4>
      <p className="mb-2 mt-0.5 text-sm text-muted-foreground">{moTa}</p>
      <VungBang tenBang={tieuDe}>
        <table className={BANG} style={{ minWidth: "30rem" }}>
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th scope="col" className={TH}>
                {cot[0]}
              </th>
              <th scope="col" className={cn(TH, SO)}>
                {cot[1]}
              </th>
              <th scope="col" className={cn(TH, SO)}>
                {cot[2]}
              </th>
            </tr>
          </thead>
          <tbody>
            {dong.map((d) => (
              <tr key={d.ma} className="h-11 border-b border-border/60 last:border-0">
                <th scope="row" className={cn(TD, "whitespace-normal font-medium text-foreground")}>
                  {d.nhan}
                </th>
                <td className={cn(TD, SO)}>{dinhDangSo(d.a)}</td>
                <td className={cn(TD, SO)}>{dinhDangDong(d.b)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </VungBang>
    </div>
  );
}

type DongThieu = { ma: string; nhan: string; dongHien: number; tienHien: number; dongDe: number; tienDe: number };

/** Vai có quy tắc mà chưa có người hưởng — HAI kịch bản cạnh nhau (một kịch bản vượt trần thì không còn dòng nào để "thiếu", nên không được ẩn bên kia). */
function BangThieuNguoi({ dong }: { dong: DongThieu[] }) {
  if (dong.length === 0) return null;
  const ten = "Vai có quy tắc nhưng chưa có người hưởng";
  return (
    <div>
      <h4 className="text-sm font-semibold text-foreground">{ten}</h4>
      <p className="mb-2 mt-0.5 text-sm text-muted-foreground">Phần hoa hồng này chưa có ai nhận nên KHÔNG nằm trong tổng; cột tiền là số CÓ THỂ phát sinh nếu bổ sung người.</p>
      <VungBang tenBang={ten}>
        <table className={BANG} style={{ minWidth: "38rem" }}>
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th scope="col" className={TH}>
                Lý do
              </th>
              <th scope="col" className={cn(TH, SO)}>
                Dòng hiện tại
              </th>
              <th scope="col" className={cn(TH, SO)}>
                Tiềm năng hiện tại
              </th>
              <th scope="col" className={cn(TH, SO)}>
                Dòng đề xuất
              </th>
              <th scope="col" className={cn(TH, SO)}>
                Tiềm năng đề xuất
              </th>
            </tr>
          </thead>
          <tbody>
            {dong.map((d) => (
              <tr key={d.ma} className="h-11 border-b border-border/60 last:border-0">
                <th scope="row" className={cn(TD, "max-w-[18rem] truncate font-medium text-foreground")} title={d.nhan}>
                  {d.nhan}
                </th>
                <td className={cn(TD, SO)}>{dinhDangSo(d.dongHien)}</td>
                <td className={cn(TD, SO)}>{dinhDangDong(d.tienHien)}</td>
                <td className={cn(TD, SO)}>{dinhDangSo(d.dongDe)}</td>
                <td className={cn(TD, SO)}>{dinhDangDong(d.tienDe)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </VungBang>
    </div>
  );
}

/** `coQuyenSuaTran` BẮT BUỘC, không mặc định (luật 7): quyết liên kết «Mở Cấu hình vận hành để nâng trần» của cảnh báo vượt trần — chỉ người có `settings:edit` thấy. */
export function KhoiKetQuaThuTinh({ ketQua: k, chayLuc, cu, coQuyenSuaTran }: { ketQua: KetQuaMoPhong; chayLuc: string; cu: boolean; coQuyenSuaTran: boolean }) {
  const canhBao = canhBaoCuaKetQua(k);
  // Vai thiếu người: gộp theo mã lý do, HAI kịch bản cạnh nhau.
  const maThieu = [...new Set([...k.thieuNguoi.hienTai, ...k.thieuNguoi.deXuat].map((x) => x.ma))];
  const thieu: DongThieu[] = maThieu.map((ma) => {
    const h = k.thieuNguoi.hienTai.find((x) => x.ma === ma);
    const d = k.thieuNguoi.deXuat.find((x) => x.ma === ma);
    return { ma, nhan: (d ?? h)!.nhan, dongHien: h?.soKhoan ?? 0, tienHien: h?.soTien ?? 0, dongDe: d?.soKhoan ?? 0, tienDe: d?.soTien ?? 0 };
  });
  const ngoaiThuTinh = [
    k.ngoai.soKhoanHoan > 0 ? `${dinhDangSo(k.ngoai.soKhoanHoan)} khoản hoàn / điều chỉnh âm (${dinhDangDong(k.ngoai.tienHoan)})` : null,
    k.ngoai.soKhoanChuyenNoiBo > 0 ? `${dinhDangSo(k.ngoai.soKhoanChuyenNoiBo)} khoản chuyển tiền nội bộ` : null,
    k.ngoai.soKhoanKhongPhaiHocPhi > 0 ? `${dinhDangSo(k.ngoai.soKhoanKhongPhaiHocPhi)} khoản không phải học phí` : null,
  ].filter((x): x is string => x !== null);

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6" data-testid="ket-qua-thu-tinh">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
        <p className="text-sm text-foreground">
          <span className="font-semibold">Ước tính trên dữ liệu {nhanKhoang(k.khoang)}, KHÔNG ghi sổ.</span> Chạy lúc <span className="tabular-nums">{nhanGioChay(chayLuc)}</span>
          {k.phamVi.soCoSo !== null ? ` · ${k.phamVi.soCoSo} cơ sở` : ""}.
        </p>
        <p className="text-sm text-muted-foreground">
          Nguồn lead, người phụ trách và phân loại học viên lấy theo dữ liệu hôm nay, không phải ảnh chụp lúc khoản thu xảy ra. “Hiện tại” = chính sách đang có hiệu lực hôm nay; “Đề xuất” = cùng bộ đó
          nhưng quy tắc của chính sách này được thay bằng bản nháp.
        </p>
      </div>

      {cu && (
        <div role="status" className="flex items-start gap-3 rounded-lg border border-state-warning-ink/40 bg-state-warning-soft px-4 py-3 text-sm text-state-warning-ink">
          <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Kết quả này là của bản nháp ở lần lưu trước (hoặc bạn đang sửa dở) — chạy lại để có số đúng bản đang soạn.</p>
        </div>
      )}

      {canhBao.length > 0 && (
        <ul className="grid gap-2" aria-label="Điều cần biết trước khi đọc số">
          {canhBao.map((c) => (
            <li
              key={c.ma}
              role={c.mucDo === "loi" ? "alert" : "status"}
              className={cn(
                "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm",
                c.mucDo === "loi" ? "border-state-danger-ink/40 bg-state-danger-soft text-state-danger-ink" : "border-state-warning-ink/40 bg-state-warning-soft text-state-warning-ink",
              )}
            >
              <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                {c.noiDung}
                {c.duongDan && coQuyenSuaTran && (
                  <>
                    {" "}
                    <LienKetNangTran duongDan={c.duongDan} coQuyenSuaTran={coQuyenSuaTran} className="whitespace-nowrap" />
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}

      {k.soKhoanTinhDuoc === 0 ? (
        <p className="border-y border-border px-3 py-4 text-sm text-foreground">
          Không có khoản thu nào tính được trong khoảng và phạm vi này
          {k.soKhoanTrongKhoang > 0 ? ` (có ${dinhDangSo(k.soKhoanTrongKhoang)} khoản thu nhưng chưa thể tính — xem bên dưới)` : ""}. Thử khoảng dài hơn hoặc bỏ lọc đơn vị.
        </p>
      ) : (
        <>
          <p className="text-sm text-foreground">
            Thực thu tính được (sau VAT): <span className="font-semibold tabular-nums">{dinhDangDong(k.coSo)}</span> — cùng một số cho cả “Hiện tại” và “Đề xuất”.
          </p>
          <VungBang tenBang="Tóm tắt Hiện tại, Đề xuất, Chênh">
            <table className={BANG}>
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th scope="col" className={cn(TH, "px-2 sm:px-3")}>
                    <span className="sr-only">Bản</span>
                  </th>
                  <th scope="col" className={cn(TH, SO, "whitespace-normal px-2 leading-tight sm:whitespace-nowrap sm:px-3")}>
                    Tổng hoa hồng
                  </th>
                  <th scope="col" className={cn(TH, SO, "whitespace-normal px-2 leading-tight sm:whitespace-nowrap sm:px-3")}>
                    Tỉ lệ hiệu dụng
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="h-14 border-b border-border/60">
                  <th scope="row" className={cn(TD, "px-2 font-medium text-foreground sm:px-3")}>
                    Hiện tại
                  </th>
                  <td className={cn(TD, SO, "px-2 font-semibold sm:px-3 sm:text-xl")}>{dinhDangDong(k.hoaHong.hienTai)}</td>
                  <td className={cn(TD, SO, "px-2 sm:px-3")}>{dinhDangTiLe(k.tiLeHieuDung.hienTai)}</td>
                </tr>
                <tr className="h-14 border-b border-border/60">
                  <th scope="row" className={cn(TD, "px-2 font-medium text-foreground sm:px-3")}>
                    Đề xuất
                  </th>
                  <td className={cn(TD, SO, "px-2 font-semibold sm:px-3 sm:text-xl")}>{dinhDangDong(k.hoaHong.deXuat)}</td>
                  <td className={cn(TD, SO, "px-2 sm:px-3")}>{dinhDangTiLe(k.tiLeHieuDung.deXuat)}</td>
                </tr>
                <tr className="h-14">
                  <th scope="row" className={cn(TD, "px-2 font-semibold text-foreground sm:px-3")}>
                    Chênh
                  </th>
                  <td className={cn(TD, SO, "px-2 font-semibold sm:px-3 sm:text-xl", k.hoaHong.chenh === 0 && "text-muted-foreground")}>{dinhDangChenh(k.hoaHong.chenh)}</td>
                  <td className={cn(TD, SO, "px-2 font-medium sm:px-3")}>{dinhDangChenhTiLe(k.tiLeHieuDung.hienTai, k.tiLeHieuDung.deXuat)}</td>
                </tr>
              </tbody>
            </table>
          </VungBang>
          <p className="-mt-3 text-sm text-foreground">
            <span className="font-semibold tabular-nums">{dinhDangSo(k.soNguoiAnhHuong)} người</span> có hoa hồng thay đổi.
          </p>
          <p className="-mt-3 text-sm text-muted-foreground">
            {dinhDangSo(k.soKhoanTinhDuoc)} khoản thu được tính
            {k.soKhoanTrongKhoang !== k.soKhoanTinhDuoc ? ` trên ${dinhDangSo(k.soKhoanTrongKhoang)} khoản thu trong khoảng` : ""}.
          </p>

          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
            <BangPhanRa tieuDe="Theo vai hưởng" cotDau="Vai" dong={k.phanRa.vai} coCoSo={false} />
            <BangPhanRa tieuDe="Theo nhóm nguồn" cotDau="Nguồn" dong={k.phanRa.nguon} coCoSo />
            <BangPhanRa tieuDe="Theo cơ sở" cotDau="Cơ sở" dong={k.phanRa.donVi} coCoSo />
            <BangPhanRa tieuDe="Theo loại giao dịch" cotDau="Loại" dong={k.phanRa.loai} coCoSo />
          </div>
        </>
      )}

      <DanhSachVuotTran k={k} />

      <BangLyDo
        tieuDe={`Khoản chưa thể tính (${dinhDangSo(k.chuaTinh.soKhoan)})`}
        moTa="Thiếu dữ liệu để quyết nên engine thật cũng đang để chúng ở hàng chờ. Không nằm trong số ở trên, không bị tính là 0đ."
        cot={["Lý do", "Số khoản", "Thực thu"]}
        dong={k.chuaTinh.theoLyDo.map((x) => ({ ma: x.ma, nhan: x.nhan, a: x.soKhoan, b: x.soTien }))}
      />

      <BangThieuNguoi dong={thieu} />

      {ngoaiThuTinh.length > 0 && <p className="text-sm text-muted-foreground">Không nằm trong thử tính: {ngoaiThuTinh.join("; ")}.</p>}
    </div>
  );
}
