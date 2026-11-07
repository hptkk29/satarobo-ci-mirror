"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { kiemBieuMau, type LoiBieuMau } from "@/lib/finance/hoa-don/yeu-cau-nguoi-mua-bieu-mau";
import type { OTrenForm } from "@/lib/finance/hoa-don/yeu-cau-nguoi-mua-cong-khai";
import type { OKhoa } from "@/lib/finance/hoa-don/yeu-cau-nguoi-mua";
import { guiThongTinNguoiMuaAction } from "../_actions";
import { NHAN_DONG_Y, NOI_DUNG_QUYEN_RIENG_TU } from "../_hang-so";
import { ThongBaoLienKet } from "./thong-bao-lien-ket";

// Biểu mẫu công khai cho phụ huynh điền thông tin người mua hoá đơn (Invoice Hub đợt 2, S11). Quét QR bằng điện thoại, không đăng nhập.
//
// Quyết định thiết kế:
//  · Chỉ HAI lựa chọn (cá nhân / doanh nghiệp) ⇒ nút chọn gắn liền thay cho ô thả xuống: thấy hết lựa chọn, bấm một lần, vùng bấm ≥ 44px. Dùng <input type="radio"> gốc (đã đúng ngữ nghĩa +
//    bàn phím + đọc màn hình) — repo chưa có RadioGroup/Checkbox của shadcn và không thêm thư viện.
//  · Ô nhập cao 44px, chữ 16px (dưới 16px iOS Safari tự phóng to trang khi chạm ô). Một cột ở mọi độ rộng, không cuộn ngang.
//  · Lỗi hiện NGAY DƯỚI ô (cùng `aria-describedby`), không toast; mục lỗi đầu tiên nhận focus sau mỗi lần gửi hỏng.
//  · [02/11/2026, chủ dự án] Khối ô theo LOẠI người mua, lấy theo khối «Người mua trên hoá đơn» của nhân viên:
//      cá nhân  — BẮT BUỘC họ tên ba/mẹ · CCCD ba/mẹ · địa chỉ; tuỳ chọn SĐT, email và khối học viên (tên · ngày sinh · CCCD);
//      doanh nghiệp — BẮT BUỘC tên doanh nghiệp · mã số thuế · địa chỉ · email nhận hoá đơn.
//  · [03/11/2026, chủ dự án] ĐIỀN SẴN từ đơn / hồ sơ / phiếu lead (tên, SĐT, email, địa chỉ, học viên) để phụ huynh chỉ sửa chỗ sai. Hai ô CCCD thì KHÔNG BAO GIỜ điền sẵn (máy chủ không gửi xuống) —
//    lộ liên kết không được lộ CCCD. Bản điền sẵn được GỬI LẠI nguyên văn (`banDau`) để máy chủ biết ô nào PH thật sự sửa: ô không đụng thì không đè lên chỉnh sửa của nhân viên làm trong lúc PH đang mở form.
//  · Luật kiểm là `kiemBieuMau` — CÙNG hàm với Server Action; client chỉ để phản hồi sớm, cổng thật ở máy chủ.
//  · Gửi: khoá nút + một cờ ref (chống bấm đôi trước khi React kịp vẽ lại).

type Props = { ma: string; datTruoc: OTrenForm };
type Buoc = { kieu: "FORM" } | { kieu: "XONG" } | { kieu: "HET"; thongDiep: string };
type LoaiChon = "CA_NHAN" | "DOANH_NGHIEP";

/** Thứ tự các ô trên màn — dùng để đưa focus tới ô lỗi ĐẦU TIÊN (trên xuống dưới). */
const THU_TU_O = ["loai", "ten", "maSoThue", "cccd", "sdt", "diaChi", "email", "tenHocVien", "ngaySinhHocVien", "cccdHocVien"] as const satisfies readonly OKhoa[];
const ID_O: Record<(typeof THU_TU_O)[number], string> = {
  loai: "o-loai-ca-nhan",
  ten: "o-ten",
  maSoThue: "o-mst",
  cccd: "o-cccd",
  sdt: "o-sdt",
  diaChi: "o-dia-chi",
  email: "o-email",
  tenHocVien: "o-ten-hoc-vien",
  ngaySinhHocVien: "o-ngay-sinh-hoc-vien",
  cccdHocVien: "o-cccd-hoc-vien",
};
const ID_DONG_Y = "o-dong-y";

