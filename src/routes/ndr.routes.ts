import { Router } from "express";
import { ndrController } from "../controllers/ndr/ndr.controller";

const router = Router();

router.post(
  "/:awb/response",
  ndrController.submitCustomerResponse.bind(ndrController),
);

export default router;