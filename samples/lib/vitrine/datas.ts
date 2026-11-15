// =============================================================================
// As DATAS da loja — "Próxima data" e "Santo do dia" (anexo 01 §3.2) — PURO.
// =============================================================================
// O CALENDÁRIO É DA LOJA (Loja › Datas e santos, 20261101200000): o Natal e o
// calendário litúrgico do modelo são dado de demonstração e NÃO moram no código.
// A tabela nasce vazia; loja sem data de contagem não tem o painel escuro, e
// loja sem santo cadastrado não tem o cartão (spec §6.1, P16).
//
// UMA DATA É DIA + MÊS, SEM ANO: repete todo ano. Quem decide em qual ano ela
// cai é a conta daqui, sempre no FUSO DA COMPRADORA (America/Sao_Paulo) — o
// servidor de produção roda em UTC, e "hoje" no Brasil às 22h já é amanhã em
// UTC. 29/02 só existe nos anos bissextos: nos outros, a data é pulada.
//
// MÓDULO PURO, e por isso sem `server-only`: o relógio do painel escuro roda no
// navegador e refaz a conta a cada minuto com estas mesmas funções.
// =============================================================================

import type { FundoDaData } from "@/lib/vitrine/fundo-da-data";

export const FUSO_DA_LOJA = "America/Sao_Paulo";

export type DataDaLoja = {
  tipo: "contagem" | "santo";
  nome: string;
  dia: number;
  mes: number;
  frase: string | null;
  nota: string | null;
  /** A estampa ligada, só quando ela tem produto no ar (`lerTagsComProduto`). */
  tag: { nome: string; slug: string } | null;
  /**
   * O fundo do bloco "Próxima data" (20261109499400): imagem ou cor. `null` = o
   * bloco de sempre. Só a data de contagem usa.
   */
  fundo: FundoDaData | null;
};

export const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

/** O ano tem 29/02? */
function bissexto(ano: number): boolean {
  return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
}

