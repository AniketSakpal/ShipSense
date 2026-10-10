import app from "./app";
import { testDatabaseConnection, pool } from "./config/db/db.pool";
import {startWebhookProcessor} from "./workers/webhook-processor.worker";
import {startNotificationOutboxWorker} from "./workers/notification-outbox.worker";
import dotenv from "dotenv";
dotenv.config();


async function startServer(): Promise<void> {
    try{
        await testDatabaseConnection();
        const port = Number(process.env.PORT || 3000);
        app.listen(port, () => {
            console.log(`Server running on port ${port}`);
            void startWebhookProcessor();
            void startNotificationOutboxWorker();
        });
    }catch(error){
        console.error("Failed to start application:", error);
        await pool.end();
        process.exitCode = 1;
    }

}

void startServer();