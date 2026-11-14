// Nội dung sao chép từ thiết kế (artifact Design 02/11/2026) — văn bản chào khách của 9 trang khoá học.
// KHÔNG chứa giá: học phí đọc từ Course.price / CoursePackage / courses-pricing qua `khoa-hoc-loader.ts`.
// Tên bài của khoá theo năm (Sata3–7) KHÔNG nằm ở đây — lấy từ roadmap-5-years.ts (nguồn giáo trình).
// Khoá luyện thi (Sata1/2/Combo/Sata8) chia học phần theo giáo trình phiên bản 2026.1 nên mang bài học tại đây.
import type { KhoaNoiDung, TheDanhSach } from "./kieu";

export const NOI_DUNG_KHOA: Record<string, KhoaNoiDung> = {
  sata3: {
    slug: "sata3",
    loai: "nam",
    ma: "Sata3",
    ten: "Ươm mầm tài năng",
    lop: "Lớp 1–2",
    mau: "#4fd1b5",
    maGiaoTrinh: "SATA3",
    phienBanGiaoTrinh: "[v2026.1]",
    thietBi: "Hệ sinh thái Alpha A + C & cảm biến siêu âm",
    moTa: "Con lắp mô hình từ con số 0, lập trình bằng thẻ lệnh không cần màn hình và thấy robot chuyển động ngay trước mắt.",
    suMenh: "Giai đoạn vàng trong phát triển tư duy của trẻ lớp 1–2: não bộ tiếp thu nhanh nhất, hứng thú khám phá mạnh nhất.",
    kyNang: [
      "Tư duy hệ thống sơ đồ",
      "Cơ sở cơ giới hoá",
      "Lập trình thẻ (screen-free)",
      "Vận động tinh",
      "Phân tích bản vẽ",
      "Xử lý sự cố vật lý",
      "Tính kiên định",
      "Tò mò khoa học",
    ],
    anhBo: "a666ac3e1e338d2186c3c7704b0fa511",
    thuVien: [
      "8e84cedec6e850911465d7aafb64dbb3",
      "a666ac3e1e338d2186c3c7704b0fa511",
      "6d64d0aed432227fd19aaa18afd44f09",
      "0905411cbc3f291c8a60dbbeab1ab8ea",
      "2d3137371ad8a3e0a84fc914d68d0860",
    ],
    hocPhan: [
      {
        ma: "HP1",
        tieuDe: "Làm quen & lắp ráp cơ khí",
        tomTat: "Làm quen cơ cấu truyền động, lắp ráp theo sơ đồ và điều khiển mô hình Alpha đầu tiên.",
        ketQua: "Con hoàn thành dự án robot cơ bản và trình bày được nguyên lý chuyển động.",
      },
      {
        ma: "HP2",
        tieuDe: "Cơ cấu nhiều chân & nâng hạ",
        tomTat: "Mở rộng sang cơ cấu nhiều chân, nâng hạ, vẽ tự động và mô phỏng sinh vật.",
        ketQua: "Con biết phân tích lỗi vật lý và cải tiến mô hình sau thử nghiệm.",
      },
      {
        ma: "HP3",
        tieuDe: "Lực, nhịp & đối kháng",
        tomTat: "Phát triển tư duy kỹ thuật qua dự án có lực, nhịp chuyển động và cơ cấu đối kháng.",
        ketQua: "Con tạo được mô hình có câu chuyện, cơ chế rõ ràng và biết giải thích giải pháp.",
      },
      {
        ma: "HP4",
        tieuDe: "Cảm biến & dự án cuối năm",
        tomTat: "Tích hợp cơ khí, cảm biến siêu âm và lập trình thẻ để hoàn thiện dự án cuối năm.",
        ketQua: "Con tốt nghiệp Năm 1 với một dự án Robotics vật lý hoàn chỉnh.",
      },
    ],
    trang: {
      metaTitle: "Sata3 – Ươm mầm tài năng | Khoá học Robotics Sata Robo Đà Nẵng",
      glow: "#4fd1b555",
      nhan: "Alpha A + C & cảm biến siêu âm",
      h1Truoc: "Sata3 – ",
      h1Nhan: "Ươm mầm tài năng",
      dan: "Giai đoạn vàng phát triển tư duy: con tự lắp mô hình từ con số 0, lập trình bằng thẻ lệnh không cần màn hình và thấy robot chuyển động ngay trước mắt.",
      chips: ["Lớp 1–2", "48 buổi · 72 giờ", "90 phút/buổi"],
      hero: {
        kieu: "bp",
        anhBo: "a666ac3e1e338d2186c3c7704b0fa511",
        nhan: ["ALPHA A + C & CẢM BIẾN SIÊU ÂM", "LỚP 1–2", "48 BUỔI · 72 GIỜ"],
        sticker: "a8d293a9efc52ad97026bd2d0dc02db2",
        stickerStyle: "height: auto; position: absolute; z-index: 3; filter: drop-shadow(0 16px 20px rgba(0,0,0,.35)); right: -4%; bottom: -9%; width: 118px; z-index: 4",
        stickerClass: "float",
      },
      facts: [
        {
          icon: "I0",
          nhan: "Đối tượng",
        },
        {
          icon: "I1",
          nhan: "Thời lượng",
        },
        {
          icon: "I2",
          nhan: "Mỗi buổi",
        },
        {
          icon: "I3",
          nhan: "Học phí",
        },
      ],
      kyNangTrang: [
        "Tư duy hệ thống sơ đồ",
        "Cơ sở cơ giới hoá",
        "Logic lập trình thẻ (screen-free)",
        "Vận động tinh",
        "Phân tích bản vẽ",
        "Xử lý sự cố vật lý",
        "Tính kiên định",
        "Sự tò mò khoa học",
      ],
      nhanDuoc: [
        {
          icon: "I4",
          tieuDe: "Yêu công nghệ",
          moTa: "Hào hứng tự tay tạo ra thứ chuyển động được.",
        },
        {
          icon: "I2",
          tieuDe: "Tư duy logic",
          moTa: "Quan sát, suy luận và sáng tạo qua từng mô hình.",
        },
        {
          icon: "I0",
          tieuDe: "Tự tin thuyết trình",
          moTa: "Trình bày sản phẩm trước ba mẹ sau mỗi học phần.",
        },
        {
          icon: "I5",
          tieuDe: "Thói quen tích cực",
          moTa: "Dùng công nghệ để học và làm, không chỉ giải trí.",
        },
      ],
      nenGia: "linear-gradient(140deg, #4fd1b533, rgba(254,143,45,.14))",
      diemGia: [
        "Giáo trình & bộ kit dùng tại lớp",
        "Nhận xét sau mỗi buổi gửi phụ huynh",
        "Thuyết trình sản phẩm cuối mỗi học phần",
        "Lớp tối đa 12 học viên",
      ],
      faqs: [
        [
          "Con chưa biết gì về robot có học được không?",
          "Được. Giáo viên đánh giá đầu vào trong buổi học thử 1-1 và xếp con vào cấp độ phù hợp.",
        ],
        ["Mỗi lớp có bao nhiêu học viên?", "Lớp nhỏ, tối đa 12 học viên để giáo viên theo sát từng bạn."],
        [
          "Ba mẹ theo dõi việc học của con thế nào?",
          "Giáo viên gửi nhận xét sau mỗi buổi; cuối mỗi 12 buổi con thuyết trình sản phẩm trước ba mẹ.",
        ],
        [
          "Học phí có trả góp được không?",
          "Có. Khoá chuyên sâu 48 buổi hỗ trợ trả góp theo tháng – tư vấn viên gửi phương án chi tiết.",
        ],
        [
          "Nếu học thử không hợp thì sao?",
          "Buổi học thử 1-1 hoàn toàn miễn phí. Sau buổi học đầu tiên, nếu ba mẹ không hài lòng, Sata Robo hoàn 100% học phí.",
        ],
      ],
      khac: [
        {
          slug: "sata4",
          tag: "Cấp tiếp theo · Sata4",
          img: "dbdef77fa2d35499f574fa1ec71acf88",
        },
        {
          slug: "laptrinhrobot",
          tag: "Gợi ý · Lập trình Robot",
          img: "368d0fd5444dc86f2fdc53229baed55b",
        },
        {
          slug: "combo-sata1-sata2",
          tag: "Gợi ý · Combo Sata1 + Sata2",
          img: "3d425f2a2c063a1916225676ca19f4f4",
        },
      ],
    },
  },
  sata4: {
    slug: "sata4",
    loai: "nam",
    ma: "Sata4",
    ten: "Bứt phá giới hạn",
    lop: "Lớp 3–4",
    mau: "#fe8f2d",
    maGiaoTrinh: "SATA4",
    phienBanGiaoTrinh: "[v2026.1]",
    thietBi: "RoboSim + Beta Set + sa bàn thi đấu",
    moTa: "Từ “ra lệnh” sang “xây dựng logic”: làm chủ RoboSim, điều khiển robot Beta thật và sẵn sàng thi cấp thành phố.",
    suMenh: "Giai đoạn hình thành tư duy hệ thống: kết hợp RoboSim và robot thật để con hiểu nguyên lý và tự giải quyết vấn đề.",
    kyNang: [
      "Lập trình tự hành",
      "Rẽ nhánh phức hợp",
      "Xử lý dữ liệu cảm biến",
      "Làm chủ RoboSim",
      "Cơ khí thi đấu",
      "Đồng bộ mô phỏng → robot thật",
      "Tư duy gỡ lỗi",
      "Bản lĩnh đấu trường",
    ],
    anhBo: "dbdef77fa2d35499f574fa1ec71acf88",
    thuVien: [
      "5a335391616fec91521ce26956359a45",
      "dbdef77fa2d35499f574fa1ec71acf88",
      "905ff0dd9c6dc83a67626cb74cc37dd2",
      "c05423b933c693663c6b5bc7ec74af88",
      "f71e84fb731737f008e409125c96e7d5",
    ],
    hocPhan: [
      {
        ma: "HP1",
        tieuDe: "RoboSim & cảm biến cơ bản",
        tomTat: "Làm quen RoboSim, cảm biến và thuật toán điều khiển cơ bản.",
        ketQua: "Con hoàn thành xe robot tự hành trong môi trường mô phỏng.",
      },
      {
        ma: "HP2",
        tieuDe: "Thiết kế robot & luyện thi đấu",
        tomTat: "Phân tích thể lệ, thiết kế robot và luyện các nhiệm vụ thi đấu.",
        ketQua: "Con có robot sẵn sàng chạy nhiệm vụ theo sa bàn.",
      },
      {
        ma: "HP3",
        tieuDe: "Robot Beta & dò line nâng cao",
        tomTat: "Chuyển sang robot Beta thật với điều khiển từ xa và dò line nâng cao.",
        ketQua: "Con vận hành được robot vật lý với nhiệm vụ dò line.",
      },
      {
        ma: "HP4",
        tieuDe: "Tổng duyệt & chiến thuật thi đấu",
        tomTat: "Đi trọn chu kỳ thi từ phân tích thể lệ đến thi đấu nội bộ.",
        ketQua: "Con hoàn thành bài thi nội bộ với quy trình kỹ thuật rõ ràng.",
      },
    ],
    trang: {
      metaTitle: "Sata4 – Bứt phá giới hạn | Khoá học Robotics Sata Robo Đà Nẵng",
      glow: "#fe8f2d55",
      nhan: "RoboSim + Beta Set + sa bàn thi đấu",
      h1Truoc: "Sata4 – ",
      h1Nhan: "Bứt phá giới hạn",
      dan: "Từ “ra lệnh” sang “xây dựng logic”: con làm chủ RoboSim, điều khiển robot Beta thật và sẵn sàng cho cuộc thi Robotics cấp thành phố.",
      chips: ["Lớp 3–4", "48 buổi · 72 giờ", "90 phút/buổi"],
      hero: {
        kieu: "bp",
        anhBo: "dbdef77fa2d35499f574fa1ec71acf88",
        nhan: ["ROBOSIM + BETA SET + SA BÀN THI ĐẤU", "LỚP 3–4", "48 BUỔI · 72 GIỜ"],
        sticker: "bb38a24d4c4cbde40ee43774b5002179",
        stickerStyle: "height: auto; position: absolute; z-index: 3; filter: drop-shadow(0 16px 20px rgba(0,0,0,.35)); right: -4%; bottom: -9%; width: 118px; z-index: 4",
        stickerClass: "float",
      },
      facts: [
        {
          icon: "I0",
          nhan: "Đối tượng",
        },
        {
          icon: "I1",
          nhan: "Thời lượng",
        },
        {
          icon: "I2",
          nhan: "Mỗi buổi",
        },
        {
          icon: "I3",
          nhan: "Học phí",
        },
      ],
      kyNangTrang: [
        "Lập trình tự hành",
        "Cấu trúc rẽ nhánh phức hợp",
        "Xử lý dữ liệu cảm biến",
        "Làm chủ RoboSim",
        "Cấu trúc cơ khí thi đấu",
        "Đồng bộ mô phỏng → robot thật",
        "Tư duy gỡ lỗi",
        "Bản lĩnh đấu trường",
      ],
      nhanDuoc: [
        {
          icon: "I4",
          tieuDe: "Làm chủ RoboSim & robot thật",
          moTa: "Lập trình trên mô phỏng và điều khiển robot Beta trên sa bàn.",
        },
        {
          icon: "I2",
          tieuDe: "Tư duy thuật toán",
          moTa: "Phân tích bài toán và tự sửa lỗi.",
        },
        {
          icon: "I0",
          tieuDe: "Kỹ năng thuyết trình",
          moTa: "Trình bày giải pháp rõ ràng, tự tin.",
        },
        {
          icon: "I5",
          tieuDe: "Sẵn sàng thi đấu",
          moTa: "Đủ nền tảng tham gia cuộc thi cấp thành phố.",
        },
      ],
      nenGia: "linear-gradient(140deg, #fe8f2d33, rgba(254,143,45,.14))",
      diemGia: [
        "Giáo trình & bộ kit dùng tại lớp",
        "Nhận xét sau mỗi buổi gửi phụ huynh",
        "Thuyết trình sản phẩm cuối mỗi học phần",
        "Lớp tối đa 12 học viên",
      ],
      faqs: [
        [
          "Con chưa biết gì về robot có học được không?",
          "Được. Giáo viên đánh giá đầu vào trong buổi học thử 1-1 và xếp con vào cấp độ phù hợp.",
        ],
        ["Mỗi lớp có bao nhiêu học viên?", "Lớp nhỏ, tối đa 12 học viên để giáo viên theo sát từng bạn."],
        [
          "Ba mẹ theo dõi việc học của con thế nào?",
          "Giáo viên gửi nhận xét sau mỗi buổi; cuối mỗi 12 buổi con thuyết trình sản phẩm trước ba mẹ.",
        ],
        [
          "Học phí có trả góp được không?",
          "Có. Khoá chuyên sâu 48 buổi hỗ trợ trả góp theo tháng – tư vấn viên gửi phương án chi tiết.",
        ],
        [
          "Nếu học thử không hợp thì sao?",
          "Buổi học thử 1-1 hoàn toàn miễn phí. Sau buổi học đầu tiên, nếu ba mẹ không hài lòng, Sata Robo hoàn 100% học phí.",
        ],
      ],
      khac: [
        {
          slug: "sata3",
          tag: "Cấp trước · Sata3",
          img: "a666ac3e1e338d2186c3c7704b0fa511",
        },
        {
          slug: "sata5",
          tag: "Cấp tiếp theo · Sata5",
          img: "f5f7c32bbcd018254cf34914d98fd82c",
        },
        {
          slug: "laptrinhrobot",
          tag: "Gợi ý · Lập trình Robot",
          img: "368d0fd5444dc86f2fdc53229baed55b",
        },
      ],
    },
  },
  sata5: {
    slug: "sata5",
    loai: "nam",
    ma: "Sata5",
    ten: "Khơi nguồn sáng tạo",
    lop: "Lớp 5",
    mau: "#60a5fa",
    maGiaoTrinh: "SATA5",
    phienBanGiaoTrinh: "[v2026.1]",
    thietBi: "Hệ sinh thái Storm (chuẩn kỹ sư)",
    moTa: "Làm việc như kỹ sư thực thụ với Storm: cơ khí động lực, cảm biến, smart-home và robot tự hành.",
    suMenh: "Giai đoạn sáng tạo thực sự với thiết bị Storm cao cấp: con thiết kế và xây dựng giải pháp cho bài toán thực tế.",
    kyNang: [
      "Cơ khí động lực học",
      "Cơ cấu truyền động",
      "Vật lý kỹ thuật",
      "Tự động hoá & smart-home",
      "Tích hợp đa hệ thống",
      "Giao tiếp tín hiệu",
      "Mô hình hoá thực tiễn",
      "Thiết kế bền vững",
    ],
    anhBo: "f5f7c32bbcd018254cf34914d98fd82c",
    thuVien: [
      "444bae85d36170392c4e4c131e845d0e",
      "f5f7c32bbcd018254cf34914d98fd82c",
      "13da897c33250d37f7f5ee9047ef2b1b",
      "d682a47134c89e778451433c1ef229eb",
    ],
    hocPhan: [
      {
        ma: "HP1",
        tieuDe: "Cơ khí động lực học",
        tomTat: "Khám phá cơ khí động lực học qua các mô hình chuyển động.",
        ketQua: "Con thiết kế được mô hình cơ khí có chuyển động ổn định.",
      },
      {
        ma: "HP2",
        tieuDe: "Đo lường & tín hiệu",
        tomTat: "Đo lường, năng lượng, giảm xóc và hệ thống tín hiệu.",
        ketQua: "Con biết kiểm thử và cải tiến mô hình theo dữ liệu quan sát.",
      },
      {
        ma: "HP3",
        tieuDe: "Cảm biến & tự động hoá",
        tomTat: "Tích hợp cảm biến, tín hiệu âm thanh và tự động hoá smart-home.",
        ketQua: "Con hoàn thiện một mô hình tự động hoá thông minh.",
      },
      {
        ma: "HP4",
        tieuDe: "Tự hành & nhận diện",
        tomTat: "Xây dựng giải pháp tự hành, radar, nhận diện và phân loại.",
        ketQua: "Con bảo vệ dự án cuối khoá theo tư duy thiết kế kỹ thuật.",
      },
    ],
    trang: {
      metaTitle: "Sata5 – Khơi nguồn sáng tạo | Khoá học Robotics Sata Robo Đà Nẵng",
      glow: "#60a5fa55",
      nhan: "Hệ sinh thái Storm",
      h1Truoc: "Sata5 – ",
      h1Nhan: "Khơi nguồn sáng tạo",
      dan: "Con làm việc như một kỹ sư thực thụ với hệ sinh thái Storm: cơ khí động lực, cảm biến, smart-home và robot tự hành – và có portfolio dự án của riêng mình.",
      chips: ["Lớp 5", "48 buổi · 72 giờ", "90 phút/buổi"],
      hero: {
        kieu: "bp",
        anhBo: "f5f7c32bbcd018254cf34914d98fd82c",
        nhan: ["HỆ SINH THÁI STORM", "LỚP 5", "48 BUỔI · 72 GIỜ"],
        sticker: "41d8957417d5d5794183fc0c6767039d",
        stickerStyle: "height: auto; position: absolute; z-index: 3; filter: drop-shadow(0 16px 20px rgba(0,0,0,.35)); right: -4%; bottom: -9%; width: 118px; z-index: 4",
        stickerClass: "float",
      },
      facts: [
        {
          icon: "I0",
          nhan: "Đối tượng",
        },
        {
          icon: "I1",
          nhan: "Thời lượng",
        },
        {
          icon: "I2",
          nhan: "Mỗi buổi",
        },
        {
          icon: "I3",
          nhan: "Học phí",
        },
      ],
      kyNangTrang: [
        "Cơ khí động lực học",
        "Làm chủ cơ cấu truyền động",
        "Vật lý kỹ thuật",
        "Tự động hoá & smart-home",
        "Tích hợp đa hệ thống",
        "Giao tiếp tín hiệu",
        "Mô hình hoá thực tiễn",
        "Tư duy thiết kế bền vững",
      ],
      nhanDuoc: [
        {
          icon: "I4",
          tieuDe: "Portfolio cá nhân",
          moTa: "Bộ sưu tập dự án robot thực sự của con.",
        },
        {
          icon: "I2",
          tieuDe: "Sẵn sàng thi cấp tỉnh",
          moTa: "Đủ điều kiện dự thi cấp tỉnh và quốc gia.",
        },
        {
          icon: "I0",
          tieuDe: "Tư duy kỹ sư",
          moTa: "Thiết kế, thử nghiệm và cải tiến như kỹ sư.",
        },
        {
          icon: "I5",
          tieuDe: "Kết nối kiến thức",
          moTa: "Vận dụng vật lý và toán vào mô hình thật.",
        },
      ],
      nenGia: "linear-gradient(140deg, #60a5fa33, rgba(254,143,45,.14))",
      diemGia: [
        "Giáo trình & bộ kit dùng tại lớp",
        "Nhận xét sau mỗi buổi gửi phụ huynh",
        "Thuyết trình sản phẩm cuối mỗi học phần",
        "Lớp tối đa 12 học viên",
      ],
      faqs: [
        [
          "Con chưa biết gì về robot có học được không?",
          "Được. Giáo viên đánh giá đầu vào trong buổi học thử 1-1 và xếp con vào cấp độ phù hợp.",
        ],
        ["Mỗi lớp có bao nhiêu học viên?", "Lớp nhỏ, tối đa 12 học viên để giáo viên theo sát từng bạn."],
        [
          "Ba mẹ theo dõi việc học của con thế nào?",
          "Giáo viên gửi nhận xét sau mỗi buổi; cuối mỗi 12 buổi con thuyết trình sản phẩm trước ba mẹ.",
        ],
        [
          "Học phí có trả góp được không?",
          "Có. Khoá chuyên sâu 48 buổi hỗ trợ trả góp theo tháng – tư vấn viên gửi phương án chi tiết.",
        ],
        [
          "Nếu học thử không hợp thì sao?",
          "Buổi học thử 1-1 hoàn toàn miễn phí. Sau buổi học đầu tiên, nếu ba mẹ không hài lòng, Sata Robo hoàn 100% học phí.",
        ],
      ],
      khac: [
        {
          slug: "sata4",
          tag: "Cấp trước · Sata4",
          img: "dbdef77fa2d35499f574fa1ec71acf88",
        },
        {
          slug: "sata6",
          tag: "Cấp tiếp theo · Sata6",
          img: "905ff0dd9c6dc83a67626cb74cc37dd2",
        },
        {
          slug: "laptrinhrobot",
          tag: "Gợi ý · Lập trình Robot",
          img: "368d0fd5444dc86f2fdc53229baed55b",
        },
      ],
    },
  },
  sata6: {
    slug: "sata6",
    loai: "nam",
    ma: "Sata6",
    ten: "Chinh phục đấu trường",
    lop: "Lớp 6–7",
    mau: "#f472b6",
    maGiaoTrinh: "SATA6",
    phienBanGiaoTrinh: "[v2026.1]",
    thietBi: "RoboSim + Beta Set + sa bàn chuẩn thi đấu",
    moTa: "Lớp thi đấu cấp cao: PID, kiểm soát sai số, tối ưu hành trình và bản lĩnh trước áp lực.",
    suMenh: "Khoá học của những học sinh nghiêm túc muốn thi đấu thật và đạt thành tích thật – lộ trình hướng đến World Robot Championship (WRC).",
    kyNang: [
      "Thuật toán PID",
      "Kiểm soát sai số cảm biến",
      "Xử lý đa luồng",
      "Tối ưu hành trình",
      "Cơ khí đối kháng",
      "Gỡ lỗi dưới áp lực",
      "Tư duy chuyên gia",
      "Bản lĩnh thi đấu",
    ],
    anhBo: "905ff0dd9c6dc83a67626cb74cc37dd2",
    thuVien: [
      "115b2c0af08632a373b177181586bc33",
      "905ff0dd9c6dc83a67626cb74cc37dd2",
      "4e64fe8d1416507464a6f0265d287e76",
      "f71e84fb731737f008e409125c96e7d5",
    ],
    hocPhan: [
      {
        ma: "HP1",
        tieuDe: "Nền tảng thi đấu",
        tomTat: "Củng cố nền tảng RoboSim, cảm biến, truyền động và tự hành.",
        ketQua: "Con hoàn thành robot tự hành có khả năng phản ứng theo cảm biến.",
      },
      {
        ma: "HP2",
        tieuDe: "Chu kỳ thi đấu chuẩn",
        tomTat: "Luyện chu kỳ thi đấu với nhiệm vụ tích hợp và tối ưu chương trình.",
        ketQua: "Con chạy được bài thi tổng hợp trong điều kiện nội bộ.",
      },
      {
        ma: "HP3",
        tieuDe: "Điều khiển nâng cao & PID",
        tomTat: "Điều khiển nâng cao, cảnh báo, âm thanh và dò line chuyên sâu bằng PID.",
        ketQua: "Con hiểu cách giảm sai số và ổn định hành trình robot.",
      },
      {
        ma: "HP4",
        tieuDe: "Tổng duyệt thi đấu",
        tomTat: "Tổng duyệt với áp lực thời gian, lỗi thực chiến và chiến thuật dự phòng.",
        ketQua: "Con sẵn sàng tham gia các vòng thi Robotics với bản lĩnh kỹ thuật.",
      },
    ],
    trang: {
      metaTitle: "Sata6 – Chinh phục đấu trường | Khoá học Robotics Sata Robo Đà Nẵng",
      glow: "#f472b655",
      nhan: "RoboSim + Beta Set + sa bàn chuẩn thi đấu",
      h1Truoc: "Sata6 – ",
      h1Nhan: "Chinh phục đấu trường",
      dan: "Lớp thi đấu cấp cao: thuật toán PID, kiểm soát sai số, tối ưu hành trình và bản lĩnh trước áp lực – hướng tới đấu trường quốc gia và quốc tế.",
      chips: ["Lớp 6–7", "48 buổi · 72 giờ", "90 phút/buổi"],
      hero: {
        kieu: "bp",
        anhBo: "905ff0dd9c6dc83a67626cb74cc37dd2",
        nhan: ["ROBOSIM + BETA SET + SA BÀN CHUẨN THI ĐẤU", "LỚP 6–7", "48 BUỔI · 72 GIỜ"],
        sticker: "3d425f2a2c063a1916225676ca19f4f4",
        stickerStyle: "height: auto; position: absolute; z-index: 3; filter: drop-shadow(0 16px 20px rgba(0,0,0,.35)); right: -4%; bottom: -9%; width: 118px; z-index: 4",
        stickerClass: "float",
      },
      facts: [
        {
          icon: "I0",
          nhan: "Đối tượng",
        },
        {
          icon: "I1",
          nhan: "Thời lượng",
        },
        {
          icon: "I2",
          nhan: "Mỗi buổi",
        },
        {
          icon: "I3",
          nhan: "Học phí",
        },
      ],
      kyNangTrang: [
        "Thuật toán PID",
        "Kiểm soát sai số cảm biến",
        "Xử lý đa luồng",
        "Tối ưu hoá hành trình",
        "Thiết kế cơ khí đối kháng",
        "Gỡ lỗi dưới áp lực",
        "Tư duy chuyên gia",
        "Bản lĩnh thi đấu",
      ],
      nhanDuoc: [
        {
          icon: "I4",
          tieuDe: "Kỹ năng thi đấu quốc gia",
          moTa: "Chiến thuật và kỹ thuật ở mức cao.",
        },
        {
          icon: "I2",
          tieuDe: "Tư duy chiến lược",
          moTa: "Phân tích, ra quyết định nhanh.",
        },
        {
          icon: "I0",
          tieuDe: "Sẵn sàng cho WRC",
          moTa: "Chuẩn bị cho các thách thức quốc tế.",
        },
        {
          icon: "I5",
          tieuDe: "Phản ứng thời gian thực",
          moTa: "Đọc và phản ứng với đối thủ trên sân.",
        },
      ],
      nenGia: "linear-gradient(140deg, #f472b633, rgba(254,143,45,.14))",
      diemGia: [
        "Giáo trình & bộ kit dùng tại lớp",
        "Nhận xét sau mỗi buổi gửi phụ huynh",
        "Thuyết trình sản phẩm cuối mỗi học phần",
        "Lớp tối đa 12 học viên",
      ],
      faqs: [
        [
          "Con chưa biết gì về robot có học được không?",
          "Được. Giáo viên đánh giá đầu vào trong buổi học thử 1-1 và xếp con vào cấp độ phù hợp.",
        ],
        ["Mỗi lớp có bao nhiêu học viên?", "Lớp nhỏ, tối đa 12 học viên để giáo viên theo sát từng bạn."],
        [
          "Ba mẹ theo dõi việc học của con thế nào?",
          "Giáo viên gửi nhận xét sau mỗi buổi; cuối mỗi 12 buổi con thuyết trình sản phẩm trước ba mẹ.",
        ],
        [
          "Học phí có trả góp được không?",
          "Có. Khoá chuyên sâu 48 buổi hỗ trợ trả góp theo tháng – tư vấn viên gửi phương án chi tiết.",
        ],
        [
          "Nếu học thử không hợp thì sao?",
          "Buổi học thử 1-1 hoàn toàn miễn phí. Sau buổi học đầu tiên, nếu ba mẹ không hài lòng, Sata Robo hoàn 100% học phí.",
        ],
      ],
      khac: [
        {
          slug: "sata5",
          tag: "Cấp trước · Sata5",
          img: "f5f7c32bbcd018254cf34914d98fd82c",
        },
        {
          slug: "sata7",
          tag: "Cấp tiếp theo · Sata7",
          img: "0f72f010d69f5bd7650a9e5a4f2a072a",
        },
        {
          slug: "laptrinhrobot",
          tag: "Gợi ý · Lập trình Robot",
          img: "368d0fd5444dc86f2fdc53229baed55b",
        },
      ],
    },
  },
  sata7: {
    slug: "sata7",
    loai: "nam",
    ma: "Sata7",
    ten: "Chắp cánh tương lai",
    lop: "Lớp 8",
    mau: "#b84be8",
    maGiaoTrinh: "SATA7",
    phienBanGiaoTrinh: "[v2026.1]",
    thietBi: "Storm + AI (Computer Vision Modules)",
    moTa: "Đỉnh của lộ trình 5 năm: AI, thị giác máy tính, logistics, AGV và capstone project.",
    suMenh: "Con đi qua quy trình AI đầy đủ: thu thập dữ liệu, training, triển khai, tinh chỉnh và bảo vệ giải pháp công nghệ trước hội đồng chuyên môn.",
    kyNang: [
      "Trí tuệ nhân tạo",
      "Thị giác máy tính",
      "Nhận diện thông minh",
      "Học máy cơ bản",
      "Object Tracking",
      "Logistics & AGV",
      "Đô thị 4.0",
      "Capstone Project",
    ],
    anhBo: "0f72f010d69f5bd7650a9e5a4f2a072a",
    thuVien: [
      "7103a162a7005f9a17e49fef89ab8e06",
      "0f72f010d69f5bd7650a9e5a4f2a072a",
      "fb9cb7b939b33ebb33a07455f5e11eca",
      "b24c1171d00397292221ebd3db154c41",
    ],
    hocPhan: [
      {
        ma: "HP1",
        tieuDe: "Đô thị thông minh & tự hành",
        tomTat: "Tự động hoá đô thị, đỗ xe, nhận diện và tự hành cơ bản.",
        ketQua: "Con hoàn thành mô hình đô thị thông minh có robot tự hành.",
      },
      {
        ma: "HP2",
        tieuDe: "Logistics & siêu thị thông minh",
        tomTat: "Mô phỏng logistics, AGV, phân loại sản phẩm và vận hành hệ thống bán hàng.",
        ketQua: "Con tạo được chuỗi vận hành logistics tự động ở quy mô mô hình.",
      },
      {
        ma: "HP3",
        tieuDe: "Hiệu chuẩn & kiểm soát chuyển động",
        tomTat: "Tối ưu thuật toán tự hành qua hiệu chuẩn dữ liệu, định vị và kiểm soát gia tốc.",
        ketQua: "Con biết tinh chỉnh robot chạy ổn định trong điều kiện sai số thực tế.",
      },
      {
        ma: "HP4",
        tieuDe: "Computer Vision & Capstone",
        tomTat: "Triển khai AI thị giác máy tính vào robot và bảo vệ capstone cuối khoá.",
        ketQua: "Con bảo vệ dự án AI Robotics trước hội đồng chuyên môn.",
      },
    ],
    trang: {
      metaTitle: "Sata7 – Chắp cánh tương lai | Khoá học Robotics Sata Robo Đà Nẵng",
      glow: "#b84be855",
      nhan: "Storm + AI (Computer Vision)",
      h1Truoc: "Sata7 – ",
      h1Nhan: "Chắp cánh tương lai",
      dan: "Đỉnh của lộ trình 5 năm: trí tuệ nhân tạo, thị giác máy tính và robot tự hành – con bảo vệ một Capstone Project như sinh viên kỹ thuật.",
      chips: ["Lớp 8", "48 buổi · 72 giờ", "90 phút/buổi"],
      hero: {
        kieu: "bp",
        anhBo: "0f72f010d69f5bd7650a9e5a4f2a072a",
        nhan: ["STORM + AI (COMPUTER VISION)", "LỚP 8", "48 BUỔI · 72 GIỜ"],
        sticker: "ae64602080af6eeebb18341c8404c4e4",
        stickerStyle: "height: auto; position: absolute; z-index: 3; filter: drop-shadow(0 16px 20px rgba(0,0,0,.35)); right: -4%; bottom: -9%; width: 118px; z-index: 4",
        stickerClass: "float",
      },
      facts: [
        {
          icon: "I0",
          nhan: "Đối tượng",
        },
        {
          icon: "I1",
          nhan: "Thời lượng",
        },
        {
          icon: "I2",
          nhan: "Mỗi buổi",
        },
        {
          icon: "I3",
          nhan: "Học phí",
        },
      ],
      kyNangTrang: [
        "Trí tuệ nhân tạo",
        "Thị giác máy tính",
        "Nhận diện thông minh",
        "Học máy cơ bản",
        "Object Tracking",
        "Logistics & AGV",
        "Giải pháp đô thị 4.0",
        "Capstone Project",
      ],
      nhanDuoc: [
        {
          icon: "I4",
          tieuDe: "Portfolio AI thực chiến",
          moTa: "Các dự án AI, Computer Vision của riêng con.",
        },
        {
          icon: "I2",
          tieuDe: "Hiểu nguyên lý AI",
          moTa: "AI, thị giác máy tính và robot tự hành.",
        },
        {
          icon: "I0",
          tieuDe: "Định hướng công nghệ",
          moTa: "Tư duy công nghệ được định hình vững chắc.",
        },
        {
          icon: "I5",
          tieuDe: "Sẵn sàng THPT",
          moTa: "Nền tảng học chuyên sâu Robotics/AI bậc THPT.",
        },
      ],
      nenGia: "linear-gradient(140deg, #b84be833, rgba(254,143,45,.14))",
      diemGia: [
        "Giáo trình & bộ kit dùng tại lớp",
        "Nhận xét sau mỗi buổi gửi phụ huynh",
        "Thuyết trình sản phẩm cuối mỗi học phần",
        "Lớp tối đa 12 học viên",
      ],
      faqs: [
        [
          "Con chưa biết gì về robot có học được không?",
          "Được. Giáo viên đánh giá đầu vào trong buổi học thử 1-1 và xếp con vào cấp độ phù hợp.",
        ],
        ["Mỗi lớp có bao nhiêu học viên?", "Lớp nhỏ, tối đa 12 học viên để giáo viên theo sát từng bạn."],
        [
          "Ba mẹ theo dõi việc học của con thế nào?",
          "Giáo viên gửi nhận xét sau mỗi buổi; cuối mỗi 12 buổi con thuyết trình sản phẩm trước ba mẹ.",
        ],
        [
          "Học phí có trả góp được không?",
          "Có. Khoá chuyên sâu 48 buổi hỗ trợ trả góp theo tháng – tư vấn viên gửi phương án chi tiết.",
        ],
        [
          "Nếu học thử không hợp thì sao?",
          "Buổi học thử 1-1 hoàn toàn miễn phí. Sau buổi học đầu tiên, nếu ba mẹ không hài lòng, Sata Robo hoàn 100% học phí.",
        ],
      ],
      khac: [
        {
          slug: "sata6",
          tag: "Cấp trước · Sata6",
          img: "905ff0dd9c6dc83a67626cb74cc37dd2",
        },
        {
          slug: "laptrinhrobot",
          tag: "Gợi ý · Lập trình Robot",
          img: "368d0fd5444dc86f2fdc53229baed55b",
        },
        {
          slug: "combo-sata1-sata2",
          tag: "Gợi ý · Combo Sata1 + Sata2",
          img: "3d425f2a2c063a1916225676ca19f4f4",
        },
      ],
    },
  },
  sata1: {
    slug: "sata1",
    loai: "luyen-thi",
    ma: "Sata1",
    ten: "Robosim Master",
    lop: "Lớp 3–8",
    mau: "#f5c344",
    maGiaoTrinh: "SATA1",
    phienBanGiaoTrinh: "[v2026.1]",
    thietBi: "Phần mềm RoboSim (thi vòng loại)",
    moTa: "Làm chủ RoboSim – phần mềm thi vòng loại Cuộc thi Sáng tạo Robotics: đọc sa bàn, giải đề, xây chiến thuật tối ưu.",
    suMenh: "Đưa con vượt vòng loại khu vực Miền Trung bằng chiến thuật bài thi rõ ràng và phản xạ trong phòng thi.",
    kyNang: [
      "Làm chủ RoboSim",
      "Đọc & phân tích sa bàn",
      "Thuật toán dò line",
      "Chiến thuật bài thi",
      "Tối ưu chương trình",
      "Bản lĩnh phòng thi",
    ],
    anhBo: "bb38a24d4c4cbde40ee43774b5002179",
    thuVien: [
      "659c303937fe76b0d2be11b04c59889e",
      "fb9cb7b939b33ebb33a07455f5e11eca",
      "7103a162a7005f9a17e49fef89ab8e06",
    ],
    hocPhan: [
      {
        ma: "GĐ1",
        tieuDe: "Làm quen & nền tảng",
        tomTat: "Giới thiệu cuộc thi, làm quen RoboSim, xe robot và cảm biến dò line.",
        ketQua: "Con nắm thể lệ và lập trình được xe robot tự hành trên RoboSim.",
        baiHoc: [
          {
            ten: "Giới thiệu Cuộc thi Sáng tạo Robotics 2026",
            loai: "Lý thuyết",
          },
          {
            ten: "Dự án xe robot di chuyển",
            loai: "Dự án",
          },
          {
            ten: "Tìm hiểu cảm biến dò line",
            loai: "Dự án",
          },
          {
            ten: "Dự án xe robot tự hành",
            loai: "Dự án",
          },
          {
            ten: "Phân tích thể lệ thi đấu",
            loai: "Lý thuyết",
          },
        ],
      },
      {
        ma: "GĐ2",
        tieuDe: "Giải đề nhiệm vụ",
        tomTat: "Giải từng nhiệm vụ của đề vòng loại, so sánh cách làm thường và cách tối ưu.",
        ketQua: "Con giải trọn bộ nhiệm vụ của đề vòng loại.",
        baiHoc: [
          {
            ten: "Giải đề nhiệm vụ thi đấu – lần 1",
            loai: "Giải đề",
          },
          {
            ten: "Giải đề nhiệm vụ thi đấu – lần 2",
            loai: "Giải đề",
          },
          {
            ten: "Giải đề nhiệm vụ thi đấu – lần 3",
            loai: "Giải đề",
          },
          {
            ten: "Giải đề nhiệm vụ thi đấu – lần 4",
            loai: "Giải đề",
          },
          {
            ten: "Giải đề nhiệm vụ thi đấu – lần 5",
            loai: "Giải đề",
          },
          {
            ten: "Tổng hợp nhiệm vụ",
            loai: "Ôn tập",
          },
        ],
      },
      {
        ma: "GĐ3",
        tieuDe: "Tối ưu & thi thử",
        tomTat: "Tối ưu chương trình, luyện đề tổng hợp và nắm quy chế thi.",
        ketQua: "Con sẵn sàng vượt vòng loại khu vực Miền Trung.",
        baiHoc: [
          {
            ten: "Tối ưu chương trình",
            loai: "Dự án",
          },
          {
            ten: "Kiểm tra lập trình",
            loai: "Kiểm tra",
          },
          {
            ten: "Luyện đề tổng hợp",
            loai: "Giải đề",
          },
          {
            ten: "Thi thử 180 phút",
            loai: "Thi thử",
          },
          {
            ten: "Phổ biến quy chế, tổng kết",
            loai: "Báo cáo",
          },
        ],
      },
    ],
    trang: {
      metaTitle: "Sata1 – Robosim Master | Khoá học Robotics Sata Robo Đà Nẵng",
      glow: "#f5c34455",
      nhan: "Phần mềm RoboSim",
      h1Truoc: "Sata1 – ",
      h1Nhan: "Robosim Master",
      dan: "Làm chủ RoboSim – phần mềm thi vòng loại của Cuộc thi Sáng tạo Robotics: đọc sa bàn, giải đề và xây chiến thuật tối ưu.",
      chips: ["Lớp 3–8", "16 buổi · 24 giờ", "90 phút/buổi"],
      hero: {
        kieu: "scoreb",
        anh: "659c303937fe76b0d2be11b04c59889e",
        alt: "Học viên luyện thi Robotics tại Sata Robo",
        sticker: "bb38a24d4c4cbde40ee43774b5002179",
        stickerStyle: "height: auto; position: absolute; z-index: 3; filter: drop-shadow(0 16px 20px rgba(0,0,0,.35)); right: -4%; bottom: -8%; width: 120px; z-index: 4",
        stickerClass: "float",
        thanh: [
          {
            l: "Làm chủ RoboSim ",
            style: "width: 92%",
          },
          {
            l: "Giải đề nhiệm vụ ",
            style: "width: 84%",
          },
          {
            l: "Robot thật trên sa bàn ",
            style: "width: 40%",
          },
        ],
      },
      facts: [
        {
          icon: "I0",
          nhan: "Đối tượng",
        },
        {
          icon: "I1",
          nhan: "Thời lượng",
        },
        {
          icon: "I2",
          nhan: "Mỗi buổi",
        },
        {
          icon: "I3",
          nhan: "Học phí",
        },
      ],
      kyNangTrang: [],
      nhanDuoc: [
        {
          icon: "I4",
          tieuDe: "Làm chủ RoboSim",
          moTa: "Thành thạo phần mềm thi vòng loại.",
        },
        {
          icon: "I2",
          tieuDe: "Đọc sa bàn",
          moTa: "Phân tích sa bàn và nhiệm vụ nhanh.",
        },
        {
          icon: "I0",
          tieuDe: "Chiến thuật tối ưu",
          moTa: "Xây chiến thuật bài thi đạt điểm cao.",
        },
        {
          icon: "I5",
          tieuDe: "Sẵn sàng vòng loại",
          moTa: "Vượt vòng loại khu vực Miền Trung.",
        },
      ],
      nenGia: "linear-gradient(140deg, #f5c34433, rgba(254,143,45,.14))",
      diemGia: [
        "Sa bàn & thiết bị chuẩn cuộc thi",
        "Giải đề vòng loại theo thể lệ 2026",
        "Hướng dẫn đăng ký dự thi",
        "Đồng hành suốt mùa giải",
      ],
      faqs: [
        [
          "Cuộc thi dùng phần mềm gì?",
          "Vòng loại Cuộc thi Sáng tạo Robotics thi trên phần mềm RoboSim; các vòng sau thi với robot thật trên sa bàn.",
        ],
        [
          "Con chưa thi bao giờ có học được không?",
          "Được. Khoá đi từ giới thiệu cuộc thi, làm quen phần mềm đến giải đề và tối ưu.",
        ],
        [
          "Học xong có được thi ngay không?",
          "Sata Robo hướng dẫn ba mẹ đăng ký thi và đồng hành cùng con trong suốt mùa giải.",
        ],
        [
          "Nên chọn Sata1, Sata2 hay Combo?",
          "Combo Sata1 + Sata2 là lộ trình liền mạch từ mô phỏng đến robot thật và tiết kiệm 704.000đ so với học riêng.",
        ],
      ],
      khac: [
        {
          slug: "sata2",
          tag: "Cấp tiếp theo · Sata2",
          img: "905ff0dd9c6dc83a67626cb74cc37dd2",
        },
        {
          slug: "combo-sata1-sata2",
          tag: "Gợi ý · Combo Sata1 + Sata2",
          img: "3d425f2a2c063a1916225676ca19f4f4",
        },
        {
          slug: "laptrinhrobot",
          tag: "Gợi ý · Lập trình Robot",
          img: "368d0fd5444dc86f2fdc53229baed55b",
        },
      ],
    },
  },
  sata2: {
    slug: "sata2",
    loai: "luyen-thi",
    ma: "Sata2",
    ten: "Đấu trường Robot",
    lop: "Lớp 3–8",
    mau: "#fe8f2d",
    maGiaoTrinh: "SATA2",
    phienBanGiaoTrinh: "[v2026.1]",
    thietBi: "Robot Beta + RoboSim + sa bàn chuẩn cuộc thi",
    moTa: "Từ mô phỏng ra sân thật: vận hành robot Beta trên sa bàn chuẩn, xử lý sai số và tự gỡ lỗi như tuyển thủ.",
    suMenh: "Chuẩn bị cho các vòng thi trực tiếp cấp khu vực và toàn quốc với robot thật.",
    kyNang: [
      "Vận hành robot Beta",
      "Lắp ráp Robotics",
      "Xử lý sai số thực tế",
      "Debug độc lập",
      "Phối hợp đội thi",
      "Bản lĩnh thi đấu",
    ],
    anhBo: "905ff0dd9c6dc83a67626cb74cc37dd2",
    thuVien: [
      "5a335391616fec91521ce26956359a45",
      "905ff0dd9c6dc83a67626cb74cc37dd2",
      "c05423b933c693663c6b5bc7ec74af88",
    ],
    hocPhan: [
      {
        ma: "GĐ1",
        tieuDe: "Nền tảng robot thật",
        tomTat: "Từ giới thiệu cuộc thi đến thiết kế lắp ráp robot Beta.",
        ketQua: "Con lắp và lập trình được robot Beta tự hành.",
        baiHoc: [
          {
            ten: "Giới thiệu cuộc thi 2026",
            loai: "Lý thuyết",
          },
          {
            ten: "Xe robot di chuyển",
            loai: "Dự án",
          },
          {
            ten: "Cảm biến dò line",
            loai: "Dự án",
          },
          {
            ten: "Xe robot tự hành",
            loai: "Dự án",
          },
          {
            ten: "Phân tích thể lệ thi",
            loai: "Lý thuyết",
          },
          {
            ten: "Thiết kế lắp ráp",
            loai: "Dự án",
          },
        ],
      },
      {
        ma: "GĐ2",
        tieuDe: "Giải đề trên sa bàn",
        tomTat: "Giải 5 lượt nhiệm vụ trên sa bàn chuẩn và tổng hợp.",
        ketQua: "Robot của con chạy trọn bộ nhiệm vụ trên sa bàn thật.",
        baiHoc: [
          {
            ten: "Giải đề nhiệm vụ – lần 1",
            loai: "Giải đề",
          },
          {
            ten: "Giải đề nhiệm vụ – lần 2",
            loai: "Giải đề",
          },
          {
            ten: "Giải đề nhiệm vụ – lần 3",
            loai: "Giải đề",
          },
          {
            ten: "Giải đề nhiệm vụ – lần 4",
            loai: "Giải đề",
          },
          {
            ten: "Giải đề nhiệm vụ – lần 5",
            loai: "Giải đề",
          },
          {
            ten: "Tổng hợp nhiệm vụ",
            loai: "Ôn tập",
          },
        ],
      },
      {
        ma: "GĐ3",
        tieuDe: "Tối ưu & kiểm tra",
        tomTat: "Tối ưu chương trình, kiểm tra lắp ráp – lập trình và phổ biến quy chế.",
        ketQua: "Con sẵn sàng thi đấu cấp khu vực và toàn quốc.",
        baiHoc: [
          {
            ten: "Tối ưu chương trình",
            loai: "Dự án",
          },
          {
            ten: "Kiểm tra lắp ráp",
            loai: "Kiểm tra",
          },
          {
            ten: "Kiểm tra lập trình",
            loai: "Kiểm tra",
          },
          {
            ten: "Phổ biến quy chế, tổng kết",
            loai: "Báo cáo",
          },
        ],
      },
    ],
    trang: {
      metaTitle: "Sata2 – Đấu trường Robot | Khoá học Robotics Sata Robo Đà Nẵng",
      glow: "#fe8f2d55",
      nhan: "Robot Beta + RoboSim + sa bàn chuẩn",
      h1Truoc: "Sata2 – ",
      h1Nhan: "Đấu trường Robot",
      dan: "Từ mô phỏng ra sân thật: vận hành robot Beta trên sa bàn chuẩn cuộc thi, xử lý sai số và tự gỡ lỗi như một tuyển thủ.",
      chips: ["Lớp 3–8", "16 buổi · 24 giờ", "90 phút/buổi"],
      hero: {
        kieu: "scoreb",
        anh: "5a335391616fec91521ce26956359a45",
        alt: "Học viên luyện thi Robotics tại Sata Robo",
        sticker: "3d425f2a2c063a1916225676ca19f4f4",
        stickerStyle: "height: auto; position: absolute; z-index: 3; filter: drop-shadow(0 16px 20px rgba(0,0,0,.35)); right: -4%; bottom: -8%; width: 120px; z-index: 4",
        stickerClass: "float",
        thanh: [
          {
            l: "Làm chủ RoboSim ",
            style: "width: 92%",
          },
          {
            l: "Giải đề nhiệm vụ ",
            style: "width: 84%",
          },
          {
            l: "Robot thật trên sa bàn ",
            style: "width: 88%",
          },
        ],
      },
      facts: [
        {
          icon: "I0",
          nhan: "Đối tượng",
        },
        {
          icon: "I1",
          nhan: "Thời lượng",
        },
        {
          icon: "I2",
          nhan: "Mỗi buổi",
        },
        {
          icon: "I3",
          nhan: "Học phí",
        },
      ],
      kyNangTrang: [],
      nhanDuoc: [
        {
          icon: "I4",
          tieuDe: "Vận hành robot Beta",
          moTa: "Thành thạo thiết bị thi đấu chính thức.",
        },
        {
          icon: "I2",
          tieuDe: "Xử lý sai số",
          moTa: "Khắc phục khác biệt giữa mô phỏng và thực tế.",
        },
        {
          icon: "I0",
          tieuDe: "Tự gỡ lỗi",
          moTa: "Debug robot độc lập ngay trên sân.",
        },
        {
          icon: "I5",
          tieuDe: "Thi khu vực & toàn quốc",
          moTa: "Sẵn sàng cho các vòng thi trực tiếp.",
        },
      ],
      nenGia: "linear-gradient(140deg, #fe8f2d33, rgba(254,143,45,.14))",
      diemGia: [
        "Sa bàn & thiết bị chuẩn cuộc thi",
        "Giải đề vòng loại theo thể lệ 2026",
        "Hướng dẫn đăng ký dự thi",
        "Đồng hành suốt mùa giải",
      ],
      faqs: [
        [
          "Cuộc thi dùng phần mềm gì?",
          "Vòng loại Cuộc thi Sáng tạo Robotics thi trên phần mềm RoboSim; các vòng sau thi với robot thật trên sa bàn.",
        ],
        [
          "Con chưa thi bao giờ có học được không?",
          "Được. Khoá đi từ giới thiệu cuộc thi, làm quen phần mềm đến giải đề và tối ưu.",
        ],
        [
          "Học xong có được thi ngay không?",
          "Sata Robo hướng dẫn ba mẹ đăng ký thi và đồng hành cùng con trong suốt mùa giải.",
        ],
        [
          "Nên chọn Sata1, Sata2 hay Combo?",
          "Combo Sata1 + Sata2 là lộ trình liền mạch từ mô phỏng đến robot thật và tiết kiệm 704.000đ so với học riêng.",
        ],
      ],
      khac: [
        {
          slug: "sata1",
          tag: "Cấp trước · Sata1",
          img: "bb38a24d4c4cbde40ee43774b5002179",
        },
        {
          slug: "combo-sata1-sata2",
          tag: "Gợi ý · Combo Sata1 + Sata2",
          img: "3d425f2a2c063a1916225676ca19f4f4",
        },
        {
          slug: "laptrinhrobot",
          tag: "Gợi ý · Lập trình Robot",
          img: "368d0fd5444dc86f2fdc53229baed55b",
        },
      ],
    },
  },
  "combo-sata1-sata2": {
    slug: "combo-sata1-sata2",
    loai: "combo",
    ma: "Combo",
    ten: "Sata1 + Sata2",
    lop: "Lớp 3–8",
    mau: "#b84be8",
    maGiaoTrinh: "COMBO",
    phienBanGiaoTrinh: "[v2026.1]",
    thietBi: "RoboSim + robot Beta + sa bàn",
    moTa: "Lộ trình liền mạch từ mô phỏng RoboSim đến robot Beta thật – một lần đăng ký, sẵn sàng mọi vòng thi.",
    suMenh: "Hoàn thiện cả hai kỹ năng mô phỏng và vận hành robot thật, không gián đoạn giữa hai khoá.",
    kyNang: [
      "Làm chủ RoboSim",
      "Vận hành robot Beta",
      "Chiến thuật bài thi",
      "Xử lý sai số",
      "Debug độc lập",
      "Bản lĩnh thi đấu",
    ],
    anhBo: "3d425f2a2c063a1916225676ca19f4f4",
    thuVien: [
      "4e64fe8d1416507464a6f0265d287e76",
      "3baf3bfe1445c597a9ac1cf30f4ef9b3",
      "115b2c0af08632a373b177181586bc33",
    ],
    hocPhan: [
      {
        ma: "Phần A",
        tieuDe: "Sata1 · Robosim Master",
        tomTat: "16 buổi trên RoboSim: nền tảng, giải đề, tối ưu.",
        ketQua: "Con vượt vòng loại trên RoboSim.",
        baiHoc: [
          {
            ten: "Giới thiệu Cuộc thi Sáng tạo Robotics 2026",
            loai: "Lý thuyết",
          },
          {
            ten: "Dự án xe robot di chuyển",
            loai: "Dự án",
          },
          {
            ten: "Tìm hiểu cảm biến dò line",
            loai: "Dự án",
          },
          {
            ten: "Dự án xe robot tự hành",
            loai: "Dự án",
          },
          {
            ten: "Phân tích thể lệ thi đấu",
            loai: "Lý thuyết",
          },
          {
            ten: "Giải đề nhiệm vụ thi đấu – lần 1",
            loai: "Giải đề",
          },
          {
            ten: "Giải đề nhiệm vụ thi đấu – lần 2",
            loai: "Giải đề",
          },
          {
            ten: "Giải đề nhiệm vụ thi đấu – lần 3",
            loai: "Giải đề",
          },
          {
            ten: "Giải đề nhiệm vụ thi đấu – lần 4",
            loai: "Giải đề",
          },
          {
            ten: "Giải đề nhiệm vụ thi đấu – lần 5",
            loai: "Giải đề",
          },
          {
            ten: "Tổng hợp nhiệm vụ",
            loai: "Ôn tập",
          },
          {
            ten: "Tối ưu chương trình",
            loai: "Dự án",
          },
          {
            ten: "Kiểm tra lập trình",
            loai: "Kiểm tra",
          },
          {
            ten: "Luyện đề tổng hợp",
            loai: "Giải đề",
          },
          {
            ten: "Thi thử 180 phút",
            loai: "Thi thử",
          },
          {
            ten: "Phổ biến quy chế, tổng kết",
            loai: "Báo cáo",
          },
        ],
      },
      {
        ma: "Phần B",
        tieuDe: "Sata2 · Đấu trường Robot",
        tomTat: "16 buổi với robot Beta trên sa bàn chuẩn.",
        ketQua: "Con sẵn sàng cho chung kết khu vực Miền Trung.",
        baiHoc: [
          {
            ten: "Giới thiệu cuộc thi 2026",
            loai: "Lý thuyết",
          },
          {
            ten: "Xe robot di chuyển",
            loai: "Dự án",
          },
          {
            ten: "Cảm biến dò line",
            loai: "Dự án",
          },
          {
            ten: "Xe robot tự hành",
            loai: "Dự án",
          },
          {
            ten: "Phân tích thể lệ thi",
            loai: "Lý thuyết",
          },
          {
            ten: "Thiết kế lắp ráp",
            loai: "Dự án",
          },
          {
            ten: "Giải đề nhiệm vụ – lần 1",
            loai: "Giải đề",
          },
          {
            ten: "Giải đề nhiệm vụ – lần 2",
            loai: "Giải đề",
          },
          {
            ten: "Giải đề nhiệm vụ – lần 3",
            loai: "Giải đề",
          },
          {
            ten: "Giải đề nhiệm vụ – lần 4",
            loai: "Giải đề",
          },
          {
            ten: "Giải đề nhiệm vụ – lần 5",
            loai: "Giải đề",
          },
          {
            ten: "Tổng hợp nhiệm vụ",
            loai: "Ôn tập",
          },
          {
            ten: "Tối ưu chương trình",
            loai: "Dự án",
          },
          {
            ten: "Kiểm tra lắp ráp",
            loai: "Kiểm tra",
          },
          {
            ten: "Kiểm tra lập trình",
            loai: "Kiểm tra",
          },
          {
            ten: "Phổ biến quy chế, tổng kết",
            loai: "Báo cáo",
          },
        ],
      },
    ],
    trang: {
      metaTitle: "Combo Sata1 + Sata2 – Full lộ trình luyện thi | Khoá học Robotics Sata Robo Đà Nẵng",
      glow: "#b84be855",
      nhan: "RoboSim + robot Beta + sa bàn",
      h1Truoc: "Combo Sata1 + Sata2 – ",
      h1Nhan: "Full lộ trình luyện thi",
      dan: "Lộ trình liền mạch từ mô phỏng RoboSim đến robot Beta thật – một lần đăng ký, sẵn sàng cho vòng loại Đà Nẵng và chung kết khu vực Miền Trung.",
      chips: ["Lớp 3–8", "32 buổi · 48 giờ", "90 phút/buổi"],
      hero: {
        kieu: "scoreb",
        anh: "4e64fe8d1416507464a6f0265d287e76",
        alt: "Học viên luyện thi Robotics tại Sata Robo",
        sticker: "5b2733eebd8a2725fab2afb4c936fd4b",
        stickerStyle: "height: auto; position: absolute; z-index: 3; filter: drop-shadow(0 16px 20px rgba(0,0,0,.35)); right: -4%; bottom: -8%; width: 120px; z-index: 4",
        stickerClass: "float",
        thanh: [
          {
            l: "Làm chủ RoboSim ",
            style: "width: 92%",
          },
          {
            l: "Giải đề nhiệm vụ ",
            style: "width: 84%",
          },
          {
            l: "Robot thật trên sa bàn ",
            style: "width: 88%",
          },
        ],
      },
      facts: [
        {
          icon: "I0",
          nhan: "Đối tượng",
        },
        {
          icon: "I1",
          nhan: "Thời lượng",
        },
        {
          icon: "I2",
          nhan: "Mỗi buổi",
        },
        {
          icon: "I3",
          nhan: "Học phí",
        },
      ],
      kyNangTrang: [],
      nhanDuoc: [
        {
          icon: "I4",
          tieuDe: "2 kỹ năng trong 1",
          moTa: "Mô phỏng RoboSim + vận hành robot thật.",
        },
        {
          icon: "I2",
          tieuDe: "Sẵn sàng mọi vòng",
          moTa: "Vòng loại Đà Nẵng và chung kết Miền Trung.",
        },
        {
          icon: "I0",
          tieuDe: "Liên tục",
          moTa: "Lộ trình không gián đoạn giữa 2 khoá.",
        },
        {
          icon: "I5",
          tieuDe: "Tiết kiệm 704.000đ",
          moTa: "So với đăng ký riêng từng khoá.",
        },
      ],
      nenGia: "linear-gradient(140deg, #b84be833, rgba(254,143,45,.14))",
      diemGia: [
        "Sa bàn & thiết bị chuẩn cuộc thi",
        "Giải đề vòng loại theo thể lệ 2026",
        "Hướng dẫn đăng ký dự thi",
        "Đồng hành suốt mùa giải",
      ],
      faqs: [
        [
          "Cuộc thi dùng phần mềm gì?",
          "Vòng loại Cuộc thi Sáng tạo Robotics thi trên phần mềm RoboSim; các vòng sau thi với robot thật trên sa bàn.",
        ],
        [
          "Con chưa thi bao giờ có học được không?",
          "Được. Khoá đi từ giới thiệu cuộc thi, làm quen phần mềm đến giải đề và tối ưu.",
        ],
        [
          "Học xong có được thi ngay không?",
          "Sata Robo hướng dẫn ba mẹ đăng ký thi và đồng hành cùng con trong suốt mùa giải.",
        ],
        [
          "Nên chọn Sata1, Sata2 hay Combo?",
          "Combo Sata1 + Sata2 là lộ trình liền mạch từ mô phỏng đến robot thật và tiết kiệm 704.000đ so với học riêng.",
        ],
      ],
      khac: [
        {
          slug: "sata8",
          tag: "Gợi ý · Sata8",
          img: "5b2733eebd8a2725fab2afb4c936fd4b",
        },
        {
          slug: "laptrinhrobot",
          tag: "Gợi ý · Lập trình Robot",
          img: "368d0fd5444dc86f2fdc53229baed55b",
        },
        {
          slug: "luyenthirobosim",
          tag: "Gợi ý · Online · SataWorld",
          img: "b09f648ab11d0579d24805fe838e0900",
        },
      ],
    },
  },
  sata8: {
    slug: "sata8",
    loai: "ve-vang",
    ma: "Sata8",
    ten: "Vé vàng chung kết",
    lop: "Đã có nền tảng",
    mau: "#f5c344",
    maGiaoTrinh: "SATA8",
    phienBanGiaoTrinh: "[v2026.1]",
    thietBi: "RoboSim + E-learning",
    moTa: "Gói bảo chứng: đi đủ lộ trình mà không vượt vòng loại, Sata Robo hoàn 100% học phí gói.",
    suMenh: "Lớp bảo chứng cho học viên đã có nền tảng RoboSim, nhắm thẳng vòng loại – có hợp đồng cam kết.",
    kyNang: ["Sửa lỗi cá nhân", "Chiến thuật vòng loại", "Thi thử có nhận xét", "Tự học E-learning"],
    anhBo: "5b2733eebd8a2725fab2afb4c936fd4b",
    thuVien: [
      "8688393802f9254473968dfd4a65ba7f",
      "0adb05dbf41a4b9e492350b8a32cbf8a",
      "3baf3bfe1445c597a9ac1cf30f4ef9b3",
    ],
    hocPhan: [
      {
        ma: "5 buổi",
        tieuDe: "Lộ trình bảo chứng",
        tomTat: "Điều kiện: đã học Sata1 hoặc vượt bài kiểm tra đầu vào.",
        ketQua: "Đi đủ 5 buổi + hoàn thành E-learning mà không vượt vòng loại → hoàn 100% học phí gói.",
        baiHoc: [
          {
            ten: "Ôn nền tảng RoboSim & chiến thuật vòng loại",
            loai: "Ôn tập",
          },
          {
            ten: "Sửa lỗi cá nhân theo năng lực",
            loai: "Dự án",
          },
          {
            ten: "Thi thử có giáo viên nhận xét",
            loai: "Thi thử",
          },
          {
            ten: "Hoàn thành bài E-learning được giao",
            loai: "Giải đề",
          },
          {
            ten: "Tổng ôn trước vòng loại",
            loai: "Báo cáo",
          },
        ],
      },
    ],
    trang: {
      metaTitle: "Sata8 – Vé vàng chung kết | Khoá học Robotics Sata Robo Đà Nẵng",
      glow: "#f5c34455",
      nhan: "RoboSim + E-learning",
      h1Truoc: "Sata8 – ",
      h1Nhan: "Vé vàng chung kết",
      dan: "Gói bảo chứng cho học viên đã có nền tảng RoboSim: đi đủ lộ trình mà không vượt vòng loại, Sata Robo hoàn 100% học phí gói.",
      chips: ["Đã có nền tảng RoboSim", "5 buổi · 7,5 giờ", "90 phút/buổi"],
      hero: {
        kieu: "ticket",
        sticker: "5b2733eebd8a2725fab2afb4c936fd4b",
        stickerStyle: "height: auto; position: absolute; z-index: 3; filter: drop-shadow(0 16px 20px rgba(0,0,0,.35)); right: -2%; top: -6%; width: 112px; z-index: 4",
        stickerClass: "bob",
      },
      facts: [
        {
          icon: "I0",
          nhan: "Đối tượng",
        },
        {
          icon: "I1",
          nhan: "Thời lượng",
        },
        {
          icon: "I2",
          nhan: "Mỗi buổi",
        },
        {
          icon: "I3",
          nhan: "Học phí",
        },
      ],
      kyNangTrang: [],
      nhanDuoc: [
        {
          icon: "I4",
          tieuDe: "Sửa lỗi cá nhân",
          moTa: "Giáo viên xử lý đúng điểm yếu của từng bạn.",
        },
        {
          icon: "I2",
          tieuDe: "Thi thử có nhận xét",
          moTa: "Làm đề thật và được góp ý chi tiết.",
        },
        {
          icon: "I0",
          tieuDe: "E-learning đi kèm",
          moTa: "Tài liệu luyện thêm tại nhà.",
        },
        {
          icon: "I5",
          tieuDe: "Hoàn tiền 100%",
          moTa: "Nếu không vượt vòng loại.",
        },
      ],
      nenGia: "linear-gradient(140deg, #f5c34433, rgba(254,143,45,.14))",
      diemGia: [
        "5 buổi chuyên sâu theo năng lực",
        "Bài E-learning luyện tại nhà",
        "Thi thử có giáo viên nhận xét",
        "Hợp đồng cam kết hoàn tiền",
      ],
      faqs: [
        [
          "Ai nên đăng ký Sata8?",
          "Học viên đã có nền tảng RoboSim, muốn có một lớp bảo chứng trước vòng loại.",
        ],
        [
          "Điều kiện hoàn tiền thế nào?",
          "Đi đủ 5 buổi và hoàn thành bài E-learning nhưng không vượt vòng loại thì được hoàn 100% học phí gói – có hợp đồng.",
        ],
        ["Chưa học Sata1 có đăng ký được không?", "Được, nếu vượt bài kiểm tra đầu vào RoboSim."],
      ],
      khac: [
        {
          slug: "combo-sata1-sata2",
          tag: "Cấp trước · Combo Sata1 + Sata2",
          img: "3d425f2a2c063a1916225676ca19f4f4",
        },
        {
          slug: "laptrinhrobot",
          tag: "Gợi ý · Lập trình Robot",
          img: "368d0fd5444dc86f2fdc53229baed55b",
        },
        {
          slug: "luyenthirobosim",
          tag: "Gợi ý · Online · SataWorld",
          img: "b09f648ab11d0579d24805fe838e0900",
        },
      ],
    },
  },
};

