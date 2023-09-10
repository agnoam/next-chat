import { Request, Response, NextFunction } from 'express';

import { ResponseStatus } from "../constants/default.constants";

const ErrorMiddleware = (err: Error, req: Request, res: Response, next: NextFunction) => {
    err ? 
        res.status(ResponseStatus.BadRequest).json({ description: 'Internal error' }) 
    : next();
}

export default ErrorMiddleware;