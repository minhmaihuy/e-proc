# E-PROC

Nền tảng đánh giá kỹ thuật đa tenant. Hướng dẫn đầy đủ về phát triển và triển
khai nằm trong [AGENTS.md](AGENTS.md); tài liệu dưới đây là điểm vào vận hành
Live screen monitor WebRTC.

## Live WebRTC monitor: chọn transport theo batch

`tenant_admin` chọn transport cho từng batch thi thường có recording `local`
hoặc `s3`:

| Chế độ | Signaling | Đường video khi không P2P được |
| --- | --- | --- |
| `off` | Không có | Không có |
| `self_hosted` | WebSocket cùng origin `/api/live/signaling` | coturn do E-PROC vận hành |
| `supabase` | Supabase Realtime private Broadcast | Metered TURN |

Chỉ `tenant_admin` được thay đổi lựa chọn. Không thể đổi transport khi batch có
thí sinh `in_progress`, và Practice hay batch không recording luôn bị tắt Live
monitor ở backend.

## Cơ chế self-hosted

1. Backend xác thực thí sinh/admin và cấp token signaling ngắn hạn.
2. Hai browser mở WebSocket tới `/api/live/signaling` để trao đổi offer, answer
   và ICE candidate.
3. Browser cố kết nối WebRTC trực tiếp. Nếu NAT/firewall chặn, browser dùng
   candidate `relay` qua coturn; E-PROC backend không nhận hoặc lưu video,
   audio, SDP hay ICE payload.
4. Backend chỉ lưu audit metadata của phiên xem.

coturn phải dùng hostname DNS-only riêng (không đặt sau proxy HTTP/CDN), TLS,
TCP/UDP 3478, TCP 5349 và UDP relay range 49152–49200. Shared secret chỉ ở
server; browser nhận credential HMAC có hạn dùng.

Xem cấu hình và kiểm tra chi tiết tại
[docs/live-monitoring-self-hosted-webrtc.md](docs/live-monitoring-self-hosted-webrtc.md).

## IPv6-only và Supabase + Metered

Supabase Realtime **chỉ là signaling**; nó không relay video. Metered TURN mới
relay media khi pair ICE chọn `relay`:

```text
Browser thí sinh ── WebRTC media ──> Metered TURN ── WebRTC media ──> Browser admin
       │
       └──────── offer / answer / ICE ───────> Supabase Realtime
```

Vì vậy, một coturn chỉ IPv6 sẽ không phục vụ browser chỉ IPv4. Batch `supabase`
cho phép browser IPv4 đi thẳng tới Supabase và Metered, không đi qua VM ở đường
video. Tuy nhiên VM hiện vẫn gọi Metered Credentials API để lấy TURN
credentials. Nếu VM là IPv6-only và không có DNS64/NAT64 hoặc một đường egress
tới endpoint IPv4 của Metered, code sẽ rơi về STUN-only và relay có thể thất bại.

Muốn không gán public IPv4 trực tiếp cho VM mà vẫn hỗ trợ browser IPv4 cần cả:

- ingress HTTPS/WSS dual-stack (proxy/CDN phù hợp) cho ứng dụng;
- egress IPv6-to-IPv4 bằng DNS64/NAT64, hoặc một credential broker IPv6-capable
  được thiết kế riêng; và
- Metered credentials được giữ server-side, tuyệt đối không gửi Metered API key
  xuống browser.

DNS64/NAT64 qua AWS NAT Gateway có thể giải quyết egress IPv6-to-IPv4, nhưng có
chi phí NAT Gateway. Xem [docs/live-monitoring-transports.md](docs/live-monitoring-transports.md)
và [migrations/20260905_live_monitoring_supabase.sql](migrations/20260905_live_monitoring_supabase.sql)
trước khi bật mode Supabase.

## Kiểm tra sau triển khai

1. Tạo batch thường có Local/S3, chọn transport và bắt đầu attempt.
2. Mở Live bằng `tenant_admin`; hai session phải nhận cùng `transport`.
3. Trong `chrome://webrtc-internals`, pair ICE thành công có candidate type
   `relay` khi Metered/coturn đang được dùng; `bytesReceived` và `framesDecoded`
   phải tăng khi video hiển thị.
4. Kiểm tra `off`, Practice, account `admin` thường, attempt không active và đổi
   transport giữa attempt đều bị API từ chối.
