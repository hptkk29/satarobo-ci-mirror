"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { khaiLuatAction } from "../../_actions";
import { NHAN_O, NUT_CHINH, NUT_PHU, O_NHAP, O_CHON, O_NHAP_VAN_BAN } from "../../_components/ui/dieu-khien";

/**
 * EL-18 — KHAI một luật tự động hoá.
 *
 * ⚠️ Cửa này tồn tại vì `khaiLuatAction` từng là action MỒ CÔI (0 màn nào gọi): luật chỉ tạo được bằng
 * SQL tay, tức cỗ máy có công tắc mà không có cách khai luật. Lưới `tests/elearning/loi-vao-ui.test.ts`
 * canh để nó không mồ côi lại.
 *
 * ⚠️ Luật LUÔN được lưu ở trạng thái TẮT, bất kể form gửi gì (xem `cauHinhKhaiLuat`). Bật là một hành
 * động riêng, có lý do riêng, ở nút "Bật luật" của danh sách — để người khai xem lại trước khi cỗ máy
 * bắt đầu tự giao việc cho người khác.
 *
 * Danh sách kích hoạt / hành động ĐÓNG và khớp `KICH_HOAT` / `HANH_DONG`: không có ô nhập biểu thức tự do
 * (một cỗ máy luật cho gõ biểu thức là một ngôn ngữ lập trình nằm trong DB), và KHÔNG có hành động chế
 * tài (QĐ-CDA-06).
 */

type Khoa = { id: string; title: string };
type LoTrinh = { id: string; title: string; soBuoc: number };
type PhongBan = { id: string; name: string };

const KICH_HOAT: { v: string; nhan: string }[] = [
  { v: "NHAN_SU_MOI", nhan: "Nhân sự mới vào làm" },
  { v: "KHOA_HOAN_THANH", nhan: "Hoàn thành một khoá" },
  { v: "CHUNG_NHAN_HET_HAN", nhan: "Chứng nhận hết hiệu lực" },
  { v: "YEU_CAU_MOI_AP_DUNG", nhan: "Yêu cầu đào tạo mới áp dụng" },
];

const HANH_DONG: { v: string; nhan: string }[] = [
  { v: "GIAO_KHOA", nhan: "Giao một khoá" },
  { v: "GIAO_LO_TRINH", nhan: "Giao trọn một lộ trình" },
  { v: "GUI_NHAC", nhan: "Gửi một lời nhắc" },
];

const O = O_NHAP;

