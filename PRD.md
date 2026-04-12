# PRODUCT REQUIREMENT DOCUMENT (PRD)

## E-Audit Platform (AI-Powered Technical Assessment Platform)

**Version:** 1.1  
**Last Updated:** 2026-04-12  
**Project:** e-audit-platform

---

## 1. Project Overview

### 1.1 Definition

E-Audit Platform là hệ thống tự động hóa quy trình phỏng vấn/kiểm tra kiến thức IT bằng hình thức thi tự luận trực tuyến, có giám sát hành vi và chấm điểm tự động bởi AI.

### 1.2 Target Users

| Role | Description |
|------|------------|
| **Admin/Trainer** | Người tạo đề, quản lý thí sinh, xem báo cáo, phúc khảo |
| **Student** | Người làm bài thi |

### 1.3 MVP Constraints

- **Số câu hỏi mỗi bài thi:** Cố định 10 câu
- **Thời gian làm bài:** Configurable per Batch (mặc định 30 phút)
- **Số lượng thí sinh tối đa/Batch:** 50

---

## 2. Tech Stack

### 2.1 Backend

| Component | Technology |
|----------|-----------|
| Runtime | Node.js v18+ |
| Framework | Express.js with TypeScript |
| Database (Dev) | SQLite with `better-sqlite3` |
| Database (Prod) | PostgreSQL (Supabase) |
| Queue | File-based (no Redis) |
| AI | Google Gemini API, OpenAI, Groq, DeepSeek, Ollama |
| File Processing | `xlsx` (Excel), `multer` |

### 2.2 Frontend

| Component | Technology |
|----------|-----------|
| Framework | React 18 with TypeScript |
| Build Tool | Vite |
| HTTP Client | Axios |
| UI | Custom CSS + Headless UI |

---

## 3. Functional Requirements

### 3.1 Admin Features

#### 3.1.1 Question Bank Management

- **Import Excel:** Upload file Excel để import/update câu hỏi
- **Excel Format:**

| Column | Type | Description |
|--------|------|-------------|
| ID | String | Khóa chính (e.g., DB-E-01) |
| Type | Enum | `Coding`, `Conceptual` |
| Level | Enum | `Easy`, `Medium`, `Hard` |
| Module | String | Topic/Module name |
| Question Sample | Text | Nội dung câu hỏi |
| Rubric Must-have | Text | Tiêu chí 70% |
| Rubric Nice-to-have | Text | Tiêu chí 20% |
| Rubric Optional | Text | Tiêu chí 10% |

- **Logic:**
  - ID trùng → Update toàn bộ nội dung
  - Module được normalize Unicode
  - Invalid Level/Type → Báo lỗi dòng đó

#### 3.1.2 Batch Management

- **Create Batch:**
  - Tên Batch
  - Start Time, End Time
  - Duration (phút)
  - **Blueprint Config** (Ma trận đề thi)

- **Blueprint JSON Structure:**
```json
{
  "blueprint": [
    { "module": "Database", "easy": 1, "medium": 1, "hard": 0 },
    { "module": "Java Core", "easy": 2, "medium": 1, "hard": 1 }
  ],
  "total_questions": 10
}
```

- **Feasibility Check:** Kiểm tra đủ câu hỏi trong Question Bank trước khi tạo Batch

#### 3.1.3 Student Management

- **Import Emails:** Textarea, mỗi dòng 1 email
- **Generate Code:** Sinh Access Code 6 ký tự ngẫu nhiên (Uppercase + Số)
- **Export Excel:** Tải file chứa Email và Code

#### 3.1.4 Results & Reports

- **View Online:**
  - Biểu đồ phân phối điểm
  - Chi tiết từng câu hỏi của học viên
  - AI Score, AI Feedback
  - Trainer Score, Trainer Feedback (override)

- **Export Excel:** Multiple sheets (1 sheet = 1 student)

#### 3.1.5 AI Settings

