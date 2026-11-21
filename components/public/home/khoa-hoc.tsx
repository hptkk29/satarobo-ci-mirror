import Link from "next/link";
import { PubAnh } from "@/components/public/pub-design/pub-anh";
import type { GiaTheKhoa } from "./home-thuan";
import { NHAN_HOC_PHI_LIEN_HE } from "@/lib/public/hoc-phi-an";

/**
 * [01] Lộ trình khoá học — CHÉP từ Main.dc.html. Giá chỉ in khi có nguồn thật (`gia.<khoá>` = null ⇒ bỏ cả khối giá,
 * thẻ còn "Xem chi tiết →"): xem `home-loader.ts` + `dungGiaTrangChu`.
 */
export function KhoaHocSection({ gia }: { gia: GiaTheKhoa }) {
  return (
      <section id="khoa-hoc" className="sec">
        <div className="wrap">
          <div className="head2 sv a-mask">
            <div>
              <span className="label mono">
                <b>
                  [01]
                </b>
                {" "}
                Lộ trình khoá học
              </span>
              <h2>
                Khoá học Robotics từ luyện thi đến
                {" "}
                <span className="grad">
                  AI & IoT
                </span>
              </h2>
            </div>
            <p>
              4 buổi mỗi tháng. Mỗi học phần 12 buổi khép lại bằng buổi thuyết trình trước phụ huynh.
            </p>
            <PubAnh id="73b382084ca7853afdf952e288f8a206" className="sticker bob hide-sm" alt="" aria-hidden="true" style={{right: "0", top: "-150px", width: "150px"}} sizes="150px" />
          </div>
          <div className="g4">
            <article className="card lift sv a-flip">
              <div className="zoom brk" style={{position: "relative", height: "200px", overflow: "hidden"}}>
                <PubAnh id="659c303937fe76b0d2be11b04c59889e" alt="Học viên luyện RoboSim" style={{width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 35%"}} sizes="(max-width: 640px) 100vw, (max-width: 1100px) 50vw, 290px" />
                <span style={{position: "absolute", top: "12px", right: "12px", background: "rgba(20,8,32,0.85)", color: "#fff", borderRadius: "999px", padding: "4px 10px", fontSize: "12px"}}>
                  Lớp 3–8 · có nền tảng
                </span>
                <PubAnh id="0dc66ebc51f2e0648814a6232081a092" alt="" aria-hidden="true" style={{position: "absolute", right: "8px", bottom: "8px", width: "84px", filter: "drop-shadow(0 8px 14px rgba(0,0,0,0.5))"}} sizes="84px" />
              </div>
              <div style={{padding: "20px", display: "flex", flexDirection: "column", gap: "12px", flexGrow: "1"}}>
                <span className="mono" style={{alignSelf: "flex-start", fontSize: "11px", color: "#241133", background: "#f5c344", padding: "3px 8px", borderRadius: "6px"}}>
                  Sata1 · Sata2 · RoboSim + Beta
                </span>
                <h3>
                  <Link href="/khoa-hoc/combo-sata1-sata2" style={{color: "inherit", textDecoration: "none"}}>
                    Luyện thi Robotics
                  </Link>
                </h3>
                <p style={{margin: "0", fontSize: "14px", lineHeight: "1.55", color: "var(--muted)"}}>
                  Luyện chuyên sâu trên RoboSim — phần mềm bắt buộc của Cuộc thi Sáng tạo Robotics — kết hợp robot Beta thật trên sa bàn.
                </p>
                <ul style={{margin: "0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: "6px", fontSize: "14px"}}>
                  <li>
                    <b style={{color: "#fe8f2d"}}>
                      ✓
                    </b>
                    {" "}
                    Giải đề vòng loại 2026
                  </li>
                  <li>
                    <b style={{color: "#fe8f2d"}}>
                      ✓
                    </b>
                    {" "}
                    Chạy thử trên sa bàn thi đấu
                  </li>
                  <li>
                    <b style={{color: "#fe8f2d"}}>
                      ✓
                    </b>
                    {" "}
                    Học thêm online qua SataWorld
                  </li>
                </ul>
                <div style={{marginTop: "auto", paddingTop: "14px", borderTop: "1px solid var(--line)", display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px"}}>
                  {gia.combo ? (
                  <span style={{whiteSpace: "nowrap"}}>
                    <small style={{fontSize: "12px", color: "var(--muted)"}}>
                      từ
                      {" "}
                    </small>
                    <strong style={{fontSize: "17px"}}>
                      {gia.combo}
                    </strong>
                    <span style={{fontSize: "13px", color: "var(--muted)"}}>
                      /khoá
                    </span>
                  </span>
                  ) : (
                    <strong style={{fontSize: "15px", whiteSpace: "nowrap"}}>{NHAN_HOC_PHI_LIEN_HE}</strong>
                  )}
                  <Link href="/khoa-hoc/combo-sata1-sata2" style={{fontSize: "14px", fontWeight: "700", textDecoration: "none", whiteSpace: "nowrap"}}>
                    Xem chi tiết →
                  </Link>
                </div>
              </div>
            </article>
            <article className="lift sv d2 a-flip iri" style={{borderRadius: "18px", padding: "2px", display: "flex"}}>
              <div style={{background: "var(--panel)", borderRadius: "16px", overflow: "hidden", display: "flex", flexDirection: "column", width: "100%"}}>
                <div className="mono" style={{background: "#fe8f2d", color: "#241133", textAlign: "center", fontSize: "11px", padding: "6px"}}>
                  ★ Phổ biến nhất
                </div>
                <div className="zoom brk" style={{position: "relative", height: "200px", overflow: "hidden"}}>
                  <PubAnh id="0905411cbc3f291c8a60dbbeab1ab8ea" alt="Bé lắp robot Alpha trong buổi học thử" style={{width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 70%"}} sizes="(max-width: 640px) 100vw, (max-width: 1100px) 50vw, 290px" />
                  <span style={{position: "absolute", top: "12px", right: "12px", background: "rgba(20,8,32,0.85)", color: "#fff", borderRadius: "999px", padding: "4px 10px", fontSize: "12px"}}>
                    6–7 tuổi · Lớp 1–2
                  </span>
                  <PubAnh id="1232bb9a8bfc26aa604f7ce16aac28a7" alt="" aria-hidden="true" style={{position: "absolute", right: "8px", bottom: "8px", width: "90px", filter: "drop-shadow(0 8px 14px rgba(0,0,0,0.5))"}} sizes="90px" />
                </div>
                <div style={{padding: "20px", display: "flex", flexDirection: "column", gap: "12px", flexGrow: "1"}}>
                  <span className="mono" style={{alignSelf: "flex-start", fontSize: "11px", color: "#241133", background: "#4fd1b5", padding: "3px 8px", borderRadius: "6px"}}>
                    Sata3 · Alpha Set
                  </span>
                  <h3>
                    <Link href="/khoa-hoc/sata3" style={{color: "inherit", textDecoration: "none"}}>
                      Nhập môn Robotics
                    </Link>
                  </h3>
                  <p style={{margin: "0", fontSize: "14px", lineHeight: "1.55", color: "var(--muted)"}}>
                    Con lắp robot từ hàng trăm chi tiết, ra lệnh bằng thẻ lệnh và khối kéo thả — hiểu “ra lệnh → robot làm” trước khi cần biết code.
                  </p>
                  <ul style={{margin: "0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: "6px", fontSize: "14px"}}>
                    <li>
                      <b style={{color: "#fe8f2d"}}>
                        ✓
                      </b>
                      {" "}
                      Lắp ráp theo sơ đồ kỹ thuật
                    </li>
                    <li>
                      <b style={{color: "#fe8f2d"}}>
                        ✓
                      </b>
                      {" "}
                      Tư duy logic, thuật toán cơ bản
                    </li>
                    <li>
                      <b style={{color: "#fe8f2d"}}>
                        ✓
                      </b>
                      {" "}
                      16 mô hình: khủng long, cua, tàu cướp biển…
                    </li>
                  </ul>
                  <div style={{marginTop: "auto", paddingTop: "14px", borderTop: "1px solid var(--line)", display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px"}}>
                    {gia.sata3 ? (
                    <span style={{whiteSpace: "nowrap"}}>
                      <strong style={{fontSize: "17px"}}>
                        {gia.sata3}
                      </strong>
                      <span style={{fontSize: "13px", color: "var(--muted)"}}>
                        /tháng
                      </span>
                    </span>
                    ) : (
                      <strong style={{fontSize: "15px", whiteSpace: "nowrap"}}>{NHAN_HOC_PHI_LIEN_HE}</strong>
                    )}
                    <Link href="/khoa-hoc/sata3" style={{fontSize: "14px", fontWeight: "700", textDecoration: "none", whiteSpace: "nowrap"}}>
                      Xem chi tiết →
                    </Link>
                  </div>
                </div>
              </div>
            </article>
            <article className="lift sv d3 a-flip iri" style={{borderRadius: "18px", padding: "2px", display: "flex"}}>
              <div style={{background: "var(--panel)", borderRadius: "16px", overflow: "hidden", display: "flex", flexDirection: "column", width: "100%"}}>
                <div className="mono" style={{background: "#fe8f2d", color: "#241133", textAlign: "center", fontSize: "11px", padding: "6px"}}>
                  ★ Sata4 phổ biến nhất
                </div>
                <div className="zoom brk" style={{position: "relative", height: "200px", overflow: "hidden"}}>
                  <PubAnh id="5a335391616fec91521ce26956359a45" alt="Học viên điều khiển robot Beta trên sa bàn" style={{width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 60%"}} sizes="(max-width: 640px) 100vw, (max-width: 1100px) 50vw, 290px" />
                  <span style={{position: "absolute", top: "12px", right: "12px", background: "rgba(20,8,32,0.85)", color: "#fff", borderRadius: "999px", padding: "4px 10px", fontSize: "12px"}}>
                    8–12 tuổi · Lớp 3+
                  </span>
                  <PubAnh id="e2d49e8c75861d7dc293ace982a38c15" alt="" aria-hidden="true" style={{position: "absolute", right: "8px", bottom: "8px", width: "80px", filter: "drop-shadow(0 8px 14px rgba(0,0,0,0.5))"}} sizes="80px" />
                </div>
                <div style={{padding: "20px", display: "flex", flexDirection: "column", gap: "12px", flexGrow: "1"}}>
                  <span className="mono" style={{alignSelf: "flex-start", fontSize: "11px", color: "#241133", background: "#fe8f2d", padding: "3px 8px", borderRadius: "6px"}}>
                    Sata4 · Sata6 · Beta Set
                  </span>
                  <h3>
                    <Link href="/khoa-hoc/sata4" style={{color: "inherit", textDecoration: "none"}}>
                      Robotics thi đấu
                    </Link>
                  </h3>
                  <p style={{margin: "0", fontSize: "14px", lineHeight: "1.55", color: "var(--muted)"}}>
                    Chuyển từ “ra lệnh” sang “xây dựng logic”: dò line, tránh vật cản, gỡ lỗi và tối ưu thuật toán.
                  </p>
                  <ul style={{margin: "0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: "6px", fontSize: "14px"}}>
                    <li>
                      <b style={{color: "#fe8f2d"}}>
                        ✓
                      </b>
                      {" "}
                      Cảm biến chính xác cao
                    </li>
                    <li>
                      <b style={{color: "#fe8f2d"}}>
                        ✓
                      </b>
                      {" "}
                      Xe dò line, cánh tay robot, robot biểu cảm
                    </li>
                    <li>
                      <b style={{color: "#fe8f2d"}}>
                        ✓
                      </b>
                      {" "}
                      Huấn luyện thi đấu Robotics
                    </li>
                  </ul>
                  <div style={{marginTop: "auto", paddingTop: "14px", borderTop: "1px solid var(--line)", display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px"}}>
                    {gia.sata4 ? (
                    <span style={{whiteSpace: "nowrap"}}>
                      <small style={{fontSize: "12px", color: "var(--muted)"}}>
                        từ
                        {" "}
                      </small>
                      <strong style={{fontSize: "17px"}}>
                        {gia.sata4}
                      </strong>
                      <span style={{fontSize: "13px", color: "var(--muted)"}}>
                        /tháng
                      </span>
                    </span>
                    ) : (
                      <strong style={{fontSize: "15px", whiteSpace: "nowrap"}}>{NHAN_HOC_PHI_LIEN_HE}</strong>
                    )}
                    <Link href="/khoa-hoc/sata4" style={{fontSize: "14px", fontWeight: "700", textDecoration: "none", whiteSpace: "nowrap"}}>
                      Xem chi tiết →
                    </Link>
                  </div>
                </div>
              </div>
            </article>
            <article className="card lift sv d4 a-flip">
              <div className="zoom brk" style={{position: "relative", height: "200px", overflow: "hidden"}}>
                <PubAnh id="8fc7aaf0088b11dee2ad657e3688f291" alt="Học viên cùng nhau lập trình" style={{width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 55%"}} sizes="(max-width: 640px) 100vw, (max-width: 1100px) 50vw, 290px" />
                <span style={{position: "absolute", top: "12px", right: "12px", background: "rgba(20,8,32,0.85)", color: "#fff", borderRadius: "999px", padding: "4px 10px", fontSize: "12px"}}>
                  9–14 tuổi · Lớp 3+
                </span>
                <span className="mono" style={{position: "absolute", left: "12px", bottom: "12px", background: "rgba(20,8,32,0.85)", color: "#4fd1b5", borderRadius: "6px", padding: "4px 8px", fontSize: "11px"}}>
                  ◉ Camera AI · IoT
                </span>
              </div>
              <div style={{padding: "20px", display: "flex", flexDirection: "column", gap: "12px", flexGrow: "1"}}>
                <span className="mono" style={{alignSelf: "flex-start", fontSize: "11px", color: "#ffffff", background: "#8e3cc4", padding: "3px 8px", borderRadius: "6px"}}>
                  Sata5 · Sata7 · Intel Set
                </span>
                <h3>
                  <Link href="/khoa-hoc/sata5" style={{color: "inherit", textDecoration: "none"}}>
                    AI, Camera & IoT
                  </Link>
                </h3>
                <p style={{margin: "0", fontSize: "14px", lineHeight: "1.55", color: "var(--muted)"}}>
                  Camera AI thế hệ mới + MCU hiệu năng cao. Học theo dự án (PBL): robot nhận diện khuôn mặt, vật thể, QR code, cử chỉ và kết nối IoT.
                </p>
                <ul style={{margin: "0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: "6px", fontSize: "14px"}}>
                  <li>
                    <b style={{color: "#fe8f2d"}}>
                      ✓
                    </b>
                    {" "}
                    Nhận diện khuôn mặt, vật thể, QR
                  </li>
                  <li>
                    <b style={{color: "#fe8f2d"}}>
                      ✓
                    </b>
                    {" "}
                    Điều khiển bằng cử chỉ
                  </li>
                  <li>
                    <b style={{color: "#fe8f2d"}}>
                      ✓
                    </b>
                    {" "}
                    Kết nối IoT, học theo dự án
                  </li>
                </ul>
                <div style={{marginTop: "auto", paddingTop: "14px", borderTop: "1px solid var(--line)", display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px"}}>
                  {gia.sata5 ? (
                  <span style={{whiteSpace: "nowrap"}}>
                    <small style={{fontSize: "12px", color: "var(--muted)"}}>
                      từ
                      {" "}
                    </small>
                    <strong style={{fontSize: "17px"}}>
                      {gia.sata5}
                    </strong>
                    <span style={{fontSize: "13px", color: "var(--muted)"}}>
                      /tháng
                    </span>
                  </span>
                  ) : (
                    <strong style={{fontSize: "15px", whiteSpace: "nowrap"}}>{NHAN_HOC_PHI_LIEN_HE}</strong>
                  )}
                  <Link href="/khoa-hoc/sata5" style={{fontSize: "14px", fontWeight: "700", textDecoration: "none", whiteSpace: "nowrap"}}>
                    Xem chi tiết →
                  </Link>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>
  );
}
