import type { NextFunction, Request, Response } from "express";

/** Encaminha erros de handlers async para o middleware de erros (Express 4). */
export const rota =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

export const sessao = (req: Request) => req.sessao!;