export const THU_TU_KHOA_NAM = ["sata3", "sata4", "sata5", "sata6", "sata7"] as const;
export const THU_TU_KHOA_THI = ["sata1", "sata2", "combo-sata1-sata2", "sata8"] as const;

export const DANH_SACH_THE: TheDanhSach[] = [
  {
    cat: "chuyen-sau",
    slug: "sata3",
    code: "Sata3 · Alpha Set",
    name: "Nhập môn Robotics",
    img: "a666ac3e1e338d2186c3c7704b0fa511",
    badge: "★ Phổ biến nhất",
    grade: "Lớp 1–2",
    sessions: "48 buổi/năm",
    dur: "90 phút",
    price: "880.000đ",
    unit: "/tháng",
    b: [
      "Lắp robot theo sơ đồ kỹ thuật",
      "Ra lệnh bằng thẻ lệnh & khối kéo thả",
      "Tư duy logic, thuật toán cơ bản",
    ],
  },
  {
    cat: "chuyen-sau",
    slug: "sata4",
    code: "Sata4 · Sata6 · Beta Set",
    name: "Robotics thi đấu",
    img: "dbdef77fa2d35499f574fa1ec71acf88",
    badge: "★ Sata4 phổ biến nhất",
    grade: "Lớp 3+",
    sessions: "48 buổi/năm",
    dur: "90 phút",
    price: "960.000đ+",
    unit: "/tháng",
    b: ["Cảm biến chính xác cao", "Robot dò line, tránh vật cản", "Huấn luyện thi đấu Robotics"],
  },
  {
    cat: "chuyen-sau",
    slug: "sata5",
    code: "Sata5 · Sata7 · Intel Set",
    name: "AI, Camera & IoT",
    img: "0f72f010d69f5bd7650a9e5a4f2a072a",
    badge: null,
    grade: "Lớp 3+",
    sessions: "48 buổi/năm",
    dur: "90 phút",
    price: "1.040.000đ+",
    unit: "/tháng",
    b: [
      "Nhận diện khuôn mặt, vật thể, QR code",
      "Điều khiển bằng cử chỉ",
      "Kết nối IoT, học theo dự án (PBL)",
    ],
  },
  {
    cat: "luyen-thi",
    slug: "sata1",
    code: "Sata1",
    name: "Robosim Master",
    img: "bb38a24d4c4cbde40ee43774b5002179",
    badge: null,
    grade: "Lớp 3–8",
    sessions: "16 buổi",
    dur: "90 phút",
    price: "2.400.000đ",
    unit: "/khoá",
    b: [
      "11 buổi học + 5 buổi luyện RoboSim tặng kèm",
      "Đọc đề, tối ưu chiến thuật",
      "Làm chủ vòng loại RoboSim",
    ],
  },
  {
    cat: "luyen-thi",
    slug: "sata2",
    code: "Sata2",
    name: "Đấu trường Robot",
    img: "905ff0dd9c6dc83a67626cb74cc37dd2",
    badge: null,
    grade: "Lớp 3–8",
    sessions: "16 buổi",
    dur: "90 phút",
    price: "3.040.000đ",
    unit: "/khoá",
    b: [
      "Luyện robot Beta thật cho cấp khu vực",
      "Xử lý sự cố trên sân đấu",
      "Bản lĩnh trước áp lực thi đấu",
    ],
  },
  {
    cat: "luyen-thi",
    slug: "combo-sata1-sata2",
    code: "Combo Sata1 + Sata2",
    name: "Full lộ trình luyện thi",
    img: "3d425f2a2c063a1916225676ca19f4f4",
    badge: "⭐ Khuyên dùng",
    grade: "Lớp 3–8",
    sessions: "32 buổi",
    dur: "90 phút",
    price: "4.690.000đ",
    unit: "/combo",
    b: ["Học trọn từ RoboSim đến robot Beta thật", "Tiết kiệm hơn học lẻ", "Điều kiện để học Sata8"],
  },
  {
    cat: "luyen-thi",
    slug: "sata8",
    code: "Sata8",
    name: "Vé vàng chung kết",
    img: "5b2733eebd8a2725fab2afb4c936fd4b",
    badge: "🔥 Cam kết hoàn tiền",
    grade: "Đã học Combo/Sata1",
    sessions: "5 buổi",
    dur: "90 phút",
    price: "2.500.000đ",
    unit: "/gói",
    b: [
      "Ôn chuyên sâu cho vòng chung kết",
      "Cam kết bằng văn bản trước khi học",
      "Hoàn 100% học phí Sata8 nếu đủ điều kiện mà chưa qua vòng loại",
    ],
  },
  {
    cat: "online",
    slug: "luyenthirobosim",
    code: "Online · SataWorld",
    name: "Luyện thi RoboSim Bảng R1 & R2",
    img: "b09f648ab11d0579d24805fe838e0900",
    badge: "Học online",
    grade: "R1: lớp 3–5 · R2: lớp 6–9",
    sessions: "18 buổi",
    dur: "Video + coaching",
    price: "490.000đ",
    unit: "/bảng",
    b: [
      "Học mọi lúc, truy cập trọn đời",
      "Nền tảng → giải đề thật → thi thử 180 phút",
      "Đổi bảng miễn phí trong 7 ngày",
    ],
  },
];

