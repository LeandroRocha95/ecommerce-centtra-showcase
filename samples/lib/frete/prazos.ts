import { FUSO_DA_LOJA } from "@/lib/vitrine/datas";

// =============================================================================
// O PRAZO TOTAL — "Chega até dd/mm". Módulo puro: sem rede, sem banco.
// =============================================================================
// O prazo da transportadora é só o TRANSPORTE. A peça ainda precisa ficar
// pronta: a loja piloto faz quase tudo sob encomenda. A data que a cliente lê é
//
//   dia do pagamento (ou hoje)  →  início da produção (respeitando o horário de corte)
//                               →  + produção (dias úteis)  = "pronto para enviar até"
//                               →  + prazo do frete (dias úteis) = "chega até"
//
// A PRODUÇÃO DO PEDIDO é o MAIOR prazo entre os itens, pela PORTA de cada um:
//   pronta  peça de coleção com saldo no estoque;
//   lisa    peça lisa no estoque, só estampar — a porta ainda não existe no
//           sistema; o campo e a conta estão prontos para quando existir;
//   doZero  sem saldo (sob encomenda): faz a peça inteira;
//   monte   "Monte a sua": conta da APROVAÇÃO DA ARTE, não do pagamento.
//
// SEM PRAZO CONFIGURADO NENHUM, nada muda: a data é só a do frete, como antes.
//
// DIA ÚTIL é segunda a sexta. Feriado está fora do escopo de hoje: a régua é um
// parâmetro (`ehDiaUtil`) em toda conta, e um calendário de feriados entra por ele.
// =============================================================================

export type PortaDeProducao = "pronta" | "lisa" | "doZero" | "monte";

export type PrazosDeProducao = {
  pronta: number | null;
  lisa: number | null;
  doZero: number | null;
  monte: number | null;
  /** "14:00": pago DEPOIS disto, conta a partir do próximo dia útil. */
  corte: string | null;
};

/** O teto de um prazo de produção, o mesmo do CHECK do banco. */
export const PRAZO_MAXIMO_DIAS = 90;

const HORARIO = /^([01]\d|2[0-3]):([0-5]\d)$/;

function diasOuNull(valor: unknown): number | null {
  return typeof valor === "number" && Number.isInteger(valor) && valor >= 0 && valor <= PRAZO_MAXIMO_DIAS
    ? valor
    : null;
}

export function horarioValido(valor: unknown): string | null {
  return typeof valor === "string" && HORARIO.test(valor) ? valor : null;
}

/** `tenants.prazos_de_producao` (chaves do banco: pronta, lisa, do_zero, monte, corte), lida sem confiar na forma. */
export function lerPrazosDeProducao(bruto: unknown): PrazosDeProducao {
  const linha =
    typeof bruto === "object" && bruto !== null && !Array.isArray(bruto) ? (bruto as Record<string, unknown>) : {};
  return {
    pronta: diasOuNull(linha.pronta),
    lisa: diasOuNull(linha.lisa),
    doZero: diasOuNull(linha.do_zero),
    monte: diasOuNull(linha.monte),
    corte: horarioValido(linha.corte),
  };
}

/** O objeto que vai para o banco: só as chaves preenchidas. */
export function prazosParaOBanco(prazos: PrazosDeProducao): Record<string, number | string> {
  const saida: Record<string, number | string> = {};
  if (prazos.pronta !== null) saida.pronta = prazos.pronta;
  if (prazos.lisa !== null) saida.lisa = prazos.lisa;
  if (prazos.doZero !== null) saida.do_zero = prazos.doZero;
  if (prazos.monte !== null) saida.monte = prazos.monte;
  if (prazos.corte !== null) saida.corte = prazos.corte;
  return saida;
}

export function prazosConfigurados(prazos: PrazosDeProducao): boolean {
  return prazos.pronta !== null || prazos.lisa !== null || prazos.doZero !== null || prazos.monte !== null;
}

