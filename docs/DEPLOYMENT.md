# คู่มือติดตั้ง Deploy และส่งมอบระบบ

คู่มือนี้ใช้สำหรับนำ CRS Yuem-Kuen System รุ่น `0.2.0` ไปติดตั้งบน Google Workspace จริง ตั้งแต่สร้างทรัพยากรจนถึงตรวจรับ Workspace/Gmail User/Admin และดูแลหลังเปิดใช้งาน ขั้นตอนทั้งหมดใช้บริการของ Google และไม่ต้องมี VPS หรือฐานข้อมูลแยก

> สถานะของ repository เป็น source ที่ผ่านการทดสอบในเครื่อง ไม่ใช่หลักฐานว่าระบบถูก deploy ในโดเมนขององค์กรแล้ว ผู้รับผิดชอบ deployment ต้องทำรายการใน [Deployment Acceptance Matrix](../tests/MANUAL_ACCEPTANCE.md) ให้ผ่านก่อนเปิดใช้งานจริง

## รูปแบบ deployment ที่ระบบนี้รองรับ

| รายการ | ค่าที่กำหนด |
|---|---|
| Apps Script project | Standalone project ภายใต้บัญชี Google Workspace ขององค์กร |
| Execute as | ผู้ deploy (`Me` / `USER_DEPLOYING`) |
| Who has access | Google Account ที่ลงชื่อเข้าใช้แล้ว (`ANYONE`); ห้าม `ANYONE_ANONYMOUS` |
| Database | Google Sheet ที่ระบุด้วย `SPREADSHEET_ID` |
| Image storage | Google Drive folder ที่ระบุด้วย `DRIVE_FOLDER_ID` |
| Visitor identity | server-side OpenID Connect ID token ที่ backend ตรวจครบ แล้วตรงกับ Users row ที่ `ACTIVE` |
| Production URL | URL แบบ versioned deployment ที่ลงท้ายด้วย `/exec` |

รูปแบบนี้ทำให้ผู้ใช้ทั่วไปไม่ต้องมีสิทธิ์อ่านหรือแก้ไข Sheet/Drive folder โดยตรง เพราะ backend ทำงานด้วยสิทธิ์ของผู้ deploy การใช้งานและ quota ของบริการที่ backend เรียกจึงรวมอยู่ที่บัญชีผู้ deploy และต้องมีผู้ติดตาม execution health การตั้ง `ANYONE` เป็นเพียง Google login gate เพื่อให้บัญชีภายนอกเปิด Web app ได้ ไม่ใช่การอนุญาตเข้าแอป: ทุก business RPC ต้องมี opaque application session ที่ผูกกับ visitor และไม่หมดอายุ แล้วตรวจ Users row, status และ role อีกครั้ง; Google ID token ถูกแลกและตรวจเฉพาะฝั่ง server ระหว่าง callback

ห้ามใช้ `Session.getActiveUser()` หรือ `Session.getEffectiveUser()` เป็น visitor identity, ห้ามเชื่อ email/role ที่ browser ส่งเอง, ห้ามใช้ token ที่เพียง decode โดยไม่ตรวจ signature และห้ามตั้ง access เป็น `ANYONE_ANONYMOUS` ไม่ว่ากรณีใด

## สิ่งที่ต้องเตรียม

- บัญชี Workspace อายุการใช้งานระยะยาวที่องค์กรควบคุมสำหรับเป็นผู้ deploy ไม่ควรใช้บัญชีพนักงานที่อาจถูกปิดเมื่อย้ายงาน
- สิทธิ์สร้าง/แก้ไข Google Sheet, Google Drive folder และ Apps Script project ด้วยบัญชีเดียวกัน
- Google Cloud project ที่องค์กรควบคุม พร้อม OAuth consent/branding แบบ **External** และ OAuth Client ชนิด **Web application** สำหรับ server-side OAuth
- อีเมล Admin เริ่มต้นอย่างน้อยหนึ่งบัญชีใน allowlisted domain โดยบัญชี Workspace ที่รัน setup ครั้งแรกต้องอยู่ในรายการนี้
- บัญชี User ทดสอบอย่างน้อยสองบัญชี โดยมีทั้ง Workspace (`@yru.ac.th`) และ Gmail (`@gmail.com`) ใช้ browser profile แยกจาก Admin; เพิ่มทุกบัญชีเป็น Users row ล่วงหน้า
- โทรศัพท์ Android/iOS อย่างน้อยหนึ่งเครื่องสำหรับทดสอบ QR, native camera/file picker และ responsive UI
- Source จาก commit ที่ผ่าน review; บันทึกค่า `git rev-parse HEAD` ไว้ใน change record ก่อน deploy

หากข้อมูลจริงต้องสะอาด แนะนำให้ทำ UAT ใน Apps Script project, Sheet และ Drive folder ชุดแยกต่างหาก เพราะ History และ Operations เป็นหลักฐานแบบไม่ลบย้อนหลัง การทดลอง lifecycle ในฐานข้อมูล production จะคงอยู่ใน audit trail

## 1. สร้าง Google Sheet

1. ลงชื่อเข้าใช้ด้วยบัญชี Workspace ที่จะเป็นผู้ deploy
2. สร้าง Google Sheet เปล่า เช่น `CRS Yuem-Kuen System`
3. ไม่ต้องสร้าง tab หรือ header เอง `setupSystem_()` จะสร้างและตรวจ schema ให้ทั้งหมด
4. เปิด URL ของ Sheet แล้วคัดลอกข้อความระหว่าง `/d/` และ `/edit` เก็บเป็น `SPREADSHEET_ID`
5. จำกัด Share ของ Sheet ไว้เฉพาะบัญชีผู้ deploy และผู้ดูแลข้อมูลที่จำเป็น ผู้ใช้ระบบทั่วไปต้องไม่มีสิทธิ์ตรงทุกระดับ รวม Viewer/Commenter และสิทธิ์ที่ได้ผ่าน group/link

ตัวอย่างตำแหน่ง ID:

```text
https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit
```

ระบบสร้าง/ดูแล 11 tabs ต่อไปนี้: `Equipment`, `Users`, `Borrow`, `Categories`, `IncludedItems`, `BorrowItems`, `History`, `Operations`, `Settings`, `Sequences` และ `SchemaMigrations` โดยไม่ลบ tab อื่น เช่น `Sheet1` หากต้องการลบ tab เริ่มต้นให้ยืนยันก่อนว่าไม่มีข้อมูลและไม่ใช่หนึ่งใน 11 ชื่อที่ระบบดูแล