/** O dia existe neste ano? (31/04 nunca; 29/02 só no bissexto.) */
function existe(ano: number, mes: number, dia: number): boolean {
  if (mes < 1 || mes > 12 || dia < 1) return false;
  const dias = [31, bissexto(ano) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return dia <= dias[mes - 1];
}

const PARTES = new Intl.DateTimeFormat("en-US", {
  timeZone: FUSO_DA_LOJA,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

/** O relógio de parede do fuso da loja no instante dado. */
function relogioDaLoja(instante: number): {
  ano: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
} {
  const partes = PARTES.formatToParts(instante);
  const valor = (tipo: string) => Number(partes.find((parte) => parte.type === tipo)?.value ?? 0);
  return {
    ano: valor("year"),
    mes: valor("month"),
    dia: valor("day"),
    hora: valor("hour") % 24,
    minuto: valor("minute"),
    segundo: valor("second"),
  };
}

/** Quantos ms o relógio da loja está à frente do UTC (negativo no Brasil). */
function deslocamento(instante: number): number {
  const r = relogioDaLoja(instante);
  const comoUtc = Date.UTC(r.ano, r.mes - 1, r.dia, r.hora, r.minuto, r.segundo);
  return comoUtc - Math.floor(instante / 1000) * 1000;
}

/** O instante da meia-noite do dia dado, no fuso da loja. */
export function meiaNoiteNaLoja(ano: number, mes: number, dia: number): number {
  const comoUtc = Date.UTC(ano, mes - 1, dia);
  // Duas voltas: a segunda acerta o caso (raro) de o deslocamento mudar entre a
  // meia-noite UTC e a da loja — o horário de verão, se um dia voltar.
  let instante = comoUtc - deslocamento(comoUtc);
  instante = comoUtc - deslocamento(instante);
  return instante;
}

/** "Hoje" no fuso da loja. */
export function hojeNaLoja(agora: Date): { ano: number; mes: number; dia: number } {
  const r = relogioDaLoja(agora.getTime());
  return { ano: r.ano, mes: r.mes, dia: r.dia };
}

/**
 * O ano da próxima vez que (dia, mês) acontece a partir de `desde` (inclusive),
 * pulando os anos em que o dia não existe. `null` = o dia não existe nunca.
 */
function anoDaProxima(
  mes: number,
  dia: number,
  desde: { ano: number; mes: number; dia: number },
  incluirHoje: boolean,
): number | null {
  for (let ano = desde.ano; ano <= desde.ano + 8; ano++) {
    if (!existe(ano, mes, dia)) continue;
    if (ano > desde.ano) return ano;
    const depois = mes > desde.mes || (mes === desde.mes && (incluirHoje ? dia >= desde.dia : dia > desde.dia));
    if (depois) return ano;
  }
  return null;
}

export type Contagem = { data: DataDaLoja; dias: number; horas: number; minutos: number };

/**
 * A data de CONTAGEM mais próxima e quanto falta para a meia-noite dela, no fuso
 * da loja. A data de hoje, depois da meia-noite, já chegou: vale a do ano que
 * vem (o modelo faz o mesmo). `null` = a loja não tem data de contagem.
 */
export function proximaContagem(datas: readonly DataDaLoja[], agora: Date): Contagem | null {
  const instante = agora.getTime();
  const hoje = hojeNaLoja(agora);
  let melhor: { data: DataDaLoja; falta: number } | null = null;

  for (const data of datas) {
    if (data.tipo !== "contagem") continue;
    // `incluirHoje: false`: a meia-noite de hoje já passou.
    const ano = anoDaProxima(data.mes, data.dia, hoje, false);
    if (ano === null) continue;
    const falta = meiaNoiteNaLoja(ano, data.mes, data.dia) - instante;
    if (falta <= 0) continue;
    if (melhor === null || falta < melhor.falta) melhor = { data, falta };
  }

  if (melhor === null) return null;
  return {
    data: melhor.data,
    dias: Math.floor(melhor.falta / DIA),
    horas: Math.floor((melhor.falta % DIA) / HORA),
    minutos: Math.floor((melhor.falta % HORA) / MINUTO),
  };
}

/** O instante da meia-noite da data de contagem escolhida (o alvo do relógio). */
export function alvoDaContagem(data: DataDaLoja, agora: Date): number | null {
  const ano = anoDaProxima(data.mes, data.dia, hojeNaLoja(agora), false);
  return ano === null ? null : meiaNoiteNaLoja(ano, data.mes, data.dia);
}

/** Dias, horas e minutos até o alvo (nunca negativos). */
export function faltaAte(alvo: number, agora: number): { dias: number; horas: number; minutos: number } {
  const falta = Math.max(0, alvo - agora);
  return {
    dias: Math.floor(falta / DIA),
    horas: Math.floor((falta % DIA) / HORA),
    minutos: Math.floor((falta % HORA) / MINUTO),
  };
}

/**
 * O santo de HOJE (no fuso da loja), ou a próxima festa cadastrada — na virada
 * do ano, a primeira do ano que vem. `null` = a loja não cadastrou santo.
 */
export function santoDoDia(
  datas: readonly DataDaLoja[],
  agora: Date,
): { hoje: boolean; data: DataDaLoja } | null {
  const hoje = hojeNaLoja(agora);
  let melhor: { data: DataDaLoja; chave: number } | null = null;

  for (const data of datas) {
    if (data.tipo !== "santo") continue;
    const ano = anoDaProxima(data.mes, data.dia, hoje, true);
    if (ano === null) continue;
    const chave = ano * 10_000 + data.mes * 100 + data.dia;
    if (melhor === null || chave < melhor.chave) melhor = { data, chave };
  }

  if (melhor === null) return null;
  const ehHoje = melhor.chave === hoje.ano * 10_000 + hoje.mes * 100 + hoje.dia;
  return { hoje: ehHoje, data: melhor.data };
}

/** "1 de novembro". */
export function diaPorExtenso(dia: number, mes: number): string {
  return `${dia} de ${MESES[mes - 1]}`;
}

/** A linha de cima do cartão do santo: "Hoje, 1 de novembro" ou "Próxima festa, 8 de dezembro". */
export function linhaDoSanto(santo: { hoje: boolean; data: DataDaLoja }): string {
  return `${santo.hoje ? "Hoje" : "Próxima festa"}, ${diaPorExtenso(santo.data.dia, santo.data.mes)}`;
}

function plural(n: number, um: string, varios: string): string {
  return n === 1 ? um : varios;
}

/** Os três blocos do relógio: o número e o rótulo (anexo 01 §3.2). */
export function blocosDaContagem(falta: { dias: number; horas: number; minutos: number }) {
  return [
    { chave: "dias", n: falta.dias, rotulo: plural(falta.dias, "dia", "dias") },
    { chave: "horas", n: falta.horas, rotulo: plural(falta.horas, "hora", "horas") },
    { chave: "minutos", n: falta.minutos, rotulo: "min" },
  ] as const;
}

/**
 * O `aria-label` do relógio: "Faltam 53 dias, 14 horas e 0 minutos para Natal".
 *
 * O modelo escreve "para o Natal"; o artigo é o único pedaço que não veio, porque
 * o nome é da LOJA e o código não sabe o gênero dele ("para o Páscoa" seria pior
 * que "para Páscoa"). As unidades vão no singular quando o número é 1.
 */
export function rotuloDaContagem(
  falta: { dias: number; horas: number; minutos: number },
  nome: string,
): string {
  return (
    `Faltam ${falta.dias} ${plural(falta.dias, "dia", "dias")}, ` +
    `${falta.horas} ${plural(falta.horas, "hora", "horas")} e ` +
    `${falta.minutos} ${plural(falta.minutos, "minuto", "minutos")} para ${nome}`
  );
}
