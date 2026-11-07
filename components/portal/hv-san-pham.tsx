"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { HvDauTrang, HvLuoi, HvThe, HvTrong, NUT_VIEN } from "@/components/portal/hv-ui";
import { HvTabs } from "@/components/portal/hv-tabs";
import { Sticker, type TenSticker } from "@/components/portal/sticker";
import { KY_HIEU, MAU_NHOM, NOI_DUNG, TEN_ROBOT, type NhomDisc, type RobotCuaBe } from "@/lib/portal/hv-tinh-cach-thuan";

// Màn "Sản phẩm & tính cách" — artifact HV-San-pham / M-HV-San-pham.
// KHÔNG vẽ: "Khoe với ba mẹ", lời khen riêng từng ảnh (chưa có dữ liệu), bài khám phá 3 câu + nút "Chơi lại" (DISC thật dùng bộ đề riêng,
// làm lại ở Cổng phụ huynh). Tab "Robot tính cách" chỉ có khi bé CÓ kết quả DISC thật.

type Anh = { id: string; caption: string | null; url: string };
type SanPham = { sessionId: string; buoi: number | null; ten: string | null; nhanNgay: string; anh: Anh[] };
type Tab = "sp" | "rb";

export function HvSanPhamTrang({
  tenHoa,
  dongY,
  sp,
  tong,
  robot,
}: {
  tenHoa: string;
  dongY: boolean;
  sp: SanPham[];
  tong: number;
  robot: RobotCuaBe | null;
}) {
  const [tab, setTab] = useState<Tab>("sp");
  const [xem, setXem] = useState(0);
  const [anhXem, setAnhXem] = useState(0);
  const cur = sp[xem];
  const a = cur?.anh[anhXem] ?? cur?.anh[0];

  return (
    <>
      <HvDauTrang nhan={`GÓC CỦA ${tenHoa.toUpperCase()}`} tieuDe="Sản phẩm & tính cách" />
      {robot && (
        <HvTabs<Tab>
          nhan="Mục"
          muc={[
            { id: "sp", ten: "Sản phẩm của em" },
            { id: "rb", ten: "Robot tính cách" },
          ]}
          gia={tab}
          doi={setTab}
          className="max-w-[480px]"
        />
      )}

      {(tab === "sp" || !robot) && (
        <>
          {!dongY ? (
            <HvTrong>Ba mẹ chưa cho phép dùng hình ảnh của em nên chưa có ảnh ở đây. Ba mẹ bật lại trong Hồ sơ gia đình là ảnh hiện ra.</HvTrong>
          ) : sp.length === 0 ? (
            <HvTrong>Chưa có ảnh sản phẩm nào. Thầy cô chụp ảnh robot của em ở lớp là ảnh hiện ra ở đây.</HvTrong>
          ) : (
            <HvLuoi min={360}>
              <HvThe aria-label="Ảnh đang xem" className="gap-3.5 p-4">
                {a && (
                  <div className="overflow-hidden rounded-2xl bg-[var(--sr-tint-purple)]">
                    {/* Dùng thẻ img thường: ảnh R2 có chữ ký tạm thời, không đi qua trình tối ưu của next/image. */}
                    <img src={a.url} alt={a.caption ?? `Sản phẩm buổi ${cur?.buoi ?? ""}`} loading="lazy" className="block h-auto max-h-[420px] w-full object-contain" />
                  </div>
                )}
                {cur && (
                  <div className="flex flex-col gap-1 px-1">
                    <div className="text-xs font-bold text-[var(--sr-orange-text)]">
                      {[cur.buoi !== null ? `BUỔI ${cur.buoi}` : null, cur.nhanNgay].filter(Boolean).join(" · ")}
                    </div>
                    <b className={cn("break-words text-xl", cur.ten === null && "font-medium text-muted-foreground")}>{cur.ten ?? "Chưa có tên bài"}</b>
                  </div>
                )}
                {cur && cur.anh.length > 1 && (
                  <div className="flex flex-wrap gap-2">
                    {cur.anh.map((x, i) => (
                      <button
                        key={x.id}
                        type="button"
                        aria-pressed={i === anhXem}
                        aria-label={`Ảnh ${i + 1}`}
                        onClick={() => setAnhXem(i)}
                        className={cn("size-14 overflow-hidden rounded-xl border-2", i === anhXem ? "border-[var(--sr-purple)]" : "border-border")}
                      >
                        <img src={x.url} alt="" loading="lazy" className="size-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
                {a && (
                  <div className="flex flex-wrap gap-2">
                    <a href={a.url} target="_blank" rel="noopener noreferrer" download className={cn(NUT_VIEN, "h-10 text-[13px]")}>
                      Tải ảnh về
                    </a>
                  </div>
                )}
              </HvThe>

              <section aria-labelledby="ds-sp" className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h2 id="ds-sp" className="m-0 text-xl font-bold">
                    Các sản phẩm của em
                  </h2>
                  <span className="text-sm text-muted-foreground">{sp.length} buổi · {tong} ảnh</span>
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
                  {sp.map((p, i) => (
                    <button
                      key={p.sessionId}
                      type="button"
                      aria-pressed={i === xem}
                      onClick={() => {
                        setXem(i);
                        setAnhXem(0);
                      }}
                      className={cn(
                        "flex flex-col overflow-hidden rounded-2xl bg-card p-0 text-left text-foreground",
                        i === xem ? "border-[3px] border-[var(--sr-purple)]" : "border border-border",
                      )}
                    >
                      <span aria-hidden="true" className="block h-[104px] w-full bg-[var(--sr-tint-purple)]">
                        {p.anh[0] && <img src={p.anh[0].url} alt="" loading="lazy" className="size-full object-cover" />}
                      </span>
                      <span className="flex flex-col gap-0.5 px-2.5 pb-2.5 pt-2">
                        <span className="text-[11px] font-bold text-[var(--sr-orange-text)]">{p.buoi !== null ? `Buổi ${p.buoi}` : "Buổi học"}</span>
                        <span className={cn("break-words text-sm font-bold leading-[19px]", p.ten === null && "font-medium text-muted-foreground")}>
                          {p.ten ?? "Chưa có tên bài"}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
                <div className="text-[13px] leading-[19px] text-muted-foreground">
                  Ảnh do thầy cô chụp ở lớp và đã được ba mẹ đồng ý. Ảnh có bạn khác sẽ không hiện ở đây.
                </div>
              </section>
            </HvLuoi>
          )}
        </>
      )}

      {robot && tab === "rb" && <RobotTinhCach r={robot} />}
    </>
  );
}

/** Mỗi nhóm tính cách một sticker (D = siêu nhân · I = ăn mừng · S = thư giãn · C = đọc sách). */
const STICKER_NHOM: Record<NhomDisc, TenSticker> = { D: "sieu-nhan", I: "an-mung", S: "thu-gian", C: "doc-sach" };

function RobotTinhCach({ r }: { r: RobotCuaBe }) {
  const nd = NOI_DUNG[r.chinh];
  const nhom: NhomDisc[] = ["D", "I", "S", "C"];
  const the: { tieu: string; y: string[]; cham: string }[] = [
    { tieu: "Điểm mạnh của em", y: nd.manh, cham: "var(--sr-success)" },
    { tieu: "Em làm tốt nhất khi", y: nd.tot, cham: "var(--sr-orange)" },
    { tieu: "Mẹo nhỏ cho em", y: nd.meo, cham: "var(--sr-purple)" },
  ];
  return (
    <>
      <section style={{ background: MAU_NHOM[r.chinh].nen }} className="flex flex-wrap items-center gap-5 rounded-3xl p-6">
        <span className="grid size-[120px] shrink-0 place-items-center rounded-[32px] bg-card">
          <Sticker ten={STICKER_NHOM[r.chinh]} cao={104} />
        </span>
        <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-2">
          <div className="text-xs font-bold tracking-[0.08em] text-muted-foreground">EM GIỐNG NHẤT</div>
          <h2 className="m-0 font-display text-[28px] font-extrabold leading-[34px] min-[900px]:text-[32px] min-[900px]:leading-[38px]">{TEN_ROBOT[r.chinh]}</h2>
          <div className="text-base leading-6">{nd.cau}</div>
          <div className="text-[13px] text-muted-foreground">Kèm một chút {TEN_ROBOT[r.phu]}</div>
        </div>
      </section>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-4">
        {the.map((t) => (
          <article key={t.tieu} className="flex flex-col gap-2.5 rounded-[20px] border border-border bg-card p-5">
            <b className="text-[17px]">{t.tieu}</b>
            {t.y.map((y) => (
              <div key={y} className="flex gap-2.5 text-sm leading-[21px]">
                <span aria-hidden="true" style={{ background: t.cham }} className="mt-1.5 size-2.5 shrink-0 rounded-full" />
                {y}
              </div>
            ))}
          </article>
        ))}
      </div>
      <HvThe className="gap-3">
        <b className="text-[17px]">Bốn kiểu robot — ai cũng có một chút của cả bốn</b>
        {nhom.map((k) => (
          <div key={k} className="flex items-center gap-3">
            <span className="flex flex-[0_0_150px] items-center gap-1.5 text-sm font-semibold max-[430px]:flex-[0_0_110px]">
              <span aria-hidden="true">{KY_HIEU[k]}</span>
              {TEN_ROBOT[k]}
            </span>
            <div aria-hidden="true" className="h-3.5 flex-1 overflow-hidden rounded-full bg-[var(--sr-bar-off)]">
              <div style={{ width: `${r.thanh[k]}%`, background: MAU_NHOM[k].thanh }} className="h-full rounded-full" />
            </div>
          </div>
        ))}
        <span className="pt-1.5 text-[13px] leading-[19px] text-muted-foreground">
          Không có kiểu nào tốt hơn kiểu nào. Mỗi lần làm lại có thể ra khác một chút — vì em đang lớn lên! Muốn làm lại bài thì nhờ ba mẹ vào Cổng phụ huynh nhé.
        </span>
      </HvThe>
    </>
  );
}