## 2. เปิด Apps Script
1. ไปที่ [script.google.com](https://script.google.com/) แล้วเลือก **New project** เพื่อสร้าง standalone project
2. ตั้งชื่อ Apps Script project เป็น `CRS Yuem-Kuen System`
3. เปิด **Project Settings** แล้วตรวจ Time zone เป็น `(GMT+07:00) Bangkok`
4. เปิดตัวเลือก **Show "appsscript.json" manifest file in editor**
5. บันทึก Script ID และเจ้าของ project ไว้ใน change record ขององค์กร โดยไม่ใส่ค่าจริงลง Git
6. จำกัด Editor ของ Apps Script project ไว้เฉพาะ release operators ที่อนุมัติแล้ว เพราะ Editor เปลี่ยน code และ Script Properties ที่ production อ่านได้ทันที

Standalone project เป็นรูปแบบหลักของระบบ แม้ code จะรองรับ bound script เป็น fallback ก็ตาม Production ต้องตั้ง `SPREADSHEET_ID` อย่างชัดเจนเพื่อไม่ให้ชี้ฐานข้อมูลผิดไฟล์

## 3. เพิ่ม Source Code

วิธีที่ไม่ต้องติดตั้งเครื่องมือเพิ่มคือสร้างไฟล์ใน Apps Script editor แล้วคัดลอกเนื้อหาจาก `src/` ให้ตรงชื่อทุกไฟล์

1. แทนที่เนื้อหา `Code.gs` ที่ project สร้างมาให้ โดยลบ `myFunction` เดิมแล้ววาง `src/Code.gs`
2. สำหรับไฟล์ `.gs` อีก 24 ไฟล์ ให้กด **Add a file > Script** แล้วใส่ชื่อฐานโดยไม่ต้องพิมพ์ `.gs`
3. สำหรับไฟล์ `.html` ให้กด **Add a file > HTML** แล้วใส่ชื่อฐานโดยไม่ต้องพิมพ์ `.html`
4. แทนที่ manifest ด้วยเนื้อหาจาก `src/appsscript.json`
5. บันทึกทุกไฟล์ แล้วตรวจว่าไม่มีไฟล์ชื่อซ้ำ เช่น `Code.gs.gs` หรือไฟล์ runtime เก่าที่ไม่มีใน inventory

ไฟล์ Script จำนวน 26 ไฟล์ (รวม `AuthorizeTest.gs` ซึ่งเก็บ helper `authorizePilot_()` แบบ private สำหรับ operator เท่านั้น):

```text
Api.gs
Auth.gs
BorrowService.gs
CategoryService.gs
Code.gs
Config.gs
Constants.gs
DashboardService.gs
DataStore.gs
EquipmentService.gs
Errors.gs
HistoryService.gs
ImageService.gs
IdentityService.gs
IntegrityService.gs
Migrations.gs
OAuthService.gs
OperationAdminService.gs
OperationService.gs
Schema.gs
ServiceUtils.gs
Setup.gs
UserService.gs
Utils.gs
Validation.gs
```

ไฟล์ HTML จำนวน 19 ไฟล์:

```text
admin.html
borrow.html
components.html
dashboard.html
equipment.html
equipment-detail.html
index.html
my-borrow.html
scan.html
scripts-admin.html
scripts-api.html
scripts-borrow.html
scripts-core.html
scripts-dashboard.html
scripts-equipment.html
scripts-qr.html
styles.html
vendor-html5-qrcode.html
vendor-qrcode-generator.html
```

รวม manifest แล้วมี runtime source 46 ไฟล์ ไม่ต้องอัปโหลด `docs/`, `tests/`, `node_modules/`, `package.json` หรือไฟล์ license เข้า Apps Script การทำงานของไฟล์ `.gs` ไม่ขึ้นกับลำดับที่แสดงใน editor

ก่อนส่ง source ขึ้น production ผู้พัฒนาควรรันจาก repository ด้วย Node.js 20 ขึ้นไป:

```powershell
npm ci
npx playwright install chromium
npm run test
```

ต้องได้ผลผ่านทั้ง source/security contracts, backend workflow และ Playwright browser acceptance

## 4. ตั้ง Spreadsheet ID

1. ใน Apps Script เปิด **Project Settings**
2. ใต้ **Script Properties** เลือก **Add script property**
3. เพิ่ม Property `SPREADSHEET_ID`
4. ใส่เฉพาะ ID ที่คัดลอกจากข้อ 1 ไม่ใส่ URL, ช่องว่าง หรือวงเล็บ
5. กด **Save script properties**

Script Properties เป็นค่าร่วมของทั้ง web app และเก็บเป็น string ไม่ควรเขียน ID จริงลง `Config.gs` หรือ commit ลง repository

## 5. ตั้ง Drive Folder

1. สร้าง folder ใน Google Drive ด้วยบัญชีผู้ deploy เช่น `CRS Yuem-Kuen Images`
2. คัดลอก ID หลัง `/folders/` จาก URL ของ folder เช่น `https://drive.google.com/drive/folders/{DRIVE_FOLDER_ID}`
3. เพิ่ม Script Property `DRIVE_FOLDER_ID` ด้วย ID นี้
4. เลือก `IMAGE_SHARING` ตามการจัดชั้นข้อมูลและกลุ่มผู้ใช้จริง; external Gmail ต้องใช้ `ANYONE_WITH_LINK` จึงจะเปิดไฟล์จาก Drive URL ได้
5. อย่าแชร์ folder ให้ผู้ใช้ทั่วไปทุกระดับ รวม Viewer/Commenter, group และ link ระบบจะสร้างไฟล์ด้วยสิทธิ์ผู้ deploy และตั้งสิทธิ์อ่านให้แต่ละไฟล์ตาม policy

`IMAGE_SHARING` ยอมรับเพียง:

- `DOMAIN_WITH_LINK` — ผู้มี link ภายใน Workspace domain เปิดรูปได้ แต่ Gmail ภายนอกเปิดไม่ได้ แม้ผ่านสิทธิ์แอป
- `ANYONE_WITH_LINK` — ทุกคนที่มี link เปิดรูปได้โดยไม่ผ่าน ID token หรือ Users row; ใช้เมื่อองค์กรอนุมัติให้ภาพเป็นข้อมูลเปิดตามลิงก์แล้วเท่านั้น

หากนโยบาย Workspace ปิด sharing mode ที่เลือก การอัปโหลดจะ fail closed ด้วย `DRIVE_SHARING_FAILED` ให้ประสาน Workspace Admin แทนการเปลี่ยนเป็น public โดยพลการ

ทั้งสอง mode เป็น boundary ที่กว้างกว่า Users sheet: `DOMAIN_WITH_LINK` อนุญาตสมาชิก domain ที่มี URL แม้ไม่มี Users row หรือถูก Inactive แต่กัน Gmail ออก ส่วน `ANYONE_WITH_LINK` รองรับ Gmail แต่ผู้ถือ URL ทุกคนดูได้ รูปจึงต้องเป็นภาพครุภัณฑ์ที่องค์กรอนุมัติตาม audience นั้น ห้ามใช้เก็บเอกสารลับ ข้อมูลบุคคล หรือภาพที่ต้องบังคับสิทธิ์ระดับ Users row หากต้องการ policy แคบกว่านี้ต้องออกแบบ authenticated image delivery ใหม่

การเปลี่ยน `IMAGE_SHARING` มีผลเฉพาะไฟล์ที่อัปโหลด/แทนที่หลังเปลี่ยนค่า ไม่ย้อนสิทธิ์ไฟล์เก่า และการแทนรูปไม่ได้ลบรูปเดิมอัตโนมัติเพราะ History อาจอ้าง file ID/URL เดิม ให้ผู้ดูแลทำ permission/storage audit และ reconcile reference ก่อนเปลี่ยนสิทธิ์หรือย้ายไฟล์ ห้ามลบจาก Drive แบบ bulk โดยไม่ตรวจหลักฐาน

## 6. ตั้ง Admin, allowed domains และ Google OAuth Client

เพิ่ม Script Properties ตามตารางนี้:

| Property | ตัวอย่างรูปแบบ | กฎ |
|---|---|---|
| `ALLOWED_DOMAINS` | `yru.ac.th,gmail.com` | exact domain ตัวพิมพ์เล็ก คั่นด้วย comma ไม่ใส่ `@`, protocol หรือ wildcard |
| `ADMIN_EMAILS` | `admin1@yru.ac.th,admin2@gmail.com` | คั่นด้วย comma; ทุกบัญชีต้องอยู่ใน `ALLOWED_DOMAINS` และต้องมี Users row หลัง bootstrap |
| `GOOGLE_OAUTH_CLIENT_SECRET` | ตั้งค่าลับจาก Google Cloud โดยตรง | ห้ามใส่ source/Git/log/chat; เปลี่ยนทันทีหากเคยเปิดเผย |
| `AUTH_FLOW_TTL_SECONDS` | `600` | อายุ flow 120–1800 วินาที |
| `AUTH_SESSION_TTL_SECONDS` | `21600` | absolute application-session TTL 300–21600 วินาทีหลัง verified sign-in; `ScriptCache` อาจ evict ก่อนกำหนดและต้อง fail closed |
| `GOOGLE_OAUTH_CLIENT_ID` | `1234567890-example.apps.googleusercontent.com` | OAuth 2.0 Client ID ชนิด Web application; เป็น ID ไม่ใช่ client secret |

อย่าปล่อยให้ใช้ค่าเริ่มต้น `admin@example.com` จาก source บัญชีที่กด Run ครั้งแรกต้องอยู่ใน `ADMIN_EMAILS` และต้องเข้าถึง Sheet ได้

`ADMIN_EMAILS` ใช้ bootstrap เฉพาะ setup สำเร็จครั้งแรก หลังจากนั้นให้เพิ่ม/แก้ Admin ผ่านหน้า **Admin > ผู้ใช้** และเฉพาะ Admin ที่ Active อยู่ใน Users sheet เท่านั้นจึงรัน setup ซ้ำได้ การแก้ Property หลัง bootstrap ไม่ได้เพิ่ม Admin row ให้อัตโนมัติ

เมื่อ `ALLOWED_DOMAINS` มีค่า ระบบใช้รายการนี้และไม่รวมค่า `ALLOWED_DOMAIN`; หาก property ใหม่ไม่มีหรือว่างจึง fallback ไปใช้ `ALLOWED_DOMAIN` เดิมหนึ่งค่าเพื่อ backward compatibility เท่านั้น ไม่รวม secondary domain, subdomain หรือ alias โดยอัตโนมัติ หลัง migrate สำเร็จควรเก็บ `ALLOWED_DOMAIN` ไว้ใน restricted backup แล้วลบ property เก่าเพื่อลดความกำกวม

กฎ authoritative email ที่ backend ใช้:

- `@gmail.com` ต้องมี `email_verified=true`; `hd` ไม่จำเป็น
- Google Workspace/non-Gmail ต้องมี `email_verified=true` และ `hd` ตรง exact domain หลัง `@`
- Google Account ที่สมัครด้วยอีเมล third-party แต่ไม่มี `hd` ถูกปฏิเสธ แม้ `email_verified=true`

Domain allowlist ไม่ได้สร้างสิทธิ์ใช้งาน ทุกบัญชีต้องมี Users row ตรง exact email, status `ACTIVE` และ role ที่เหมาะสม ระบบไม่ auto-provision visitor ให้คง `AUTO_PROVISION_USERS=false`

Schema v3 ยังคงใช้ verified email เป็น authorization key เพื่อ backward compatibility แม้ token จะมี Google `sub` ด้วย เมื่อมีการ rename/reassign บัญชี ต้อง Inactive หรือแก้ Users row เดิมผ่านกระบวนการ Admin ก่อนให้เจ้าของอีเมลคนใหม่เข้าใช้ โดยเฉพาะ row ที่เป็น `ADMIN`; ห้ามถือว่าอีเมลที่นำกลับมาใช้ใหม่คือบุคคลเดิมโดยอัตโนมัติ

### สร้าง OAuth Web Client สำหรับ server-side Authorization Code flow

1. เลือก Google Cloud project ที่องค์กรควบคุม เปิด Google Auth Platform ตั้ง Branding และ Audience เป็น **External**; หากยัง Testing ให้เพิ่มบัญชี YRU และ Gmail ที่จะทดสอบใน Test users
2. เปิด **Clients > Create client > Web application** ไม่ใช้ Desktop/Android/iOS
3. ใน **Authorized redirect URIs** เพิ่ม URL นี้ โดยแทน PILOT_DEPLOYMENT_ID ด้วย deployment ID ของ Pilot:

   `https://script.google.com/macros/s/{PILOT_DEPLOYMENT_ID}/exec`

4. ไม่ต้องเพิ่ม Authorized JavaScript origins สำหรับ flow นี้ ไม่ใช้ wildcard หรือ host ของ userHtmlFrame
5. คัดลอก Client ID ที่ลงท้าย `.apps.googleusercontent.com` ลง `GOOGLE_OAUTH_CLIENT_ID` และ Client secret ลง `GOOGLE_OAUTH_CLIENT_SECRET` ใน Script Properties เท่านั้น Callback URL ไม่ใช่ Client ID ตั้ง property GOOGLE_OAUTH_REDIRECT_URI เป็น exact Pilot /exec URL เดียวกับ Authorized redirect URIs
6. บันทึก properties; คง `ALLOWED_DOMAINS=yru.ac.th,gmail.com` และ `AUTO_PROVISION_USERS=false` ก่อนเปิด pilot หาก secret เคยปรากฏในภาพ/แชต ให้สร้างใหม่ อัปเดต property และยกเลิก secret เก่า
7. Visitor ขอเฉพาะ `openid email`; Drive/Sheets authorization เป็นของ deployer แยกต่างหาก ห้ามเพิ่ม direct permission ให้ visitor เพื่อแก้ OAuth error

ค่าที่แนะนำก่อนเปิดใช้งาน:

| Property | ค่าที่แนะนำ | ความหมาย |
|---|---:|---|
| `AUTO_PROVISION_USERS` | `false` | บังคับ: ผู้ใช้ต้องถูกเพิ่มโดย Admin ก่อน; identity path ไม่ auto-provision |
| `APP_NAME` | `CRS Yuem-Kuen System` | ชื่อเต็มบน browser/page title และ metadata ของแอป |
| `APP_SHORT_NAME` | `CRS Yuem-Kuen` | ชื่อสั้นบน navigation, login และส่วน branding ที่พื้นที่จำกัด |
| `TIMEZONE` | `Asia/Bangkok` | timezone ธุรกิจ |
| `LOCALE` | `th_TH` | locale ของ Sheet |
| `MAX_IMAGE_BYTES` | `4194304` | รูปสูงสุด 4 MiB; ช่วงที่รองรับ 1,024–10,485,760 bytes |
| `IMAGE_SHARING` | ผ่าน data-owner review | `DOMAIN_WITH_LINK` ไม่รองรับ Gmail; `ANYONE_WITH_LINK` เปิดกว้างตาม URL |

ค่า optional/tuning ต่อไปนี้ไม่จำเป็นต้องเพิ่มหากใช้ค่าเริ่มต้น:

| Property | ค่าเริ่มต้น | ช่วง/ข้อกำหนด |
|---|---:|---|
| `APP_VERSION` | `0.2.0` | ควรใช้ค่าจาก source และเปลี่ยนตาม release process เดียวกัน |
| `DEFAULT_PAGE_SIZE` | `24` | จำนวนเต็ม 1–100 และจะไม่เกิน `MAX_PAGE_SIZE` |
| `MAX_PAGE_SIZE` | `100` | จำนวนเต็ม 1–100 |
| `CACHE_TTL_SECONDS` | `120` | จำนวนเต็ม 30–21,600 วินาที |
| `LOCK_TIMEOUT_MS` | `15000` | จำนวนเต็ม 1,000–30,000 มิลลิวินาที |

ค่าตัวเลขที่อยู่นอกช่วงใน `Config.gs` จะกลับไปใช้ค่าเริ่มต้น

## 7. Run Setup

1. ใน Apps Script editor เลือก private function `setupSystem_` จาก function selector ฟังก์ชันนี้ตั้งใจให้รันจาก editor เท่านั้นและไม่ใช่ Web app/RPC endpoint
2. กด **Run** ด้วยบัญชี Admin ที่กำหนดไว้
3. ทำ authorization ตามข้อ 8 เมื่อระบบถาม แล้วรอจน execution จบ
4. เปิด **Execution log** ต้องพบ event `SETUP_COMPLETED` พร้อม `requestId`, Spreadsheet ID, รายชื่อ managed sheets และ warnings
5. หากพบ log ระดับ Error ให้ใช้ `code`, `message` และ `requestId` ตรวจสาเหตุก่อนรันซ้ำ แม้ UI ของ editor อาจแสดงว่า execution จบเพราะ backend แปลง error เป็นผลลัพธ์ที่ปลอดภัย

ผลสำเร็จครั้งแรกต้องมี:

- 11 managed tabs พร้อม header ตาม schema และ warning protection; tab อื่นที่มีอยู่ไม่ถูกลบ
- 13 default categories โดยไม่ซ้ำ
- 7 sequence rows สำหรับ Asset, Borrow, User, Category, Item, BorrowItem และ Log
- Admin rows ตาม `ADMIN_EMAILS`
- migration `001`, `002` และ `003` อย่างละหนึ่ง row
- Settings ที่มี schema version `3`, app version, timezone และ `setup_completed_at`

รัน `setupSystem_()` ซ้ำอีกครั้งเพื่อพิสูจน์ idempotency จำนวน categories, admins และ migrations ต้องไม่เพิ่มซ้ำ ห้ามสร้าง header หรือแก้ migration checksum ด้วยมือ

`setupSystem_()` ใช้ `Session.getActiveUser()` เฉพาะยืนยัน release operator ที่กด Run ใน editor การใช้ Session นี้ไม่ใช่ visitor identity ของ Web app และห้ามนำกลับไปใช้ใน RPC

ก่อน deploy อาจมี warning ว่ายังไม่พบ Web app URL ถือว่าปกติ หลังข้อ 9 ต้องตั้ง `WEB_APP_URL` และรัน setup ซ้ำจน warning นี้หาย

## 8. Authorize

Manifest กำหนด least-privilege OAuth scopes ที่ source ใช้ไว้อย่างชัดเจน:

```text
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/spreadsheets
https://www.googleapis.com/auth/drive
https://www.googleapis.com/auth/script.external_request
```

ครั้งแรกที่รัน setup Google จะขอให้ผู้ deploy อนุญาต identity email, Google Sheets, Google Drive และ external request ตามรายการนี้ `script.external_request` ใช้ให้ backend ดึง rotating JWKS จาก `https://www.googleapis.com/oauth2/v3/certs` เพื่อตรวจลายเซ็น ID token เท่านั้น

1. ตรวจชื่อ Apps Script project และบัญชีให้ถูกต้อง
2. เปิด **Overview > Project OAuth Scopes** แล้วเทียบให้ตรงกับสี่ scope ใน manifest ก่อนกด Allow ระบบนี้ไม่ต้องใช้ Gmail, Calendar หรือ Contacts
3. หาก Workspace Admin บล็อก scope หรือแอปภายใน ให้ส่ง Script ID และ scope ให้ Admin ตรวจ/อนุมัติ อย่าข้าม policy ด้วยบัญชีภายนอก
4. เมื่อ source รุ่นใหม่เพิ่ม Google service ให้รัน function จาก editor อีกครั้งเพื่อ re-authorize ก่อนปล่อย version

บัญชีผู้ deploy ต้องคงสิทธิ์ Editor ของ Sheet และ Drive folder ตลอดอายุ deployment เพราะทุก RPC ทำงานภายใต้สิทธิ์บัญชีนี้

## 9. Deploy Web App

1. กด **Deploy > New deployment**
2. ที่ **Select type** เลือก **Web app**
3. Description ใช้ข้อความที่ตรวจย้อนหลังได้ เช่น `v0.2.0 external identity rollout`
4. ตั้ง **Execute as** เป็น **Me** หรือบัญชีผู้ deploy (`USER_DEPLOYING`)
5. ตั้ง **Who has access** เป็น **Anyone** (`ANYONE`) ซึ่งใน Apps Script หมายถึง Google Account ที่ลงชื่อเข้าใช้แล้ว ตรวจค่าจาก manifest/deployment record ว่าไม่ใช่ `ANYONE_ANONYMOUS`
6. กด **Deploy** และคัดลอก Web app URL ที่ลงท้ายด้วย `/exec`
7. เก็บ deployment ID, `/exec` URL, source commit, version, ผู้ deploy และวันเวลาไว้ใน change record ที่จำกัดสิทธิ์
8. เพิ่ม Script Property `WEB_APP_URL` เป็น `/exec` URL เต็ม ห้ามมี query string, fragment หรือ `/dev`
9. รัน `setupSystem_()` ซ้ำ แล้วตรวจว่าไม่มี warning เรื่อง Web app URL
10. เปิด `/exec` ด้วย Admin และตรวจว่า QR ในหน้า Equipment Detail สร้าง URL origin/path เดียวกับ deployment

URL `/dev` จาก **Test deployments** เปิดได้เฉพาะผู้มีสิทธิ์แก้ script และใช้ code ล่าสุด จึงใช้ตรวจระหว่างพัฒนาเท่านั้น ห้ามแจกเป็น production URL

### Server-side OAuth pilot ที่ต้องผ่านก่อนเปิดใช้

คง production version เดิมไว้ สร้าง versioned pilot deployment ของโค้ดใหม่แบบ `USER_DEPLOYING` + `ANYONE_ANONYMOUS` แล้วทดสอบผ่าน URL `/exec` ไม่ใช่ `/dev` การเปิด anonymous นี้อนุญาตให้โหลด app shell เท่านั้น ไม่ได้สร้าง application session หรือให้สิทธิ์เรียก business RPC ให้ YRU Admin เดิมลงชื่อเข้าใช้และเพิ่ม Gmail test account เป็น Users row ที่ `ACTIVE` ก่อนทดสอบบัญชีนั้น

Browser สร้าง poll/session secrets ด้วย Web Crypto เก็บใน memory เท่านั้น และส่ง hashes ไปเริ่ม flow Server ใช้ opaque one-time server-side state, nonce, PKCE S256 และ callback แบบ one-time แลก code ผ่าน POST แล้วตรวจ RS256/JWKS, issuer, audience/azp, expiry/iat/nbf, nonce และ verified email ก่อนตรวจ Users row Callback ไม่ส่ง ID/access/session token ใน URL; browser poll ผลและใช้ opaque session ใน RPC body

Session ใช้ shared ScriptCache ที่แยก record ด้วย hash ของ secret ไม่ใช้ deployer UserProperties/UserCache ไม่เก็บ role ไว้เป็นสิทธิ์ถาวร ทุก RPC อ่านสิทธิ์จาก Users ใหม่ Browser เก็บเฉพาะ opaque application token + expiry ใน `sessionStorage` หรือ `localStorage` เมื่อผู้ใช้ opt in; ห้ามเก็บ Google token/email/role Cache ถูกล้าง/evict หรือ session หมดอายุ client ต้องล้าง token และแสดงหน้า login โดยไม่เปิด OAuth popup อัตโนมัติ

**Pilot anonymous-access binding:** Runtime evidence วันที่ 2026-09-24 แสดงว่า `Session.getTemporaryActiveUserKey()` ว่างใน RPC ของผู้เข้าชมแบบ anonymous จึงห้ามใช้ค่านี้เป็นเงื่อนไขเริ่ม flow, polling หรือระบุตัวตนผู้ใช้ ระบบผูก flow กับ hash ของ browser-held poll proof และ session proof แบบสุ่มแยกกัน; callback ใช้ one-time state และ session จะ active หลังตรวจ OTP พร้อม proofs ทั้งคู่เท่านั้น ทุก business RPC ยังต้องมี opaque session token ที่ตรงกับ server-side hash แล้วอ่าน Users row, `ACTIVE`, domain และ Role ปัจจุบันซ้ำ ห้ามใช้ `Session.getActiveUser()`/`getEffectiveUser()` เป็น visitor identity การตั้ง `ANYONE_ANONYMOUS` มีผลเฉพาะ Pilot; Production deployment คง access/version เดิมจนกว่าจะผ่าน acceptance และอนุมัติ promotion

ทดสอบ browser profiles แยกกันทั้ง YRU/Gmail: sign in, sign out, refresh, session expiry, popup ถูกบล็อก/ปิด, consent denied, user ไม่มี row/Inactive และ User เรียก Admin RPC ต้องถูกปฏิเสธ ลองนำ authorization URL ของคน A ไปเปิดใน profile B ต้องไม่ให้ A รับ session ของ B ตรวจ callback ซ้ำและ state ผิดต้องถูกปฏิเสธด้วย

หากไม่ผ่าน ให้ตรวจ:
1. `redirect_uri_mismatch`: exact redirect URI ต้องใช้ Pilot deployment ID และลงท้าย `/exec`
2. `invalid_client`: Client ID/secret ต้องมาจาก Web client เดียวกัน และ secret ยังใช้งานได้
3. `access_denied`: ตรวจ External audience, Test users และ Workspace third-party app policy
4. `UNAUTHENTICATED`: ตรวจ callback/channel binding, อายุ flow/session และ server config ห้ามลด validation
5. ตรวจ Executions ด้วย requestId แต่ห้ามบันทึก/ส่ง token, code, state, session หรือ secret ใน log/chat

เมื่อ pilot ผ่านจึงแก้ deployment production เดิมให้ชี้ version ใหม่เพื่อรักษา URL/QR แล้ว smoke test และ archive pilot ไม่เปลี่ยนเป็น `ANYONE_ANONYMOUS` หรือ execute-as-user เพื่อแก้ข้อผิดพลาด

## 10. ทดสอบ User

ใช้บัญชี User จริงที่ Admin เพิ่มเป็น `USER` และ `ACTIVE`; ค่าเริ่มต้น `AUTO_PROVISION_USERS=false` จะปฏิเสธบัญชีที่ยังไม่มี row

1. เปิด `/exec` และตรวจชื่อ/อีเมลในหน้า Account
2. ตรวจว่าไม่เห็นเมนู Admin และเปิด `?view=admin` แล้วไม่ได้สิทธิ์
3. เปิด Dashboard, ค้นหา/กรอง/เรียงอุปกรณ์ และดูทั้ง Card/Table
4. เปิด Equipment Detail และ Included Items
5. Scan QR หรือกรอก Asset ID ด้วยมือ ต้องเปิด asset ที่ตรงกันโดยไม่ทำ mutation
6. ขอยืม asset ที่ `AVAILABLE`; ตรวจสถานะ `PENDING_APPROVAL` ใน My Borrow
7. ให้บัญชี User ทดสอบคนที่สองลองขอ asset เดิม ต้องถูกปฏิเสธและไม่เกิด double booking
8. หลัง Admin checkout ตรวจว่า User เห็นสถานะกำลังยืมและ due date
9. กดแจ้งคืน ตรวจว่าสถานะเป็นรอคืนและไม่สามารถแจ้งซ้ำ
10. ตรวจ personal history และข้อความ Thai success/error/loading บน desktop และโทรศัพท์

ทดสอบ unknown same-domain, inactive, external-domain และ signed-out identity เพิ่มตาม matrix ทุกกรณีต้อง fail closed โดยไม่มีข้อมูลหรือ mutation รั่วไหล

## 11. ทดสอบ Admin

1. เปิด Dashboard และเทียบจำนวน Total, Available, Pending, Borrowed, Overdue, Damaged, Maintenance และ Lost กับข้อมูลใน Sheet
2. สร้าง/แก้ category และตรวจ unique name/prefix/status
3. เพิ่ม User, เปลี่ยน role/status และยืนยันว่า User ปกติเรียก admin action ไม่ได้
4. เพิ่ม Equipment พร้อม Included Items; ตรวจ Asset ID อัตโนมัติและ duplicate serial validation
5. อัปโหลด/เปลี่ยนรูป JPEG, PNG หรือ WebP แล้วเปิด URL จาก Workspace, Gmail และ signed-out profile ผลต้องตรงกับ policy ที่อนุมัติ: `DOMAIN_WITH_LINK` กัน Gmail/signed-out ส่วน `ANYONE_WITH_LINK` ยอมให้ผู้ถือ URL ทุกคนดูได้
6. Download QR sticker, พิมพ์และ scan ด้วย Android/iOS; QR ต้องเปิด exact Equipment Detail และไม่ trigger action
7. ทำ lifecycle `request → approve → checkout → return request → inspected return`
8. ตรวจ Included Items ทุกชิ้นและทดสอบ normal/damaged/maintenance/lost disposition ตามกติกา
9. ตรวจ History ว่ามีหนึ่งรายการต่อ command และ old/new status ถูกต้อง
10. เปิด Integrity audit ต้องไม่มี Error สำหรับข้อมูลที่ปกติ
11. ตรวจ Operations ที่ `STARTED`; กู้คืนหรือ abort เฉพาะกรณีที่หน้า Admin แสดงว่าปลอดภัย ห้ามแก้ row เอง
12. ตรวจ responsive ที่ความกว้าง 320, 768 และ 1440 pixels รวม keyboard/focus/dialog

บันทึก PASS/FAIL, ผู้ทดสอบ, วันเวลา, browser/device และหลักฐานที่ไม่เปิดเผย Sheet/Drive ID สู่สาธารณะใน [Deployment Acceptance Matrix](../tests/MANUAL_ACCEPTANCE.md)

## เกณฑ์ Go-live

เปิดให้ผู้ใช้จริงได้เมื่อครบทุกข้อ:

- `npm run test` ผ่านทั้งหมดบน source commit เดียวกับที่ deploy
- `setupSystem_()` ครั้งล่าสุดสำเร็จ ไม่มี configuration warning และการ upload จริงยืนยัน Drive sharing policy แล้ว
- Identity pilot ยืนยัน Google ID token, verified email, Users row, status และ role ของ Workspace User, Gmail User และ Admin ได้ถูกต้อง
- User/Admin lifecycle, Drive image, QR physical scan และ responsive checks ผ่าน
- Integrity audit ไม่มี Error และ Operations ไม่มีรายการ `STARTED` ที่ไม่ทราบสาเหตุ
- User ทั่วไปไม่มี direct access ต่อ Sheet/folder ทุก role และไม่มีสิทธิ์แฝงผ่าน group/link; Apps Script Editor จำกัดเฉพาะ release operators
- เจ้าของข้อมูลเลือกและยอมรับ image boundary แล้ว: `DOMAIN_WITH_LINK` ไม่รองรับ Gmail หรือ `ANYONE_WITH_LINK` เปิดภาพแก่ผู้ถือ URL โดยไม่ผ่าน Users/token
- บัญชีผู้ deploy เป็นบัญชีองค์กรระยะยาว มี backup operator และมีแผน redeploy กรณีเจ้าของถูกปิด เพราะ versioned deployment เดิมโอน ownership โดยตรงไม่ได้
- บันทึก source commit, Apps Script version, deployment ID และ `/exec` URL ใน change record แล้ว
- ยังไม่พิมพ์ QR จำนวนมากจนกว่าจะยืนยัน URL production คงที่

## การอัปเดตโดยรักษา QR URL เดิม

1. หยุดหรือแจ้ง maintenance window สำหรับ mutation สำคัญ
2. สำรอง Sheet และรัน Integrity audit ก่อนเปลี่ยนรุ่น
3. อัปโหลด source รุ่นใหม่เข้า Apps Script project เดิมให้ครบ 46 runtime files และเทียบ inventory สองทาง ไฟล์ `.gs/.html` เก่าที่ถูกถอดจาก repository ต้องผ่าน review แล้วนำออกจาก project ด้วย เพราะไฟล์ `.gs` ที่ค้างยังเป็น global callable code ได้
4. อ่าน [MIGRATING.md](MIGRATING.md) แล้วรัน private editor function `setupSystem_()` เพื่อใช้ additive migrations
5. ที่ **Deploy > Manage deployments** เลือก deployment production เดิม แล้วกด **Edit**
6. ก่อน deploy ทุกครั้ง ตรวจ **Execute as** เป็น **Me** (`USER_DEPLOYING`) และ **Who has access** เป็น **Anyone** (`ANYONE` สำหรับบัญชี Google ที่ลงชื่อเข้าใช้แล้ว); ต้องไม่ใช่ `DOMAIN` หรือ `ANYONE_ANONYMOUS`
7. เลือก **New version**, ใส่ description ที่อ้าง source commit และกด Deploy
8. ตรวจว่า deployment ID และ `/exec` URL ไม่เปลี่ยน จากนั้นทำ smoke test Workspace User, Gmail User, Admin และ QR

อย่าสร้าง deployment production ใหม่ทุก release เพราะ URL จะเปลี่ยนและ QR sticker เดิมจะชี้ผิดที่ Version ของ Apps Script เป็น snapshot ที่แก้ไม่ได้ แต่ deployment เดิมสามารถชี้ไป version ใหม่โดยรักษา URL/ID เดิม

### Rollback

หาก release ใหม่มีปัญหา ให้ **Manage deployments > Edit** deployment เดิมแล้วเลือก version ก่อนหน้า การ rollback นี้คืนเฉพาะ code/manifest ไม่ได้ย้อนข้อมูล, migration หรือ Script Properties ซึ่งเป็นค่าร่วมที่แก้ได้ตลอด ให้เทียบและคืน property set รุ่นก่อนจาก restricted config backup หลังตรวจ compatibility เท่านั้น เนื่องจาก migrations เป็น additive ต้องอ่าน `MIGRATING.md` ก่อน rollback และห้าม restore ด้วยการลบ History, Operations หรือ SchemaMigrations

## การดูแลหลังเปิดใช้งาน

### ทุกวันหรือเมื่อมี incident

- เปิด Apps Script **Executions** แล้วกรอง `Failed` และ `Timed out`
- ตรวจ structured `console.error`/Cloud Logging ตาม `code` และ `requestId` แม้ execution แสดง `Completed` เพราะ application errors ถูกจับและคืนเป็น safe result
- ให้ผู้ใช้ส่งข้อความ error พร้อม `requestId`, เวลาโดยประมาณ, action และ Asset/Borrow ID โดยไม่ส่งข้อมูลส่วนบุคคลเกินจำเป็น
- ตรวจ Admin Integrity audit และ Operations queue ก่อนแก้ Sheet
- ตรวจ Workspace Status Dashboard หากหลายรายการล้มพร้อมกัน

### ทุกสัปดาห์และก่อน release

- ทำสำเนา Google Sheet แบบจำกัดสิทธิ์และบันทึกวันเวลา/source version
- export Script Properties เป็น restricted configuration record ผ่านกระบวนการที่ไม่เขียนค่าจริงลง Git/issue/chat และทบทวนทุกครั้งก่อน release
- ตรวจผู้มีสิทธิ์ Editor ของ Sheet, folder และ Apps Script project
- ตรวจ account ผู้ deploy ว่ายัง Active และเข้าถึงทรัพยากรได้
- ตรวจ error rate, execution duration และ quota ใน Apps Script dashboard
- ตรวจสิทธิ์/พื้นที่ของไฟล์ภาพทั้งไฟล์ปัจจุบันและไฟล์ที่ถูกแทนที่ เพราะ policy ใหม่ไม่ย้อนแก้ไฟล์เก่าและ storage สามารถสะสมได้
- ทดสอบ DR เป็นระยะ: Sheet copy, property restore, Drive retention และขั้นตอน remap file ID ใน environment แยกก่อนอ้างว่าสามารถกู้คืนได้

สำเนา Sheet เก็บข้อมูลธุรกรรมและ file IDs แต่ไม่ได้สร้างสำเนารูปที่มี ID เดิม ควรใช้ retention/backup policy ของ Google Drive เพื่อรักษา folder ต้นฉบับ หาก copy รูปเป็นไฟล์ใหม่ ID จะเปลี่ยนและต้องมีแผน reconcile reference ก่อน restore

Google เปลี่ยน quota ได้โดยไม่แจ้งล่วงหน้า อย่าฝังค่า quota ปัจจุบันไว้เป็นสมมติฐานของระบบ ให้ตรวจหน้า quota ทางการและ execution health ก่อนเพิ่มปริมาณผู้ใช้

## ข้อห้ามในการดูแลข้อมูล

- ห้ามเปลี่ยนชื่อ/ลำดับ/ลบ header ของ Sheet
- ห้ามแก้ `Sequences`, `SchemaMigrations`, `Operations` หรือ `History` ด้วยมือ
- ห้ามลบ row ของ Equipment, Borrow, Users, Categories, IncludedItems หรือ BorrowItems; ใช้ lifecycle/status และ workflow ที่ระบบให้
- ห้ามแก้ Borrow/Equipment status แยกกัน เพราะสองตารางต้อง synchronize ภายใต้ Script Lock
- warning protection ที่ setup สร้างเป็นสัญญาณเตือน ไม่ใช่ access control; สิทธิ์ Share ของ Google Sheet คือ boundary จริง
- ห้ามเผยแพร่ Script Properties, Sheet ID, Drive folder ID, deployment ID หรือ URL ภายในใน issue/public repository

## Troubleshooting แบบย่อ

| อาการ/รหัส | ตรวจสอบและแก้ไข |
|---|---|
| `UNAUTHENTICATED` / ลงชื่อเข้าใช้ไม่ผ่าน | ตรวจ Web OAuth Client ID/secret, exact redirect URI, callback state/nonce, token audience/expiry, browser-held poll/session proofs และ access ของ deployment ที่กำลังทดสอบ; ไม่ใช้ Active User เป็น visitor identity |
| `FORBIDDEN` | เพิ่ม/เปิดใช้งาน Users row หรือ role ผ่าน Admin; อย่าแก้ role จาก browser/client |
| `CONFIG_ERROR` ที่ Sheet | ตรวจ `SPREADSHEET_ID` และสิทธิ์ผู้ deploy แล้วรัน setup |
| `CONFIG_ERROR` ที่ Drive | ตรวจ `DRIVE_FOLDER_ID`, folder ไม่อยู่ Trash และสิทธิ์ผู้ deploy |
| `DRIVE_SHARING_FAILED` | ตรวจ Workspace Drive sharing policy; อย่าเปลี่ยนเป็น public โดยไม่อนุมัติ |
| QR ไม่พร้อม | ตั้ง `WEB_APP_URL` เป็น HTTPS `/exec` URL ที่ไม่มี query/fragment แล้วรัน setup ซ้ำ |
| `OPERATION_PENDING` | ใช้หน้า Admin Operations เพื่อ reconcile exact command; ห้ามลบ/แก้ journal row |
| `ID_EXHAUSTED` | หยุดสร้าง record ชนิดนั้นและออกแบบ migration ของรูปแบบ ID; ห้ามเพิ่มเลขเอง |
| quota/timeout | ตรวจ Executions และ quota ทางการ ลด burst/retry หลังประเมิน operation state |
| UI ไม่มี style/font | ตรวจ firewall ให้ browser เข้าถึง `cdn.jsdelivr.net`, `fonts.googleapis.com` และ `fonts.gstatic.com` |
| รูปไม่แสดง | ตรวจ `drive.google.com`, file sharing mode และ resource key จากบัญชี User ปกติ |

## เอกสารทางการที่ใช้อ้างอิง

- [Deploy Apps Script as a web app](https://developers.google.com/apps-script/guides/web)
- [Web app manifest access and execute-as values](https://developers.google.com/apps-script/manifest/web-app-api-executable)
- [Session and Active User identity](https://developers.google.com/apps-script/reference/base/session)
- [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server)
- [opaque one-time server-side state](https://developers.google.com/apps-script/reference/script/state-token-builder)
- [Verify a Google ID token on the backend](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)
- [Google OpenID Connect claims](https://developers.google.com/identity/openid-connect/openid-connect)
- [Apps Script HTML Service iframe restrictions](https://developers.google.com/apps-script/guides/html/restrictions)
- [Apps Script temporary active user key](https://developers.google.com/apps-script/reference/base/session)
- [Manage Script Properties](https://developers.google.com/apps-script/guides/properties)
- [Create and manage versioned deployments](https://developers.google.com/apps-script/concepts/deployments)
- [Apps Script authorization](https://developers.google.com/apps-script/guides/services/authorization)
- [Apps Script OAuth scopes](https://developers.google.com/apps-script/concepts/scopes)
- [Apps Script logging and execution errors](https://developers.google.com/apps-script/guides/logging)
- [Current Apps Script quotas and limits](https://developers.google.com/apps-script/guides/services/quotas)

## Pilot user-management update (after v4)

- Create has no `user_id` input and always invokes `adminCreateUser`. Backend rejects supplied IDs and allocates sequential `USR-000001` IDs from Sequences under ScriptLock; occupied IDs are skipped, exhausted sequences fail closed. Gaps after interruptions are safe.
- Edit displays the original ID as text and stores a frozen record snapshot; it never reads target/version from FormData. `adminListUsers` issues a server-cached, one-hour `edit_proof` bound to Admin, record ID and row version. Update requires that proof; tampered IDs and absent/expired/evicted proofs fail closed. Reload the users list if it expires. Admin reconciliation obtains a new proof from the journaled target, not browser input.
- Normalized email uniqueness includes blank-ID legacy rows. Duplicate nonempty IDs block updates. Domain, status, role and last-active-admin validation remain enabled. Keep `ALLOWED_DOMAINS=yru.ac.th,gmail.com` and `AUTO_PROVISION_USERS=false`.
- Read-only legacy audit: authenticated Admin can run `await CRS.api.adminAuditLegacyUsers()` in the Pilot app frame console. It returns `candidates` with row, old ID, email, fingerprint, repairable flag and blockers. This does not change Users data. Use the CRS frame, not the outer Apps Script page; never paste/share session tokens.
- Do NOT edit Sheet IDs manually. Back up data and establish the reference boundary first. The scanner covers all registered schema sheets, nested audit/operation JSON, ID/email references, duplicate IDs/emails and formulas. Unknown sheets, ambiguous blank IDs, invalid fields and any historical/reference match block repair. External spreadsheets, exports and third-party consumers cannot be discovered: if they exist or their absence cannot be established, do not execute repair; plan a reviewed migration instead.
- Only after reviewing a repairable candidate and confirming data isolation from Production, Admin may call `await CRS.api.adminRepairLegacyUser({row: candidate.row, fingerprint: candidate.fingerprint, confirm: true, command_id: CRS.commandId()})`. Save the command ID first and retry the same input/command, or use Admin operation reconciliation after interruption. Never supply `user_id`. Backend rechecks under lock, journals the original row before allocation, writes one exact checked row and appends `REPAIR_USER_ID` audit without rewriting old History/Operations. Investigate stale fingerprints/reference conflicts; never bypass them. Blank IDs with audit records are conservatively blocked.
- Deployments in one Apps Script project share Script Properties and may share the Sheet. Pilot-only code does NOT isolate data writes. No live repair is part of this rollout. Do not change shared properties or repair shared data as a side effect of testing.
- Acceptance: edit/cancel an existing user then create an ACTIVE Gmail USER; verify CREATE_USER (not EDIT_USER), a generated ID and exactly one normalized email row. Verify YRU/Gmail login separately, inactive rejection and USER denial of all Admin RPCs. Use approved test records; automated mocks do not establish live acceptance.
- Run `npm test`, commit and push `main`, verify Pilot `USER_DEPLOYING` + `ANYONE_ANONYMOUS`, create an immutable version, download/compare all runtime files, update only the existing Pilot deployment, and confirm Production retains its original version. Do not create a separate pre-deploy source backup. Updating an existing deployment preserves its `/exec` URL; no OAuth URI/property change is needed solely for a new version.

## Pilot callback confirmation update

Visitor OAuth returns to the exact Pilot `/exec` URL configured in `GOOGLE_OAUTH_REDIRECT_URI` (Script Properties) and the OAuth Web application's Authorized redirect URIs. Do not use `/usercallback`, StateTokenBuilder, wildcard origins, or the production URL. `doGet` routes any code/error/state request to a private callback implementation; malformed/duplicate/replayed/expired state fails closed.

Before each Pilot release, start sign-in from the Pilot URL and inspect the Google authorization request's `redirect_uri` (never record its `state`, `code`, or tokens). Look up that exact `/exec` URL in Apps Script deployments. If it is a separate callback deployment, update that deployment to the **same immutable source version** as the Pilot start deployment before asking anyone to sign in. Otherwise the callback can run an older flow/cache protocol and reject every account with “invalid, expired, or already used,” even when Google account selection succeeds. Keep its existing URL and access setting. The preferred long-term configuration is to set `GOOGLE_OAUTH_REDIRECT_URI` to the current Pilot `/exec` URL and register that exact URL on the OAuth Web client; do both together, then verify a real login. Script Properties are shared between deployments, so changing the redirect property affects all sign-in starts immediately. Do not change Production or weaken account authorization as a workaround.

Callback verifies Google identity but only stores a pending candidate, NOT an active session. It displays a six-digit numeric OTP generated from a server-keyed HMAC CSPRNG. The server stores only a flow-bound OTP HMAC, never the plaintext code; the OTP expires after five minutes, permits at most five failed submissions, is consumed immediately on success, and cannot be replayed. Confirmation still requires the OTP plus the original browser-held poll AND session proofs. Users/ACTIVE/Role are checked again at activation and on every business RPC. Never share an OTP or complete a sign-in flow started by someone else.

The callback and visitor RPCs do NOT read or compare `getTemporaryActiveUserKey()` because anonymous Apps Script executions may return an empty value. Flow ownership uses the browser-held poll proof and domain-separated session-proof hash; session activation still requires the OTP plus both proofs. No Google/session token appears in URLs. Raw callback state is hashed in cache; nonce/PKCE verifier are transient server-only cache data. Random server values use a domain-separated HMAC-SHA256 PRF keyed by the confidential OAuth client secret with UUID/time uniqueness input; protect/rotate that secret and never log it.

Deployment procedure: pass all tests, commit and push `main`, verify `USER_DEPLOYING` + `ANYONE`, upload, create an immutable version, download and compare that version, then update ONLY the existing Pilot deployment. Do not create a separate pre-deploy source backup. Production promotion requires real YRU/Gmail login, confirmation, session isolation, and authorization acceptance.
