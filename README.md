# ⚡ TM — 19A-Teamly

Nền tảng quản lý nhóm với giao diện **Nịnh Mắt** — nhiệm vụ, lộ trình, chat nhóm, thông báo thông minh.

> 🆕 Phiên bản này (**TM Pro**) được xây dựng dựa trên dự án gốc, bổ sung hệ thống gói **Free / Pro**, Kanban board, thống kê đóng góp, xuất báo cáo và nhiều hơn nữa — xem mục "Tính năng Pro mới" dưới đây.

---

## 🎯 Tính năng (Free)

| Tính năng               | Mô tả                                                       |
| ----------------------- | ----------------------------------------------------------- |
| 👑 Phân cấp vai trò     | Admin · Nhóm trưởng · Phó nhóm · Thành viên · Tùy chỉnh     |
| 📋 Quản lý nhiệm vụ     | Giao việc, deadline, ưu tiên, nộp drive link, duyệt/từ chối |
| 🗺️ Lộ trình Gantt       | Biểu đồ Gantt trực quan, theo dõi mốc dự án                 |
| 💬 Chat nhóm            | Nhắn tin thời gian thực với Socket.io                       |
| 🔔 Thông báo thông minh | Cảnh báo deadline, thông báo nộp bài, duyệt thành viên      |
| 🏅 Chấm điểm            | Nhóm trưởng chấm điểm đóng góp cho từng thành viên          |
| 🔑 Mã mời               | Mã 8 ký tự để thành viên xin vào nhóm                       |
| 🌗 Dark / Light mode    | Chuyển đổi giao diện sáng/tối, lưu theo tài khoản           |

---

## ⭐ Tính năng Pro mới

| Tính năng                          | Mô tả                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 🗂️ **Kanban board**                | Kéo thả nhiệm vụ giữa 3 cột Cần làm / Đang làm / Hoàn thành                                                              |
| 📈 **Thống kê đóng góp**           | Biểu đồ radar (Chart.js) so sánh điểm số, tỉ lệ hoàn thành, đúng hạn, khối lượng việc, hoạt động giữa các thành viên     |
| 📄 **Xuất báo cáo PDF/Excel**      | Xuất file tổng kết dự án (thông tin, thành viên, điểm số, danh sách nhiệm vụ) — hỗ trợ tiếng Việt có dấu                 |
| 🧩 **Mẫu dự án**                   | 3 mẫu có sẵn: 💻 Đồ án CNTT, 📋 Báo cáo thực tập, 🎓 Khóa luận tốt nghiệp — tự tạo nhiệm vụ & lộ trình mẫu khi tạo dự án |
| 🎨 **Tùy biến màu chủ đề**         | Người dùng Pro chọn màu chủ đạo (accent color) riêng                                                                     |
| ♾️ Không giới hạn dự án/thành viên | (logic gói đã sẵn, có thể bổ sung giới hạn cho Free nếu cần)                                                             |

### Cách bật/tắt gói Pro

- **Người dùng tự thử (demo)**: vào `/profile` hoặc `/pricing` → bấm "Nâng cấp lên Pro (Demo)". Đây là **toggle demo, chưa có cổng thanh toán thật**.
- **Admin** có thể bật/tắt Pro cho từng tài khoản tại trang `/admin` (nút "⭐ Pro" / "⬇️ Free" trong bảng người dùng). Tài khoản `role=admin` luôn có quyền Pro.

> 💡 Muốn tích hợp thanh toán thật (VNPay/Momo/Stripe...), thay logic trong route `POST /profile/upgrade` (file `server.js`) bằng luồng thanh toán + webhook xác nhận, rồi `UPDATE users SET plan='pro'`.

---

## 🔐 Tài khoản mặc định

```
Username: admin
Password: admin12
```

⚠️ **Hãy đổi mật khẩu admin ngay sau khi deploy** (qua trang `/profile` hoặc trực tiếp trong database).

---

## 🚀 HƯỚNG DẪN CÀI ĐẶT & DEPLOY (từng bước)

### BƯỚC 1 — Cài đặt Git

1. Vào https://git-scm.com/download/win → tải Git cho Windows
2. Cài đặt → giữ nguyên mặc định, nhấn Next hết
3. Mở **VS Code** → nhấn `` Ctrl+` `` để mở Terminal

---

### BƯỚC 2 — Cài dependencies (trong VS Code Terminal)

```bash
# Di chuyển vào thư mục dự án (thay đường dẫn cho đúng)
cd C:\Users\YourName\neon-teamwork

