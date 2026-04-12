# E-Audit Platform - Specification Document

## 1. Project Overview

**Project Name:** E-Audit Platform (AI-Powered Technical Assessment)
**Project Type:** Full-stack Web Application
**Core Functionality:** Automated IT knowledge assessment with AI-powered grading and behavior monitoring
**Target Users:** Admins/Trainers (assessment creators), Students (test takers)

---

## 2. Tech Stack

### Backend
- **Runtime:** Node.js v18+
- **Framework:** Express.js with TypeScript
- **Database:** 
  - **Development:** SQLite with better-sqlite3 (set `USE_SQLITE=true`)
  - **Production:** PostgreSQL (Supabase or any PostgreSQL provider)
- **Queue:** Database-backed queue (no Redis needed)
- **AI:** Google Gemini API (replacing LLama)

### Frontend
- **Framework:** React 18 with TypeScript
- **Build Tool:** Vite
- **UI:** Custom CSS + Headless UI components
- **HTTP Client:** Axios

---

## 3. Database Schema

### Tables

#### `question_bank`
| Column | Type | Description |
|--------|------|-------------|
| id | VARCHAR(50) PK | Unique ID (e.g., DB-E-01) |
| type | ENUM | 'Coding', 'Conceptual' |
| level | ENUM | 'Easy', 'Medium', 'Hard' |
| module | VARCHAR(100) | Module name |
| question_sample | TEXT | Question content |
| rubric_must_have | TEXT | 70% criteria |
| rubric_nice_to_have | TEXT | 20% criteria |
| rubric_optional | TEXT | 10% criteria |
| created_at | DATETIME | Creation timestamp |
| updated_at | DATETIME | Update timestamp |

#### `batches`
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK AUTO | Batch ID |
| name | VARCHAR(100) | Batch name |
| start_time | DATETIME | Exam start time |
| end_time | DATETIME | Exam end time |
| duration | INTEGER | Duration in minutes |
| blueprint | TEXT | JSON blueprint config |
| status | ENUM | 'draft', 'active', 'closed' |
| created_at | DATETIME | Creation timestamp |

#### `students`
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK AUTO | Student ID |
| batch_id | INTEGER FK | Reference to batch |
| email | VARCHAR(255) | Student email |
| access_code | VARCHAR(6) | 6-char access code |
| status | ENUM | 'pending', 'in_progress', 'submitted' |
| created_at | DATETIME | Creation timestamp |

#### `exam_questions`
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK AUTO | ID |
| student_id | INTEGER FK | Reference to student |
| question_id | VARCHAR(50) FK | Reference to question_bank |
| question_order | INTEGER | Order in exam |
| answer | TEXT | Student's answer |
| ai_score | FLOAT | AI evaluation score |
| ai_feedback | TEXT | AI feedback text |
| trainer_score | FLOAT | Trainer override score |
| trainer_feedback | TEXT | Trainer feedback |
| created_at | DATETIME | Creation timestamp |

#### `violations`
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK AUTO | ID |
| student_id | INTEGER FK | Reference to student |
| type | VARCHAR(50) | Violation type |
| count | INTEGER | Violation count |
| created_at | DATETIME | Timestamp |

---

## 4. API Endpoints

### Admin APIs

#### Question Bank
- `POST /api/admin/questions/import` - Import from Excel
- `GET /api/admin/questions` - List all questions
- `GET /api/admin/questions/modules` - Get unique modules
- `DELETE /api/admin/questions/:id` - Delete question

#### Batch Management
- `POST /api/admin/batches` - Create batch with blueprint
- `GET /api/admin/batches` - List batches
- `GET /api/admin/batches/:id` - Get batch details
- `PUT /api/admin/batches/:id` - Update batch
- `POST /api/admin/batches/:id/check-feasibility` - Check question availability
- `DELETE /api/admin/batches/:id` - Delete batch

#### Student Management
- `POST /api/admin/batches/:id/students/import` - Import emails
- `GET /api/admin/batches/:id/students` - List students
- `GET /api/admin/batches/:id/students/export` - Export student list

#### Results & Reports
- `GET /api/admin/batches/:id/results` - Get all results
- `GET /api/admin/batches/:id/results/export` - Export to Excel
- `PUT /api/admin/results/:studentId` - Update trainer score/feedback

### Student APIs

#### Authentication
- `POST /api/student/verify` - Verify access code and batch time
- `POST /api/student/select-email` - Select email from code

#### Exam
- `POST /api/student/exam/start` - Start exam (randomize questions)
- `GET /api/student/exam/questions` - Get questions
- `POST /api/student/exam/answer` - Save answer (cached, no immediate DB write)
- `POST /api/student/exam/flush` - Force flush cached answers to DB
- `POST /api/student/exam/submit` - Submit exam (flushes cache + queues AI grading)

#### Violations
- `POST /api/student/violation` - Report violation (fullscreen exit, tab switch)

#### Cache & Queue
- `GET /api/queue/stats` - Get queue statistics
- `GET /api/queue/process` - Manually process queue
- `POST /api/cache/flush` - Force flush all cached answers
- `GET /api/stats` - Get overall system stats

---

## 5. Performance Optimizations

### Answer Caching
- **In-memory cache** for autosave answers
- **Batch writes** to database every 5 seconds (configurable via `ANSWER_FLUSH_INTERVAL`)
- **99.7% reduction** in DB writes for autosave (300 writes → 1 write)

### AI Queue Processing
- **File-based queue** persisted to `data/ai-queue.json`
- **Periodic processing** every 10 seconds (configurable via `QUEUE_PROCESS_INTERVAL`)
- **Parallel processing** of multiple AI grading jobs
- **Automatic retry** with 3 attempts per job

### Connection Pooling
- **SQLite:** WAL mode for concurrent reads
- **PostgreSQL:** Connection pooling (min: 2, max: 10)

---

## 6. AI Engine (Gemini)

### Configuration
- **Model:** gemini-2.0-flash
- **Timeout:** 60 seconds per question
- **Retry:** 3 times on JSON parse error
- **Fallback:** score = 0.0, feedback = "AI Evaluation Failed"

### Prompt Template
```
You are an expert technical interviewer. Evaluate the following answer based on the rubric.

Question: {question}
Answer: {answer}

Rubric Must-have (70%): {must_have}
Rubric Nice-to-have (20%): {nice_to_have}
Rubric Optional (10%): {optional}

Provide a JSON response:
{
  "score": <0-10>,
  "feedback": "<detailed feedback>"
}
```

---

## 7. Frontend Pages

### Admin Pages
1. **Dashboard** - Overview of batches and stats
2. **Question Bank** - Import Excel, view questions
3. **Batch Management** - Create batch with matrix config
4. **Student Management** - Import emails, export codes
5. **Results** - View results, trainer override, export

### Student Pages
1. **Login** - Enter access code
2. **Email Selection** - Select email from list
3. **Exam** - Fullscreen exam interface with timer
4. **Submit** - Thank you page

---

## 8. Acceptance Criteria

1. **Feasibility Check:** Cannot create batch with blueprint requiring more questions than available
2. **Randomization:** Each student gets different questions based on blueprint
3. **Trainer Override:** Export uses trainer score if provided
4. **Queue:** System handles concurrent submissions without 504 errors
5. **Violations:** Lock exam after 2 violations
6. **Fullscreen:** Enforce fullscreen during exam
7. **Performance:** Supports 20-30 concurrent users with caching (99.7% reduction in DB writes)