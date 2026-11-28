"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { suaKhoaAction, taoKhoaAction } from "../_actions";
import { GOI_Y_O, NHAN_O, NUT_CHINH, O_CHON, O_NHAP, O_NHAP_VAN_BAN } from "../../_components/ui/dieu-khien";
import { taoSlug } from "@/lib/elearning-online/khoa-hoc";

type DanhMuc = { id: string; name: string; parentId: string | null };
export type KhoaSua = {
  id: string;
  code: string;
  slug: string;
  name: string;
  shortDescription: string | null;
  fullDescription: string | null;
  categoryId: string | null;
  level: string | null;
  gradeFrom: number | null;
  gradeTo: number | null;
  listPrice: number;
  salePrice: number;
  validityMonths: number | null;
  renewalEnabled: boolean;
  renewalPrice: number | null;
  seoTitle: string | null;
  seoDescription: string | null;
};

const KY_HAN = [
  { v: "1", nhan: "1 tháng" },
  { v: "3", nhan: "3 tháng" },
  { v: "6", nhan: "6 tháng" },
  { v: "12", nhan: "12 tháng" },
  { v: "24", nhan: "24 tháng" },
  { v: "TRON_DOI", nhan: "Trọn đời" },
];
const CAP_DO = [
  { v: "", nhan: "— Không đặt —" },
  { v: "INTRO", nhan: "Làm quen" },
  { v: "BASIC", nhan: "Cơ bản" },
  { v: "INTERMEDIATE", nhan: "Trung cấp" },
  { v: "ADVANCED", nhan: "Nâng cao" },
];

const so = (s: string): number | null => (s.trim() === "" ? null : Number(s.replace(/[^\d-]/g, "")));

/**
 * Biểu mẫu khoá Online — TẠO (QoTao) và SỬA thông tin + giá + thời hạn (QoGia). Server là nơi kiểm cuối: ô ở đây chỉ để người dùng thấy lỗi sớm.
 * Đổi giá/thời hạn KHÔNG đổi quyền học đã cấp (quyền chụp kỳ hạn lúc cấp).
 */