/** A porta de UM item do carrinho. `disponivel` = saldo menos reservado da variante; `null` = não se sabe. */
export function portaDaPeca(item: {
  natureza: "variante" | "personalizado";
  disponivel: number | null;
  quantidade: number;
}): PortaDeProducao {
  if (item.natureza === "personalizado") return "monte";
  return item.disponivel !== null && item.disponivel >= item.quantidade ? "pronta" : "doZero";
}

export type ProducaoDoPedido = {
  dias: number;
  /** Tem "Monte a sua": a conta começa na aprovação da arte. */
  aPartirDaArte: boolean;
  corte: string | null;
};

/** A produção do pedido: o MAIOR prazo entre as portas. `null` = loja sem prazos (comportamento de antes). */
export function producaoDoPedido(
  portas: readonly PortaDeProducao[],
  prazos: PrazosDeProducao,
): ProducaoDoPedido | null {
  if (portas.length === 0 || !prazosConfigurados(prazos)) return null;
  const dias = Math.max(...portas.map((porta) => prazos[porta] ?? 0));
  return { dias, aPartirDaArte: portas.includes("monte"), corte: prazos.corte };
}

/**
 * A PRODUÇÃO DE UM PEDIDO QUE NÃO A GRAVOU (feito antes dos prazos de 08/11, ou fora do
 * checkout), pelos prazos da loja de HOJE: a regra de `producaoDoPedido` (o maior prazo
 * entre os itens), com a peça do catálogo como "feita do zero" — o estoque daquele dia não
 * se sabe mais, e o prazo maior não cobra cedo demais — e o Monte a sua como "monte".
 * Pedido sem itens legíveis conta como uma peça do catálogo. `null` = loja sem prazos.
 */
export function producaoPelosPrazosDaLoja(
  naturezas: readonly (string | null | undefined)[],
  prazos: PrazosDeProducao | null | undefined,
): ProducaoDoPedido | null {
  if (!prazos) return null;
  const portas: PortaDeProducao[] = (naturezas.length > 0 ? naturezas : [null]).map((natureza) =>
    natureza === "personalizado" ? "monte" : "doZero",
  );
  return producaoDoPedido(portas, prazos);
}

export type DataCivil = { ano: number; mes: number; dia: number };

/** A régua de dia útil. O ponto de extensão dos feriados é trocar esta função. */
export type ReguaDeDiaUtil = (data: DataCivil) => boolean;

function diaDaSemana(data: DataCivil): number {
  return new Date(Date.UTC(data.ano, data.mes - 1, data.dia)).getUTCDay();
}

export const segundaASexta: ReguaDeDiaUtil = (data) => {
  const semana = diaDaSemana(data);
  return semana !== 0 && semana !== 6;
};

function diaSeguinte(data: DataCivil): DataCivil {
  const d = new Date(Date.UTC(data.ano, data.mes - 1, data.dia + 1));
  return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate() };
}

/** `n` dias úteis depois de `data` (0 = a própria data). */
export function somarDiasUteis(data: DataCivil, n: number, ehDiaUtil: ReguaDeDiaUtil = segundaASexta): DataCivil {
  let atual = data;
  let faltam = n;
  while (faltam > 0) {
    atual = diaSeguinte(atual);
    if (ehDiaUtil(atual)) faltam -= 1;
  }
  return atual;
}

const PARTES = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO_DA_LOJA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function naLoja(iso: string): (DataCivil & { minutos: number }) | null {
  const instante = Date.parse(iso);
  if (Number.isNaN(instante)) return null;
  const partes = PARTES.formatToParts(instante);
  const de = (tipo: Intl.DateTimeFormatPartTypes) => Number(partes.find((p) => p.type === tipo)?.value);
  return { ano: de("year"), mes: de("month"), dia: de("day"), minutos: de("hour") * 60 + de("minute") };
}

/**
 * O dia em que a produção começa a contar: o dia do pagamento na loja, ou o próximo dia útil
 * quando ele foi depois do corte ou caiu fora de dia útil. `null` = data ilegível.
 */