- **Config Providers:** Gemini, OpenAI, Azure, Groq, DeepSeek, Ollama, OpenRouter
- **Test Connection:** Kiểm tra API hoạt động

### 3.2 Student Features

#### 3.2.1 Authentication

1. Nhập Access Code 6 ký tự
2. Kiểm tra Batch time (Start ≤ Now ≤ End)
3. Chọn Email từ danh sách

#### 3.2.2 Exam Interface

- **Auto Fullscreen:** Yêu cầu fullscreen khi vào
- **One-by-One View:** Hiển thị 1 câu, có Prev/Next
- **Autosave:** Debounce 2 giây, buffer answers
- **Timer:** Đếm ngược, auto submit khi hết giờ

#### 3.2.3 Anti-Cheating

| Violation | Action |
|----------|-------|
| Violation 1 | Cảnh báo đỏ, không chặn |
| Violation 2 | Lock exam, auto submit |

- **Violation Types:** `fullscreen_exit`, `tab_switch`

#### 3.2.4 Submit

- **Frontend:** "Cảm ơn, bài thi đã được ghi nhận..."
- **Backend:**
  1. Update status = 'submitted'
  2. Flush cached answers to DB
  3. Add jobs to AI queue

---

## 4. Database Schema

### 4.1 Tables

#### question_bank

| Column | Type | Constraints |
|--------|------|------------|
| id | VARCHAR(50) | PRIMARY KEY |
| type | TEXT | CHECK IN ('Coding', 'Conceptual') |
| level | TEXT | CHECK IN ('Easy', 'Medium', 'Hard') |
| module | TEXT | NOT NULL |
| question_sample | TEXT | NOT NULL |
| rubric_must_have | TEXT | NOT NULL |
| rubric_nice_to_have | TEXT | NOT NULL |
| rubric_optional | TEXT | NOT NULL |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |
| updated_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

#### batches

| Column | Type | Constraints |
|--------|------|------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT |
| name | TEXT | NOT NULL |
| start_time | TIMESTAMP | NOT NULL |
| end_time | TIMESTAMP | NOT NULL |
| duration | INTEGER | NOT NULL |
| blueprint | JSONB/TEXT | |
| status | TEXT | DEFAULT 'draft' |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

#### students

| Column | Type | Constraints |
|--------|------|------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT |
| batch_id | INTEGER | FOREIGN KEY → batches(id) |
| email | TEXT | NOT NULL |
| access_code | VARCHAR(6) | NOT NULL |
| status | TEXT | DEFAULT 'pending' |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

#### exam_questions

| Column | Type | Constraints |
|--------|------|------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT |
| student_id | INTEGER | FOREIGN KEY → students(id) |
| question_id | VARCHAR(50) | FOREIGN KEY → question_bank(id) |
| question_order | INTEGER | NOT NULL |
| answer | TEXT | |
| ai_score | FLOAT | |
| ai_feedback | TEXT | |
| trainer_score | FLOAT | |
| trainer_feedback | TEXT | |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

#### violations

| Column | Type | Constraints |
|--------|------|------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT |
| student_id | INTEGER | FOREIGN KEY → students(id) |
| type | TEXT | NOT NULL |
| count | INTEGER | DEFAULT 0 |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

#### ai_queue

| Column | Type | Constraints |
|--------|------|------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT |
| exam_question_id | INTEGER | FOREIGN KEY → exam_questions(id) |
| student_id | INTEGER | FOREIGN KEY → students(id) |
| status | TEXT | DEFAULT 'pending' |
| attempts | INTEGER | DEFAULT 0 |
| error_message | TEXT | |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |
| updated_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

#### ai_settings

| Column | Type | Constraints |
|--------|------|------------|
| id | INTEGER | PRIMARY KEY |
| provider | TEXT | NOT NULL |
| apiKey | TEXT | |
| model | TEXT | NOT NULL |
| temperature | REAL | DEFAULT 0.3 |
| maxTokens | INTEGER | DEFAULT 2048 |

---

