import dotenv from 'dotenv';
dotenv.config();
import express, { Request, Response } from 'express';
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { createServer } from 'http';

import connecToMongoDB from './config/connectToMongoDB';
import { ensureBucketsCreation } from './config/minio';
import './config/k8s';
import './config/redis';
import startCleanupWorker from './workers/cleanup.worker';
import startSnapshotCron from './workers/snapshot.cron';
import adminRoutes from './routes/admin.routes';
import labRoutes from './routes/lab.routes';
import fileRoutes from './routes/file.routes';
import initTerminalSocket from './socket/terminal.socket';

const PORT = process.env.PORT || 3000;

const app = express();
const httpServer = createServer(app);

const corsOpts = {
    origin: '*',
    methods: [
        'GET',
        'POST',
        'PUT',
        'DELETE',
        'PATCH',
        'OPTIONS'
    ],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Accept'
    ],
    credentials: true
};

app.use(cors(corsOpts));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));
app.use(helmet());
app.use(helmet.crossOriginResourcePolicy({ policy: "cross-origin" }));
app.use(morgan("tiny"));

app.get('/api/v1', (_req: Request, res: Response) => {
    res.send('Server Up & Running!');
});

app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/labs', labRoutes);
app.use('/api/v1/files', fileRoutes);

initTerminalSocket(httpServer);

const bootstrap = async () => {
    await connecToMongoDB();
    await ensureBucketsCreation();
    await startCleanupWorker();
    startSnapshotCron();

    httpServer.listen(PORT, () => {
        console.log(`🚀 Server is running on PORT: ${PORT}`);
    });
}

bootstrap().catch((err) => {
    console.error("[Bootstrap] Fatal:", err);
    process.exit(1);
});