import express from "express";
import cors from "cors";
import "dotenv/config";
import { resourcesRouter } from "./routes/resources";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/resources", resourcesRouter);

app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Server running on port ${port}`));