const nhanTen = (l: LoaiChon) => (l === "DOANH_NGHIEP" ? "Tên doanh nghiệp" : "Họ và tên của ba/mẹ");
const goiYTen = (l: LoaiChon) => (l === "DOANH_NGHIEP" ? "Ghi đúng tên trên giấy đăng ký kinh doanh." : "Người đứng tên trên hoá đơn. Ghi như bạn muốn in trên hoá đơn.");
const CLASS_O = "h-11 px-3 text-base md:text-base";

type TruongProps = {
  oKhoa: (typeof THU_TU_O)[number];
  nhan: React.ReactNode;
  goiY?: string;
  loi: string | undefined;
  children: (p: { id: string; "aria-invalid"?: true; "aria-describedby"?: string }) => React.ReactNode;
};

/** Một ô: nhãn + (ô nhập) + gợi ý + lỗi, nối `aria-describedby` đúng. Tách ra để mười ô không chép tay mười lần. */
function Truong({ oKhoa, nhan, goiY, loi, children }: TruongProps) {
  const id = ID_O[oKhoa];
  const mo = [loi ? `${id}-loi` : null, goiY ? `${id}-goi-y` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <Label htmlFor={id} className="mb-2 text-base">
        {nhan}
      </Label>
      {children({ id, "aria-invalid": loi ? true : undefined, "aria-describedby": mo })}
      {goiY ? (
        <p id={`${id}-goi-y`} className="mt-1.5 text-sm text-muted-foreground">
          {goiY}
        </p>
      ) : null}
      {loi ? (
        <p id={`${id}-loi`} className="mt-1.5 text-sm font-medium text-destructive">
          {loi}
        </p>
      ) : null}
    </div>
  );
}

