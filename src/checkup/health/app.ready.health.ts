import {Request,Response} from "express"; 
import { pool } from "../../config/db/db.pool";

export class AppReadyHealthController {

    static getHealth(req:Request,res:Response){
          return  res.status(200).json({
                status: "UP",
                service: "shipsense-api"
            });
    }

   static async isReady(req:Request,res:Response){
        try{
            await pool.query("SELECT 1");
            res.status(200).json({
            status: "READY",
            database: "CONNECTED"
            });
        }catch(error){
             res.status(503).json({
                status: "NOT_READY",
            database: "UNAVAILABLE"
            });
        }
    }
}