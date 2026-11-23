import { Router } from "express";
import { registerOrderRoutes } from "../controllers/order.controller.js";
const router = Router();
registerOrderRoutes(router);
export default router;