export function inicioDaProducao(
  iso: string,
  corte: string | null,
  ehDiaUtil: ReguaDeDiaUtil = segundaASexta,
): DataCivil | null {
  const agora = naLoja(iso);
  if (agora === null) return null;
  let dia: DataCivil = { ano: agora.ano, mes: agora.mes, dia: agora.dia };
  const limite = horarioValido(corte);
  if (limite !== null) {
    const [h, m] = limite.split(":").map(Number) as [number, number];
    if (agora.minutos > h * 60 + m) dia = diaSeguinte(dia);
  }
  while (!ehDiaUtil(dia)) dia = diaSeguinte(dia);
  return dia;
}

export type DatasDaEntrega = {
  /** O limite da produção ("Pronto para enviar até"). `null` quando a loja não tem prazos. */
  prontoAte: DataCivil | null;
  chegaAte: DataCivil;
};

export function datasDaEntrega(entrada: {
  /** O pagamento, ou agora. */
  desde: string;
  producao: ProducaoDoPedido | null;
  prazoFreteDias: number;
  ehDiaUtil?: ReguaDeDiaUtil;
}): DatasDaEntrega | null {
  const regua = entrada.ehDiaUtil ?? segundaASexta;
  if (!Number.isInteger(entrada.prazoFreteDias) || entrada.prazoFreteDias < 0) return null;
  if (entrada.producao === null) {
    // O COMPORTAMENTO DE ANTES: do dia de hoje, só o transporte.
    const hoje = naLoja(entrada.desde);
    if (hoje === null) return null;
    return {
      prontoAte: null,
      chegaAte: somarDiasUteis({ ano: hoje.ano, mes: hoje.mes, dia: hoje.dia }, entrada.prazoFreteDias, regua),
    };
  }
  const inicio = inicioDaProducao(entrada.desde, entrada.producao.corte, regua);
  if (inicio === null) return null;
  const prontoAte = somarDiasUteis(inicio, entrada.producao.dias, regua);
  return { prontoAte, chegaAte: somarDiasUteis(prontoAte, entrada.prazoFreteDias, regua) };
}

/** O dia de hoje na loja (fuso da loja). `null` = instante ilegível. */
export function diaNaLoja(iso: string): DataCivil | null {
  const p = naLoja(iso);
  return p === null ? null : { ano: p.ano, mes: p.mes, dia: p.dia };
}

/** `a` vem antes de `b`? */
export function antesDe(a: DataCivil, b: DataCivil): boolean {
  return a.ano !== b.ano ? a.ano < b.ano : a.mes !== b.mes ? a.mes < b.mes : a.dia < b.dia;
}

/** "02/12". */
export function ddmm(data: DataCivil): string {
  return `${String(data.dia).padStart(2, "0")}/${String(data.mes).padStart(2, "0")}`;
}

export function fraseChegaAte(chegaAte: DataCivil, aPartirDaArte: boolean): string {
  return aPartirDaArte
    ? `Chega até ${ddmm(chegaAte)}, a partir da aprovação da prova de arte`
    : `Chega até ${ddmm(chegaAte)}`;
}

/** O que viaja no `envio` do pedido para refazer a conta depois do pagamento. */
export type ProducaoNoPedido = { dias: number; a_partir_da_arte: boolean; corte: string | null };

export function producaoParaOPedido(producao: ProducaoDoPedido | null): ProducaoNoPedido | null {
  return producao === null ? null : { dias: producao.dias, a_partir_da_arte: producao.aPartirDaArte, corte: producao.corte };
}

/** `envio.producao` do pedido, lida sem confiar na forma. */
export function lerProducaoDoPedido(bruto: unknown): ProducaoDoPedido | null {
  if (typeof bruto !== "object" || bruto === null || Array.isArray(bruto)) return null;
  const linha = bruto as Record<string, unknown>;
  const dias = diasOuNull(linha.dias);
  if (dias === null) return null;
  return { dias, aPartirDaArte: linha.a_partir_da_arte === true, corte: horarioValido(linha.corte) };
}
