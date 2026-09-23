# CRS Yuem-Kuen System

CRS Yuem-Kuen System คือระบบเว็บภาษาไทยสำหรับจัดการอุปกรณ์ส่วนกลาง ตั้งแต่ค้นหาและสแกน QR ไปจนถึงขอยืม อนุมัติ รับอุปกรณ์ แจ้งคืน ตรวจสภาพ และบันทึกประวัติ โดยใช้บริการของ Google Workspace เป็นหลักและไม่ต้องมีเซิร์ฟเวอร์แยก

## เทคโนโลยี

- Frontend: HTML5, CSS3, JavaScript, Bootstrap 5, Noto Sans Thai
- Backend: Google Apps Script V8
- Database: Google Sheets
- File storage: Google Drive
- Authentication: Google OAuth 2.0 / OpenID Connect แบบ server-side Authorization Code flow พร้อม PKCE
- QR: ไลบรารีโอเพนซอร์สบนฝั่งเบราว์เซอร์

## ขอบเขต V1

ระบบรองรับ Dashboard, รายการและรายละเอียดอุปกรณ์, ค้นหา/กรอง/เรียง/แบ่งหน้า, QR deep link, คำขอยืม, อนุมัติ/ปฏิเสธ, checkout, แจ้งคืน, ตรวจรับคืน, overdue, ประวัติ, ผู้ใช้ และหมวดหมู่ พร้อมการตรวจสิทธิ์ทั้งหน้าเว็บและ backend หน้าเว็บมีธีม `system`, `light` และ `dark`; ค่าเริ่มต้นตามอุปกรณ์และบันทึกตัวเลือกไว้เฉพาะใน `localStorage` ของ browser

## สถาปัตยกรรมโดยย่อ

เว็บเป็น single-page application ที่ Apps Script HTML Service ให้บริการ หน้าเว็บเรียก RPC แบบ asynchronous ผ่าน `google.script.run` ไปยัง API wrappers ซึ่งตรวจ identity/role ก่อนเรียก domain services ส่วน domain services บังคับ state transition ภายใต้ Script Lock และอ่านเขียนผ่าน repository ที่อิงชื่อ header ของ Google Sheets เท่านั้น

อ่านรายละเอียดได้ที่ [Architecture](docs/ARCHITECTURE.md), [Database](docs/DATABASE.md) และ [Workflows](docs/WORKFLOWS.md)

## การทดสอบในเครื่อง

ต้องใช้ Node.js 20 ขึ้นไป จากนั้นรัน `npm ci`, `npx playwright install chromium` และ `npm run test` ชุดทดสอบจะตรวจ source contracts, workflow backend ด้วยฐานข้อมูลจำลองในหน่วยความจำ และ UI/responsive ด้วย Chromium โดยไม่ต้องมี Google Sheet หรือ Web App deployment อ่านขอบเขตและรายการตรวจบนระบบจริงได้ที่ [Manual acceptance](tests/MANUAL_ACCEPTANCE.md)

## ข้อกำหนดสำคัญด้านบัญชี

ระบบรองรับ Google Workspace และบัญชี `@gmail.com` ตาม exact allowlist ใน `ALLOWED_DOMAINS` โดย fallback ไปอ่าน `ALLOWED_DOMAIN` เดิมเมื่อยังไม่ได้ตั้งค่ารายการใหม่ Browser เปิด Google Authorization endpoint ใน popup ส่วน Apps Script รับ authorization code ที่ callback `/exec`, แลก token ฝั่ง serverแล้วตรวจลายเซ็น, issuer, audience, expiry, nonce และอีเมลที่ Google ยืนยัน ก่อนตรวจ Users row, `ACTIVE` status และ role อีกชั้น Browser ได้เฉพาะ opaque application session อายุไม่เกิน 6 ชั่วโมง: ค่าเริ่มต้นอยู่ใน `sessionStorage` และเมื่อผู้ใช้เลือก “จดจำการเข้าสู่ระบบ” จึงอยู่ใน `localStorage`; ไม่เก็บ Google token/email/role และทุก business RPC ยังตรวจ session, Users row, status และ role ใหม่ ระบบไม่ใช้ `Session.getActiveUser()` เป็น visitor identity, ไม่สร้าง Users row อัตโนมัติ และ fail closed เมื่อหลักฐานหรือสิทธิ์ไม่ครบ

## การติดตั้ง

ทำตาม [คู่มือติดตั้งและ Deploy](docs/DEPLOYMENT.md) ซึ่งครอบคลุมการสร้าง Google Sheet/Drive folder, นำไฟล์ runtime 46 ไฟล์เข้า Apps Script, สร้าง Web OAuth Client พร้อม exact Authorized redirect URI, ตั้ง Script Properties, bootstrap Admin, authorize, deploy แบบ `USER_DEPLOYING` + `ANYONE` สำหรับผู้ที่ลงชื่อเข้าใช้แล้ว, ทดสอบ Workspace/Gmail, rollback และดูแลหลังเปิดใช้งาน ห้ามใช้ `ANYONE_ANONYMOUS`

## สถานะ

Source สำหรับ V1 ทั้ง 7 phases อยู่บน branch `main`; deployment แบบ domain-only เคยผ่านการทดสอบใน `yru.ac.th` แล้ว ส่วน release ที่เพิ่ม external Google Account ยังต้องผ่าน live acceptance กับ Workspace/Gmail ก่อนประกาศ production

## Pilot callback confirmation update

Visitor OAuth returns to the exact Pilot `/exec` URL configured in `GOOGLE_OAUTH_REDIRECT_URI` (Script Properties) and the OAuth Web application's Authorized redirect URIs. Do not use `/usercallback`, StateTokenBuilder, wildcard origins, or the production URL. `doGet` routes any code/error/state request to a private callback implementation; malformed/duplicate/replayed/expired state fails closed.

Callback verifies Google identity but only stores a pending candidate, NOT an active session. It displays a six-digit numeric OTP generated from a server-keyed HMAC CSPRNG. The server stores only a flow-bound OTP HMAC, never the plaintext code; the OTP expires after five minutes, permits at most five failed submissions, is consumed immediately on success, and cannot be replayed. Confirmation still requires the OTP plus the original browser-held poll AND session proofs. Users/ACTIVE/Role are checked again at activation and on every business RPC. Never share an OTP or complete a sign-in flow started by someone else.

The callback does NOT read or compare `getTemporaryActiveUserKey()`. Its context may differ from the original RPC context. The existing temporary-key check remains only between begin/complete/business RPCs as additional defense; it is not relied on to stop attacker-started/victim-redeemed callbacks. No Google/session token appears in URLs. Raw callback state is hashed in cache; nonce/PKCE verifier are transient server-only cache data. Random server values use a domain-separated HMAC-SHA256 PRF keyed by the confidential OAuth client secret with UUID/time uniqueness input; protect/rotate that secret and never log it.

Deployment procedure: pass all tests, commit and push `main`, verify `USER_DEPLOYING` + `ANYONE`, upload, create an immutable version, download that new version and compare all source files, then update ONLY the existing Pilot deployment. Do not create a separate pre-deploy source backup. Production promotion requires real YRU/Gmail login, confirmation, session isolation, and authorization acceptance. A configuration change does not prove successful login.
