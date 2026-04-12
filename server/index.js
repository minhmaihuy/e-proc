"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const express_session_1 = __importDefault(require("express-session"));
const dotenv_1 = __importDefault(require("dotenv"));
const postgres_js_1 = require("./db/postgres.js");
const admin_js_1 = __importDefault(require("./routes/admin.js"));
const student_js_1 = __importDefault(require("./routes/student.js"));
const queue_js_1 = require("../ai/queue.js");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
dotenv_1.default.config();
const app = (0, express_1.default)();
app.use((0, cors_1.default)({
    origin: true,
    credentials: true
}));
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '10mb' }));
const limiter = (0, express_rate_limit_1.default)({
    windowMs: 60000,
    max: 100,
    message: { error: 'Too many requests, please try again later' }
});
app.use(limiter);
app.use((0, express_session_1.default)({
    secret: process.env.SESSION_SECRET || 'e-audit-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: true,
        sameSite: 'lax'
    }
}));
app.use('/api/admin', admin_js_1.default);
app.use('/api/student', student_js_1.default);
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});
app.get('/api/queue/process', async (req, res) => {
    try {
        const processed = await (0, queue_js_1.processQueue)(10);
        res.json({ processed, timestamp: new Date().toISOString() });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.get('/api/queue/stats', async (req, res) => {
    try {
        const { getQueueStats } = await Promise.resolve().then(() => __importStar(require('../ai/queue.js')));
        const stats = await getQueueStats();
        res.json(stats);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
(0, postgres_js_1.initDatabase)().then(() => {
    console.log('Database initialized');
    (0, queue_js_1.processQueue)(5).then(() => {
        console.log('Initial queue processed');
    });
}).catch(err => {
    console.error('Init error:', err);
});
exports.default = app;
//# sourceMappingURL=index.js.map