## 5. API Endpoints

### 5.1 Admin APIs

#### Question Bank
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/admin/questions/import | Import từ Excel |
| GET | /api/admin/questions | List all questions |
| GET | /api/admin/questions/modules | Get unique modules |
| DELETE | /api/admin/questions/:id | Delete question |

#### Batch Management
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/admin/batches | Create batch with blueprint |
| GET | /api/admin/batches | List batches |
| GET | /api/admin/batches/:id | Get batch details |
| PUT | /api/admin/batches/:id | Update batch |
| DELETE | /api/admin/batches/:id | Delete batch |
| POST | /api/admin/batches/:id/check-feasibility | Check question availability |

#### Student Management
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/admin/batches/:id/students/import | Import emails |
| GET | /api/admin/batches/:id/students | List students |
| GET | /api/admin/batches/:id/students/export | Export Excel |

#### Results
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/admin/batches/:id/results | Get all results |
| GET | /api/admin/batches/:id/results/export | Export Excel |
| PUT | /api/admin/results/:studentId | Trainer override |

#### Settings
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/admin/settings/ai | Get AI settings |
| POST | /api/admin/settings/ai | Save AI settings |
| POST | /api/admin/settings/ai/test | Test AI connection |

### 5.2 Student APIs

#### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/student/verify | Verify access code |
| POST | /api/student/select-email | Select email |

#### Exam
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/student/exam/start | Start exam (randomize) |
| GET | /api/student/exam/questions | Get questions |
| POST | /api/student/exam/answer | Save answer (cache) |
| POST | /api/student/exam/flush | Flush cached answers |
| POST | /api/student/exam/submit | Submit exam |

#### Violations
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/student/violation | Report violation |

### 5.3 System APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/health | Health check |
| GET | /api/queue/process | Process queue manual |
| GET | /api/queue/stats | Queue statistics |
| POST | /api/cache/flush | Flush answers |
| GET | /api/stats | System stats |

---

## 6. Frontend Pages

### 6.1 Admin Pages

| Route | Page | Description |
|-------|------|-------------|
| /admin | Login | Admin login |
| /admin/dashboard | Dashboard | Overview |
| /admin/questions | Question Bank | Import/view questions |
| /admin/batches | Batch Management | Create/configure batches |
| /admin/batches/:id/students | Student Management | Import/export students |
| /admin/batches/:id/results | Results | View/export results |
| /admin/settings | AI Settings | Configure AI providers |

### 6.2 Student Pages

| Route | Page | Description |
|-------|------|-------------|
| / | Login | Enter access code |
| /exam | Exam | Full exam interface |
| /submit | Submit | Thank you page |

---

## 7. Performance Optimizations

### 7.1 Answer Caching

- **In-memory buffer** cho autosave
- **Batch write** mỗi 5 giây (configurable via `ANSWER_FLUSH_INTERVAL`)
- **Giảm 99.7%** số lần ghi DB

### 7.2 AI Queue Processing

- **File-based queue** tại `data/ai-queue.json`
- **Periodic processing** mỗi 10 giây (configurable via `QUEUE_PROCESS_INTERVAL`)
- **Parallel processing** nhiều jobs
- **Auto retry** 3 lần/job

### 7.3 Database

- **SQLite:** WAL mode cho concurrent reads
- **PostgreSQL:** Connection pooling (min: 2, max: 10)

---

## 8. AI Engine

### 8.1 Supported Providers

| Provider | Model Default | Package |
|----------|-------------|--------|
| Gemini | gemini-2.0-flash | @google/generative-ai |
| OpenAI | gpt-4o-mini | openai |
| Azure | deployment name | openai |
| Groq | llama-3.1-70b-versatile | groq |
| DeepSeek | deepseek-chat | openai |
| Ollama | llama3 | fetch |
| OpenRouter | any model | openai |

### 8.2 Evaluation Prompt Template

