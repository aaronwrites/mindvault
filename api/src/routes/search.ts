import { Router } from "express";
import { searchResources } from "../controllers/search.controller";

export const searchRouter = Router();

searchRouter.get("/", searchResources);
