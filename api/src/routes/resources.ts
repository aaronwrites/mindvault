import { Router } from "express";
import { createResource, listResources, getResource } from "../controllers/resources.controller";

export const resourcesRouter = Router();

resourcesRouter.post("/", createResource);
resourcesRouter.get("/", listResources);
resourcesRouter.get("/:id", getResource);