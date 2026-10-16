import { Router, type IRouter } from "express";
import healthRouter from "./health";
import cartRouter from "./cart";
import ordersRouter from "./orders";
import maintenanceRouter from "./maintenance";

const router: IRouter = Router();

router.use(healthRouter);
router.use(cartRouter);
router.use(ordersRouter);
router.use(maintenanceRouter);

export default router;
