// =============================================================================
// A COTAÇÃO DE FRETE — as regras puras. Sem rede, sem banco, sem `server-only`.
// =============================================================================
// O Melhor Envio responde "quanto custa levar ESTES pacotes do CEP A ao CEP B"
// com uma lista de serviços (Correios PAC, SEDEX, Jadlog…). Este módulo faz o
// que vem antes e depois da chamada (lib/frete/melhor-envio.ts):
//
//   antes   os itens da sacola viram a lista de `products` que a API empacota
//           sozinha — ela recebe peça por peça, com medida e peso, e escolhe a
//           caixa;
//   depois  a resposta crua vira `OpcaoDeFrete[]`, as opções que a API não
//           atende saem, e a regra de frete grátis da loja é aplicada.
//
// AS MEDIDAS SÃO AS DA LÉPRICA, medidas na balança em 26/10/2026: cada peça
// dobrada no envelope plástico de envio, com o peso do envelope junto. A
// ESPESSURA do envelope fechado não veio e está estimada (a transportadora
// exige altura). O dia em que vier, ou a medida virar cadastro no painel, o
// valor muda AQUI — e nada mais precisa saber.
// =============================================================================

import type { ProducaoDoPedido } from "@/lib/frete/prazos";

export type MedidasDaPeca = {
  alturaCm: number;
  larguraCm: number;
  comprimentoCm: number;
  pesoKg: number;
};

/**
 * As embalagens reais da Léprica (26/10/2026). Largura × comprimento e peso
 * medidos; a ALTURA é a espessura do envelope fechado, estimada.
 * A oversized ainda não foi medida e usa a medida da camiseta básica.
 */
export const MEDIDAS_DAS_EMBALAGENS: Readonly<Record<"camiseta" | "babyLook" | "moletom", MedidasDaPeca>> = {
  camiseta: { alturaCm: 3, larguraCm: 25, comprimentoCm: 35, pesoKg: 0.182 },
  babyLook: { alturaCm: 2, larguraCm: 25, comprimentoCm: 35, pesoKg: 0.133 },
  moletom: { alturaCm: 6, larguraCm: 35, comprimentoCm: 45, pesoKg: 0.62 },
};

/** A medida de UMA peça, pelo nome do produto ou do modelo. */
export function medidasDaPeca(nome: string): MedidasDaPeca {
  if (/molet[oô]m|moleton|hoodie|casaco/i.test(nome)) return MEDIDAS_DAS_EMBALAGENS.moletom;
  if (/baby\s*-?\s*look/i.test(nome)) return MEDIDAS_DAS_EMBALAGENS.babyLook;
  return MEDIDAS_DAS_EMBALAGENS.camiseta;
}

export type PecaParaCotar = {
  /** Nome do produto ou do modelo — é dele que sai a medida. */
  nome: string;
  quantidade: number;
  /** O preço unitário: vira o valor declarado (seguro) da peça. */
  precoUnitario: number;
};

/** A lista `products` do `POST /me/shipment/calculate`. */
export type ProdutoDaCotacao = {
  id: string;
  width: number;
  height: number;
  length: number;
  weight: number;
  insurance_value: number;
  quantity: number;
};

export function produtosParaCotacao(pecas: readonly PecaParaCotar[]): ProdutoDaCotacao[] {
  return pecas
    .filter((peca) => peca.quantidade > 0)
    .map((peca, indice) => {
      const medida = medidasDaPeca(peca.nome);
      return {
        id: String(indice + 1),
        width: medida.larguraCm,
        height: medida.alturaCm,
        length: medida.comprimentoCm,
        weight: medida.pesoKg,
        insurance_value: Math.max(0, peca.precoUnitario),
        quantity: peca.quantidade,
      };
    });
}

/** Uma opção de entrega que a cliente pode escolher. */
export type OpcaoDeFrete = {
  /** O id do serviço no Melhor Envio — é o que a etiqueta usa depois. */
  servicoId: number;
  transportadora: string;
  servico: string;
  /** O que a TRANSPORTADORA cobra. */
  custo: number;
  /** O que a CLIENTE paga: o custo, ou zero quando é o frete grátis da loja. */
  preco: number;
  prazoDias: number;
  gratis: boolean;
  /**
   * A produção do pedido, quando a loja tem prazos (lib/frete/prazos.ts). Só a opção ESCOLHIDA
   * a carrega (`opcaoEscolhida`), e ela vai para `pedidos.envio.producao`.
   */
  producao?: ProducaoDoPedido | null;
};

