import cors from "cors";
import express from "express";
import { resourcesRouter } from "./routes/resources";
import { searchRouter } from "./routes/search";

export function createApp() {
    const app = express();
    app.use(cors());
    app.use(express.json());

    app.use("/resources", resourcesRouter);
    app.use("/search", searchRouter);
    app.get("/health", (_req, res) => res.json({ status: "ok" }));

    return app;
}
