"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { capChungNhanTayAction, capQuyenAction, lichSuQuyenAction, thuHoiQuyenAction, timUngVienAction } from "../_actions";
import { GOI_Y_O, NHAN_O, NUT_CHINH, NUT_NGUY, NUT_NHO, NUT_PHU, O_NHAP } from "../../_components/ui/dieu-khien";
import { NHAN_SU_KIEN, dinhDangNgay } from "@/lib/elearning-online/hien-thi";
import { hienThiMaChungNhan } from "@/lib/elearning-online/ma-chung-nhan";
import { xemTruocGiaHan } from "@/lib/elearning-online/quyen-hoc";
import type { KyHan } from "@/lib/elearning-online/thoi-han";
import type { DongLichSuQuyen, UngVienCap } from "@/lib/elearning-online/hoc-vien-khoa";

/** Khoá idempotency sinh MỘT LẦN mỗi lần mở hộp thoại — bấm đúp / gửi lại không cấp hai lần. */
const khoaMoi = () => `ui-${globalThis.crypto.randomUUID()}`;

function Hop({ mo, onDong, tieuDe, children }: { mo: boolean; onDong: () => void; tieuDe: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (mo && !d.open) d.showModal();
    if (!mo && d.open) d.close();
  }, [mo]);
  return (
    <dialog ref={ref} onClose={onDong} aria-label={tieuDe} className="w-[min(32rem,92vw)] rounded-xl border border-border bg-card p-0 text-left text-foreground backdrop:bg-black/40">
      {mo ? (
        <div className="flex flex-col gap-3 p-5">
          <h3 className="text-base font-semibold">{tieuDe}</h3>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}

/** Nút thao tác trên MỘT dòng học viên: Gia hạn · Lịch sử · Thu hồi (mỗi nút chỉ vẽ khi người xem có quyền tương ứng; server vẫn kiểm lại). */
export function HanhDongHocVien(p: { courseId: string; studentId: string; tenHocVien: string; trangThai: string; duocGiaHan: boolean; duocThuHoi: boolean; duocXemLichSu: boolean; khoaChoGiaHan: boolean; duocCapChungNhan?: boolean ; tenKhoa: string; nguonNhan: string; hetHan: string | null; anchorDay: number; thangHan: number | null}) {
  const router = useRouter();
  const [dangChay, chuyen] = useTransition();
  const [viec, setViec] = useState<"gia-han" | "lich-su" | "thu-hoi" | "chung-nhan" | null>(null);
  const [lyDo, setLyDo] = useState("");
  const [khoa, setKhoa] = useState("");
  const [ls, setLs] = useState<DongLichSuQuyen[] | null>(null);
  const dong = () => {
    setViec(null);
    setLyDo("");
  };
  const mo = (v: "gia-han" | "lich-su" | "thu-hoi" | "chung-nhan") => {
    setKhoa(khoaMoi());
    setLyDo("");
    setViec(v);
    if (v === "lich-su") {
      setLs(null);
      lichSuQuyenAction({ courseId: p.courseId, studentId: p.studentId }).then((r) => (r.ok ? setLs(r.data) : (toast.error(r.error.message), setViec(null))));
    }
  };
  const daThuHoi = p.trangThai === "THU_HOI";
  const duLyDo = lyDo.trim().length >= 10;

  const guiCap = () =>
    chuyen(async () => {
      const r = await capQuyenAction({ courseId: p.courseId, studentId: p.studentId, loai: "GIA_HAN", idempotencyKey: khoa }, { reason: lyDo.trim() });
      if (!r.ok) return void toast.error(r.error.message);
      toast.success(r.data.daXuLyTruocDo ? "Thao tác này đã được ghi nhận trước đó" : `Đã gia hạn${r.data.hetHan ? ` — hạn mới ${dinhDangNgay(r.data.hetHan)}` : ""}`);
      dong();
      router.refresh();
    });
  const guiThuHoi = () =>
    chuyen(async () => {
      const r = await thuHoiQuyenAction({ courseId: p.courseId, studentId: p.studentId, idempotencyKey: khoa }, { reason: lyDo.trim() });
      if (!r.ok) return void toast.error(r.error.message);
      toast.success("Đã thu hồi quyền — học viên không còn vào được nội dung khoá");
      dong();
      router.refresh();
    });

  return (
    <>
      <span className="flex flex-wrap justify-end gap-1.5">
        {p.duocGiaHan && !daThuHoi ? <button type="button" className={NUT_NHO} onClick={() => mo("gia-han")}>Gia hạn</button> : null}
        {p.duocXemLichSu ? <button type="button" className={NUT_NHO} onClick={() => mo("lich-su")}>Lịch sử</button> : null}
        {p.duocCapChungNhan ? <button type="button" className={NUT_NHO} onClick={() => mo("chung-nhan")}>Cấp chứng nhận</button> : null}
        {p.duocThuHoi && !daThuHoi ? <button type="button" className={NUT_NHO} onClick={() => mo("thu-hoi")}>Thu hồi</button> : null}
      </span>

      <Hop mo={viec === "gia-han"} onDong={dong} tieuDe={`Gia hạn quyền học — ${p.tenHocVien}`}>
        <p className="text-sm text-muted-foreground">Cộng thêm một kỳ hạn theo cấu hình khoá. Còn hạn ⇒ cộng từ hạn hiện tại; đã hết hạn ⇒ tính từ hôm nay. Không cần phê duyệt thêm; ghi nhật ký kèm lý do.</p>
        <GiaHanXemTruoc tenKhoa={p.tenKhoa} nguonNhan={p.nguonNhan} hetHan={p.hetHan} anchorDay={p.anchorDay} thangHan={p.thangHan} trangThai={p.trangThai} />
        {!p.khoaChoGiaHan ? <p className="rounded-lg bg-muted px-3 py-2 text-xs">Khoá không bật “Cho phép gia hạn” cho phụ huynh — quản trị vẫn gia hạn được.</p> : null}
        <label className={NHAN_O} htmlFor="gh-lydo">Lý do (≥ 10 ký tự)</label>
        <input id="gh-lydo" className={O_NHAP} value={lyDo} onChange={(e) => setLyDo(e.target.value)} />
        <div className="flex gap-2">
          <button type="button" className={NUT_CHINH} disabled={dangChay || !duLyDo} onClick={guiCap}>{dangChay ? "Đang xử lý…" : "Gia hạn"}</button>
          <button type="button" className={NUT_PHU} onClick={dong}>Huỷ</button>
        </div>
      </Hop>

      <Hop mo={viec === "thu-hoi"} onDong={dong} tieuDe={`Thu hồi quyền học — ${p.tenHocVien}`}>
        <p className="text-sm">Học viên bị chặn mọi nội dung của khoá <strong>ngay lập tức</strong> và khoá biến khỏi danh sách học của họ. Tiến độ, điểm, lịch sử mua vẫn được giữ.</p>
        <label className={NHAN_O} htmlFor="th-lydo">Lý do (≥ 10 ký tự, vào nhật ký)</label>
        <input id="th-lydo" className={O_NHAP} value={lyDo} onChange={(e) => setLyDo(e.target.value)} />
        <div className="flex gap-2">
          <button type="button" className={NUT_NGUY} disabled={dangChay || !duLyDo} onClick={guiThuHoi}>{dangChay ? "Đang xử lý…" : "Thu hồi quyền"}</button>
          <button type="button" className={NUT_PHU} onClick={dong}>Huỷ</button>
        </div>
      </Hop>

      <Hop mo={viec === "chung-nhan"} onDong={dong} tieuDe={`Cấp chứng nhận tay — ${p.tenHocVien}`}>
        <p className="text-sm text-muted-foreground">Cấp chứng nhận hoàn thành khoá cho học viên này kể cả khi chưa đủ điều kiện tự động. Mỗi học viên chỉ có MỘT chứng nhận cho khoá; ghi nhật ký kèm lý do.</p>
        <label className={NHAN_O} htmlFor="cn-lydo2">Lý do (≥ 10 ký tự)</label>
        <input id="cn-lydo2" className={O_NHAP} value={lyDo} onChange={(e) => setLyDo(e.target.value)} />
        <div className="flex gap-2">
          <button
            type="button"
            className={NUT_CHINH}
            disabled={dangChay || !duLyDo}
            onClick={() =>
              chuyen(async () => {
                const r = await capChungNhanTayAction({ courseId: p.courseId, studentId: p.studentId }, { reason: lyDo.trim() });
                if (!r.ok) return void toast.error(r.error.message);
                toast.success(`Đã cấp chứng nhận ${hienThiMaChungNhan(r.data.code)}`);
                dong();
                router.refresh();
              })
            }
          >
            {dangChay ? "Đang xử lý…" : "Cấp chứng nhận"}
          </button>
          <button type="button" className={NUT_PHU} onClick={dong}>Huỷ</button>
        </div>
      </Hop>

      <Hop mo={viec === "lich-su"} onDong={dong} tieuDe={`Lịch sử quyền học — ${p.tenHocVien}`}>
        {ls === null ? (
          <p className="text-sm text-muted-foreground">Đang tải…</p>
        ) : (
          <ol className="flex max-h-80 flex-col gap-2 overflow-y-auto text-sm">
            {ls.map((l) => (
              <li key={l.id} className="rounded-lg border border-border px-3 py-2">
                <p className="font-medium">{NHAN_SU_KIEN[l.kind] ?? l.kind} <span className="font-normal text-muted-foreground">· {dinhDangNgay(l.luc)}</span></p>
                <p className="text-xs text-muted-foreground">
                  {l.nguon ? `${l.nguon} · ` : ""}
                  {l.denHan !== null || l.tuHan !== null ? `Hạn ${dinhDangNgay(l.tuHan)} → ${dinhDangNgay(l.denHan)}` : "Trọn đời"}
                  {l.thangThem ? ` · +${l.thangThem} tháng` : ""}
                  {l.nguoiThucHien ? ` · ${l.nguoiThucHien}` : ""}
                  {l.donHang ? ` · đơn ${l.donHang}` : ""}
                </p>
                {l.lyDo ? <p className="mt-1 text-xs">Lý do: {l.lyDo}</p> : null}
              </li>
            ))}
          </ol>
        )}
        <div><button type="button" className={NUT_PHU} onClick={dong}>Đóng</button></div>
      </Hop>
    </>
  );
}

/** “Cấp quyền miễn phí” — tìm học viên ĐÃ CÓ (không tạo mới), nhập lý do, cấp. Học viên đã có quyền ⇒ cộng thêm kỳ hạn. */
export function CapQuyenMienPhi({ courseId, khoaTronDoi }: { courseId: string; khoaTronDoi: boolean }) {
  const router = useRouter();
  const [dangChay, chuyen] = useTransition();
  const [mo, setMo] = useState(false);
  const [q, setQ] = useState("");
  const [kq, setKq] = useState<UngVienCap[] | null>(null);
  const [chon, setChon] = useState<UngVienCap | null>(null);
  const [lyDo, setLyDo] = useState("");
  const [khoa, setKhoa] = useState("");
  const dong = () => {
    setMo(false);
    setQ("");
    setKq(null);
    setChon(null);
    setLyDo("");
  };
  return (
    <>
      <button type="button" className={NUT_CHINH} onClick={() => { setKhoa(khoaMoi()); setMo(true); }}>Cấp quyền miễn phí</button>
      <Hop mo={mo} onDong={dong} tieuDe="Cấp quyền học miễn phí">
        <p className="text-sm text-muted-foreground">Chỉ cấp cho học viên ĐÃ CÓ trong hệ thống (mã học viên theo chuẩn chung). Không phê duyệt thêm; ghi nhật ký kèm lý do.</p>
        {!chon ? (
          <>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                chuyen(async () => {
                  const r = await timUngVienAction({ courseId, q });
                  if (!r.ok) return void toast.error(r.error.message);
                  setKq(r.data);
                });
              }}
            >
              <input aria-label="Tìm học viên" className={O_NHAP} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tên học viên, mã học viên, tên hoặc SĐT phụ huynh" />
              <button type="submit" className={NUT_PHU} disabled={dangChay || q.trim().length < 2}>Tìm</button>
            </form>
            {kq ? (
              kq.length === 0 ? (
                <p className="text-sm text-muted-foreground">Không thấy học viên nào. Học viên mới phải được tạo ở hệ thống học viên trước.</p>
              ) : (
                <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto">
                  {kq.map((u) => (
                    <li key={u.studentId}>
                      <button type="button" className="flex w-full flex-col items-start rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => setChon(u)}>
                        <span className="font-medium">{u.tenHocVien}{u.daCoQuyen ? " · đã có quyền" : ""}</span>
                        <span className="text-xs text-muted-foreground">{[u.maHocVien, u.tenPhuHuynh, u.sdtChe].filter(Boolean).join(" · ")}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </>
        ) : (
          <>
            <p className="rounded-lg bg-muted px-3 py-2 text-sm"><strong>{chon.tenHocVien}</strong>{chon.tenPhuHuynh ? ` · ${chon.tenPhuHuynh}` : ""}{chon.daCoQuyen ? " — đang có quyền: sẽ cộng thêm một kỳ hạn" : ""}</p>
            {khoaTronDoi && chon.daCoQuyen ? <p className="text-sm">Khoá trọn đời: người này đã có quyền trọn đời, không cần cấp thêm.</p> : null}
            <label className={NHAN_O} htmlFor="cap-lydo">Lý do (≥ 10 ký tự)</label>
            <input id="cap-lydo" className={O_NHAP} value={lyDo} onChange={(e) => setLyDo(e.target.value)} />
            <p className={GOI_Y_O}>Ví dụ: “Học bổng theo quyết định số …”, “Tặng đối tác …”.</p>
            <div className="flex gap-2">
              <button
                type="button"
                className={NUT_CHINH}
                disabled={dangChay || lyDo.trim().length < 10}
                onClick={() =>
                  chuyen(async () => {
                    const r = await capQuyenAction({ courseId, studentId: chon.studentId, loai: "CAP_MIEN_PHI", idempotencyKey: khoa }, { reason: lyDo.trim() });
                    if (!r.ok) return void toast.error(r.error.message);
                    toast.success(r.data.daXuLyTruocDo ? "Thao tác này đã được ghi nhận trước đó" : `Đã cấp quyền${r.data.hetHan ? ` — hạn ${dinhDangNgay(r.data.hetHan)}` : " — trọn đời"}`);
                    dong();
                    router.refresh();
                  })
                }
              >
                {dangChay ? "Đang xử lý…" : "Cấp quyền"}
              </button>
              <button type="button" className={NUT_PHU} onClick={() => setChon(null)}>Chọn người khác</button>
            </div>
          </>
        )}
        <div><button type="button" className={NUT_NHO} onClick={dong}>Đóng</button></div>
      </Hop>
    </>
  );
}

/** Bảng xem trước của hộp "Gia hạn cho …" (QoGiaHan): Khoá · Nguồn hiện tại · Hạn hiện tại · Hạn mới. Cùng `quyetDinhCap` với máy chủ. */
function GiaHanXemTruoc({ tenKhoa, nguonNhan, hetHan, anchorDay, thangHan, trangThai }: { tenKhoa: string; nguonNhan: string; hetHan: string | null; anchorDay: number; thangHan: number | null; trangThai: string }) {
  const ky: KyHan = thangHan === null ? { loai: "TRON_DOI" } : { loai: "THANG", soThang: thangHan };
  const han = hetHan ? new Date(hetHan) : null;
  const xt = xemTruocGiaHan({ now: new Date(), quyen: { trangThai: trangThai === "THU_HOI" ? "REVOKED" : "ACTIVE", hetHan: han, anchorDay }, ky });
  const Dong = ({ t, v, dam }: { t: string; v: string; dam?: boolean }) => (
    <div className="grid grid-cols-[8rem_1fr] gap-2 text-sm"><dt className="text-muted-foreground">{t}</dt><dd className={dam ? "font-semibold" : ""}>{v}</dd></div>
  );
  return (
    <dl aria-label="Xem trước gia hạn" className="flex flex-col gap-1.5 rounded-lg border border-border p-3">
      <Dong t="Khoá" v={tenKhoa} />
      <Dong t="Nguồn hiện tại" v={nguonNhan} />
      <Dong t="Hạn hiện tại" v={han ? dinhDangNgay(han) : "Trọn đời"} />
      {xt.ok ? (
        <Dong t="Hạn mới" v={`${xt.hetHan ? dinhDangNgay(xt.hetHan) : "Trọn đời"}${xt.soThangCong ? ` · thêm ${xt.soThangCong} tháng theo khoá` : ""}`} dam />
      ) : (
        <Dong t="Hạn mới" v={xt.thongBao} dam />
      )}
    </dl>
  );
}