function numeroOuNull(valor: unknown): number | null {
  const numero = typeof valor === "number" ? valor : typeof valor === "string" ? Number(valor) : NaN;
  return Number.isFinite(numero) ? numero : null;
}

function registro(valor: unknown): Record<string, unknown> | null {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null;
}

/**
 * A resposta crua do Melhor Envio vira as opções que a tela oferece.
 *
 * SAI DA LISTA o que não serve: serviço com `error` (a transportadora não
 * atende o CEP, ou a caixa passou do limite dela), preço ou prazo que não é
 * número, preço zero ou negativo. Mostrar "Mini Envios — indisponível" para a
 * cliente é ruído; ela só precisa das opções que de fato levam o pedido.
 *
 * O PREÇO É O `custom_price` QUANDO EXISTE: é o valor que a conta da loja
 * configurou no Melhor Envio (com desconto, acréscimo de manuseio…), e não a
 * tabela cheia. O mesmo vale para `custom_delivery_time`.
 *
 * Ordem: do mais barato para o mais caro, e prazo menor no empate.
 */
export function lerCotacao(bruta: unknown): OpcaoDeFrete[] {
  if (!Array.isArray(bruta)) return [];
  const opcoes: OpcaoDeFrete[] = [];
  for (const cru of bruta) {
    const linha = registro(cru);
    if (linha === null || linha.error) continue;
    const servicoId = numeroOuNull(linha.id);
    const custo = numeroOuNull(linha.custom_price ?? linha.price);
    const prazo = numeroOuNull(linha.custom_delivery_time ?? linha.delivery_time);
    const empresa = registro(linha.company);
    const transportadora = typeof empresa?.name === "string" ? empresa.name : null;
    const servico = typeof linha.name === "string" ? linha.name : null;
    if (servicoId === null || custo === null || custo <= 0 || prazo === null) continue;
    if (transportadora === null || servico === null) continue;
    opcoes.push({
      servicoId,
      transportadora,
      servico,
      custo: Math.round(custo * 100) / 100,
      preco: Math.round(custo * 100) / 100,
      prazoDias: Math.round(prazo),
      gratis: false,
    });
  }
  return opcoes.sort((a, b) => a.custo - b.custo || a.prazoDias - b.prazoDias);
}

/**
 * O FRETE GRÁTIS DA LOJA, aplicado às opções.
 *
 * A loja anuncia "frete grátis acima de R$ X" (`tenants.limiar_frete_gratis`).
 * Acima do limiar, a opção MAIS BARATA sai de graça para a cliente; as outras
 * continuam com o preço delas — quem quer chegar mais rápido paga a diferença
 * da escolha. É a regra comum do varejo, e é a única que não obriga a loja a
 * bancar um SEDEX para o outro lado do país.
 *
 * O VALOR COMPARADO é o total das peças a preço de venda (o preço "por"), SEM
 * descontar cupom, desconto por quantidade nem boas-vindas
 * (`valorParaOFreteGratis`, lib/vitrine/pedido.ts). Decisão de produto de
 * 09/11/2026, que revoga a D11: o desconto não tira o frete que o carrinho alcançou.
 */
export function aplicarFreteGratis(
  opcoes: readonly OpcaoDeFrete[],
  valorDasPecas: number,
  limiar: number | null,
): OpcaoDeFrete[] {
  const ganhou = limiar !== null && limiar > 0 && valorDasPecas >= limiar;
  const maisBarata = opcoes.reduce<OpcaoDeFrete | null>(
    (menor, opcao) => (menor === null || opcao.custo < menor.custo ? opcao : menor),
    null,
  );
  return opcoes.map((opcao) =>
    ganhou && opcao === maisBarata ? { ...opcao, preco: 0, gratis: true } : { ...opcao },
  );
}

/** O CEP com 8 dígitos, ou `null`. Aceita "89201-000" e "89201000". */
export function cepValido(bruto: string | null | undefined): string | null {
  const digitos = (bruto ?? "").replace(/\D/g, "");
  return digitos.length === 8 ? digitos : null;
}

/** "Correios PAC · 7 dias úteis". */
export function descreverOpcao(opcao: Pick<OpcaoDeFrete, "transportadora" | "servico" | "prazoDias">): string {
  const dias = opcao.prazoDias === 1 ? "1 dia útil" : `${opcao.prazoDias} dias úteis`;
  return `${opcao.transportadora} ${opcao.servico} · ${dias}`;
}