export function RuleForm(props: {
  khoa: Khoa[];
  loTrinh: LoTrinh[];
  phongBan: PhongBan[];
}) {
  const router = useRouter();
  const [dangChay, batDau] = useTransition();
  const [mo, setMo] = useState(false);

  const [ma, setMa] = useState("");
  const [tieuDe, setTieuDe] = useState("");
  const [kichHoat, setKichHoat] = useState("NHAN_SU_MOI");
  const [hanhDong, setHanhDong] = useState("GIAO_KHOA");
  const [trongVongNgay, setTrongVongNgay] = useState("30");
  const [phongBanId, setPhongBanId] = useState("");
  const [khoaDieuKien, setKhoaDieuKien] = useState("");
  const [khoaGiao, setKhoaGiao] = useState("");
  const [loTrinhGiao, setLoTrinhGiao] = useState("");
  const [nhacTieuDe, setNhacTieuDe] = useState("");
  const [nhacNoiDung, setNhacNoiDung] = useState("");
  const [hanNgay, setHanNgay] = useState("30");
  const [lyDo, setLyDo] = useState("");

  const dieuKien = () => {
    if (kichHoat === "NHAN_SU_MOI") {
      return {
        trongVongNgay: Number(trongVongNgay),
        ...(phongBanId ? { departmentId: phongBanId } : {}),
      };
    }
    if (kichHoat === "KHOA_HOAN_THANH" && khoaDieuKien) return { courseId: khoaDieuKien };
    return {};
  };

  const thamSo = () => {
    if (hanhDong === "GIAO_KHOA") return { courseId: khoaGiao || null };
    if (hanhDong === "GIAO_LO_TRINH") return { pathId: loTrinhGiao || null };
    return { tieuDe: nhacTieuDe.trim() || null, noiDung: nhacNoiDung.trim() || null };
  };

  const thieu: string[] = [];
  if (ma.trim().length < 3) thieu.push("mã luật (≥ 3 ký tự)");
  if (tieuDe.trim().length < 3) thieu.push("tên luật (≥ 3 ký tự)");
  if (kichHoat === "NHAN_SU_MOI" && !(Number(trongVongNgay) >= 1)) thieu.push("số ngày 'nhân sự mới'");
  if (hanhDong === "GIAO_KHOA" && !khoaGiao) thieu.push("khoá cần giao");
  if (hanhDong === "GIAO_LO_TRINH" && !loTrinhGiao) thieu.push("lộ trình cần giao");
  if (hanhDong === "GUI_NHAC" && (!nhacTieuDe.trim() || !nhacNoiDung.trim())) thieu.push("tiêu đề và nội dung lời nhắc");
  if (lyDo.trim().length < 10) thieu.push("lý do (≥ 10 ký tự)");

  const luu = () =>
    batDau(async () => {
      const r = await khaiLuatAction(
        {
          code: ma.trim(),
          title: tieuDe.trim(),
          trigger: kichHoat as never,
          action: hanhDong as never,
          conditionJson: dieuKien(),
          actionJson: thamSo(),
          dueDays: Number(hanNgay),
        },
        // `reason` ở tham số THỨ HAI — schema `.strict()`.
        { reason: lyDo.trim() },
      );
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      toast.success("Đã khai luật — luật đang TẮT, bật ở danh sách bên dưới khi đã xem lại");
      setMo(false);
      setMa("");
      setTieuDe("");
      setLyDo("");
      router.refresh();
    });

  if (!mo) {
    return (
      <div>
        <button type="button" onClick={() => setMo(true)} aria-expanded={false} className={NUT_PHU}>
          + Khai luật mới
        </button>
      </div>
    );
  }

  return (
    <form
      className="space-y-4 rounded-xl border border-border bg-background p-4 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (thieu.length === 0) luu();
      }}
    >
      <p className="text-sm text-muted-foreground">
        Luật được lưu ở trạng thái <strong>TẮT</strong>. Bật nó là một hành động riêng, có lý do riêng.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className={NHAN_O}>Mã luật</span>
          <input className={O} value={ma} onChange={(e) => setMa(e.target.value)} maxLength={60} />
        </label>
        <label className="block space-y-1">
          <span className={NHAN_O}>Tên luật</span>
          <input className={O} value={tieuDe} onChange={(e) => setTieuDe(e.target.value)} maxLength={200} />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className={NHAN_O}>Khi (kích hoạt)</span>
          <select className={O_CHON} value={kichHoat} onChange={(e) => setKichHoat(e.target.value)}>
            {KICH_HOAT.map((k) => (
              <option key={k.v} value={k.v}>
                {k.nhan}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className={NHAN_O}>Thì (hành động)</span>
          <select className={O_CHON} value={hanhDong} onChange={(e) => setHanhDong(e.target.value)}>
            {HANH_DONG.map((k) => (
              <option key={k.v} value={k.v}>
                {k.nhan}
              </option>
            ))}
          </select>
        </label>
      </div>

      {kichHoat === "NHAN_SU_MOI" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className={NHAN_O}>Vào làm trong vòng (ngày)</span>
            <input
              className={O}
              type="number"
              min={1}
              max={365}
              value={trongVongNgay}
              onChange={(e) => setTrongVongNgay(e.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className={NHAN_O}>Phòng ban (để trống = mọi phòng)</span>
            <select className={O_CHON} value={phongBanId} onChange={(e) => setPhongBanId(e.target.value)}>
              <option value="">Mọi phòng ban</option>
              {props.phongBan.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {kichHoat === "KHOA_HOAN_THANH" ? (
        <label className="block space-y-1">
          <span className={NHAN_O}>Chỉ khi khoá vừa xong là (để trống = bất kỳ khoá)</span>
          <select className={O_CHON} value={khoaDieuKien} onChange={(e) => setKhoaDieuKien(e.target.value)}>
            <option value="">Bất kỳ khoá nào</option>
            {props.khoa.map((k) => (
              <option key={k.id} value={k.id}>
                {k.title}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {hanhDong === "GIAO_KHOA" ? (
        <label className="block space-y-1">
          <span className={NHAN_O}>Khoá cần giao</span>
          <select className={O_CHON} value={khoaGiao} onChange={(e) => setKhoaGiao(e.target.value)}>
            <option value="">— chọn khoá —</option>
            {props.khoa.map((k) => (
              <option key={k.id} value={k.id}>
                {k.title}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {hanhDong === "GIAO_LO_TRINH" ? (
        <label className="block space-y-1">
          <span className={NHAN_O}>Lộ trình cần giao</span>
          <select className={O_CHON} value={loTrinhGiao} onChange={(e) => setLoTrinhGiao(e.target.value)}>
            <option value="">— chọn lộ trình —</option>
            {props.loTrinh.map((t) => (
              <option key={t.id} value={t.id} disabled={t.soBuoc === 0}>
                {t.title} ({t.soBuoc} bước{t.soBuoc === 0 ? " — chưa có bước nào" : ""})
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {hanhDong === "GUI_NHAC" ? (
        <div className="space-y-2">
          <label className="block space-y-1">
            <span className={NHAN_O}>Tiêu đề lời nhắc</span>
            <input className={O} value={nhacTieuDe} onChange={(e) => setNhacTieuDe(e.target.value)} maxLength={200} />
          </label>
          <label className="block space-y-1">
            <span className={NHAN_O}>Nội dung lời nhắc</span>
            <textarea className={O_NHAP_VAN_BAN} rows={3} value={nhacNoiDung} onChange={(e) => setNhacNoiDung(e.target.value)} maxLength={1000} />
          </label>
        </div>
      ) : null}

      {hanhDong !== "GUI_NHAC" ? (
        <label className="block space-y-1 sm:max-w-xs">
          <span className={NHAN_O}>Hạn hoàn thành (ngày kể từ lúc được giao)</span>
          <input
            className={O}
            type="number"
            min={0}
            max={365}
            value={hanNgay}
            onChange={(e) => setHanNgay(e.target.value)}
          />
        </label>
      ) : null}

      <label className="block space-y-1">
        <span className={NHAN_O}>Lý do khai luật (bắt buộc, ≥ 10 ký tự — vào nhật ký)</span>
        <textarea className={O_NHAP_VAN_BAN} rows={2} value={lyDo} onChange={(e) => setLyDo(e.target.value)} maxLength={500} />
      </label>

      {thieu.length > 0 ? (
        <p className="text-sm font-medium text-state-warning-ink">Còn thiếu: {thieu.join(" · ")}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={dangChay || thieu.length > 0} className={NUT_CHINH}>
          {dangChay ? "Đang lưu…" : "Lưu luật (ở trạng thái TẮT)"}
        </button>
        <button type="button" onClick={() => setMo(false)} className={NUT_PHU}>
          Thôi
        </button>
      </div>
    </form>
  );
}
