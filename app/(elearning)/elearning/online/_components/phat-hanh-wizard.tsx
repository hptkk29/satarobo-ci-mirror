"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { phatHanhAction, xemTruocPhatHanhAction } from "../_actions";
import { GhiChu } from "../../_components/ui/trang";
import { GOI_Y_O, NHAN_O, NUT_CHINH, NUT_PHU, O_NHAP } from "../../_components/ui/dieu-khien";
import { NHAN_CHINH_SACH } from "@/lib/elearning-online/hien-thi";
import type { XemTruocPhatHanh } from "@/lib/elearning-online/phien-ban";
import type { ChinhSachTienDo } from "@/lib/elearning-online/phat-hanh";

type Buoc = 1 | 2 | 3;
type Loai = ChinhSachTienDo["loai"];

/**
 * QoPhatHanh1–3 — WIZARD PHÁT HÀNH BẢN MỚI: (1) so sánh + cổng chất lượng → (2) CHỌN chính sách tiến độ (bắt buộc, không mặc định; bản đầu tiên bỏ bước này)
 * → (3) xem TÁC ĐỘNG theo số liệu thật rồi gõ "PHAT HANH". Server tính lại tác động trong giao dịch và từ chối nếu dấu vết lệch bản xem trước.
 */
export function PhatHanhWizard({ courseId, tenKhoa, laBanDauTien }: { courseId: string; tenKhoa: string; laBanDauTien: boolean }) {
  const router = useRouter();
  const [dangChay, chuyen] = useTransition();
  const [buoc, setBuoc] = useState<Buoc>(1);
  const [xt, setXt] = useState<XemTruocPhatHanh | null>(null);
  const [loiTai, setLoiTai] = useState<string | null>(null);
  const [loai, setLoai] = useState<Loai | "">("");
  const [baiChon, setBaiChon] = useState<string[]>([]);
  const [chuongChon, setChuongChon] = useState<string[]>([]);
  const [xacNhan, setXacNhan] = useState("");

  const chinhSach = useCallback((): ChinhSachTienDo | null => {
    if (laBanDauTien) return null;
    if (loai === "KEEP_PROGRESS" || loai === "ADD_NEW_ONLY") return { loai };
    if (loai === "RELEARN_SELECTED") return { loai, baiHocLai: baiChon };
    if (loai === "RESET_BY_SCOPE" && chuongChon.length) return { loai, chuongStableIds: chuongChon };
    return null;
  }, [laBanDauTien, loai, baiChon, chuongChon]);

  const tai = useCallback(
    (cs: ChinhSachTienDo | null, sau?: (x: XemTruocPhatHanh) => void) =>
      chuyen(async () => {
        const r = await xemTruocPhatHanhAction({ courseId, chinhSach: cs });
        if (!r.ok) return void setLoiTai(r.error.message);
        setLoiTai(null);
        setXt(r.data);
        sau?.(r.data);
      }),
    [courseId],
  );

  useEffect(() => {
    tai(null);
  }, [tai]);

  const ten = (s: string) => xt?.bai[s]?.title ?? s;
  const coLoi = !!xt?.chatLuong.some((c) => c.muc === "LOI");
  const csHienTai = chinhSach();
  const duChinhSach = laBanDauTien || !!csHienTai;

  if (loiTai) return <GhiChu sac="danger">{loiTai}</GhiChu>;
  if (!xt) return <p className="text-sm text-muted-foreground">Đang so sánh bản nháp với bản đang chạy…</p>;

  const dsSoSanh: { nhan: string; ds: string[] }[] = xt.soSanh
    ? [
        { nhan: "Bài thêm mới", ds: xt.soSanh.them },
        { nhan: "Bài đã sửa", ds: xt.soSanh.sua },
        { nhan: "Bài ẩn", ds: xt.soSanh.an },
        { nhan: "Bài hiện lại", ds: xt.soSanh.hienLai },
        { nhan: "Bài đổi vị trí", ds: xt.soSanh.doiThuTu },
        { nhan: "Bài bị xoá khỏi bản mới", ds: xt.soSanh.bien },
      ]
    : [];

  return (
    <div className="flex flex-col gap-6">
      <ol className="flex flex-wrap gap-2 text-sm" aria-label="Các bước">
        {(laBanDauTien ? [1, 3] : [1, 2, 3]).map((b, i) => (
          <li key={b} aria-current={buoc === b ? "step" : undefined} className={`rounded-full px-3 py-1 ${buoc === b ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
            {i + 1}. {b === 1 ? "So sánh & kiểm tra" : b === 2 ? "Chính sách tiến độ" : "Tác động & xác nhận"}
          </li>
        ))}
      </ol>

      {buoc === 1 ? (
        <section className="flex flex-col gap-4" aria-label="So sánh và kiểm tra">
          <h2 className="text-base font-semibold">{tenKhoa} — bản {xt.soBanNhap}</h2>
          {laBanDauTien ? (
            <GhiChu sac="info">Đây là lần phát hành đầu tiên: chưa có học viên nào đang học nên không cần chọn chính sách tiến độ.</GhiChu>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {dsSoSanh.map((m) => (
                <div key={m.nhan} className="rounded-lg border border-border p-3">
                  <p className="text-sm font-semibold">{m.nhan} <span className="font-normal text-muted-foreground">({m.ds.length})</span></p>
                  {m.ds.length ? <ul className="mt-1 list-disc pl-5 text-sm">{m.ds.map((s) => <li key={s}>{ten(s)}</li>)}</ul> : <p className="text-sm text-muted-foreground">Không có.</p>}
                </div>
              ))}
            </div>
          )}
          <div>
            <h3 className="mb-1 text-sm font-semibold">Kiểm tra chất lượng</h3>
            {xt.chatLuong.length === 0 ? (
              <GhiChu sac="success">Không có vấn đề nào.</GhiChu>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {xt.chatLuong.map((c, i) => (
                  <li key={i}><GhiChu sac={c.muc === "LOI" ? "danger" : "warning"}>{c.muc === "LOI" ? "Phải sửa: " : "Lưu ý: "}{c.thongBao}</GhiChu></li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" className={NUT_CHINH} disabled={coLoi || dangChay} onClick={() => (laBanDauTien ? tai(null, () => setBuoc(3)) : setBuoc(2))}>Tiếp tục</button>
            <button type="button" className={NUT_PHU} onClick={() => router.push(`/elearning/online/khoa/${courseId}?tab=chuong-bai`)}>Quay lại soạn</button>
          </div>
          {coLoi ? <p className={GOI_Y_O}>Còn lỗi phải sửa trước khi phát hành.</p> : null}
        </section>
      ) : null}

      {buoc === 2 ? (
        <section className="flex flex-col gap-4" aria-label="Chính sách tiến độ">
          <GhiChu sac="info">Có {xt.soHocVienDangHoc} học viên đang có quyền học. Bạn PHẢI chọn cách xử lý tiến độ của họ — không có lựa chọn mặc định. Điểm, bài nộp và chứng nhận đã cấp luôn được giữ nguyên.</GhiChu>
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">Chính sách tiến độ</legend>
            {(Object.keys(NHAN_CHINH_SACH) as Loai[]).map((k) => (
              <label key={k} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${loai === k ? "border-primary bg-primary/5" : "border-border"}`}>
                <input type="radio" name="chinh-sach" className="mt-1" checked={loai === k} onChange={() => setLoai(k)} />
                <span>
                  <span className="block text-sm font-semibold">{NHAN_CHINH_SACH[k]!.nhan}</span>
                  <span className="block text-sm text-muted-foreground">{NHAN_CHINH_SACH[k]!.moTa}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {loai === "RELEARN_SELECTED" ? (
            <fieldset className="rounded-lg border border-border p-3">
              <legend className="px-1 text-sm font-semibold">Bài đã sửa — chọn bài học viên phải học lại</legend>
              {xt.soSanh?.sua.length ? xt.soSanh.sua.map((s) => (
                <label key={s} className="flex items-center gap-2 py-1 text-sm">
                  <input type="checkbox" checked={baiChon.includes(s)} onChange={(e) => setBaiChon(e.target.checked ? [...baiChon, s] : baiChon.filter((x) => x !== s))} />
                  {ten(s)}
                </label>
              )) : <p className="text-sm text-muted-foreground">Không có bài nào bị sửa — chính sách này sẽ không đặt lại gì.</p>}
            </fieldset>
          ) : null}
          {loai === "RESET_BY_SCOPE" ? (
            <fieldset className="rounded-lg border border-border p-3">
              <legend className="px-1 text-sm font-semibold">Chọn chương cần đặt lại tiến độ</legend>
              {xt.chuong.map((c) => (
                <label key={c.stableId} className="flex items-center gap-2 py-1 text-sm">
                  <input type="checkbox" checked={chuongChon.includes(c.stableId)} onChange={(e) => setChuongChon(e.target.checked ? [...chuongChon, c.stableId] : chuongChon.filter((x) => x !== c.stableId))} />
                  {c.title}
                </label>
              ))}
            </fieldset>
          ) : null}
          <div className="flex gap-2">
            <button type="button" className={NUT_CHINH} disabled={!duChinhSach || dangChay} onClick={() => tai(csHienTai, () => setBuoc(3))}>Xem tác động</button>
            <button type="button" className={NUT_PHU} onClick={() => setBuoc(1)}>Quay lại</button>
          </div>
        </section>
      ) : null}

      {buoc === 3 ? (
        <section className="flex flex-col gap-4" aria-label="Tác động và xác nhận">
          {xt.tacDong ? (
            <dl className="grid gap-3 sm:grid-cols-4">
              {[
                ["Học viên đang học", xt.tacDong.soHocVien],
                ["Bị ảnh hưởng", xt.tacDong.soBiAnhHuong],
                ["Phải học lại", xt.tacDong.soPhaiHocLai],
                ["Mất chứng nhận", xt.tacDong.matChungNhan],
              ].map(([t, v]) => (
                <div key={String(t)} className="rounded-lg border border-border p-3">
                  <dt className="text-xs text-muted-foreground">{t}</dt>
                  <dd className="text-2xl font-semibold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <GhiChu sac="info">Lần phát hành đầu tiên — không có học viên nào bị ảnh hưởng.</GhiChu>
          )}
          {csHienTai ? <p className="text-sm">Chính sách: <strong>{NHAN_CHINH_SACH[csHienTai.loai]!.nhan}</strong></p> : null}
          <p className="text-sm text-muted-foreground">Phát hành là hành động có hiệu lực ngay: bản nháp trở thành bản đang chạy và học viên chuyển sang bản mới. Bản cũ được lưu lại, không xoá.</p>
          <div className="max-w-sm">
            <label className={NHAN_O} htmlFor="xn">Gõ <strong>PHAT HANH</strong> để xác nhận</label>
            <input id="xn" className={O_NHAP} value={xacNhan} onChange={(e) => setXacNhan(e.target.value)} autoComplete="off" />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className={NUT_CHINH}
              disabled={xacNhan !== "PHAT HANH" || dangChay}
              onClick={() =>
                chuyen(async () => {
                  const r = await phatHanhAction({ courseId, chinhSach: csHienTai, dauVet: xt.dauVet, xacNhan: "PHAT HANH" });
                  if (!r.ok) {
                    toast.error(r.error.message);
                    if (r.error.code === "TAC_DONG_DA_THAY_DOI") tai(csHienTai); // tính lại để người dùng xem con số mới rồi xác nhận lại
                    return;
                  }
                  toast.success(`Đã phát hành bản ${r.data.number}`);
                  router.push(`/elearning/online/khoa/${courseId}?tab=phien-ban`);
                  router.refresh();
                })
              }
            >
              {dangChay ? "Đang phát hành…" : "Phát hành"}
            </button>
            <button type="button" className={NUT_PHU} onClick={() => setBuoc(laBanDauTien ? 1 : 2)}>Quay lại</button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