```
You are an expert technical interviewer. Evaluate the following answer based on the rubric.

Question: {question}
Answer: {answer}

Rubric Must-have (70%): {must_have}
Rubric Nice-to-have (20%): {nice_to_have}
Rubric Optional (10%): {optional}

Provide a JSON response with "score" (0-10) and "feedback" (detailed feedback):
```

### 8.3 Config

| Parameter | Default |
|-----------|---------|
| Timeout | 60 giây |
| Retry | 3 lần |
| Fallback Score | 0.0 |
| Fallback Feedback | "AI Evaluation Failed" |

---

## 9. Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|-------|
| NFR-01 | Concurrency | 30 concurrent connections |
| NFR-02 | Queue Throughput | 5 submissions/phút |
| NFR-03 | Data Validation | Nghiêm ngặt từ Excel |
| NFR-04 | Security | Access code encrypted, API protection |

---

## 10. Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3001 | Server port |
| NODE_ENV | development | Env mode |
| DATABASE_URL | - | PostgreSQL connection |
| USE_SQLITE | true | Use SQLite (dev) |
| GEMINI_API_KEY | - | Gemini API key |
| SESSION_SECRET | - | Session secret |
| ANSWER_FLUSH_INTERVAL | 5000 | Cache flush (ms) |
| QUEUE_PROCESS_INTERVAL | 10000 | Queue process (ms) |

---

## 11. Acceptance Criteria

### 11.1 Feasibility Check

- Admin tạo Batch, nhập 4 câu Java Hard nhưng DB chỉ có 3 → Hệ thống báo lỗi "Không đủ câu hỏi"

### 11.2 Randomization

- Mỗi học viên nhận câu hỏi khác nhau dựa trên blueprint

### 11.3 Trainer Override

- AI chấm 7.0, Trainer sửa thành 8.5 → Export Excel hiển thị 8.5

### 11.4 Queue

- 10 người cùng submit → Không báo lỗi 504

### 11.5 Violations

- Sau 2 violations → Lock exam tự động

### 11.6 Fullscreen

- Yêu cầu fullscreen khi vào exam

### 11.7 Performance

- Hỗ trợ 20-30 concurrent users với caching

---

## 12. Project Structure

```
/home/ast/Workspace_OpenCode
├── src/
│   ├── server/
│   │   ├── index.ts          # Express app entry
│   │   ├── server.ts       # HTTP server
│   │   ├── db/
│   │   │   └── postgres.ts  # Database layer
│   │   ├── routes/
│   │   │   ├── admin.ts    # Admin APIs
│   │   │   └── student.ts # Student APIs
│   │   └── cache.ts        # File cache & queue
│   ├── ai/
│   │   └── queue.ts       # AI queue worker
│   └── utils/
│       └── string.ts     # Utilities
├── client/
│   └── src/
│       ├── App.tsx            # Router
│       ├── pages/               # Page components
│       └── services/
│           └── api.ts       # API client
├── data/                     # SQLite DB, queue file
├── public/                   # Static assets
├── package.json
└── .env
```

---

## 13. Dependencies

### Production Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| express | ^4.18.2 | Web framework |
| better-sqlite3 | ^12.8.0 | SQLite driver |
| pg | ^8.11.3 | PostgreSQL driver |
| @google/generative-ai | ^0.2.1 | Gemini AI |
| openai | ^6.34.0 | OpenAI client |
| groq | ^5.20.0 | Groq client |
| xlsx | ^0.18.5 | Excel processing |
| multer | ^1.4.5-lts.1 | File upload |
| express-session | ^1.17.3 | Session |
| express-rate-limit | ^7.1.5 | Rate limiting |
| cors | ^2.8.5 | CORS |
| dotenv | ^16.3.1 | Environment |
| uuid | ^9.0.0 | UUID |

### Dev Dependencies

| Package | Version |
|---------|---------|
| typescript | ^5.3.3 |
| tsx | ^4.7.0 |
| @types/* | latest |

---

**Document End**

*Generated from source code analysis on 2026-04-12*