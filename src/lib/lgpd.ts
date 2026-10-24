// Termo de ciência e consentimento (LGPD) mostrado ao funcionário antes do primeiro registro.
// Ao mudar o texto, mude a VERSAO: todos precisarão aceitar de novo.
export const VERSAO_TERMO = "2026-10";

export function textoTermo(empresa: string): string[] {
  return [
    `Para registrar o ponto, a ${empresa} (empregadora) coleta e trata os seguintes dados pessoais seus:`,
    "• data e hora de cada marcação, aparelho e endereço de rede (IP);",
    "• localização do aparelho no momento da marcação (quando exigida pela empresa);",
    "• foto do rosto no momento da marcação e, quando o reconhecimento facial estiver ativo, um código matemático do seu rosto (dado biométrico, considerado sensível pela LGPD).",
    "Finalidade: controle de jornada exigido pela CLT (art. 74) e pela Portaria MTP 671/2021, prevenção de fraudes e cálculo da folha de pagamento.",
    "Base legal: cumprimento de obrigação legal (LGPD art. 7º, II) para as marcações; para a biometria facial, o tratamento é necessário para a prevenção à fraude e segurança na identificação (LGPD art. 11, II, g).",
    "As fotos são guardadas pelo prazo definido pela empresa e depois apagadas; as marcações são mantidas pelo prazo legal (5 anos).",
    "Você pode pedir acesso, correção ou informações sobre seus dados ao RH da empresa.",
  ];
}
