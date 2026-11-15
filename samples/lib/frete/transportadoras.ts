import type { OpcaoDeFrete } from "@/lib/frete/cotacao";

// =============================================================================
// AS TRANSPORTADORAS QUE A LOJA OFERECE, E ONDE ELA ENTREGA OS PACOTES. Puro.
// =============================================================================
// Quem busca é lib/frete/melhor-envio.ts; este módulo lê as respostas sem
// confiar na forma e decide o que vai para a cotação e para a etiqueta.
//
// OS SERVIÇOS (`GET /api/v2/me/shipment/services`, doc "Listar serviços"):
// a lista de serviços que a conta enxerga. A loja marca os que oferece
// (`tenants.frete_servicos_oferecidos`); NADA MARCADO é o comportamento de
// antes — a cotação pede todos. Marcados, o `POST /me/shipment/calculate`
// recebe `services: "1,3"` (doc "Cálculo de fretes por produtos"; MEDIDO no
// sandbox em 08/11/2026: com "1,3" voltaram só PAC e .Package) e a resposta
// ainda é filtrada aqui, porque a régua não pode depender do filtro de lá.
//
// AS AGÊNCIAS (`GET /api/v2/me/shipment/agencies?company&country&state&city`,
// doc "Listar agências"): cada agência diz quais serviços recebe
// (`services: [{id}]`, MEDIDO no sandbox). A loja escolhe UMA por
// transportadora (`tenants.frete_agencias`), e a etiqueta de um serviço que a
// agência recebe leva `agency: <id>` no `POST /me/cart`.
//
// A DOC AVISA (doc "Inserir fretes no carrinho", regra 2): `agency` é
// OBRIGATÓRIO para Latam Cargo, Azul Cargo e Buslog em integrações por token
// do painel, e "fora desse cenário, o ideal é que não seja informado". Por
// isso a agência é OPCIONAL: sem escolha, nada vai no carrinho.
//
// LEVAR OU COLETA: a API não diz, por serviço, se a transportadora busca o
// pacote. A frase sem agência escolhida é neutra.
// =============================================================================

export type ServicoDoMelhorEnvio = {
  id: number;
  nome: string;
  transportadora: string;
  transportadoraId: number;
};

export type AgenciaDoMelhorEnvio = {
  id: number;
  nome: string;
  endereco: string;
  /** Os serviços que a agência recebe. */
  servicos: number[];
};

/** A agência escolhida para uma transportadora, como fica guardada na loja. */
export type AgenciaEscolhida = AgenciaDoMelhorEnvio;

/** `tenants.frete_agencias`: transportadoraId (texto) → agência. */
export type AgenciasEscolhidas = Readonly<Record<string, AgenciaEscolhida>>;

function registro(valor: unknown): Record<string, unknown> | null {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null;
}

function inteiroPositivo(valor: unknown): number | null {
  return typeof valor === "number" && Number.isInteger(valor) && valor > 0 ? valor : null;
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor.trim() : null;
}

function ids(lista: unknown): number[] {
  if (!Array.isArray(lista)) return [];
  const saida: number[] = [];
  for (const cru of lista) {
    const id = inteiroPositivo(registro(cru)?.id ?? cru);
    if (id !== null && !saida.includes(id)) saida.push(id);
  }
  return saida;
}

export function lerServicos(bruto: unknown): ServicoDoMelhorEnvio[] {
  if (!Array.isArray(bruto)) return [];
  const servicos: ServicoDoMelhorEnvio[] = [];
  for (const cru of bruto) {
    const linha = registro(cru);
    const empresa = registro(linha?.company);
    const id = inteiroPositivo(linha?.id);
    const nome = texto(linha?.name);
    const transportadora = texto(empresa?.name);
    const transportadoraId = inteiroPositivo(empresa?.id);
    if (id === null || nome === null || transportadora === null || transportadoraId === null) continue;
    servicos.push({ id, nome, transportadora, transportadoraId });
  }
  return servicos.sort((a, b) => a.transportadora.localeCompare(b.transportadora, "pt-BR") || a.id - b.id);
}