# Cài thư viện
npm install
```

---

### BƯỚC 3 — Tạo tài khoản GitHub

1. Vào https://github.com → **Sign up** (nếu chưa có)
2. Tạo repository mới:
   - Nhấn **New** (nút xanh)
   - Tên: `neon-teamwork`
   - Chọn **Private**
   - **KHÔNG tick** "Add a README file"
   - Nhấn **Create repository**

---

### BƯỚC 4 — Push code lên GitHub

Trong VS Code Terminal, chạy lần lượt từng lệnh:

```bash
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/TEN_GITHUB_CUA_BAN/neon-teamwork.git
git push -u origin main
```

> ⚠️ Thay `TEN_GITHUB_CUA_BAN` bằng username GitHub của bạn

---

### BƯỚC 5 — Tạo Database trên Render

1. Vào https://render.com → **Sign up** (dùng GitHub để đăng nhập nhanh)
2. Dashboard → nhấn **New +** → chọn **PostgreSQL**
3. Điền:
   - **Name**: `neonteam-db`
   - **Region**: Singapore (gần VN nhất)
   - **Plan**: Free
4. Nhấn **Create Database**
5. Chờ ~1 phút → vào database vừa tạo
6. Copy **Internal Database URL** (dùng ở bước sau)

---

### BƯỚC 6 — Deploy Web Service trên Render

1. Dashboard → **New +** → **Web Service**
2. Chọn **Connect a repository** → chọn repo `neon-teamwork`
3. Điền thông tin:
   - **Name**: `neon-teamwork`
   - **Region**: Singapore
   - **Branch**: main
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: Free
4. Kéo xuống phần **Environment Variables** → nhấn **Add Environment Variable**:

   | Key              | Value                                 |
   | ---------------- | ------------------------------------- |
   | `DATABASE_URL`   | _Dán Internal Database URL từ bước 5_ |
   | `SESSION_SECRET` | `neonteam_secret_abc123xyz789`        |
   | `NODE_ENV`       | `production`                          |

5. Nhấn **Create Web Service**
6. Render sẽ build ~3-5 phút → khi thấy **Live** là xong ✅

---

### BƯỚC 7 — Truy cập web

- URL sẽ là: `https://neon-teamwork.onrender.com` (hoặc tên bạn đặt)
- Đăng nhập: `admin` / `admin12`

---

## 🔄 Cập nhật code sau này

Mỗi khi sửa code, chạy trong Terminal:

```bash
git add .
git commit -m "mo ta thay doi"
git push
```

Render sẽ tự động deploy lại!

---

## 🛠️ Chạy local (test trên máy)

```bash
# 1. Tạo file .env từ mẫu
cp .env.example .env

# 2. Mở file .env, điền DATABASE_URL (lấy External URL từ Render)

# 3. Chạy server
npm run dev

# 4. Mở trình duyệt: http://localhost:3000
```

---

## 📁 Cấu trúc thư mục

```
TM-Pro/
├── server.js          ← Máy chủ chính
├── data/
│   └── templates.js   ← Mẫu dự án (Pro): Đồ án CNTT, Thực tập, Khóa luận
├── db/
│   ├── pool.js        ← Kết nối database
│   └── schema.sql     ← Cấu trúc CSDL (tự ALTER khi nâng cấp)
├── routes/
│   ├── auth.js        ← Đăng nhập/Đăng ký
│   ├── admin.js       ← Quản trị (kèm bật/tắt Pro)
│   ├── projects.js    ← Dự án, nhiệm vụ, Kanban, export
│   └── api.js         ← API nội bộ
├── middleware/
│   └── auth.js        ← Xác thực phiên + requirePro
├── utils/
│   └── export.js      ← Sinh báo cáo PDF (pdfkit) & Excel (exceljs)
├── assets/fonts/       ← Font DejaVu Sans (hỗ trợ tiếng Việt trong PDF)
├── views/             ← Giao diện HTML (EJS)
│   └── pricing.ejs    ← Trang bảng giá Free/Pro
├── public/
│   ├── css/neon.css   ← Thiết kế Neon + Light mode + Kanban + Pricing
│   └── js/main.js     ← JavaScript frontend
└── package.json
```

### Cập nhật database khi nâng cấp từ bản cũ

`db/schema.sql` đã có các câu `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` cho `plan`, `theme`, `accent_color` (bảng `users`) và `template` (bảng `projects`). File này tự chạy mỗi khi server khởi động (`initDB()` trong `server.js`), nên **chỉ cần deploy code mới, không cần chạy migration thủ công**.

---

## ❓ Lỗi thường gặp

**Lỗi: `Cannot connect to database`**
→ Kiểm tra `DATABASE_URL` trong Environment Variables trên Render

**Lỗi: `Port already in use`**
→ Render tự xử lý PORT, không cần lo

**Web load chậm lần đầu**
→ Render Free tier sẽ "ngủ" sau 15 phút không dùng, lần đầu mở sẽ chờ ~30s

---

_Made with ⚡ NeonTeam_