export const TAB_DANH_SACH = [
  ["all", "Tất cả khoá"],
  ["chuyen-sau", "Chuyên sâu 48 buổi"],
  ["luyen-thi", "Luyện thi offline"],
  ["online", "Học online"],
] as const;

export const CAU_HOI_DANH_SACH: [string, string][] = [
  [
    "Con chưa biết gì về Robotics có học được không?",
    "Được. Chương trình xây từ nền tảng: các lớp nhỏ học bằng mô hình trực quan và hoạt động lắp ráp, lộ trình rõ ràng giúp con tự tin dần.",
  ],
  [
    "Học buổi đầu không hài lòng thì sao?",
    "Sata Robo hoàn 100% học phí trong 3 ngày, không cần lý do.",
  ],
  [
    "Ba mẹ theo dõi tiến độ của con thế nào?",
    "Giáo viên cập nhật định kỳ nội dung con đã nắm, điểm mạnh, điểm cần hỗ trợ và dự án đã hoàn thành. Cuối mỗi 12 buổi có buổi thuyết trình để ba mẹ đến xem.",
  ],
  [
    "Cam kết hoàn tiền Sata8 áp dụng thế nào?",
    "Áp dụng cho học viên đã học Combo hoặc Robosim Master, tham gia đủ 5 buổi Sata8 và hoàn thành bài E-learning được giao. Nếu đủ điều kiện mà chưa qua vòng loại, Sata Robo hoàn 100% học phí Sata8 theo cam kết bằng văn bản.",
  ],
  [
    "Học phí có trả góp được không?",
    "Các khoá Sata3–Sata7 hỗ trợ trả góp 0%, chia học phí theo tháng.",
  ],
  [
    "Khoá online có cần robot thật không?",
    "Không. Chỉ cần máy tính Windows cài phần mềm RoboSim để luyện tập.",
  ],
];