export function lerAgencias(bruto: unknown): AgenciaDoMelhorEnvio[] {
  if (!Array.isArray(bruto)) return [];
  const agencias: AgenciaDoMelhorEnvio[] = [];
  for (const cru of bruto) {
    const linha = registro(cru);
    const id = inteiroPositivo(linha?.id);
    const nome = texto(linha?.name);
    if (id === null || nome === null) continue;
    const endereco = registro(linha?.address);
    const rua = [texto(endereco?.address), texto(endereco?.number)].filter(Boolean).join(", ");
    const partes = [rua || null, texto(endereco?.district), texto(registro(endereco?.city)?.city)].filter(
      (parte): parte is string => parte !== null,
    );
    agencias.push({ id, nome, endereco: partes.join(" · "), servicos: ids(linha?.services) });
  }
  return agencias;
}

/** `tenants.frete_servicos_oferecidos`: inteiros positivos, sem repetição. */
export function lerServicosOferecidos(bruto: unknown): number[] {
  if (!Array.isArray(bruto)) return [];
  const saida: number[] = [];
  for (const cru of bruto) {
    const id = inteiroPositivo(cru);
    if (id !== null && !saida.includes(id)) saida.push(id);
  }
  return saida;
}

/** O `services` do calculate, ou `undefined` (todos, o comportamento de antes). */
export function parametroDeServicos(oferecidos: readonly number[]): string | undefined {
  return oferecidos.length === 0 ? undefined : [...oferecidos].sort((a, b) => a - b).join(",");
}

/** As opções cotadas, só as que a loja oferece. Lista vazia de oferecidos = todas. */
export function filtrarOferecidos(opcoes: readonly OpcaoDeFrete[], oferecidos: readonly number[]): OpcaoDeFrete[] {
  return oferecidos.length === 0 ? [...opcoes] : opcoes.filter((opcao) => oferecidos.includes(opcao.servicoId));
}

export function lerAgenciasEscolhidas(bruto: unknown): AgenciasEscolhidas {
  const linha = registro(bruto);
  if (linha === null) return {};
  const saida: Record<string, AgenciaEscolhida> = {};
  for (const [transportadora, cru] of Object.entries(linha)) {
    const agencia = registro(cru);
    const id = inteiroPositivo(agencia?.id);
    const nome = texto(agencia?.nome);
    if (!/^\d+$/.test(transportadora) || id === null || nome === null) continue;
    saida[transportadora] = { id, nome, endereco: texto(agencia?.endereco) ?? "", servicos: ids(agencia?.servicos) };
  }
  return saida;
}

/**
 * AS TRANSPORTADORAS CUJA ETIQUETA RECUSA `agency`. MEDIDO no sandbox em 08/11/2026: PAC com a
 * agência AC JOINVILLE (26468, da própria lista de agências dos Correios) → 422 "O campo agency
 * selecionado é inválido."; .Package com CO JOINVILLE 02 (Jadlog, 1245) → 201 com `agency_id`.
 * Para estas a tela não oferece a escolha: o pacote vai a qualquer agência, ou coleta.
 */
const SEM_AGENCIA_NA_ETIQUETA: ReadonlySet<number> = new Set([1]); // 1 = Correios

export function aceitaAgenciaNaEtiqueta(transportadoraId: number): boolean {
  return !SEM_AGENCIA_NA_ETIQUETA.has(transportadoraId);
}

/** A agência escolhida que recebe este serviço, ou `null`. */
export function agenciaEscolhidaDoServico(escolhidas: AgenciasEscolhidas, servicoId: number): AgenciaEscolhida | null {
  return Object.values(escolhidas).find((agencia) => agencia.servicos.includes(servicoId)) ?? null;
}

/** O `agency` do carrinho para este serviço, ou `null` (não vai nada). */
export function agenciaDoServico(escolhidas: AgenciasEscolhidas, servicoId: number): number | null {
  return agenciaEscolhidaDoServico(escolhidas, servicoId)?.id ?? null;
}

export function comoChegaATransportadora(escolhidas: AgenciasEscolhidas, servicoId: number): string {
  const agencia = Object.values(escolhidas).find((a) => a.servicos.includes(servicoId));
  return agencia
    ? `Levar até a agência ${agencia.nome}`
    : "Levar até uma agência ou agendar a coleta no Melhor Envio";
}
