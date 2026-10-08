import { Request, Response } from "express";

export class UserController {

    static getUsers(req: Request, res: Response){
        
        return res.status(200).json({ message: "User fetched successfully" });
    }


};