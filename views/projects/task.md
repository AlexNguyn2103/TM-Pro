# Task List – TM-Pro Redesign

## Phase 1: CSS & Design System
- [x] Viết lại `neon.css` – xanh lá mạ, sidebar layout, liquid glass, mobile responsive

## Phase 2: Layout Partials
- [x] Cập nhật `header.ejs` – thêm font Inter, app-layout wrapper
- [x] Cập nhật `navbar.ejs` → sidebar VNA-style với hamburger mobile
- [x] Cập nhật `footer.ejs` – mobile bottom nav, đóng app-layout

## Phase 3: Pages
- [x] Cập nhật `index.ejs` – landing page mới với hero + tabs
- [x] Cập nhật `login.ejs` – popup modal với 2 lựa chọn (login / khách)
- [x] Cập nhật `dashboard.ejs` – layout mới với glass cards
- [x] Tạo `views/guest/dashboard.ejs` – trang khách xem dự án public

## Phase 4: Guest Route
- [ ] Cập nhật `routes/guest.js` – thêm GET /guest (dashboard dự án public)
- [ ] Cập nhật `server.js` – thêm route GET /guest

## Phase 5: Task Features
- [ ] Cập nhật `detail.ejs` – thêm nút "Xác nhận nhận nhiệm vụ" (confirm)
- [ ] Cập nhật `detail.ejs` – thêm badge "Cần nộp tài liệu" / "Không cần nộp"
- [ ] Cập nhật `schema.sql` – thêm cột `requires_submission`, `confirmed_by` vào tasks
- [ ] Cập nhật `routes/projects.js` – xử lý confirm task + requires_submission flag