export function FormKhoa({ cheDo, khoa, danhMuc, phan = "tat-ca" }: { cheDo: "tao" | "sua"; khoa?: KhoaSua; danhMuc: DanhMuc[]; phan?: "tat-ca" | "thong-tin" | "gia" }) {
  const router = useRouter();
  const [dangChay, chuyen] = useTransition();
  const [loi, setLoi] = useState<{ truong?: string; thongBao: string } | null>(null);
  const [ma, setMa] = useState(khoa?.code ?? "");
  const [ten, setTen] = useState(khoa?.name ?? "");
  const [slug, setSlug] = useState(khoa?.slug ?? "");
  const [moTaNgan, setMoTaNgan] = useState(khoa?.shortDescription ?? "");
  const [moTaDai, setMoTaDai] = useState(khoa?.fullDescription ?? "");
  const [dm, setDm] = useState(khoa?.categoryId ?? "");
  const [capDo, setCapDo] = useState(khoa?.level ?? "");
  const [lopTu, setLopTu] = useState(khoa?.gradeFrom?.toString() ?? "");
  const [lopDen, setLopDen] = useState(khoa?.gradeTo?.toString() ?? "");
  const [giaNiemYet, setGiaNiemYet] = useState(String(khoa?.listPrice ?? 0));
  const [giaBan, setGiaBan] = useState(String(khoa?.salePrice ?? 0));
  const [kyHan, setKyHan] = useState(khoa ? (khoa.validityMonths === null ? "TRON_DOI" : String(khoa.validityMonths)) : "12");
  const [giaHan, setGiaHan] = useState(khoa?.renewalEnabled ?? false);
  const [giaGiaHan, setGiaGiaHan] = useState(khoa?.renewalPrice?.toString() ?? "");
  const [seoT, setSeoT] = useState(khoa?.seoTitle ?? "");
  const [seoM, setSeoM] = useState(khoa?.seoDescription ?? "");

  const tronDoi = kyHan === "TRON_DOI";
  const cha = danhMuc.filter((d) => !d.parentId);

  const gui = (e: React.FormEvent) => {
    e.preventDefault();
    setLoi(null);
    const chung = {
      name: ten,
      shortDescription: moTaNgan.trim() || null,
      fullDescription: moTaDai.trim() || null,
      categoryId: dm || null,
      level: (capDo || null) as "INTRO" | "BASIC" | "INTERMEDIATE" | "ADVANCED" | null,
      gradeFrom: so(lopTu),
      gradeTo: so(lopDen),
      listPrice: so(giaNiemYet) ?? 0,
      salePrice: so(giaBan) ?? 0,
      validityMonths: tronDoi ? null : Number(kyHan),
      renewalEnabled: tronDoi ? false : giaHan,
      renewalPrice: !tronDoi && giaHan ? so(giaGiaHan) : null,
      seoTitle: seoT.trim() || null,
      seoDescription: seoM.trim() || null,
    };
    chuyen(async () => {
      if (cheDo === "tao") {
        const r = await taoKhoaAction({ ...chung, code: ma, slug: slug.trim() || undefined });
        if (!r.ok) return void setLoi({ truong: r.error.field, thongBao: r.error.message });
        toast.success("Đã tạo khoá — bắt đầu soạn chương và bài");
        router.push(`/elearning/online/khoa/${r.data.courseId}?tab=chuong-bai`);
      } else {
        const r = await suaKhoaAction({ ...chung, courseId: khoa!.id, slug: slug.trim() || undefined });
        if (!r.ok) return void setLoi({ truong: r.error.field, thongBao: r.error.message });
        toast.success("Đã lưu");
        router.refresh();
      }
    });
  };

  return (
    <form onSubmit={gui} className="flex flex-col gap-6" noValidate>
      {loi ? (
        <p role="alert" className="rounded-lg border border-state-danger/40 bg-state-danger-soft px-3 py-2 text-sm text-state-danger-ink">
          {loi.thongBao}
        </p>
      ) : null}

      {phan !== "gia" ? (
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold">Thông tin khoá</legend>
          <div className="sm:col-span-2">
            <label className={NHAN_O} htmlFor="ten">Tên khoá *</label>
            <input id="ten" className={O_NHAP} value={ten} onChange={(e) => setTen(e.target.value)} required maxLength={200} />
          </div>
          <div>
            <label className={NHAN_O} htmlFor="ma">Mã khoá *</label>
            <input id="ma" className={O_NHAP} value={ma} onChange={(e) => setMa(e.target.value.toUpperCase())} disabled={cheDo === "sua"} placeholder="ONL-RS1" maxLength={40} required />
            <p className={GOI_Y_O}>{cheDo === "sua" ? "Mã không đổi sau khi tạo (đơn hàng và chứng nhận trỏ vào mã)." : "Chữ HOA, số, gạch ngang. Không đổi được sau khi tạo."}</p>
          </div>
          <div>
            <label className={NHAN_O} htmlFor="slug">Đường dẫn công khai</label>
            <input id="slug" className={O_NHAP} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder={taoSlug(ten) || "tu-dong-tu-ten"} maxLength={80} />
            <p className={GOI_Y_O}>Để trống: tự lấy từ tên khoá.</p>
          </div>
          <div>
            <label className={NHAN_O} htmlFor="dm">Danh mục</label>
            <select id="dm" className={O_CHON} value={dm} onChange={(e) => setDm(e.target.value)}>
              <option value="">— Chưa phân loại —</option>
              {cha.map((c) => (
                <optgroup key={c.id} label={c.name}>
                  <option value={c.id}>{c.name}</option>
                  {danhMuc.filter((x) => x.parentId === c.id).map((x) => (
                    <option key={x.id} value={x.id}>{`${c.name} › ${x.name}`}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div>
            <label className={NHAN_O} htmlFor="capdo">Cấp độ</label>
            <select id="capdo" className={O_CHON} value={capDo} onChange={(e) => setCapDo(e.target.value)}>
              {CAP_DO.map((c) => <option key={c.v} value={c.v}>{c.nhan}</option>)}
            </select>
          </div>
          <div>
            <label className={NHAN_O} htmlFor="loptu">Dành cho lớp từ</label>
            <input id="loptu" inputMode="numeric" className={O_NHAP} value={lopTu} onChange={(e) => setLopTu(e.target.value)} placeholder="4" />
          </div>
          <div>
            <label className={NHAN_O} htmlFor="lopden">Đến lớp</label>
            <input id="lopden" inputMode="numeric" className={O_NHAP} value={lopDen} onChange={(e) => setLopDen(e.target.value)} placeholder="5" />
          </div>
          <div className="sm:col-span-2">
            <label className={NHAN_O} htmlFor="ngan">Mô tả ngắn</label>
            <textarea id="ngan" className={O_NHAP_VAN_BAN} value={moTaNgan} onChange={(e) => setMoTaNgan(e.target.value)} maxLength={500} rows={2} />
          </div>
          <div className="sm:col-span-2">
            <label className={NHAN_O} htmlFor="dai">Giới thiệu đầy đủ</label>
            <textarea id="dai" className={O_NHAP_VAN_BAN} value={moTaDai} onChange={(e) => setMoTaDai(e.target.value)} maxLength={20000} rows={6} />
          </div>
          <div>
            <label className={NHAN_O} htmlFor="seot">Tiêu đề SEO</label>
            <input id="seot" className={O_NHAP} value={seoT} onChange={(e) => setSeoT(e.target.value)} maxLength={200} />
          </div>
          <div>
            <label className={NHAN_O} htmlFor="seom">Mô tả SEO</label>
            <input id="seom" className={O_NHAP} value={seoM} onChange={(e) => setSeoM(e.target.value)} maxLength={400} />
          </div>
        </fieldset>
      ) : null}

      {phan !== "thong-tin" ? (
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Giá và thời hạn</legend>
        <div>
          <label className={NHAN_O} htmlFor="niemyet">Giá niêm yết (đ) *</label>
          <input id="niemyet" inputMode="numeric" className={O_NHAP} value={giaNiemYet} onChange={(e) => setGiaNiemYet(e.target.value)} />
        </div>
        <div>
          <label className={NHAN_O} htmlFor="giaban">Giá bán (đ) *</label>
          <input id="giaban" inputMode="numeric" className={O_NHAP} value={giaBan} onChange={(e) => setGiaBan(e.target.value)} />
          <p className={GOI_Y_O}>Không cao hơn giá niêm yết. Khuyến mãi theo mã do bộ phận bán hàng quản lý — không nhập ở đây.</p>
        </div>
        <div>
          <label className={NHAN_O} htmlFor="kyhan">Thời hạn học *</label>
          <select id="kyhan" className={O_CHON} value={kyHan} onChange={(e) => setKyHan(e.target.value)}>
            {KY_HAN.map((k) => <option key={k.v} value={k.v}>{k.nhan}</option>)}
          </select>
          <p className={GOI_Y_O}>Tính THEO THÁNG LỊCH, hết hạn lúc hết ngày (giờ Việt Nam). Phụ huynh không chọn. Quyền đã cấp giữ nguyên hạn khi bạn đổi mục này.</p>
        </div>
        <div className="flex flex-col justify-end gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={giaHan && !tronDoi} disabled={tronDoi} onChange={(e) => setGiaHan(e.target.checked)} />
            Cho phép gia hạn
          </label>
          {giaHan && !tronDoi ? (
            <div>
              <label className={NHAN_O} htmlFor="giagiahan">Giá gia hạn (đ) *</label>
              <input id="giagiahan" inputMode="numeric" className={O_NHAP} value={giaGiaHan} onChange={(e) => setGiaGiaHan(e.target.value)} />
            </div>
          ) : tronDoi ? (
            <p className={GOI_Y_O}>Khoá trọn đời không có gia hạn.</p>
          ) : null}
        </div>
      </fieldset>
      ) : null}

      <div className="flex gap-2">
        <button type="submit" className={NUT_CHINH} disabled={dangChay}>
          {dangChay ? "Đang lưu…" : cheDo === "tao" ? "Tạo khoá" : "Lưu thay đổi"}
        </button>
      </div>
    </form>
  );
}