export function FormThongTinNguoiMua({ ma, datTruoc }: Props) {
  const [loai, setLoai] = React.useState<LoaiChon>(datTruoc.loai === "DOANH_NGHIEP" ? "DOANH_NGHIEP" : "CA_NHAN");
  const [ten, setTen] = React.useState(datTruoc.ten ?? "");
  const [diaChi, setDiaChi] = React.useState(datTruoc.diaChi ?? "");
  const [email, setEmail] = React.useState(datTruoc.email ?? "");
  const [maSoThue, setMaSoThue] = React.useState(datTruoc.maSoThue ?? "");
  // Hai ô CCCD luôn bắt đầu TRỐNG (máy chủ không gửi giá trị xuống); SĐT + ngày sinh học viên được điền sẵn như các ô khác.
  const [cccd, setCccd] = React.useState("");
  const [sdt, setSdt] = React.useState(datTruoc.sdt ?? "");
  const [tenHocVien, setTenHocVien] = React.useState(datTruoc.tenHocVien ?? "");
  const [ngaySinhHocVien, setNgaySinhHocVien] = React.useState(datTruoc.ngaySinhHocVien ?? "");
  const [cccdHocVien, setCccdHocVien] = React.useState("");
  const [dongY, setDongY] = React.useState(false);
  const [loi, setLoi] = React.useState<LoiBieuMau>({ theoO: {} });
  const [baoChung, setBaoChung] = React.useState<string | null>(null);
  const [dangGui, setDangGui] = React.useState(false);
  const [buoc, setBuoc] = React.useState<Buoc>({ kieu: "FORM" });
  const [lanLoi, setLanLoi] = React.useState(0);
  const dangGuiRef = React.useRef(false);
  const tieuDeXongRef = React.useRef<HTMLHeadingElement>(null);

  // Sau mỗi lần gửi hỏng: đưa focus tới mục lỗi đầu tiên (người dùng bàn phím / đọc màn hình không phải tự dò).
  React.useEffect(() => {
    if (lanLoi === 0) return;
    const dau = THU_TU_O.find((o) => loi.theoO[o] !== undefined);
    const id = dau ? ID_O[dau] : loi.dongY ? ID_DONG_Y : null;
    if (id) document.getElementById(id)?.focus();
  }, [lanLoi, loi]);

  React.useEffect(() => {
    if (buoc.kieu !== "FORM") tieuDeXongRef.current?.focus();
  }, [buoc.kieu]);

  if (buoc.kieu === "XONG") {
    return (
      <ThongBaoLienKet
        thanhCong
        tieuDeRef={tieuDeXongRef}
        tieuDe="Đã nhận thông tin — cảm ơn bạn"
        noiDung="Nhân viên Sata Robo sẽ kiểm tra thông tin rồi mới xuất hoá đơn. Bạn có thể đóng trang này."
      />
    );
  }
  if (buoc.kieu === "HET") return <ThongBaoLienKet tieuDeRef={tieuDeXongRef} tieuDe="Liên kết không còn hiệu lực" noiDung={buoc.thongDiep} />;

  const laDoanhNghiep = loai === "DOANH_NGHIEP";
  const e = loi.theoO;

  async function guiDi(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (dangGuiRef.current) return;
    setBaoChung(null);
    const du = { loai, ten, diaChi, email, maSoThue, cccd, sdt, tenHocVien, ngaySinhHocVien, cccdHocVien, dongY };
    const kt = kiemBieuMau(du);
    if (!kt.ok) {
      setLoi(kt.loi);
      setLanLoi((n) => n + 1);
      return;
    }
    dangGuiRef.current = true;
    setDangGui(true);
    setLoi({ theoO: {} });
    try {
      const kq = await guiThongTinNguoiMuaAction(ma, { ...du, banDau: datTruoc });
      if (kq.ok) {
        setBuoc({ kieu: "XONG" });
      } else if (kq.kieu === "KHONG_CON_HIEU_LUC") {
        setBuoc({ kieu: "HET", thongDiep: kq.thongDiep });
      } else if (kq.kieu === "DU_LIEU") {
        setLoi(kq.loi);
        if (Object.keys(kq.loi.theoO).length === 0 && !kq.loi.dongY) setBaoChung(kq.thongDiep);
        setLanLoi((n) => n + 1);
      } else {
        setBaoChung(kq.thongDiep);
      }
    } catch {
      setBaoChung("Mất kết nối. Vui lòng kiểm tra mạng rồi thử lại.");
    } finally {
      dangGuiRef.current = false;
      setDangGui(false);
    }
  }

  return (
    <form onSubmit={guiDi} noValidate className="space-y-6" aria-busy={dangGui}>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Thông tin để xuất hoá đơn</h1>
        <p className="text-base leading-relaxed text-muted-foreground">Điền thông tin người mua để Sata Robo xuất hoá đơn điện tử. Chỉ mất khoảng hai phút.</p>
      </header>

      <fieldset className="space-y-2" aria-describedby={e.loai ? "o-loai-loi" : undefined}>
        <legend className="mb-2 text-base font-medium">Hoá đơn xuất cho</legend>
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              ["CA_NHAN", "Cá nhân", ID_O.loai],
              ["DOANH_NGHIEP", "Doanh nghiệp", "o-loai-doanh-nghiep"],
            ] as const
          ).map(([giaTri, nhan, id]) => (
            <label
              key={giaTri}
              htmlFor={id}
              className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border border-input bg-background px-3 py-2 text-base has-[:checked]:border-primary-ink has-[:checked]:bg-primary-soft has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-ink"
            >
              <input id={id} type="radio" name="loai" value={giaTri} checked={loai === giaTri} onChange={() => setLoai(giaTri)} className="size-5 shrink-0 accent-[#b45309]" />
              <span>{nhan}</span>
            </label>
          ))}
        </div>
        {e.loai ? (
          <p id="o-loai-loi" className="mt-1.5 text-sm font-medium text-destructive">
            {e.loai}
          </p>
        ) : null}
      </fieldset>

      <Truong oKhoa="ten" nhan={nhanTen(loai)} goiY={goiYTen(loai)} loi={e.ten}>
        {(p) => <Input {...p} name="ten" type="text" autoComplete={laDoanhNghiep ? "organization" : "name"} maxLength={150} value={ten} onChange={(ev) => setTen(ev.target.value)} className={CLASS_O} />}
      </Truong>

      {laDoanhNghiep ? (
        <Truong oKhoa="maSoThue" nhan="Mã số thuế" goiY="Gồm 10 hoặc 13 chữ số." loi={e.maSoThue}>
          {(p) => <Input {...p} name="maSoThue" type="text" inputMode="numeric" autoComplete="off" maxLength={20} value={maSoThue} onChange={(ev) => setMaSoThue(ev.target.value)} className={CLASS_O} />}
        </Truong>
      ) : (
        <>
          <Truong oKhoa="cccd" nhan="Số CCCD của ba/mẹ" goiY="12 chữ số trên căn cước công dân của người đứng tên hoá đơn." loi={e.cccd}>
            {(p) => <Input {...p} name="cccd" type="text" inputMode="numeric" autoComplete="off" maxLength={14} value={cccd} onChange={(ev) => setCccd(ev.target.value)} className={`${CLASS_O} tabular-nums`} />}
          </Truong>
          <Truong
            oKhoa="sdt"
            nhan={
              <>
                Số điện thoại của ba/mẹ <span className="font-normal text-muted-foreground">(không bắt buộc)</span>
              </>
            }
            loi={e.sdt}
          >
            {(p) => <Input {...p} name="sdt" type="tel" inputMode="tel" autoComplete="tel" maxLength={16} value={sdt} onChange={(ev) => setSdt(ev.target.value)} className={`${CLASS_O} tabular-nums`} />}
          </Truong>
        </>
      )}

      <Truong oKhoa="diaChi" nhan="Địa chỉ" goiY={laDoanhNghiep ? "Địa chỉ đăng ký của doanh nghiệp." : "Số nhà, đường, phường/xã, tỉnh/thành phố."} loi={e.diaChi}>
        {(p) => <Textarea {...p} name="diaChi" rows={3} autoComplete="street-address" maxLength={250} value={diaChi} onChange={(ev) => setDiaChi(ev.target.value)} className="min-h-20 px-3 text-base md:text-base" />}
      </Truong>

      <Truong
        oKhoa="email"
        nhan={
          laDoanhNghiep ? (
            "Email nhận hoá đơn"
          ) : (
            <>
              Email nhận hoá đơn <span className="font-normal text-muted-foreground">(không bắt buộc)</span>
            </>
          )
        }
        goiY={laDoanhNghiep ? "Hoá đơn của doanh nghiệp sẽ gửi về địa chỉ này." : undefined}
        loi={e.email}
      >
        {(p) => <Input {...p} name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" maxLength={120} value={email} onChange={(ev) => setEmail(ev.target.value)} className={CLASS_O} />}
      </Truong>

      {!laDoanhNghiep ? (
        <fieldset className="space-y-4 rounded-lg border border-border p-4">
          <legend className="px-1 text-base font-medium">
            Thông tin học viên <span className="font-normal text-muted-foreground">(không bắt buộc)</span>
          </legend>
          <Truong oKhoa="tenHocVien" nhan="Họ và tên học viên" loi={e.tenHocVien}>
            {(p) => <Input {...p} name="tenHocVien" type="text" autoComplete="off" maxLength={150} value={tenHocVien} onChange={(ev) => setTenHocVien(ev.target.value)} className={CLASS_O} />}
          </Truong>
          <Truong oKhoa="ngaySinhHocVien" nhan="Ngày sinh học viên" loi={e.ngaySinhHocVien}>
            {(p) => <Input {...p} name="ngaySinhHocVien" type="date" autoComplete="off" value={ngaySinhHocVien} onChange={(ev) => setNgaySinhHocVien(ev.target.value)} className={CLASS_O} />}
          </Truong>
          <Truong oKhoa="cccdHocVien" nhan="Số CCCD của học viên" goiY="Chỉ điền nếu em đã có căn cước công dân." loi={e.cccdHocVien}>
            {(p) => <Input {...p} name="cccdHocVien" type="text" inputMode="numeric" autoComplete="off" maxLength={14} value={cccdHocVien} onChange={(ev) => setCccdHocVien(ev.target.value)} className={`${CLASS_O} tabular-nums`} />}
          </Truong>
        </fieldset>
      ) : null}

      <div className="space-y-4 border-t border-border pt-5">
        <p className="text-sm leading-relaxed text-muted-foreground">{NOI_DUNG_QUYEN_RIENG_TU}</p>
        <div>
          <label htmlFor={ID_DONG_Y} className="flex min-h-11 cursor-pointer items-start gap-3 py-1.5 text-base leading-snug">
            <input
              id={ID_DONG_Y}
              type="checkbox"
              name="dongY"
              checked={dongY}
              onChange={(ev) => setDongY(ev.target.checked)}
              className="mt-0.5 size-5 shrink-0 accent-[#b45309]"
              aria-invalid={loi.dongY ? true : undefined}
              aria-describedby={loi.dongY ? `${ID_DONG_Y}-loi` : undefined}
            />
            <span>{NHAN_DONG_Y}</span>
          </label>
          {loi.dongY ? (
            <p id={`${ID_DONG_Y}-loi`} className="mt-1.5 text-sm font-medium text-destructive">
              {loi.dongY}
            </p>
          ) : null}
        </div>

        {baoChung ? (
          <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-base font-medium text-destructive">
            {baoChung}
          </p>
        ) : null}

        <Button type="submit" disabled={dangGui} className="h-12 w-full bg-primary-ink text-base font-semibold text-white hover:bg-primary-ink-hover">
          {dangGui ? "Đang gửi…" : "Gửi thông tin"}
        </Button>
      </div>
    </form>
  );
}
