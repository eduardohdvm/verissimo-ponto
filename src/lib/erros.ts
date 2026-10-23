export class ErroHttp extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const naoEncontrado = (o = "Registro") => new ErroHttp(404, `${o} não encontrado`);
