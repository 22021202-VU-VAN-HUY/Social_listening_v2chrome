# Cấu hình collector Threads Web

Collector Threads hiện chạy qua Chrome Extension, dùng phiên đăng nhập Threads
có sẵn trong Chrome. Không cần Meta for Developers, Threads App ID, App Secret,
access token hoặc quyền `threads_keyword_search`.

## Chuẩn bị

- Chrome đã đăng nhập được `https://www.threads.com/`.
- Docker backend của dự án đang chạy.
- Extension Social Listening phiên bản `0.2.0` trở lên đã được load unpacked và
  ghép với backend.
- Ít nhất một keyword Threads đang bật, ví dụ `VinSmart Future`.

## Cài hoặc cập nhật extension

1. Chạy `npm run build --prefix apps/extension`.
2. Mở `chrome://extensions` và bật **Developer mode**.
3. Lần đầu: chọn **Load unpacked** và trỏ đến `apps/extension/dist`.
4. Khi cập nhật: bấm **Reload** trên extension Social Listening.
5. Mở popup extension. Nếu chưa ghép, tại `Settings > Threads` tạo mã ghép rồi
   nhập mã vào popup.

Mỗi máy chỉ cần cài/ghép extension một lần. Người dùng không phải tạo Meta App.

## Chạy lần đầu

1. Mở Threads Web và chắc chắn tài khoản không bị yêu cầu đăng nhập/xác minh.
2. Vào `Settings > Threads`.
3. Thêm và bật keyword cần theo dõi.
4. Chọn khoảng thời gian.
5. Bấm **Bắt đầu tìm trên Threads**.
6. Theo dõi trạng thái tại trang Jobs.

Extension chỉ dùng một tab nền. Với mỗi keyword, nó mở tìm kiếm Threads ở chế
độ recent, cuộn kết quả, kiểm tra keyword lần nữa trong DOM, mở các bài phù hợp
và thu thập phản hồi đang hiển thị. Tab được đóng khi job kết thúc.

## Nguyên tắc an toàn và dữ liệu

- Chỉ đọc và cuộn; không bấm Like, Reply, Follow hoặc đăng nội dung.
- Không lưu cookie, password, access token, username hay URL hồ sơ Threads.
- URL bài/reply được chuẩn hóa thành `https://www.threads.com/t/{shortcode}/`.
- Tác giả Threads được lưu ở trạng thái `unknown` trong MVP.
- Kết quả là phần nội dung công khai Threads hiển thị cho tài khoản và phiên tìm
  kiếm tại thời điểm chạy; không phải firehose hay toàn bộ Threads.
- DOM Threads có thể thay đổi. Nếu không nhận diện được trang, job dừng an toàn
  hoặc ghi nhận `partial`, không tự tương tác để vượt màn hình chặn.

## Lỗi thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| Extension cũ/không tương thích | Build lại, vào `chrome://extensions` và bấm Reload; cần bản 0.2.0+. |
| `EXTENSION_OFFLINE` | Mở Chrome/popup extension, kiểm tra API URL và trạng thái ghép. |
| `DEVICE_ALREADY_BUSY` | Chờ hoặc hủy job web đang chạy; một extension chỉ chạy một job Facebook/Threads. |
| `needs_login` | Mở `threads.com`, đăng nhập hoặc hoàn tất xác minh rồi chạy lại. |
| Không có kết quả | Kiểm tra keyword, thử trực tiếp Threads Search và xem Jobs có báo coverage `partial` không. |
| Giao diện Threads đổi | Lưu một DOM fixture đã loại dữ liệu nhạy cảm để cập nhật adapter/test. |

## Những biến môi trường đã bỏ

Worker không còn đọc các biến `THREADS_ACCESS_TOKEN`, `THREADS_USER_ID`,
`THREADS_GRAPH_BASE_URL`, `THREADS_API_VERSION` hoặc các giới hạn request API
Threads. Nếu chúng còn trong `.env` cục bộ, có thể xóa; chúng không còn được
Compose truyền vào worker.
