"use client";
/**
 * Form «Thêm số đo mới» của cổng phụ huynh. Khung + kiểu chép NGUYÊN từ markup artifact «Cổng Phụ Huynh — Thiết kế lại» (Suc-khoe.dc.html, mục #form-sk) —
 * thiết kế chỉ vẽ ô tĩnh nên ở đây nối thành ô điều khiển. Phần THÊM so với thiết kế: bốn ô thông tin người mới (tên · vai trò · ngày sinh · giới tính) khi chọn
 * «＋ Thêm người mới» (thiết kế có mục chọn này nhưng không có chỗ nhập), dòng báo lỗi, và câu cuối form sửa cho ĐÚNG nơi lưu («chỉ nằm trên máy này» thay cho
 * «chỉ gia đình anh chị xem được — trung tâm không xem»).
 */
import type { CSSProperties } from "react";
import { VAI_TRO_CONG, type FormSoDo } from "./vm";

type Props = {
  form: FormSoDo;
  dsNguoi: readonly { id: string; nhan: string }[];
  homNay: string;
  conCho: number;
  capNhat: (p: Partial<FormSoDo>) => void;
  chonNguoi: (id: string) => void;
  luu: () => void;
  dong: () => void;
};

const NHAN: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600 };
const O: CSSProperties = { height: 44, padding: "0 10px", borderRadius: 10, border: "1px solid #e6daee", fontFamily: "inherit", fontSize: 15, color: "#241133", background: "#ffffff" };
const NHAN_TICK: CSSProperties = { display: "flex", alignItems: "center", gap: 10, fontSize: 14 };
const TICK: CSSProperties = { width: 20, height: 20, accentColor: "#620c8b" };
const LUOI = (r: number): CSSProperties => ({ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(min(${r}px, 100%), 1fr))`, gap: 12 });

export function FormSoDo({ form, dsNguoi, homNay, conCho, capNhat, chonNguoi, luu, dong }: Props) {
  const laMoi = form.nguoiId === "moi" || !dsNguoi.some((n) => n.id === form.nguoiId);
  return (
    <section aria-labelledby="form-sk" id="form-sk" style={{ background: "#ffffff", border: "2px solid #620c8b", borderRadius: 22, padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Thêm số đo mới</h2>
          <span style={{ fontSize: 13, color: "#6b5a78" }}>Mỗi người giữ 3 bản mới nhất — lưu bản mới thì bản cũ nhất được thay.</span>
        </div>
        <button type="button" onClick={dong} style={{ height: 36, padding: "0 12px", borderRadius: 10, border: "1px solid #e6daee", background: "#ffffff", color: "#241133", fontFamily: "inherit", fontSize: 13, fontWeight: 600 }}>
          Đóng
        </button>
      </div>

      <div style={LUOI(200)}>
        <label style={NHAN}>
          Người trong nhà
          <select style={O} value={laMoi ? "moi" : form.nguoiId} onChange={(e) => chonNguoi(e.target.value)}>
            {dsNguoi.map((n) => (
              <option key={n.id} value={n.id}>
                {n.nhan}
              </option>
            ))}
            {conCho > 0 && <option value="moi">＋ Thêm người mới</option>}
          </select>
        </label>
        <label style={NHAN}>
          Ngày đo
          <input type="date" style={O} value={form.ngay} max={homNay} onChange={(e) => capNhat({ ngay: e.target.value })} />
        </label>
        <label style={NHAN}>
          Cân nặng (kg)
          <input type="number" inputMode="decimal" step="0.1" placeholder="34,5" style={O} value={form.nang} onChange={(e) => capNhat({ nang: e.target.value })} />
        </label>
        <label style={NHAN}>
          Chiều cao (cm)
          <input type="number" inputMode="decimal" step="0.1" placeholder="141" style={O} value={form.cao} onChange={(e) => capNhat({ cao: e.target.value })} />
        </label>
      </div>

      {laMoi && (
        <div style={LUOI(200)}>
          <label style={NHAN}>
            Tên hoặc biệt danh
            <input style={O} placeholder="VD: Bé Na" maxLength={40} value={form.ten} onChange={(e) => capNhat({ ten: e.target.value })} />
          </label>
          <label style={NHAN}>
            Vai trò trong nhà
            <select style={O} value={form.vt} onChange={(e) => capNhat({ vt: e.target.value })}>
              {VAI_TRO_CONG.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label style={NHAN}>
            Ngày sinh
            <input type="date" style={O} value={form.ns} max={homNay} onChange={(e) => capNhat({ ns: e.target.value })} />
          </label>
          <label style={NHAN}>
            Giới tính
            <select style={O} value={form.gt} onChange={(e) => capNhat({ gt: e.target.value === "nam" ? "nam" : "nu" })}>
              <option value="nu">Nữ</option>
              <option value="nam">Nam</option>
            </select>
          </label>
        </div>
      )}

      <details style={{ borderRadius: 14, background: "#fff8f0", padding: "12px 14px" }}>
        <summary style={{ cursor: "pointer", fontSize: 14, fontWeight: 700 }}>Thêm thông tin cho chính xác hơn (không bắt buộc)</summary>
        <div style={{ marginTop: 12, ...LUOI(220) }}>
          <label style={NHAN}>
            Vòng eo (cm, từ người lớn)
            <input type="number" inputMode="decimal" style={O} value={form.eo} onChange={(e) => capNhat({ eo: e.target.value })} />
          </label>
          <label style={NHAN}>
            Mức vận động
            <select style={O} value={form.hoatDong} onChange={(e) => capNhat({ hoatDong: e.target.value === "it" ? "it" : e.target.value === "nhieu" ? "nhieu" : "vua" })}>
              <option value="it">Ít vận động</option>
              <option value="vua">Vừa phải</option>
              <option value="nhieu">Nhiều</option>
            </select>
          </label>
          <label style={NHAN_TICK}>
            <input type="checkbox" style={TICK} checked={form.mt} onChange={(e) => capNhat({ mt: e.target.checked })} />
            Đang mang thai hoặc cho con bú
          </label>
          <label style={NHAN_TICK}>
            <input type="checkbox" style={TICK} checked={form.benhNen} onChange={(e) => capNhat({ benhNen: e.target.checked })} />
            Có bệnh nền hoặc đang dùng thuốc theo chỉ định
          </label>
        </div>
      </details>

      {form.loi && (
        <p role="alert" style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#a5561a" }}>
          {form.loi}
        </p>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
        <button type="button" onClick={luu} style={{ height: 48, padding: "0 22px", borderRadius: 12, border: "none", background: "#fe8f2d", color: "#241133", fontFamily: "inherit", fontSize: 15, fontWeight: 700 }}>
          Lưu và xem cùng Sata Robo
        </button>
        <span style={{ fontSize: 13, color: "#6b5a78" }}>Số đo chỉ nằm trên máy này — Sata Robo không nhận, không dùng để tư vấn bán hàng.</span>
      </div>
    </section>
  );
}
